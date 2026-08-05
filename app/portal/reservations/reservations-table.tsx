"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isPaid } from "@/lib/partner-commission";
import type {
  PortalReservation,
  PortalReservationSource,
} from "@/lib/actions/portal-actions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("he-IL");
}

/** How the customer arrived. An influencer has no voucher flow, so their rows
 *  only ever read link / package / quote. */
const SOURCE_LABELS: Record<PortalReservationSource, string> = {
  voucher: "שובר",
  quote: "הצעת מחיר",
  package: "לינק אישי",
  link: "לינק",
};

const STATUS_OPTIONS = [
  { value: "all", label: "כל הסטטוסים" },
  { value: "Paid", label: "שולמו" },
  { value: "Pending", label: "ממתינות" },
  { value: "24Save", label: "שמורות 24 שעות" },
  { value: "Cancelled", label: "בוטלו" },
  { value: "Lost", label: "לא נסגרו" },
] as const;

type SortKey = "created" | "event_date";

export function ReservationsTable({ rows }: { rows: PortalReservation[] }) {
  const [futureOnly, setFutureOnly] = useState(false);
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("created");

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const list = rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (futureOnly) {
        const eventMs = r.event_date ? new Date(r.event_date).getTime() : NaN;
        if (!Number.isFinite(eventMs) || eventMs < todayMs) return false;
      }
      return true;
    });

    if (sort === "event_date") {
      // Nearest event first; rows without a date sink to the bottom.
      return [...list].sort((a, b) => {
        const aMs = a.event_date ? new Date(a.event_date).getTime() : Infinity;
        const bMs = b.event_date ? new Date(b.event_date).getTime() : Infinity;
        return aMs - bMs;
      });
    }
    return list; // Server order: newest booking first.
  }, [rows, futureOnly, status, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border bg-background px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={futureOnly} onCheckedChange={setFutureOnly} />
          אירועים עתידיים בלבד
        </label>
        <label className="flex items-center gap-2 text-sm">
          סטטוס
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          מיון
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">חדשות קודם</SelectItem>
              <SelectItem value="event_date">אירוע קרוב → רחוק</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <span className="ms-auto text-sm text-muted-foreground tabular-nums">
          {filtered.length} מתוך {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          אין הזמנות שתואמות את הסינון
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מספר</TableHead>
                <TableHead>תאריך</TableHead>
                <TableHead>לקוח</TableHead>
                <TableHead>אירוע</TableHead>
                <TableHead className="text-center">כרטיסים</TableHead>
                <TableHead className="text-center">נוסעים</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead>חומר ללקוח</TableHead>
                <TableHead className="text-left">סכום</TableHead>
                <TableHead className="text-left">העמלה שלי</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((reservation) => (
                <TableRow key={reservation.id}>
                  <TableCell className="font-medium">
                    {reservation.booking_reference || reservation.id}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(reservation.created_at)}
                  </TableCell>
                  <TableCell>{reservation.customer_name || "—"}</TableCell>
                  <TableCell className="max-w-[18rem]">
                    <div className="truncate font-medium">
                      {reservation.event_title ?? `#${reservation.event_id}`}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        reservation.event_location,
                        reservation.event_date ? formatDate(reservation.event_date) : null,
                        reservation.ticket_category,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {reservation.tickets || "—"}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {reservation.pax}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isPaid(reservation) ? "default" : "outline"}>
                      {reservation.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={reservation.source === "link" ? "outline" : "secondary"}
                      className="whitespace-nowrap"
                    >
                      {SOURCE_LABELS[reservation.source]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {reservation.materials_sent ? (
                      <span className="text-sm">נשלח</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">טרם נשלח</span>
                    )}
                  </TableCell>
                  <TableCell className="text-left tabular-nums">
                    {usd.format(reservation.user_shown_price)}
                  </TableCell>
                  <TableCell className="text-left tabular-nums">
                    {reservation.commission_usd > 0 ? (
                      <>
                        <span className="font-medium">
                          {usdExact.format(reservation.commission_usd)}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {reservation.billed ? "דווח" : "לתשלום"}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
