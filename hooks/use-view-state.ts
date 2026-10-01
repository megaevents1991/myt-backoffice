"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { parseStored, readParam, viewStateKey, withParam } from "@/lib/view-state";

/**
 * "A refresh keeps my place." Screens kept their tab, view and filters in
 * `useState`, so F5 put you back on the default every time (Tasks even READ
 * `?tab=` on arrival and never wrote it when you switched). Two drop-in
 * replacements for `useState`, picked by what the state is - the rule and its
 * reasons are in `lib/view-state.ts`:
 *
 *   useUrlState      which tab / view I am on          -> the query string
 *   useSessionState  how I narrowed the list           -> sessionStorage
 *
 * A screen that changes several query params in one interaction (the tours
 * departures board) uses `useQueryState` instead: all of them, one write.
 */

/**
 * Write one query param in place. `history.replaceState`, not `router.replace`:
 * no trip to the server, no scroll jump, and Next keeps `useSearchParams` in
 * step with it. Replace, not push - Back leaves the screen, it does not walk
 * back through every tab you clicked.
 */
export function writeUrlParam(key: string, value: string | null, fallback?: string) {
  const query = withParam(window.location.search, key, value, fallback);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query}${window.location.hash}`,
  );
}

/**
 * State mirrored in the query string as `?key=value` (the default is left out).
 * The screen's own copy answers a click at once; the URL follows, and when the
 * URL moves by itself (Back, a link to this same screen) the copy follows it.
 *
 * Uses `useSearchParams`, so on a statically rendered page the component must
 * sit under a <Suspense>. Dashboard pages never render their content on the
 * server (the layout waits for the session), but wrap it anyway on a new page.
 */
export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const fromUrl = readParam(searchParams.toString(), key, fallback, allowed);
  const [value, setValue] = useState<T>(fromUrl);
  // Our own write that the router has not reported back yet - its echo (and any
  // older echo still in flight) must not be read as "the URL moved".
  const pending = useRef<T | null>(null);

  useEffect(() => {
    if (pending.current !== null) {
      if (pending.current === fromUrl) pending.current = null;
      return;
    }
    setValue(fromUrl);
  }, [fromUrl]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (next !== fromUrl) pending.current = next;
      writeUrlParam(key, next, fallback);
    },
    [key, fallback, fromUrl],
  );

  return [value, set];
}

function readSession<T>(
  storageKey: string,
  fallback: T,
  isValid?: (value: unknown) => value is T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    return parseStored(window.sessionStorage.getItem(storageKey), fallback, isValid);
  } catch {
    // Storage blocked (private mode, a policy): the screen works, it just forgets.
    return fallback;
  }
}

/**
 * `useState` that survives a refresh of this browser tab - same signature, plus
 * a name. Kept per path (`myt:view:<path>:<name>`), so two screens never share
 * a filter. A stored value that no longer has the default's shape is ignored;
 * pass `isValid` when the shape alone cannot tell (a union of strings, a
 * nullable value).
 *
 * The first render reads storage, so the component must mount on the client -
 * true for everything under the dashboard layout, which renders its content
 * only after the session check. Do not use it in markup the server renders.
 */
export function useSessionState<T>(
  name: string,
  fallback: T,
  isValid?: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const pathname = usePathname();
  const storageKey = viewStateKey(pathname ?? "", name);
  const [value, setValue] = useState<T>(() => readSession(storageKey, fallback, isValid));
  // The default as first seen - callers pass a fresh literal on every render.
  const defaultJson = useRef(JSON.stringify(fallback));

  useEffect(() => {
    try {
      const raw = JSON.stringify(value);
      // The default is not stored: nothing to restore, and a changed default
      // in a later deploy takes effect instead of being pinned by an old copy.
      if (raw === defaultJson.current) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, raw);
    } catch {
      // Quota or blocked storage - not worth failing a click over.
    }
  }, [storageKey, value]);

  return [value, setValue];
}

/**
 * Several query-string params as one piece of state, written with ONE
 * `history.replaceState` per change.
 *
 * Why not one `useUrlState` per param: the departures board changes several
 * params in a single interaction (opening a card sets `code` and `tab`;
 * "clear" resets eleven filters), and each write is a router "restore" action
 * in Next. Two restores in the same tick followed by a server action leave that
 * action stranded in Next's action queue (15.5: the queue's `last` pointer is
 * not moved by a restore, so the action is appended to a discarded node and
 * never runs) - the card then sat on its skeleton forever. One write per
 * interaction, plus `afterUrlWrite()` before an effect-driven server action,
 * keeps the queue straight.
 */
export function useQueryState<K extends string>(
  keys: readonly K[],
): [Record<K, string>, (patch: Partial<Record<K, string>>) => void] {
  const searchParams = useSearchParams();
  const urlKey = keys.map((k) => searchParams.get(k) ?? "").join("\u0001");
  const fromUrl = useMemo(() => {
    const parts = urlKey.split("\u0001");
    const out = {} as Record<K, string>;
    keys.forEach((k, i) => {
      out[k] = parts[i] ?? "";
    });
    return out;
  }, [urlKey, keys]);

  const [values, setValues] = useState(fromUrl);
  const current = useRef(values);
  const urlKeyRef = useRef(urlKey);
  urlKeyRef.current = urlKey;
  // Our own write that the router has not echoed yet - its echo must not be read as "the URL moved".
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (pending.current !== null) {
      if (pending.current === urlKey) pending.current = null;
      return;
    }
    current.current = fromUrl;
    setValues(fromUrl);
  }, [urlKey, fromUrl]);

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const next = { ...current.current, ...patch } as Record<K, string>;
      if (keys.every((k) => next[k] === current.current[k])) return;
      current.current = next;
      setValues(next);
      const params = new URLSearchParams(window.location.search);
      for (const k of keys) {
        if (next[k]) params.set(k, next[k]);
        else params.delete(k);
      }
      const serialized = keys.map((k) => next[k]).join("\u0001");
      pending.current = serialized !== urlKeyRef.current ? serialized : null;
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    },
    [keys],
  );

  return [values, set];
}

/**
 * Resolve on the next macrotask. Await it before a server action that runs in
 * an effect triggered by a URL write, so the router has finished its restore
 * before the action is queued (see useQueryState).
 */
export const afterUrlWrite = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
