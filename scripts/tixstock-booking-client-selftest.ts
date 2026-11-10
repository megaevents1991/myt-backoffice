// Run: npx tsx scripts/tixstock-booking-client-selftest.ts
// The TixStock booking API client (lib/tixstock-booking/client.ts, byte-identical in myt-main) and the backoffice's
// environment resolver (lib/services/tixstock-booking-env.ts). Every call goes through a stub fetch: no network.
// What matters most here: an answer we did not get is `no_answer` (the order may exist - never call again), an
// answer that says no is `refused`, and only "Resource Not Found" means the hold expired.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md.
import assert from "node:assert/strict";
import { createTixstockClient, holdExpired, type TixstockCall } from "../lib/tixstock-booking/client";
import { TIXSTOCK_PRODUCTION_URL, tixstockClientFor } from "../lib/services/tixstock-booking-env";

type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Answer = Response | Error | "hang";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const stub = (answers: Answer[]) => {
  const calls: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error("the stub has no more answers");
    if (answer === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
      });
    }
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { calls, fetchImpl };
};

const BASE = "https://sandbox-pf.tixstock.com/v1";
const client = (answers: Answer[], timeoutMs?: number) => {
  const s = stub(answers);
  return { ...s, api: createTixstockClient({ baseUrl: BASE, token: "T", fetchImpl: s.fetchImpl, timeoutMs }) };
};
const kindOf = (r: TixstockCall<unknown>): string => (r.ok ? "ok" : r.kind);

const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
  await fn();
  console.log("ok -", name);
};

// tsx compiles these scripts to CommonJS, where a top-level await is not allowed: the cases run inside main().
// prettier-ignore
const main = async (): Promise<void> => {
await run("bearer and currency", async () => {
  const { api, calls } = client([
    json(200, { data: [{ id: "L1" }, { id: "L2" }], meta: { last_page: 2 } }),
    json(200, { data: [{ id: "L3" }], meta: { last_page: 2 } }),
  ]);
  const r = await api.listings("E1");
  assert.equal(calls[0].url, `${BASE}/tickets/feed?event_id=E1&target_currency=USD&per_page=50&page=1`);
  assert.equal(calls[1].url, `${BASE}/tickets/feed?event_id=E1&target_currency=USD&per_page=50&page=2`);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.Authorization, "Bearer T");
  assert.equal(calls.length, 2);
  assert.deepEqual(r, { ok: true, data: [{ id: "L1" }, { id: "L2" }, { id: "L3" }] });
});

await run("a feed page that fails fails the whole read", async () => {
  const { api } = client([json(200, { data: [{ id: "L1" }], meta: { last_page: 2 } }), json(502, {})]);
  assert.equal(kindOf(await api.listings("E1")), "no_answer", "half a feed is never handed out as the feed");
});

await run("venue country", async () => {
  const a = client([json(200, { data: [{ venue: { country_code: "IT" } }] })]);
  assert.deepEqual(await a.api.eventVenueCountry("E 1"), { ok: true, data: "IT" });
  assert.equal(a.calls[0].url, `${BASE}/feed?event_id=E+1&per_page=1`);
  const b = client([json(200, { data: [] })]);
  assert.deepEqual(await b.api.eventVenueCountry("E1"), { ok: true, data: null });
});

await run("hold id", async () => {
  const { api, calls } = client([json(200, { meta: { hold_id: "h1" } })]);
  assert.deepEqual(await api.hold("L1", 2), { ok: true, data: { holdId: "h1" } });
  assert.equal(calls[0].url, `${BASE}/tickets/hold`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { listing_id: "L1", quantity: 2 });
  const none = client([json(200, { meta: {} })]);
  assert.equal(kindOf(await none.api.hold("L1", 2)), "refused", "a 200 with no hold id is not a hold");
});

await run("5xx is no_answer", async () => {
  assert.equal(kindOf(await client([json(502, { message: "bad gateway" })]).api.addOrder("h1", 2, {})), "no_answer");
  assert.equal(kindOf(await client([new DOMException("aborted", "AbortError")]).api.addOrder("h1", 2, {})), "no_answer");
  assert.equal(kindOf(await client([new TypeError("fetch failed")]).api.addOrder("h1", 2, {})), "no_answer");
});

