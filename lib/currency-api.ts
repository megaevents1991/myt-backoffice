/**
 * The public rate source (fawazahmed0 currency-api) is served from two places: jsDelivr's npm CDN
 * and Cloudflare Pages. jsDelivr answers through several CDNs, and each of them may keep an
 * `@latest` file for up to 12 hours (`s-maxage=43200`). On 2026-10-29 one of them still served
 * 28.10's file at noon, and since jsDelivr was asked first and answered, the sites priced with
 * yesterday's dollar (travel rate 3.14 instead of 3.17). Cloudflare's copy is never cached
 * (`max-age=0`). So both are read at once and the file with the newer `date` wins; on a tie, the
 * first source. One source down = the other one's answer, as before.
 *
 * Pure apart from the timer: the caller hands in its own fetch (timeout, logging).
 *
 * The SAME file lives in myt-main (lib/currencyApi.ts), mega-family (lib/server/currency-api.ts)
 * and myt-backoffice (lib/currency-api.ts). Change one = copy it to the other two (`cmp` them).
 */

export const CURRENCY_API_SOURCES = [
  {
    name: "jsdelivr",
    base: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies",
  },
  {
    name: "cloudflare",
    base: "https://latest.currency-api.pages.dev/v1/currencies",
  },
] as const;

/** Once one source answered, how long the others still get before we settle. */
export const CURRENCY_API_GRACE_MS = 1_500;

/** One source's file for a base currency: the day it describes and one unit in every other currency. */
export type CurrencyFile = {
  source: string;
  /** "2026-10-29", or null when the file carried no readable date. */
  date: string | null;
  rates: Record<string, unknown>;
};

/** The file's `date` when it is a calendar day, else null. */
export function fileDate(json: unknown): string | null {
  const date = (json as { date?: unknown } | null)?.date;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** A source's JSON as a CurrencyFile, or null when it holds no table for `base`. */
export function parseCurrencyFile(
  source: string,
  base: string,
  json: unknown,
): CurrencyFile | null {
  const table = (json as Record<string, unknown> | null)?.[base];
  if (!table || typeof table !== "object" || Array.isArray(table)) return null;
  return { source, date: fileDate(json), rates: table as Record<string, unknown> };
}

/** One unit of the file's base in `target`, or null when the file has no finite number for it. */
export function rateOf(file: CurrencyFile, target: string): number | null {
  const rate = file.rates[target];
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}

/**
 * The newest of the files that answered, in source order: the latest date wins, the earlier
 * source wins a tie, and a file with no date loses to any file with one.
 */
export function pickNewest(files: CurrencyFile[]): CurrencyFile | null {
  let best: CurrencyFile | null = null;
  for (const file of files) {
    if (!best) best = file;
    else if (file.date !== null && (best.date === null || file.date > best.date)) best = file;
  }
  return best;
}

/**
 * Ask every source for `base` at once and settle on the newest file. A file `accept` refuses (a
 * rate out of bounds) counts as no answer. Once one file is in, the rest get `graceMs` more: a
 * source that hangs must not hold a price page for its whole timeout. Never throws; null = no
 * source gave a usable file.
 */
export function readNewestFile(
  base: string,
  options: {
    fetchJson: (url: string) => Promise<unknown>;
    accept?: (file: CurrencyFile) => boolean;
    onError?: (source: string, error: unknown) => void;
    graceMs?: number;
  },
): Promise<CurrencyFile | null> {
  const { fetchJson, accept = () => true, onError, graceMs = CURRENCY_API_GRACE_MS } = options;
  const files: (CurrencyFile | null)[] = CURRENCY_API_SOURCES.map(() => null);

  return new Promise((resolve) => {
    let pending = CURRENCY_API_SOURCES.length;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(pickNewest(files.filter((f): f is CurrencyFile => f !== null)));
    };

    CURRENCY_API_SOURCES.forEach((source, i) => {
      Promise.resolve()
        .then(() => fetchJson(`${source.base}/${base}.json`))
        .then((json) => {
          const file = parseCurrencyFile(source.name, base, json);
          if (!file) throw new Error(`no "${base}" table in the answer`);
          if (!accept(file)) throw new Error("rate refused");
          files[i] = file;
        })
        .catch((error: unknown) => {
          try {
            onError?.(source.name, error);
          } catch {
            // a logger must never stop the read
          }
        })
        .finally(() => {
          pending -= 1;
          if (pending === 0) finish();
          else if (!timer && !settled && files.some((f) => f !== null)) {
            timer = setTimeout(finish, graceMs);
          }
        });
    });
  });
}
