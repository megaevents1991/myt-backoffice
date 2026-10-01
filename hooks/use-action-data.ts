"use client";

import { useCallback, useEffect, useRef, useState, type DependencyList, type Dispatch, type SetStateAction } from "react";
import type { ActionAnswer } from "@/hooks/use-action-toast";

export interface ActionData<T> {
  /** The last loaded data; kept while a reload runs and after a failed reload. */
  data: T | null;
  /** The error of the last load, null after a successful one. */
  error: string | null;
  /** True during the first load and during a reload that is not quiet. */
  loading: boolean;
  /** Loads again. `quiet` keeps the current data on screen without a loading state. */
  reload: (options?: { quiet?: boolean }) => Promise<void>;
  /** Patch the data in place after a mutation, without a round trip. */
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Loads a screen's data through a server action: the data, the error and the
 * loading state every tours screen used to wire by hand. Loads on mount and
 * whenever `deps` change; a failed load keeps the previous data.
 *
 *   const { data, error, loading, reload } = useActionData(() => listThings(id), [id]);
 */
export function useActionData<T>(load: () => Promise<ActionAnswer<T>>, deps: DependencyList): ActionData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  // The answer of an older request must not overwrite a newer one.
  const seq = useRef(0);

  const reload = useCallback(async (options?: { quiet?: boolean }) => {
    const mine = ++seq.current;
    if (!options?.quiet) setLoading(true);
    let answer: ActionAnswer<T>;
    try {
      answer = await loadRef.current();
    } catch (e) {
      answer = { success: false, error: e instanceof Error ? e.message : "Failed to load" };
    }
    if (mine !== seq.current) return;
    if (answer.success) {
      setData((answer.data ?? null) as T | null);
      setError(null);
    } else {
      setError(answer.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    // `deps` are the caller's - the load function itself is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}
