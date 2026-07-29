import { getSession } from "@/lib/auth/guards";
import { getPortalReservations } from "@/lib/actions/portal-actions";
import { isPaid } from "@/lib/partner-commission";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenHolds } from "./open-holds";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

export default async function PortalReservationsPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (getPortalReservations throws for non-agent/affiliate roles).
  if (!isPartner) return null;

  const { rows, truncated } = await getPortalReservations();

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        אין הזמנות עדיין
      </div>
    );
  }

  const paid = rows.filter(isPaid);
  const holds = rows.filter((r) => r.is_hold);
  const totals = {
    tickets: paid.reduce((sum, r) => sum + r.tickets, 0),
    sales: paid.reduce((sum, r) => sum + r.user_shown_price, 0),
    commission: paid.reduce((sum, r) => sum + r.commission_usd, 0),
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ההזמנות שלי</CardTitle>
          <CardDescription>
            {/* Scoped to the page when truncated — the dashboard totals are
                uncapped, and two different numbers with no explanation is worse
                than one qualified one. */}
            {truncated ? "ב-500 ההזמנות האחרונות: " : ""}
            {paid.length} הזמנות ששולמו · {totals.tickets} כרטיסים ·{" "}
            {usd.format(totals.sales)} מכירות · {usdExact.format(totals.commission)} עמלה
          </CardDescription>
        </CardHeader>
      </Card>

      <OpenHolds holds={holds} />

      {truncated && (
        <p className="text-sm text-muted-foreground">
          מוצגות 500 ההזמנות האחרונות. יש הזמנות ישנות יותר — פנו אלינו אם צריך אותן.
        </p>
      )}

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
              <TableHead>חומר ללקוח</TableHead>
              <TableHead className="text-left">סכום</TableHead>
              <TableHead className="text-left">העמלה שלי</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((reservation) => (
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
    </div>
  );
}
