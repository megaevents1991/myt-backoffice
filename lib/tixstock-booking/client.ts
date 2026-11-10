// TixStock's booking API as seven calls: read the listings, hold, release, add an order, update it, read it.
//
// BYTE-IDENTICAL in both repos - backoffice `lib/tixstock-booking/client.ts` (written and tested here:
// `scripts/tixstock-booking-client-selftest.ts`) and myt-main `lib/tixstock-booking/client.ts` (`cmp` the pair
// after any change). That is why this file has NO imports and reads no env: the caller hands it a host and a token.
//
// Every call answers one of three things, and the difference is the whole point:
//   ok        - TixStock did it;
//   refused   - TixStock answered and did NOT do it (4xx, or a 2xx that says so);
//   no_answer - we do not know (timeout, network, 5xx, a 2xx we cannot read). For orders/add this means the order
//               MAY exist: TixStock (10.11.2026) - "retrying the same order is not safe, as it may result in
//               duplicate orders". The caller marks the booking `uncertain` and never calls again.
// Spec: backoffice docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md.

export type TixstockCall<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "refused"; status: number; code?: number | string; message: string }
  | { ok: false; kind: "no_answer"; detail: string };

/** A listing as the feed returns it (the site's `TixStockListing` shape); read with the site's own helpers. */
export type RawListing = Record<string, unknown>;

export type TixstockClient = {
  /** GET /tickets/feed, every page, with `target_currency=USD`: `proceed_price` then comes in USD. */
  listings(eventId: string): Promise<TixstockCall<RawListing[]>>;
  /** GET /feed for one event -> its venue's country code ("IT"), or null when the feed does not say. */
  eventVenueCountry(eventId: string): Promise<TixstockCall<string | null>>;
  /** POST /tickets/hold. TixStock releases a hold by itself after about 10 minutes. */
  hold(listingId: string, qty: number): Promise<TixstockCall<{ holdId: string }>>;
  /** POST /tickets/release/{hold}/{qty}. "Already released" (code 109) counts as done. */
  release(holdId: string, qty: number): Promise<TixstockCall<true>>;
  /** POST /orders/add/{hold}/{qty}. `currency` / `total` are what TixStock registered for the order. */
  addOrder(
    holdId: string,
    qty: number,
    body: Record<string, unknown>,
  ): Promise<TixstockCall<{ orderId: string; status: string; currency: string | null; total: number | null }>>;
  /** POST /orders/update/{id}. Safe to repeat. */
  updateOrder(orderId: string, body: Record<string, unknown>): Promise<TixstockCall<{ status: string }>>;
  /**
   * GET /orders/get/{id}. Callers pass the id orders/add returned, until TixStock says which id this path takes
   * (their guide calls it "your external order id"; asked 10.11.2026).
   */
  getOrder(orderId: string): Promise<TixstockCall<Record<string, unknown>>>;
};

/** TixStock's answer to orders/add on a hold that ran out: "Resource Not Found". Only then is a new hold placed. */
export function holdExpired(r: TixstockCall<unknown>): boolean {
  return !r.ok && r.kind === "refused" && (r.status === 404 || /resource not found/i.test(r.message));
}

type Raw =
  | { answered: true; status: number; body: unknown; text: string }
  | { answered: false; detail: string };
type Answered = Extract<Raw, { answered: true }>;

const MAX_FEED_PAGES = 40;

const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const codeOf = (body: unknown): number | string | undefined => {
  const b = rec(body);
  const code = b?.code ?? rec(b?.error)?.code ?? rec(b?.meta)?.code;
  return typeof code === "number" || typeof code === "string" ? code : undefined;
};

const messageOf = (raw: Answered): string => {
  const b = rec(raw.body);
  return (
    str(b?.message) ?? str(rec(b?.error)?.message) ?? str(b?.error) ?? (raw.text ? raw.text.slice(0, 300) : `HTTP ${raw.status}`)
  );
};

const refusal = (raw: Answered, message = messageOf(raw)): TixstockCall<never> => {
  const code = codeOf(raw.body);
  return { ok: false, kind: "refused", status: raw.status, ...(code !== undefined ? { code } : {}), message };
};

/** Timeouts, network failures and 5xx are `no_answer`; any other non-2xx is `refused`; a 2xx goes to `read`. */
const settle = <T>(raw: Raw, read: (raw: Answered) => TixstockCall<T>): TixstockCall<T> => {
  if (!raw.answered) return { ok: false, kind: "no_answer", detail: raw.detail };
  if (raw.status >= 500) return { ok: false, kind: "no_answer", detail: `HTTP ${raw.status}` };
  if (raw.status < 200 || raw.status >= 300) return refusal(raw);
  return read(raw);
};

