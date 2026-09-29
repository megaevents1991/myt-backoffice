"use client";

import { useTransition } from "react";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { pushEventToFeedAction } from "@/lib/actions/meta-feed-actions";

const CREATIVE_TEXT = {
  generated: "נוצר קריאייטיב חדש",
  current: "הקריאייטיב כבר עדכני",
  skipped: "לא נוצר קריאייטיב",
} as const;

/**
 * "This event into the Meta feed now": its creative, then the feed files -
 * instead of waiting for the crons or running "sync everything". Works on the
 * SAVED event, so it waits while the editor has unsaved changes.
 */
export function PushToFeedButton({
  eventId,
  unsaved,
}: {
  eventId: number;
  unsaved: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const onClick = () =>
    startTransition(async () => {
      const res = await pushEventToFeedAction(eventId);
      if (!res.ok) {
        toast({ variant: "destructive", title: "העלאה לפיד נכשלה", description: res.error });
        return;
      }
      const creative = CREATIVE_TEXT[res.creative];
      if (res.inFeed) {
        toast({
          title: "האירוע בפיד",
          description: `${creative}. הקובץ שמטא קוראת עודכן (${res.activityRows} אירועים); מטא קוראת אותו כל שעה.`,
        });
        return;
      }
      toast({
        variant: "destructive",
        title: "האירוע לא נכנס לפיד",
        description: `${creative}. ${res.whyNot.join(" · ")}`,
      });
    });

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={pending || unsaved}
      title={unsaved ? "שמרו קודם - הפיד נבנה מהאירוע השמור" : "יוצר קריאייטיב ומעדכן את הפיד למטא עכשיו"}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Send className="mr-2 h-4 w-4" />
      )}
      {pending ? "מעלה לפיד…" : "העלה לפיד עכשיו"}
    </Button>
  );
}
