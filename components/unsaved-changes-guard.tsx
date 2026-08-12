"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Warns before leaving a page with unsaved changes - using our own
 * shadcn dialog instead of the native `window.confirm`.
 *
 * Covers:
 *  - refresh / tab close / hard navigation → native `beforeunload` (browser
 *    only allows its own prompt here; can't be styled)
 *  - in-app link clicks (sidebar, "Back to …" links) → custom dialog: the
 *    click is intercepted, navigation deferred, then fired on confirm.
 *
 * The browser Back button is not guarded (App Router has no router events and
 * the history-priming workaround strands the user after a save).
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Refresh / tab close / hard navigation - native prompt is unavoidable here.
  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);

  // In-app link clicks → intercept and defer to the custom dialog.
  useEffect(() => {
    if (!when) return;

    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      // let modified clicks (new tab/window) through untouched
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      // only guard same-origin, in-app navigation
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;

      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [when]);

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null);
      }}
      title="Discard unsaved changes?"
      description="You have unsaved changes on this page. If you leave now, they'll be lost."
      confirmLabel="Leave & discard"
      cancelLabel="Stay on page"
      destructive
      onConfirm={() => {
        const href = pendingHref;
        setPendingHref(null);
        if (href) router.push(href);
      }}
    />
  );
}
