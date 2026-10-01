"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { cn } from "@/lib/utils";
import { getSitePublishStatus, publishSite } from "@/lib/tours/site-publish";
import { formatDayTime, type SitePublishStatus } from "@/components/tours/content/shared";

/**
 * "Publish to site" for the active tours company. Self-contained: drop it in
 * the `actions` of any tours page header.
 *
 *   import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
 *   <PageHeader title="..." actions={<PublishSiteButton />} />
 *
 * The customer site is static and reads the database when it is built, so a
 * save in the backoffice reaches visitors only after a rebuild. The button asks
 * for confirmation, triggers the rebuild on the server (the deploy hook URL
 * never reaches the browser) and shows when the site was last published.
 */
export function PublishSiteButton({ className }: { className?: string }) {
  const confirm = useConfirm();
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
      title: "Publish changes to the site?",
      description:
        "The site will be rebuilt with everything saved in the backoffice so far. The build takes a few minutes, and until it finishes visitors see the previous version.",
      confirmLabel: "Publish Site",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await publishSite();
      if (result.success) {
        setStatus({ configured: true, last: result.data });
        toast.success("The site build has started. Changes will appear in a few minutes.");
      } else {
        toast.error(result.error, { duration: 7000 });
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
        ? `${last.ok ? "Last published" : "Last attempt failed"}: ${formatDayTime(last.at)}`
        : "Not published from here yet";

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
        {isPending ? <Loader2 className="animate-spin" /> : <Rocket />}
        {isPending ? "Publishing..." : "Publish Site"}
      </Button>
    </div>
  );
}
