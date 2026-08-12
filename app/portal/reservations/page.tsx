import { getSession } from "@/lib/auth/guards";
import { getPortalReservations } from "@/lib/actions/portal-actions";
import { isPaid } from "@/lib/partner-commission";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ClipboardList, DollarSign, Ticket } from "lucide-react";
import { OpenHolds } from "./open-holds";
import { ReservationsTable } from "./reservations-table";

const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export default async function PortalReservationsPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only - never call partner
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

  // The doc's four tiles - orders in, orders paid, tickets sold, commission
  // earned. Deliberately NO sales/revenue tile (הורד לבקשת אלון ודור).
  const tiles = [
    { label: "הזמנות שנכנסו", value: String(rows.length), icon: ClipboardList },
    { label: "הזמנות ששולמו", value: String(paid.length), icon: CheckCircle2 },
    {
      label: "כרטיסים נמכרו",
      value: String(paid.reduce((sum, r) => sum + r.tickets, 0)),
      icon: Ticket,
    },
    {
      label: "העמלה שהרווחתם",
      value: usdExact.format(paid.reduce((sum, r) => sum + r.commission_usd, 0)),
      icon: DollarSign,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label} className="shadow-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tile.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="font-display text-2xl font-bold tabular-nums">
                  {tile.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <OpenHolds holds={holds} />

      {truncated && (
        <p className="text-sm text-muted-foreground">
          המספרים והרשימה מחושבים מ-500 ההזמנות האחרונות. יש הזמנות ישנות יותר -
          פנו אלינו אם צריך אותן.
        </p>
      )}

      <ReservationsTable rows={rows} />
    </div>
  );
}
