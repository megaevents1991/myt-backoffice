"use client";

/**
 * Several query-string params as one piece of state, written with ONE
 * `history.replaceState` per change.
 *
 * Why not one `useUrlState` per param (hooks/use-view-state.ts): the board
 * changes several params in a single interaction (opening a card sets `code`
 * and `tab`; "clear" resets eleven filters), and each write is a router
 * "restore" action in Next. Two restores in the same tick followed by a server
 * action leave that action stranded in Next's action queue (15.5: the queue's
 * `last` pointer is not moved by a restore, so the action is appended to a
 * discarded node and never runs) - the card then sat on its skeleton forever.
 * One write per interaction, plus `afterUrlWrite()` before an effect-driven
 * server action, keeps the queue straight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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
 * before the action is queued (see the note at the top of this file).
 */
export const afterUrlWrite = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
