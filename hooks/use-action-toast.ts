"use client";

import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

/** The answer shape of the server actions this hook runs. */
export type ActionAnswer<T = unknown> =
  | { success: true; data?: T; warning?: string }
  | { success: false; error: string };

/** What to say on success: a fixed line, or one built from the answer (e.g. "3 departures published"). */
export type OkMessage<A> = string | ((answer: Extract<A, { success: true }>) => string | undefined);

/**
 * Runs a server action and reports it with the shared toast - the same toast
 * the Mega Events screens use. An error is shown as a destructive toast, a
 * warning as a plain one, and `okMessage` (when given) on success. The answer
 * comes back so the caller can read its data; it never throws.
 *
 *   const run = useActionToast();
 *   const res = await run(() => saveThing(input), "Saved");
 *   const res = await run(() => publish(ids), (a) => `${a.data.done} published`);
 *   if (res.success) ...
 */
export function useActionToast() {
  const { toast } = useToast();
  return useCallback(
    async <A extends ActionAnswer>(action: () => Promise<A>, okMessage?: OkMessage<A>): Promise<A> => {
      let answer: A;
      try {
        answer = await action();
      } catch (e) {
        answer = { success: false, error: e instanceof Error ? e.message : "Something went wrong" } as A;
      }
      if (!answer.success) {
        toast({ variant: "destructive", title: "Error", description: answer.error });
        return answer;
      }
      const title =
        typeof okMessage === "function" ? okMessage(answer as Extract<A, { success: true }>) : okMessage;
      if (answer.warning) toast({ title: title ?? "Done", description: answer.warning });
      else if (title) toast({ title });
      return answer;
    },
    [toast],
  );
}
