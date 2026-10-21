"use client";

import Link from "next/link";
import { AlertTriangle, Plane, TrainFront } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  itineraryChipLabel,
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

/**
 * "יורו טריפ" - the trip this reservation belongs to ("Build Your Euro Trip": one reservation per
 * event, tied by itinerary_group). The sibling reservations with a link each, the trip total
 * (the sum of the rows' shares of final_purchase_price_ils), and every leg of the flight that
 * sits on the trip's first reservation, plus the moves the customer makes by train on their own.
 * The reservation's own flight block (outbound / inbound) is a separate card and unchanged.
 */
export function ItineraryPanel({
  group,
  currentId,
}: {
  group: ItineraryGroup;
  currentId: number;
}) {
  const current = group.members.find((m) => m.id === currentId);
  const chip = current ? itineraryChipLabel(current.seq, group.of) : null;
  const missing =
    group.of != null && group.members.length < group.of ? group.of - group.members.length : 0;
  const hasFlight = group.legs.length > 0 || group.trainLegs.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span dir="auto">יורו טריפ</span>
          {chip && (
            <Badge variant="outline" dir="rtl" className="whitespace-nowrap">
              {chip}
            </Badge>
          )}
        </CardTitle>
        <CardDescription dir="auto">
          טיול של {group.of ?? group.members.length} אירועים - כל אירוע הוא הזמנה נפרדת, וסכום
          ההזמנות הוא מה שהלקוח שילם על הטיול כולו.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div>
            <p className="text-sm font-medium" dir="auto">סה״כ הטיול</p>
            <p className="text-2xl font-bold tabular-nums">{formatIls(group.totalIls)}</p>
            {group.totalPartial && (
              <p className="text-xs text-warning" dir="auto">
                לפחות אחת ההזמנות בלי מחיר רשום - הסכום חלקי.
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
                return (
                  <TableRow key={m.id} className={cn(isCurrent && "bg-muted/50")}>
                    <TableCell className="text-muted-foreground tabular-nums">{m.seq ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {isCurrent ? (
                        <span className="font-semibold">
                          #{m.id}
                          <Badge variant="secondary" className="ms-2" dir="auto">
                            זו ההזמנה הנוכחית
                          </Badge>
                        </span>
                      ) : (
                        <Link
                          href={`/reservations/${m.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          #{m.id}
                        </Link>
                      )}
                      {m.deleted && (
                        <Badge variant="destructive" className="ms-2" dir="auto">
                          נמחקה
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-left font-medium" dir="auto">
                        {m.eventName ?? (m.eventId != null ? `אירוע #${m.eventId}` : "-")}
                      </p>
                      {(m.eventDate || m.hotelName) && (
                        <p className="text-left text-xs text-muted-foreground" dir="auto">
                          {[m.eventDate, m.hotelName ? `מלון: ${m.hotelName}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {m.status ? <Badge variant="outline">{m.status}</Badge> : "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
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
