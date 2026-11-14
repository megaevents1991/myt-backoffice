"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { approveFeedPrice } from "@/lib/actions/feed-price-guard-actions";
import { FEED_APPROVAL_TOLERANCE, holdReasonText, parseFeedPriceGuard, usd } from "@/lib/feed/price-guard";

/**
 * Shown while the feed's abnormal-price guard holds the event out of the Meta feed
 * (lib/feed/price-guard.ts): why, and "the price is right" - an admin approves the current price and
 * the event goes back to the feed at once. Works on the SAVED event, so it waits while the editor
 * has unsaved changes.
 */
export function FeedPriceHoldNotice({
  eventId,
  guard,
  unsaved,
}: {
  eventId: number;
  /** `events.feed_price_guard` as loaded (absent before the migration). */
  guard: unknown;
  unsaved: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [approved, setApproved] = useState(false);
  const hold = parseFeedPriceGuard(guard).hold;
  if (!hold || approved) return null;

  const onClick = () =>
    startTransition(async () => {
      const res = await approveFeedPrice(eventId);
      if (!res.ok) {
        toast({ variant: "destructive", title: "לא אושר", description: res.error });
        return;
      }
      setApproved(true);
      toast({
        title: res.inFeed ? "המחיר אושר - האירוע חזר לפיד" : "המחיר אושר, אבל האירוע לא בפיד",
        description: res.inFeed
          ? `${usd(res.cardUsd)} לנוסע. האישור תקף כל עוד המחיר זז פחות מ-${Math.round(FEED_APPROVAL_TOLERANCE * 100)}%.`
          : res.whyNot.join(" · "),
        variant: res.inFeed ? undefined : "destructive",
      });
    });

  return (
    <Card className="border-amber-400 bg-amber-50 dark:bg-amber-950/30">
      <CardContent className="flex flex-wrap items-center gap-4 pt-6">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 space-y-1" dir="rtl">
          <p className="font-medium">מחוץ לפיד של מטא - מחיר חריג</p>
          <p className="text-sm">{holdReasonText(hold)}.</p>
          <p className="text-xs text-muted-foreground">
            חוזר לפיד לבד כשהמחיר חוזר לרגיל. אם המחיר נכון ורוצים לפרסם אותו - &quot;המחיר נכון&quot; (מנהל).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onClick}
          disabled={pending || unsaved}
          title={unsaved ? "שמרו קודם - האישור על המחיר השמור" : "מאשר את המחיר הנוכחי ומחזיר את האירוע לפיד"}
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
          {pending ? "מאשר…" : "המחיר נכון - החזר לפיד"}
        </Button>
      </CardContent>
    </Card>
  );
}