await run("the timeout aborts the call and is no_answer", async () => {
  const r = await client(["hang"], 20).api.addOrder("h1", 2, {});
  assert.equal(kindOf(r), "no_answer");
});

await run("4xx is refused", async () => {
  const forbidden = await client([json(403, { message: "request is forbidden" })]).api.hold("L1", 2);
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok && forbidden.kind === "refused") {
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.message, "request is forbidden");
  } else assert.fail("a 403 is refused");
  const gone = await client([json(400, { code: 108, message: "hold exceeds availability" })]).api.hold("L1", 2);
  assert.equal(!gone.ok && gone.kind === "refused" ? gone.code : null, 108);
  const limited = await client([json(429, { message: "Too Many Attempts." })]).api.addOrder("h1", 2, {});
  assert.equal(kindOf(limited), "refused", "a rate limit is an answer: nothing was created");
});

await run("empty add answer", async () => {
  const r = await client([json(200, [])]).api.addOrder("h1", 2, {});
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.kind === "refused" ? /datetime/.test(r.message) : false, true, "an empty array means a bad datetime");
});

await run("a 200 that says nothing clear on orders/add is no_answer", async () => {
  const text = await client([new Response("OK", { status: 200 })]).api.addOrder("h1", 2, {});
  assert.equal(kindOf(text), "no_answer", "the order may exist");
  const vague = await client([json(200, { message: "done" })]).api.addOrder("h1", 2, {});
  assert.equal(kindOf(vague), "no_answer", "no order id and no clear refusal");
  const said = await client([json(200, { success: false, message: "Listing is not available" })]).api.addOrder("h1", 2, {});
  assert.equal(kindOf(said), "refused", "a 200 that says it failed is a refusal");
});

await run("expired hold", async () => {
  const expired = await client([json(404, { message: "Resource Not Found" })]).api.addOrder("h1", 2, {});
  assert.equal(kindOf(expired), "refused");
  assert.equal(holdExpired(expired), true);
  const other = await client([json(400, { code: 108, message: "hold exceeds availability" })]).api.addOrder("h1", 2, {});
  assert.equal(holdExpired(other), false);
  const lost = await client([json(502, {})]).api.addOrder("h1", 2, {});
  assert.equal(holdExpired(lost), false, "an unanswered call never reads as an expired hold");
  assert.equal(holdExpired({ ok: true, data: 1 }), false);
  assert.equal(holdExpired({ ok: false, kind: "refused", status: 400, message: "resource not found" }), true);
});

await run("order answer", async () => {
  const { api, calls } = client([json(200, { data: { id: "9", status: "Approved", currency: "GBP", grand_total: "150.00" } })]);
  const r = await api.addOrder("h 1", 2, { order_status: "Approved" });
  assert.deepEqual(r, { ok: true, data: { orderId: "9", status: "Approved", currency: "GBP", total: 150 } });
  assert.equal(calls[0].url, `${BASE}/orders/add/h%201/2`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { order_status: "Approved" });
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  const bare = await client([json(200, { data: { id: 77, status: "Sale on Hold" } })]).api.addOrder("h1", 1, {});
  assert.deepEqual(bare, { ok: true, data: { orderId: "77", status: "Sale on Hold", currency: null, total: null } });
});

await run("release", async () => {
  const { api, calls } = client([json(200, { message: "released" })]);
  assert.deepEqual(await api.release("h1", 2), { ok: true, data: true });
  assert.equal(calls[0].url, `${BASE}/tickets/release/h1/2`);
  assert.equal(calls[0].method, "POST");
  const already = await client([json(400, { code: 109, message: "release exceeds on-hold" })]).api.release("h1", 2);
  assert.deepEqual(already, { ok: true, data: true }, "already released is fine");
  assert.equal(kindOf(await client([json(403, { message: "no" })]).api.release("h1", 2)), "refused");
});