export function createTixstockClient(cfg: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TixstockClient {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const doFetch = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 15000;
  const enc = encodeURIComponent;

  const request = async (method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Raw> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      return { answered: true, status: res.status, body: parsed, text };
    } catch (e) {
      return { answered: false, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    } finally {
      clearTimeout(timer);
    }
  };

  const feedPage = async (eventId: string, page: number): Promise<TixstockCall<{ rows: RawListing[]; lastPage: number }>> => {
    const query = new URLSearchParams({ event_id: eventId, target_currency: "USD", per_page: "50", page: String(page) });
    return settle(await request("GET", `/tickets/feed?${query.toString()}`), (raw) => {
      const b = rec(raw.body);
      if (!b || !Array.isArray(b.data)) return refusal(raw, "the feed answer has no data list");
      const rows = b.data.filter((row): row is RawListing => rec(row) !== null);
      return { ok: true, data: { rows, lastPage: num(rec(b.meta)?.last_page) ?? 1 } };
    });
  };

  return {
    async listings(eventId) {
      const first = await feedPage(eventId, 1);
      if (!first.ok) return first;
      const rows = [...first.data.rows];
      const lastPage = Math.min(first.data.lastPage, MAX_FEED_PAGES);
      for (let page = 2; page <= lastPage; page++) {
        const next = await feedPage(eventId, page);
        // Half a feed is never handed out as the feed: a listing missing from it would read as "sold".
        if (!next.ok) return next;
        rows.push(...next.data.rows);
      }
      return { ok: true, data: rows };
    },

    async eventVenueCountry(eventId) {
      const query = new URLSearchParams({ event_id: eventId, per_page: "1" });
      return settle(await request("GET", `/feed?${query.toString()}`), (raw) => {
        const b = rec(raw.body);
        if (!b || !Array.isArray(b.data)) return refusal(raw, "the event feed answer has no data list");
        const country = str(rec(rec(b.data[0])?.venue)?.country_code);
        return { ok: true, data: country ? country.toUpperCase() : null };
      });
    },

    async hold(listingId, qty) {
      return settle(await request("POST", "/tickets/hold", { listing_id: listingId, quantity: qty }), (raw) => {
        const holdId = str(rec(rec(raw.body)?.meta)?.hold_id);
        return holdId ? { ok: true, data: { holdId } } : refusal(raw, "the hold answer has no hold id");
      });
    },

    async release(holdId, qty) {
      const raw = await request("POST", `/tickets/release/${enc(holdId)}/${qty}`);
      // 109 = "release exceeds on-hold": the hold is already gone, which is what we wanted.
      if (raw.answered && codeOf(raw.body) === 109) return { ok: true, data: true };
      return settle(raw, () => ({ ok: true, data: true }));
    },

    async addOrder(holdId, qty, body) {
      return settle(await request("POST", `/orders/add/${enc(holdId)}/${qty}`, body), (raw) => {
        if (Array.isArray(raw.body) && raw.body.length === 0) {
          return refusal(raw, "empty answer - TixStock answers [] when the datetime format is wrong");
        }
        const b = rec(raw.body);
        const data = rec(b?.data);
        const orderId = str(data?.id);
        if (data && orderId) {
          return {
            ok: true,
            data: { orderId, status: str(data.status) ?? "", currency: str(data.currency), total: num(data.grand_total) },
          };
        }
        // A 2xx with no order id: a refusal only when TixStock says so. Anything else may be an order we cannot see.
        if (b && (b.success === false || b.error !== undefined || codeOf(raw.body) !== undefined)) return refusal(raw);
        return { ok: false, kind: "no_answer", detail: "a 2xx answer with no order id" };
      });
    },

    async updateOrder(orderId, body) {
      return settle(await request("POST", `/orders/update/${enc(orderId)}`, body), (raw) => {
        const data = rec(rec(raw.body)?.data);
        return data ? { ok: true, data: { status: str(data.status) ?? "" } } : refusal(raw, "the update answer has no order");
      });
    },

    async getOrder(orderId) {
      return settle(await request("GET", `/orders/get/${enc(orderId)}`), (raw) => {
        const data = rec(rec(raw.body)?.data);
        return data ? { ok: true, data } : refusal(raw, "the order answer has no order");
      });
    },
  };
}
