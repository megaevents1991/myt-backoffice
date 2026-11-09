"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { fmtInstant } from "@/lib/tours/format";
import { getSiteBuiltAt, getSitePublishStatus, publishSite } from "@/lib/tours/site-publish";
import type { SitePublishStatus } from "@/components/tours/content/shared";

/** How often the button asks the site which build it serves, and for how long after a press. */
const POLL_MS = 5_000;
const WATCH_MS = 4 * 60_000;

/** The build started by a press: on its way (since = the press), live on the site, or not live after WATCH_MS. */
type Build = { state: "building"; since: string } | { state: "live"; at: string } | { state: "slow" } | null;

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
 *
 * After a press it watches the site (Liz, 09.11.2026: "שהאתר יתעדכן יותר מהר" - nobody could tell when the
 * build was live): every 5 s it asks the site which build it serves (getSiteBuiltAt), and says "Site updated"
 * once that build is newer than the press - or, after 4 minutes, that it is not live yet. A page opened
 * within those minutes of a press picks the watch up.
 */
export function PublishSiteButton({ className }: { className?: string }) {
  const confirm = useConfirm();
  const run = useActionToast();
  const [status, setStatus] = useState<SitePublishStatus | null>(null);
  // the active company has no site to publish (it does not sell tours) - show nothing
  const [unavailable, setUnavailable] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [build, setBuild] = useState<Build>(null);

  useEffect(() => {
    let alive = true;
    getSitePublishStatus()
      .then((result) => {
        if (!alive) return;
        if (result.success) {
          setStatus(result.data);
          // a press a moment ago (another screen, a reload): keep watching its build
          const last = result.data.last;
          if (last?.ok && Date.now() - Date.parse(last.at) < WATCH_MS) setBuild({ state: "building", since: last.at });
        } else setUnavailable(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // while a build is on its way, ask the site which build it serves until it is that one (or newer)
  useEffect(() => {
    if (build?.state !== "building") return;
    const since = Date.parse(build.since);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const result = await getSiteBuiltAt().catch(() => null);
      if (!alive) return;
      const builtAt = result?.success ? result.data.builtAt : null;
      if (builtAt && Date.parse(builtAt) >= since) setBuild({ state: "live", at: builtAt });
      else if (Date.now() - since > WATCH_MS) setBuild({ state: "slow" });
      else timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [build]);

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
        setBuild({ state: "building", since: result.data.at });
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
      {build?.state === "building" ? (
        <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Building the site - usually under a minute
        </span>
      ) : build?.state === "live" ? (
        <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Site updated {fmtInstant(build.at)} - refresh the site to see it
        </span>
      ) : build?.state === "slow" ? (
        <span role="status" className="text-xs text-warning">
          The new build is not live after 4 minutes - press again, or tell Dor
        </span>
      ) : (
        note && (
          <span
            className={cn("text-xs text-muted-foreground", last && !last.ok && status?.configured && "text-destructive")}
            title={last ? `${last.by}${last.status ? ` · HTTP ${last.status}` : ""}` : undefined}
          >
            {note}
          </span>
        )
      )}
      <Button type="button" variant="outline" onClick={() => void publish()} disabled={isPending}>
        <RefreshCw className={cn(isPending && "animate-spin")} />
        {isPending ? "Revalidating…" : "Revalidate Pages"}
      </Button>
    </div>
  );
}