await run("update and get", async () => {
  const u = client([json(200, { data: { id: "9", status: "Approved" } })]);
  assert.deepEqual(await u.api.updateOrder("9", { order_status: "Approved" }), { ok: true, data: { status: "Approved" } });
  assert.equal(u.calls[0].url, `${BASE}/orders/update/9`);
  assert.equal(u.calls[0].method, "POST");
  assert.deepEqual(u.calls[0].body, { order_status: "Approved" });
  const g = client([json(200, { data: { id: "9", status: "Commissionable", items: [] } })]);
  assert.deepEqual(await g.api.getOrder("9"), { ok: true, data: { id: "9", status: "Commissionable", items: [] } });
  assert.equal(g.calls[0].url, `${BASE}/orders/get/9`);
  assert.equal(g.calls[0].method, "GET");
  assert.equal(kindOf(await client([json(404, { message: "Resource Not Found" })]).api.getOrder("9")), "refused");
});

await run("a trailing slash on the base url changes nothing", async () => {
  const s = stub([json(200, { meta: { hold_id: "h1" } })]);
  await createTixstockClient({ baseUrl: `${BASE}/`, token: "T", fetchImpl: s.fetchImpl }).hold("L1", 1);
  assert.equal(s.calls[0].url, `${BASE}/tickets/hold`);
});

await run("env resolver", async () => {
  const NAMES = [
    "NEXT_SECRET_TIXSTOCK_SANDBOX_URL",
    "NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN",
    "NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN",
    "NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING",
    "NEXT_SECRET_TIXSTOCK_TOKEN",
    "NEXT_SECRET_TIXSTOCK_API_URL",
  ] as const;
  const saved = NAMES.map((n) => [n, process.env[n]] as const);
  const set = (values: Partial<Record<(typeof NAMES)[number], string>>): void => {
    for (const n of NAMES) delete process.env[n];
    for (const [n, v] of Object.entries(values)) process.env[n] = v;
  };
  try {
    // the feed's own token is never a booking token
    set({ NEXT_SECRET_TIXSTOCK_TOKEN: "feed", NEXT_SECRET_TIXSTOCK_API_URL: "https://pf.tixstock.com/v1" });
    assert.deepEqual(tixstockClientFor("production"), { ok: false, kind: "production_closed" });
    assert.deepEqual(tixstockClientFor("sandbox"), { ok: false, kind: "not_configured" });

    set({ NEXT_SECRET_TIXSTOCK_TOKEN: "feed", NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING: "true" });
    assert.deepEqual(tixstockClientFor("production"), { ok: false, kind: "not_configured" }, "open, but with no booking token");

    set({ NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN: "book", NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING: "yes" });
    assert.deepEqual(tixstockClientFor("production"), { ok: false, kind: "production_closed" }, "only the exact word true opens it");

    set({ NEXT_SECRET_TIXSTOCK_TOKEN: "feed", NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN: "book", NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING: "true" });
    const prod = stub([json(200, { meta: { hold_id: "h1" } })]);
    const p = tixstockClientFor("production", prod.fetchImpl);
    assert.equal(p.ok, true);
    if (p.ok) await p.client.hold("L1", 1);
    assert.equal(prod.calls[0].url, `${TIXSTOCK_PRODUCTION_URL}/tickets/hold`);
    assert.equal(prod.calls[0].headers.Authorization, "Bearer book", "the booking token, never the feed's");

    set({ NEXT_SECRET_TIXSTOCK_SANDBOX_URL: BASE });
    assert.deepEqual(tixstockClientFor("sandbox"), { ok: false, kind: "not_configured" }, "a url with no token");

    set({ NEXT_SECRET_TIXSTOCK_SANDBOX_URL: TIXSTOCK_PRODUCTION_URL, NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN: "sand" });
    assert.deepEqual(tixstockClientFor("sandbox"), { ok: false, kind: "not_configured" }, "the sandbox never points at the production host");

    set({ NEXT_SECRET_TIXSTOCK_SANDBOX_URL: BASE, NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN: "sand", NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN: "book" });
    const sand = stub([json(200, { meta: { hold_id: "h1" } })]);
    const s = tixstockClientFor("sandbox", sand.fetchImpl);
    assert.equal(s.ok, true);
    if (s.ok) await s.client.hold("L1", 1);
    assert.equal(sand.calls[0].url, `${BASE}/tickets/hold`);
    assert.equal(sand.calls[0].headers.Authorization, "Bearer sand");
  } finally {
    for (const [n, v] of saved) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
});

};

main()
  .then(() => console.log("tixstock-booking-client-selftest: all passed"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
