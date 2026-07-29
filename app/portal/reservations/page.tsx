import { getSession } from "@/lib/auth/guards";
import { getPortalReservations } from "@/lib/actions/portal-actions";
import { isPaid } from "@/lib/partner-commission";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Badge } from "@/components/ui/badge";
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

export default async function PortalReservationsPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (getPortalReservations throws for non-agent/affiliate roles).
  if (!isPartner) return null;

  const reservations = await getPortalReservations();

  if (reservations.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        אין הזמנות עדיין
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>מספר</TableHead>
            <TableHead>תאריך</TableHead>
            <TableHead>לקוח</TableHead>
            <TableHead>אירוע</TableHead>
            <TableHead>סטטוס</TableHead>
            <TableHead>סכום</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations.map((reservation) => (
            <TableRow key={reservation.id}>
              <TableCell className="font-medium">{reservation.id}</TableCell>
              <TableCell>
                {new Date(reservation.created_at).toLocaleDateString("he-IL")}
              </TableCell>
              <TableCell>{reservation.customer_name || "—"}</TableCell>
              <TableCell>{reservation.event_title ?? reservation.event_id}</TableCell>
              <TableCell>
                <Badge variant={isPaid(reservation) ? "default" : "outline"}>
                  {reservation.status}
                </Badge>
              </TableCell>
              <TableCell>{usd.format(reservation.user_shown_price)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
