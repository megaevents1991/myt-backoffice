"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, Hotel, Plane, Ticket } from "lucide-react";
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
import { assignReservationAgent } from "@/lib/actions/portal-team-actions";
import { useToast } from "@/hooks/use-toast";

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
  if (!value) return "-";
  const date = new Date(value);
  // Two-digit year: 14 columns must fit the card without clipping (אלון,
  // 2026-08-08 - the wide table pushed סכום/עמלה out of view).
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
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

function formatDateTimeShort(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The customer's picks, one line per part; parts the customer skipped say so. */
function ChoicesPanel({ reservation }: { reservation: PortalReservation }) {
  const { flight, hotel, ticket } = reservation.choices;
  return (
    <div className="grid gap-3 py-1 sm:grid-cols-3">
      <div className="flex items-start gap-2">
        <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">כרטיסים</div>
          {ticket ? (
            <div className="text-muted-foreground">
              {[ticket.quantity ? `×${ticket.quantity}` : null, ticket.category]
                .filter(Boolean)
                .join(" · ") || "-"}
            </div>
          ) : (
            <div className="text-muted-foreground">-</div>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Plane className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">טיסה</div>
          {flight ? (
            <div className="text-muted-foreground">
              <span dir="ltr">{flight.route ?? "-"}</span>
              {flight.airline ? ` · ${flight.airline}` : ""}
              {flight.depart ? (
                <div className="text-xs">
                  הלוך {formatDateTimeShort(flight.depart)}
                  {flight.return ? ` · חזור ${formatDateTimeShort(flight.return)}` : ""}
                </div>
              ) : null}
              {(() => {
                const addedBags = (flight as { added_bags?: { checked_qty?: number; checked_qty_per_pax?: number; total_usd?: number; cabin?: { qty_per_pax?: number; total_usd?: number } } })?.added_bags;
                if (!addedBags) return null;
                const parts = [];
                // New shape (20.8): checked_qty = booking total; legacy = per pax.
                const bagsQty = addedBags.checked_qty ?? addedBags.checked_qty_per_pax;
                if (bagsQty) parts.push(`מזוודות: ${bagsQty} × $${addedBags.total_usd?.toFixed(0)}`);
                if (addedBags.cabin?.qty_per_pax) parts.push(`טרולי: ${addedBags.cabin.qty_per_pax} × $${addedBags.cabin.total_usd?.toFixed(0)}`);
                return parts.length > 0 ? <div className="text-xs mt-1">{parts.join(" · ")}</div> : null;
              })()}
            </div>
          ) : (
            <div className="text-muted-foreground">דילגו על טיסה</div>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Hotel className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">מלון</div>
          {hotel ? (
            <div className="text-muted-foreground">
              {hotel.name ?? "מלון נבחר"}
              {hotel.nights ? ` · ${hotel.nights} לילות` : ""}
              {hotel.meal ? ` · ${hotel.meal}` : ""}
            </div>
          ) : (
            <div className="text-muted-foreground">דילגו על מלון</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReservationsTable({
  rows,
  showAgentColumn,
  officeAgents,
}: {
  rows: PortalReservation[];
  /** Manager view only - adds the "סוכן" column crediting each row. */
  showAgentColumn: boolean;
  /** Manager view only - the office roster for the assignment Select's
   *  options (unused, and safe to omit, when showAgentColumn is false). */
  officeAgents?: { sub: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [futureOnly, setFutureOnly] = useState(false);
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const handleAgentChange = async (reservationId: number, value: string) => {
    setSavingId(reservationId);
    const result = await assignReservationAgent(
      reservationId,
      value === "none" ? null : value,
    );
    setSavingId(null);
    if (!result.ok) {
      toast({ variant: "destructive", title: "השיוך נכשל", description: result.error });
      return;
    }
    toast({ title: "הסוכן עודכן" });
    router.refresh();
  };

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
          {/* Compact density - 14 columns have to fit a ~1100px card. */}
          <Table className="text-sm [&_th]:h-10 [&_th]:whitespace-nowrap [&_th]:px-2 [&_td]:px-2 [&_td]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" aria-label="פתיחת פירוט" />
                <TableHead>מספר</TableHead>
                <TableHead>תאריך</TableHead>
                <TableHead>לקוח</TableHead>
                <TableHead>אמן / אירוע</TableHead>
                <TableHead>יעד</TableHead>
                <TableHead>תאריך האירוע</TableHead>
                <TableHead className="text-center">כרטיסים</TableHead>
                <TableHead className="text-center">נוסעים</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>מקור</TableHead>
                {showAgentColumn && <TableHead>סוכן</TableHead>}
                <TableHead>חומר ללקוח</TableHead>
                <TableHead className="text-left">סכום</TableHead>
                <TableHead className="text-left">העמלה שלי</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((reservation) => (
                <Fragment key={reservation.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedId((current) =>
                      current === reservation.id ? null : reservation.id
                    )
                  }
                >
                  <TableCell className="w-8 pe-0 text-muted-foreground">
                    {expandedId === reservation.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronLeft className="h-4 w-4" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {reservation.booking_reference || reservation.id}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(reservation.created_at)}
                  </TableCell>
                  <TableCell className="max-w-[7rem]">
                    <span className="block truncate">
                      {reservation.customer_name || "-"}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[10rem]">
                    <div className="truncate font-medium">
                      {reservation.event_title ?? `#${reservation.event_id}`}
                    </div>
                    {reservation.ticket_category && (
                      <div className="truncate text-xs text-muted-foreground">
                        {reservation.ticket_category}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[7rem]">
                    <span className="block truncate">
                      {reservation.event_location || "-"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {reservation.event_date ? formatDate(reservation.event_date) : "-"}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {reservation.tickets || "-"}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {reservation.pax}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant={isPaid(reservation) ? "default" : "outline"}>
                        {reservation.status}
                      </Badge>
                      {reservation.voucher_state && (
                        <Badge variant="secondary" className="whitespace-nowrap">
                          {reservation.voucher_state === "sent"
                            ? "שובר נשלח"
                            : reservation.voucher_state === "received"
                              ? "שובר נקלט"
                              : "שובר נגבה"}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={reservation.source === "link" ? "outline" : "secondary"}
                      className="whitespace-nowrap"
                    >
                      {SOURCE_LABELS[reservation.source]}
                    </Badge>
                  </TableCell>
                  {showAgentColumn && (
                    <TableCell
                      className="max-w-[9rem]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        value={reservation.agent_sub ?? "none"}
                        onValueChange={(value) =>
                          handleAgentChange(reservation.id, value)
                        }
                        disabled={savingId === reservation.id}
                      >
                        <SelectTrigger className="h-8 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">לא משויך</SelectItem>
                          {(officeAgents ?? []).map((agent) => (
                            <SelectItem key={agent.sub} value={agent.sub}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
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
                    {reservation.settled_at_charge ? (
                      <span className="text-xs text-muted-foreground">
                        קוזז בחיוב
                      </span>
                    ) : reservation.commission_usd > 0 ? (
                      <>
                        <span className="font-medium">
                          {usdExact.format(reservation.commission_usd)}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {reservation.billed ? "דווח" : "לתשלום"}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
                {expandedId === reservation.id && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={showAgentColumn ? 15 : 14} className="px-6">
                      <ChoicesPanel reservation={reservation} />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
