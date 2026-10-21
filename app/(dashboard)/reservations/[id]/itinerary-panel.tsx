"use client";

import Link from "next/link";
import { AlertTriangle, Plane, TrainFront } from "lucide-react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatIls,
  type ItineraryGroup,
  type ItineraryLeg,
} from "@/lib/itinerary/reservation-group";

/** One flown leg: "TLV → CDG · 12/05/2027 · 08:30 → 12:45 · LY123". Codes and times read left to right. */
function legLine(leg: ItineraryLeg): string {
  const times =
    leg.departs && leg.arrives
      ? `${leg.departs} → ${leg.arrives}${leg.arrivalDate ? ` (${leg.arrivalDate})` : ""}`
      : leg.departs ?? leg.arrives ?? null;
  return [`${leg.from} → ${leg.to}`, leg.date, times, leg.flightNumber]
    .filter((part): part is string => !!part)
    .join(" · ");
}

/** "הזמנה אחת" / "3 הזמנות". */
function reservationsCount(n: number): string {
  return n === 1 ? "הזמנה אחת" : `${n} הזמנות`;
}

/**
 * "יורו טריפ" - the trip this reservation belongs to ("Build Your Euro Trip": one reservation per
 * event, tied by itinerary_group). The sibling reservations with a link each, the trip price (the
 * sum of the live rows' shares of final_purchase_price_ils - a deleted, Cancelled or Lost row is
 * shown struck through and left out), and every leg of the flight that sits on the trip's first
 * reservation, plus the moves the customer makes by train on their own. Nothing here says the trip
 * was paid: that is each row's own status. The reservation's own flight block (outbound / inbound)
 * is a separate card and unchanged.
 */
export function ItineraryPanel({
  group,
  currentId,
}: {
  group: ItineraryGroup;
  currentId: number;
}) {
  const current = group.members.find((m) => m.id === currentId);
  const missing =
    group.of != null && group.members.length < group.of ? group.of - group.members.length : 0;
  const hasFlight = group.legs.length > 0 || group.trainLegs.length > 0;
  const excludedAmount = group.excluded.totalIls;

  return (
    <Card>
      <CardHeader>
        <CardTitle dir="auto">יורו טריפ</CardTitle>
        <CardDescription dir="auto">
          טיול של {group.of ?? group.members.length} אירועים - כל אירוע הוא הזמנה נפרדת.
          {current?.seq != null && group.of != null ? ` זו הזמנה ${current.seq} מתוך ${group.of}.` : ""}{" "}
          מחיר הטיול הוא סכום ההזמנות, והסטטוס נקבע לכל הזמנה בנפרד.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div>
            <p className="text-sm font-medium" dir="auto">מחיר הטיול</p>
            <p className="text-2xl font-bold tabular-nums">{formatIls(group.totalIls)}</p>
            {group.totalPartial && (
              <p className="text-xs text-warning" dir="auto">
                לפחות הזמנה אחת בלי מחיר רשום - הסכום חלקי.
              </p>
            )}
            {group.excluded.count > 0 && (
              <p className="text-xs text-muted-foreground" dir="auto">
                לא נספרו: {reservationsCount(group.excluded.count)}
                {excludedAmount != null ? ` (${formatIls(excludedAmount)})` : ""}
              </p>
            )}
          </div>
          {missing > 0 && (
            <div
              className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-1.5 text-sm text-warning"
              dir="auto"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                נמצאו {group.members.length} הזמנות מתוך {group.of} - חסרות {missing}.
              </span>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <Table look="list">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead dir="auto">הזמנה</TableHead>
                <TableHead dir="auto">אירוע</TableHead>
                <TableHead dir="auto">סטטוס</TableHead>
                <TableHead className="text-right" dir="auto">מחיר</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.members.map((m) => {
                const isCurrent = m.id === currentId;
                const struck = m.excluded ? "line-through" : undefined;
                return (
                  <TableRow
                    key={m.id}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(isCurrent && "bg-muted/50", m.excluded && "text-muted-foreground")}
                  >
                    <TableCell className="text-muted-foreground tabular-nums">{m.seq ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {m.redacted ? (
                        // A deleted sibling this viewer may not open (the list hides it from them too).
                        <span className={cn(badgeVariants({ variant: "outline" }), "text-muted-foreground")} dir="auto">
                          נמחקה
                        </span>
                      ) : (
                        <>
                          {isCurrent ? (
                            <span className={cn("font-semibold", struck)}>#{m.id}</span>
                          ) : (
                            <Link
                              href={`/reservations/${m.id}`}
                              aria-label={`פתיחת הזמנה ${m.id}`}
                              className={cn(
                                "font-medium text-primary underline-offset-4 hover:underline",
                                struck,
                              )}
                            >
                              #{m.id}
                            </Link>
                          )}
                          {isCurrent && (
                            <span className={cn(badgeVariants({ variant: "secondary" }), "ms-2")} dir="auto">
                              זו ההזמנה הנוכחית
                            </span>
                          )}
                          {m.deleted && (
                            <span className={cn(badgeVariants({ variant: "destructive" }), "ms-2")} dir="auto">
                              נמחקה
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.redacted ? (
                        "-"
                      ) : (
                        <>
                          <p className={cn("text-left font-medium", struck)} dir="auto">
                            {m.eventName ?? (m.eventId != null ? `אירוע #${m.eventId}` : "-")}
                          </p>
                          {(m.eventDate || m.hotelName) && (
                            <p className="text-left text-xs text-muted-foreground" dir="auto">
                              {[m.eventDate, m.hotelName ? `מלון: ${m.hotelName}` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {m.status ? <Badge variant="outline">{m.status}</Badge> : "-"}
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right tabular-nums", struck)}>
                      {m.priceIls != null ? formatIls(m.priceIls) : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {hasFlight ? (
          <div className="space-y-4">
            {group.legs.length > 0 && (
              <div className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Plane className="h-4 w-4" />
                  <span dir="auto">טיסות הטיול</span>
                  {group.flightHolderId != null && group.flightHolderId !== currentId && (
                    <span className="text-xs font-normal text-muted-foreground" dir="auto">
                      רשומות בהזמנה{" "}
                      <Link
                        href={`/reservations/${group.flightHolderId}`}
                        aria-label={`פתיחת הזמנה ${group.flightHolderId}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        #{group.flightHolderId}
                      </Link>
                    </span>
                  )}
                </p>
                <ol className="space-y-1 text-sm">
                  {group.legs.map((leg, i) => (
                    <li key={i} className="flex gap-2" dir="ltr">
                      <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className="tabular-nums">
                        {legLine(leg)}
                        {leg.operatedBy && (
                          <span className="ms-2 text-xs text-muted-foreground">
                            operated by {leg.operatedBy}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {group.trainLegs.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <TrainFront className="h-4 w-4" />
                  <span dir="auto">ברכבת, בכוחות עצמם</span>
                </p>
                <ul className="space-y-1 text-sm">
                  {group.trainLegs.map((train, i) => (
                    <li key={i} className="tabular-nums" dir="ltr">
                      {[`${train.from} → ${train.to}`, train.date].filter(Boolean).join(" · ")}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground" dir="auto">
                  הרכבת לא כלולה בהזמנה - הלקוח מסדר אותה בעצמו.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" dir="auto">
            אין פירוט טיסות בטיול הזה.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
