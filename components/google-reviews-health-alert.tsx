"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getGoogleReviewsHealth,
  runGoogleReviewsSyncNow,
  type GoogleReviewsHealth,
} from "@/lib/actions/google-reviews-actions";

/**
 * Dashboard banner that appears only when the Google-reviews mirror is broken
 * (last cron run failed, or no successful run for 2+ days). Silent when
 * healthy - the point is to notice the day the Elfsight feed stops, so a
 * different source can be wired before the site's reviews go stale.
 */
export function GoogleReviewsHealthAlert() {
  const [health, setHealth] = useState<GoogleReviewsHealth | null>(null);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const reload = useCallback(() => {
    getGoogleReviewsHealth()
      .then(setHealth)
      .catch((err) => console.error("[GoogleReviewsHealthAlert]", err));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!health || health.ok) return null;

  const retry = async () => {
    setRunning(true);
    try {
      const res = await runGoogleReviewsSyncNow();
      if (res.ok) {
        toast({
          title: "Reviews sync ran",
          description: `${res.result.source}: ${res.result.fetched} fetched, ${res.result.inserted} new, ${res.result.updated} updated.`,
        });
      } else {
        toast({ variant: "destructive", title: "Sync still failing", description: res.error });
      }
    } finally {
      setRunning(false);
      reload();
    }
  };

  return (
    <Alert variant="destructive">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>Google reviews sync is broken</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {health.problem} The site keeps showing the {health.reviewCount ?? "mirrored"} reviews
          it already has, but new ones will not appear until this is fixed
          {health.syncedAt
            ? ` (last success: ${new Date(health.syncedAt).toLocaleString("en-GB")})`
            : ""}
          .
        </p>
        <p className="text-xs opacity-80">
          Source is Elfsight&apos;s public feed unless a Places API key is set. If the feed
          is gone for good, add <code>NEXT_SECRET_GOOGLE_PLACES_API_KEY</code> or find a new
          source - see CLAUDE.md → googleReviewsSync.
        </p>
        <Button size="sm" variant="outline" onClick={retry} disabled={running}>
          {running ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          Run sync now
        </Button>
      </AlertDescription>
    </Alert>
  );
}
