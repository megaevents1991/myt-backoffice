"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTablePreferences,
  saveTablePreferences,
} from "@/lib/actions/table-preferences-actions";

/**
 * Per-user UI state for a backoffice table, stored against the signed-in staff
 * account so it follows the person between machines and browsers.
 *
 * localStorage is kept as a cache, not as the source of truth: it paints the
 * user's real choice on first render instead of flashing the defaults while the
 * server round-trip is in flight. The server value wins as soon as it lands.
 *
 * Reusable — give any table a stable `tableKey` and its own shape.
 */
export function useTablePreferences<T>(
  tableKey: string,
  fallback: T,
): [T, (next: T) => void, boolean] {
  const cacheKey = `table-prefs:${tableKey}`;
  const [value, setValue] = useState<T>(fallback);
  const [isLoaded, setIsLoaded] = useState(false);
  // Guards against a slow server read overwriting a choice made while it was in
  // flight — once the user has touched the control, their value wins.
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) setValue(JSON.parse(cached) as T);
    } catch {
      // A corrupt cache entry is not worth failing the page over.
    }
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    getTablePreferences(tableKey)
      .then((stored) => {
        if (cancelled || dirtyRef.current || stored == null) return;
        setValue(stored as T);
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(stored));
        } catch {
          /* private browsing */
        }
      })
      .catch((error) => console.error("Failed to load table preferences:", error))
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tableKey, cacheKey]);

  const update = useCallback(
    (next: T) => {
      dirtyRef.current = true;
      setValue(next);
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(next));
      } catch {
        /* private browsing */
      }
      // Cosmetic state — a failed write should log, never interrupt the user.
      saveTablePreferences(tableKey, next as Record<string, unknown>).catch(
        (error) => console.error("Failed to save table preferences:", error),
      );
    },
    [tableKey, cacheKey],
  );

  return [value, update, isLoaded];
}
