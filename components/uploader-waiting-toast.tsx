"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ToastAction } from "@/components/ui/toast";
import { useCompany } from "@/contexts/company-context";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { toast } from "@/hooks/use-toast";
import { countOpenQuestionsFor } from "@/lib/actions/uploader-actions";
import { TOAST_POLL_MS } from "@/lib/uploader/constants";

const DESCRIPTION_MAX = 160;
/** The first poll waits this long after the dashboard mounts - the page's own reads go first. */
const FIRST_POLL_DELAY_MS = 3_000;

const clip = (text: string) =>
  text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text;

/**
 * The tour uploader's "the AI is waiting for an answer" signal (spec §5.4). Mounted once in the
 * dashboard layout for admins only: it asks `countOpenQuestionsFor` every `TOAST_POLL_MS` and, when
 * the count ROSE, shows one persistent toast linking to the run's board. Dismissing it keeps it
 * away until a new question arrives. Renders nothing.
 *
 * - `lastSeen` is the count the admin has already been told about. It is set when the toast fires
 *   (the shared toast store owns `onOpenChange`, so a dismissal cannot be observed), and lowered
 *   whenever the count drops, so a question that comes after an answered one is a rise again.
 * - On that run's own board nothing fires (the board's amber bar says it) - the count is taken as
 *   seen, so leaving the board does not pop a toast for a question the admin just read.
 * - A failed poll (an error, or `failed` = the count could not be read) changes nothing and shows
 *   nothing: a poll must never toast an error, nor a false zero.
 * - Only while the active company sells events (the uploader is a Mega Events screen): a tours-only
 *   company - or the company context still loading - polls nothing. The first poll waits
 *   FIRST_POLL_DELAY_MS; leaving (unmount, or a switch to a tours company) takes a shown toast down.
 */
export function UploaderWaitingToast() {
  const pathname = usePathname();
  const { productTypes, isLoading } = useCompany();
  const enabled = !isLoading && productTypes.includes("events");
  // Read inside the interval, so navigating never restarts the poll.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const lastSeen = useRef(0);
  const shown = useRef<{ dismiss: () => void } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const open = await countOpenQuestionsFor();
        if (cancelled || open.failed) return;
        const { count, newest } = open;

        if (count < lastSeen.current) lastSeen.current = count;
        if (count === 0) {
          // Nothing waits any more: take a toast about an answered question down.
          shown.current?.dismiss();
          shown.current = null;
          return;
        }
        if (count <= lastSeen.current || !newest) return;

        lastSeen.current = count;
        const board = `/uploader/${newest.run_id}`;
        const here = pathRef.current ?? "";
        if (here === board || here.startsWith(`${board}/`)) return;

        shown.current?.dismiss();
        shown.current = toast({
          title: "🟠 ה-AI מחכה לתשובה",
          description: clip(`${newest.subject}: ${newest.text}`),
          action: (
            <ToastAction altText="פתיחת הלוח" asChild>
              <Link href={board}>פתח את הלוח</Link>
            </ToastAction>
          ),
          duration: Infinity,
        });
      } catch {
        // swallowed on purpose - see the note above
      }
    };

    const first = setTimeout(() => void poll(), FIRST_POLL_DELAY_MS);
    const timer = setInterval(() => void poll(), TOAST_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      // A toast this component raised does not outlive it (unmount, or the company no longer sells events).
      shown.current?.dismiss();
      shown.current = null;
    };
  }, [enabled]);

  return null;
}
