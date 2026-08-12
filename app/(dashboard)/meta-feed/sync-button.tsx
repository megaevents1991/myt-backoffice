"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";
import { syncMetaFeedAction } from "@/lib/actions/meta-feed-actions";

/**
 * Manual "publish now" for the Meta feed snapshots - same code path as the
 * twice-daily cron. Meta still refetches on its own hourly schedule, so this
 * only guarantees the snapshot is current, not that Meta has read it yet.
 */
export function SyncFeedButton() {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const onClick = () =>
    startTransition(async () => {
      const res = await syncMetaFeedAction();
      if (!res.ok) {
        toast({
          title: "הסנכרון נכשל",
          description: res.error,
          variant: "destructive",
        });
        return;
      }
      setLastSyncedAt(new Date().toLocaleTimeString("he-IL"));
      toast({
        title: "הפיד סונכרן",
        description: `${res.result.activityRows} אירועים פורסמו לקובץ שמטא קוראת.`,
      });
    });

  return (
    <div className="flex items-center gap-3">
      <Button onClick={onClick} disabled={isPending}>
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {isPending ? "מסנכרן…" : "סנכרן פיד עכשיו"}
      </Button>
      {lastSyncedAt && (
        <span className="text-sm text-muted-foreground">סונכרן ב־{lastSyncedAt}</span>
      )}
    </div>
  );
}
