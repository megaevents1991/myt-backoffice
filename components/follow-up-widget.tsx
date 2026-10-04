"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, PhoneCall } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { listFollowUps, type FollowUpList } from "@/lib/actions/reservation-follow-up-actions";
import {
  FOLLOW_UP_STATUS,
  followUpCounts,
  followUpLabel,
  type FollowUpState,
} from "@/lib/reservations/follow-up";

/** The reservations table, already narrowed to the pile. */
export const FOLLOW_UP_LIST_HREF = `/reservations?status=${encodeURIComponent(FOLLOW_UP_STATUS)}`;

/** One colour per state, shared by the dashboard card and the reservations table. */
export const FOLLOW_UP_TONE: Record<FollowUpState, string> = {
  overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  today: "border-warning/40 bg-warning-muted text-warning",
  undated: "border-border bg-muted text-muted-foreground",
  upcoming: "border-info/30 bg-info-muted text-info",
};

/** How many customers the card lists before "+N more". */
const CARD_MAX = 8;

/**
 * The Follow-up pile, loaded once for the banner and the card (null = still loading).
 * A failed read is `ok: false` and both render nothing - never a false "nobody is waiting".
 */
export function useFollowUps(): FollowUpList | null {
  const [data, setData] = useState<FollowUpList | null>(null);
  useEffect(() => {
    let cancelled = false;
    listFollowUps()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((error) => {
        console.error("useFollowUps: listFollowUps failed", error);
        if (!cancelled) setData({ ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * Dashboard banner: shows only while a customer is waiting for a call back NOW - the
 * call-back day is today, has passed, or was never set. Red once someone is overdue.
 */
export function FollowUpAlert({ data }: { data: FollowUpList | null }) {
  if (!data?.ok) return null;
  const counts = followUpCounts(data.rows, data.today);
  if (counts.now === 0) return null;

  const parts = [
    counts.overdue > 0 ? `${counts.overdue} overdue` : "",
    counts.today > 0 ? `${counts.today} for today` : "",
    counts.undated > 0 ? `${counts.undated} with no date` : "",
  ].filter(Boolean);

  return (
    <Alert
      variant={counts.overdue > 0 ? "destructive" : "default"}
      className={cn(
        counts.overdue > 0
          ? "bg-destructive/5"
          : "border-warning/40 bg-warning-muted text-warning [&>svg]:text-warning",
      )}
    >
      <PhoneCall className="h-4 w-4" />
      <AlertTitle>
        {counts.now} {plural(counts.now, "customer is", "customers are")} waiting for a call back
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p>
          Reservations in Follow-up: {parts.join(" · ")}.
          {counts.upcoming > 0 ? ` ${counts.upcoming} more ${plural(counts.upcoming, "is", "are")} set for a later day.` : ""}
        </p>
        <Button asChild size="sm" variant="outline" className="bg-background text-foreground">
          <Link href={FOLLOW_UP_LIST_HREF}>Open the list</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Dashboard card: the whole pile in the order to work it - who, their phone, which event,
 *  the comment staff left, and where the call-back day stands. */
export function FollowUpWidget({ data }: { data: FollowUpList | null }) {
  if (data && !data.ok) return null;
  const rows = data?.rows ?? [];
  const shown = rows.slice(0, CARD_MAX);
  const more = rows.length - shown.length;

  return (
    <WidgetCard
      title="Follow-up"
      icon={PhoneCall}
      badge={
        rows.length > 0 ? (
          <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs font-semibold tabular text-warning">
            {rows.length}
          </span>
        ) : undefined
      }
      href={FOLLOW_UP_LIST_HREF}
      linkLabel="All follow-ups"
    >
      {data === null ? (
        <>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Nobody is waiting for a call back.
        </div>
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-2">
            {shown.map((row) => (
              <div key={row.id} className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2">
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    FOLLOW_UP_TONE[row.state],
                  )}
                  title={row.follow_up_date ?? "No call-back day was set"}
                >
                  {followUpLabel(row.follow_up_date, data.today, "en")}
                </span>
                <Link
                  href={`/reservations/${row.id}`}
                  className="min-w-0 flex-1 hover:underline"
                  title={row.comments ?? undefined}
                >
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground" dir="auto">
                    {row.event_name}
                    {row.comments?.trim() ? ` · ${row.comments.trim()}` : ""}
                  </span>
                </Link>
                {row.phone && (
                  <a
                    href={`tel:${row.phone.replace(/[^\d+]/g, "")}`}
                    className="shrink-0 whitespace-nowrap text-xs font-medium tabular text-primary hover:underline"
                    dir="ltr"
                  >
                    {row.phone}
                  </a>
                )}
              </div>
            ))}
          </div>
          {more > 0 && <p className="text-xs text-muted-foreground">+{more} more</p>}
        </>
      )}
    </WidgetCard>
  );
}
