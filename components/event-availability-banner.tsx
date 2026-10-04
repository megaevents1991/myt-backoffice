"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { recheckEventAvailability } from "@/lib/actions/event-actions";
import { autoOffCategories, deactivationText } from "@/lib/services/tixstock-availability";
import type { Event, EventTicket } from "@/types/app.types";

/** What the editor takes back into its form after a check. */
export type CheckedAvailability = {
  tickets: EventTicket[];
  reason: string | null;
  deactivatedAt: string | null;
};

/**
 * Shown while the TixStock price sync holds the event - or some of its
 * categories - off the customer site (lib/services/tixstock-availability.ts):
 * why, and "check now", which runs that sync for this one event so a fixed
 * event is back at once instead of at the next scheduled run. The check reads
 * the SAVED event, so it waits while the editor has unsaved changes.
 */
export function EventAvailabilityBanner({
  event,
  unsaved,
  onChecked,
}: {
  event: Pick<Event, "id" | "deactivated_reason" | "tickets_and_rates">;
  unsaved: boolean;
  onChecked: (checked: CheckedAvailability) => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // TixStock's own category list for the show - known only after a check.
  const [supplierCategories, setSupplierCategories] = useState<string[] | null>(null);

  const reason = event.deactivated_reason ?? null;
  const { missing, soldOut } = autoOffCategories(event.tickets_and_rates ?? []);
  if (!reason && missing.length === 0 && soldOut.length === 0) return null;

  const onClick = () =>
    startTransition(async () => {
      const res = await recheckEventAvailability(event.id);
      if (!res.ok) {
        toast({ variant: "destructive", title: "הבדיקה נכשלה", description: res.error });
        return;
      }
      setSupplierCategories(res.supplierCategories);
      onChecked({ tickets: res.tickets, reason: res.reason, deactivatedAt: res.deactivatedAt });
      if (res.reason) {
        toast({
          variant: "destructive",
          title: "האירוע עדיין כבוי",
          description: `${deactivationText(res.reason)}.`,
        });
        return;
      }
      const stillOff = autoOffCategories(res.tickets);
      const offNow = [...stillOff.missing, ...stillOff.soldOut];
      toast({
        title: res.action === "reactivated" ? "האירוע חזר לאתר" : "האירוע באתר",
        description: offNow.length
          ? `קטגוריות שעדיין לא נמכרות: ${offNow.join(", ")}`
          : "כל הקטגוריות נמכרות.",
      });
    });

  return (
    <Card className={reason ? "border-destructive bg-destructive/10" : "border-amber-400 bg-amber-50 dark:bg-amber-950/30"}>
      <CardContent className="flex flex-wrap items-center gap-4 pt-6">
        <AlertTriangle className={reason ? "h-5 w-5 shrink-0 text-destructive" : "h-5 w-5 shrink-0 text-amber-600"} />
        <div className="min-w-0 flex-1 space-y-1" dir="rtl">
          <p className={reason ? "font-medium text-destructive" : "font-medium"}>
            {reason ? "האירוע כבוי - לא מוצג באתר" : "קטגוריות שהורדו מהמכירה אוטומטית"}
          </p>
          {reason && <p className="text-sm">{deactivationText(reason)}.</p>}
          {missing.length > 0 && (
            <p className="text-sm">לא קיים אצל TixStock להופעה הזו: {missing.join(", ")}</p>
          )}
          {soldOut.length > 0 && <p className="text-sm">אזל אצל TixStock: {soldOut.join(", ")}</p>}
          {supplierCategories && supplierCategories.length > 0 && (
            <p className="text-sm text-muted-foreground">
              הקטגוריות של TixStock להופעה: {supplierCategories.join(", ")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            חוזר לאתר לבד כשיש כרטיס למכירה - בסנכרון המחירים הבא, או מיד ב&quot;בדוק עכשיו&quot;.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onClick}
          disabled={pending || unsaved}
          title={
            unsaved
              ? "שמרו קודם - הבדיקה רצה על האירוע השמור"
              : "בודק מול TixStock עכשיו; אירוע שיש בו כרטיס למכירה חוזר לאתר"
          }
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {pending ? "בודק…" : "בדוק עכשיו"}
        </Button>
      </CardContent>
    </Card>
  );
}
