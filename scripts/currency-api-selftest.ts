/**
 * Selftest for which of the currency API's two mirrors a rate comes from (lib/currency-api.ts, the
 * same file as myt-main's lib/currencyApi.ts and mega-family's lib/server/currency-api.ts). No DB,
 * no network:
 *   npx tsx scripts/currency-api-selftest.ts
 *
 * On 2026-10-29 one jsDelivr CDN still served 28.10's `@latest` file at noon and, asked first, it set
 * the rate; Cloudflare's copy already held the new day. Both mirrors are read now and the newer date
 * wins - a tie keeps jsDelivr, one mirror down is the other's file, a mirror that hangs costs the
 * grace and not its whole timeout.
 */
import assert from "node:assert/strict";
import {
  CURRENCY_API_SOURCES,
  type CurrencyFile,
  fileDate,
  parseCurrencyFile,
  pickNewest,
  rateOf,
  readNewestFile,
} from "../lib/currency-api";

let checks = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
};

const [JSD, CF] = CURRENCY_API_SOURCES.map((s) => s.base);
const eurFile = (date: string, usd: number) => ({ date, eur: { usd } });
/** A fetch that answers each mirror from `answers` (a function = its own promise, an Error = a failure). */
const fakeFetch =
  (answers: Record<string, unknown>) =>
  async (url: string): Promise<unknown> => {
    const answer = answers[url.startsWith(JSD) ? JSD : CF];
    if (typeof answer === "function") return (answer as () => Promise<unknown>)();
    if (answer instanceof Error) throw answer;
    return answer;
  };
const file = (source: string, date: string | null): CurrencyFile => ({ source, date, rates: { usd: 1.1 } });

async function main() {
  await check("the later date wins, a tie keeps the first source, a date beats none", () => {
    assert.equal(pickNewest([file("jsdelivr", "2026-10-28"), file("cloudflare", "2026-10-29")])?.source, "cloudflare");
    assert.equal(pickNewest([file("jsdelivr", "2026-10-29"), file("cloudflare", "2026-10-29")])?.source, "jsdelivr");
    assert.equal(pickNewest([file("jsdelivr", null), file("cloudflare", "2026-10-01")])?.source, "cloudflare");
    assert.equal(pickNewest([]), null);
  });

  await check("a file needs its base's table; a rate is a finite number", () => {
    assert.equal(fileDate({ date: "2026-10-29" }), "2026-10-29");
    assert.equal(fileDate({ date: "29.10.2026" }), null);
    assert.equal(parseCurrencyFile("x", "eur", { date: "2026-10-29" }), null);
    const f = parseCurrencyFile("x", "eur", { date: "2026-10-29", eur: { usd: 1.16, gbp: "0.87" } });
    assert.ok(f);
    assert.equal(rateOf(f, "usd"), 1.16);
    assert.equal(rateOf(f, "gbp"), null);
  });

  await check("29.10: a stale jsDelivr file loses to Cloudflare's newer day", async () => {
    const got = await readNewestFile("eur", {
      fetchJson: fakeFetch({ [JSD]: eurFile("2026-10-28", 1.15), [CF]: eurFile("2026-10-29", 1.16) }),
    });
    assert.equal(got?.source, "cloudflare");
    assert.equal(got && rateOf(got, "usd"), 1.16);
  });

  await check("the same day on both: jsDelivr, as before", async () => {
    const got = await readNewestFile("eur", {
      fetchJson: fakeFetch({ [JSD]: eurFile("2026-10-29", 1.15), [CF]: eurFile("2026-10-29", 1.16) }),
    });
    assert.equal(got?.source, "jsdelivr");
  });

  await check("one mirror down = the other's file; both down = null, never a throw", async () => {
    const errors: string[] = [];
    const one = await readNewestFile("eur", {
      fetchJson: fakeFetch({ [JSD]: new Error("HTTP 503"), [CF]: eurFile("2026-10-29", 1.16) }),
      onError: (source) => errors.push(source),
    });
    assert.equal(one?.source, "cloudflare");
    assert.deepEqual(errors, ["jsdelivr"]);
    const none = await readNewestFile("eur", { fetchJson: fakeFetch({ [JSD]: new Error("a"), [CF]: new Error("b") }) });
    assert.equal(none, null);
  });

  await check("a refused rate counts as no answer", async () => {
    const got = await readNewestFile("eur", {
      fetchJson: fakeFetch({ [JSD]: eurFile("2026-10-28", 1.15), [CF]: eurFile("2026-10-29", 9) }),
      accept: (f) => (rateOf(f, "usd") ?? 0) < 1.4,
    });
    assert.equal(got?.source, "jsdelivr");
  });

  await check("a hung mirror costs the grace; a newer file inside the grace still wins", async () => {
    const started = Date.now();
    const hung = await readNewestFile("eur", {
      fetchJson: fakeFetch({ [JSD]: eurFile("2026-10-28", 1.15), [CF]: () => new Promise(() => {}) }),
      graceMs: 30,
    });
    assert.equal(hung?.source, "jsdelivr");
    assert.ok(Date.now() - started < 1_000);
    const late = await readNewestFile("eur", {
      fetchJson: fakeFetch({
        [JSD]: eurFile("2026-10-28", 1.15),
        [CF]: () => new Promise((r) => setTimeout(() => r(eurFile("2026-10-29", 1.16)), 20)),
      }),
      graceMs: 200,
    });
    assert.equal(late?.source, "cloudflare");
  });

  console.log(`\n${checks} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
