/**
 * "A refresh keeps my place" - the pure rules. Two homes for a screen's view
 * state, by what the state IS:
 *
 *   URL (query string)   which tab / view of the screen I am on. Survives a
 *                        refresh, works with Back, and can be sent as a link.
 *   sessionStorage       how I narrowed the list - filters, search, page, sort,
 *                        hidden columns. Survives a refresh in this browser tab,
 *                        keeps the URL short, and is gone when the tab closes
 *                        (a filter from last week would hide rows by surprise).
 *
 * The hooks are in `hooks/use-view-state.ts`; nothing here touches `window`,
 * so `scripts/view-state-selftest.ts` runs it under plain node.
 */

/**
 * The query string ("" or "?a=b") after setting `key`. A null / empty value, or
 * the screen's own default, REMOVES the param - a default never clutters the URL.
 */
export function withParam(
  search: string,
  key: string,
  value: string | null,
  fallback?: string,
): string {
  const params = new URLSearchParams(search);
  if (value == null || value === "" || value === fallback) params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** `key` from the query string - the fallback when absent or not one of `allowed`. */
export function readParam<T extends string>(
  search: string,
  key: string,
  fallback: T,
  allowed?: readonly T[],
): T {
  const raw = new URLSearchParams(search).get(key);
  if (raw == null || raw === "") return fallback;
  if (allowed && !(allowed as readonly string[]).includes(raw)) return fallback;
  return raw as T;
}

/** Where a screen's filter is kept - per path, so /events and /tasks never share one. */
export function viewStateKey(pathname: string, name: string): string {
  return `myt:view:${pathname}:${name}`;
}

/** Same kind of value as the default: a boolean for a boolean, every field of an object. */
function sameShape(value: unknown, fallback: unknown): boolean {
  if (fallback === null || fallback === undefined) return value === fallback;
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (typeof fallback === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.entries(fallback as Record<string, unknown>).every(
      ([key, sample]) => key in record && typeof record[key] === typeof sample,
    );
  }
  return typeof value === typeof fallback;
}

/**
 * A stored value is used only while it still has the shape the screen expects -
 * anything else (broken JSON, a field renamed by a later deploy) reads as the
 * default rather than crashing the screen that restored it.
 */
export function parseStored<T>(
  raw: string | null,
  fallback: T,
  isValid?: (value: unknown) => value is T,
): T {
  if (raw == null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (isValid) return isValid(value) ? value : fallback;
    return sameShape(value, fallback) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A short stable key for a table, from its column ids - two tables on one screen
 * (the Tasks tabs) get different keys without anyone naming them. A table whose
 * columns change with the data passes its own `stateKey` instead.
 */
export function tableStateKey(columnIds: string[]): string {
  let hash = 5381;
  for (const char of columnIds.join("|")) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}
