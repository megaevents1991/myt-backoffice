"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { fmtInstant } from "@/lib/tours/format";
import { getSitePublishStatus, publishSite } from "@/lib/tours/site-publish";
import type { SitePublishStatus } from "@/components/tours/content/shared";

/**
 * "Revalidate Pages" for the active tours company - the same button, name and
 * icon as on the Mega Events screens. Self-contained: drop it in
 * the `actions` of any tours page header.
 *
 *   import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
 *   <PageHeader title="..." actions={<PublishSiteButton />} />
 *
 * The customer site is static and reads the database when it is built, so a
 * save in the backoffice reaches visitors only after a rebuild: here the button
 * rebuilds the site (about a minute), where on Mega Events it clears the cache. The button asks
 * for confirmation, triggers the rebuild on the server (the deploy hook URL
 * never reaches the browser) and shows when the site was last published.
 */
export function PublishSiteButton({ className }: { className?: string }) {
  const confirm = useConfirm();
  const run = useActionToast();
  const [status, setStatus] = useState<SitePublishStatus | null>(null);
  // the active company has no site to publish (it does not sell tours) - show nothing
  const [unavailable, setUnavailable] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getSitePublishStatus()
      .then((result) => {
        if (!alive) return;
        if (result.success) setStatus(result.data);
        else setUnavailable(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const publish = async () => {
    const ok = await confirm({
      title: "Revalidate the site?",
      description:
        "The site will be rebuilt with everything saved in the backoffice so far. It takes about a minute, and until it finishes visitors see the previous version.",
      confirmLabel: "Revalidate Pages",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await run(() => publishSite(), "Revalidating: the site is rebuilding. Changes appear in about a minute.");
      if (result.success) {
        setStatus({ configured: true, last: result.data });
      } else {
        // a failed call is recorded too - show it
        const fresh = await getSitePublishStatus();
        if (fresh.success) setStatus(fresh.data);
      }
    });
  };

  if (unavailable) return null;

  const last = status?.last ?? null;
  const note = !status
    ? null
    : !status.configured
      ? "Site connection not set up"
      : last
        ? `${last.ok ? "Last revalidated" : "Last attempt failed"}: ${fmtInstant(last.at)}`
        : "Not revalidated from here yet";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {note && (
        <span
          className={cn("text-xs text-muted-foreground", last && !last.ok && status?.configured && "text-destructive")}
          title={last ? `${last.by}${last.status ? ` · HTTP ${last.status}` : ""}` : undefined}
        >
          {note}
        </span>
      )}
      <Button type="button" variant="outline" onClick={() => void publish()} disabled={isPending}>
        <RefreshCw className={cn(isPending && "animate-spin")} />
        {isPending ? "Revalidating…" : "Revalidate Pages"}
      </Button>
    </div>
  );
}
