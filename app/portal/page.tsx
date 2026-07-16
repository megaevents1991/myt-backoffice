import { getSession } from "@/lib/auth/guards";
import { getPortalStats } from "@/lib/actions/portal-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClipboardList,
  CheckCircle2,
  DollarSign,
  Wallet,
  Ticket,
  TicketPercent,
} from "lucide-react";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function PortalDashboardPage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);

  // Staff visiting /portal see the layout's notice only — never call partner
  // actions for them (getPortalStats throws for non-agent/affiliate roles).
  if (!isPartner) return null;

  const stats = await getPortalStats();

  const cards: { label: string; value: string | number; icon: typeof ClipboardList }[] = [
    { label: "סה\"כ הזמנות", value: stats.totalReservations, icon: ClipboardList },
    { label: "הזמנות ששולמו", value: stats.paidReservations, icon: CheckCircle2 },
    { label: "סה\"כ מכירות ($)", value: usd.format(stats.totalSalesUsd), icon: DollarSign },
    { label: "כרטיסים ששולמו", value: stats.paidTickets, icon: Ticket },
    {
      label: "עמלה לכרטיס",
      value:
        stats.commissionPerTicket != null ? usd.format(stats.commissionPerTicket) : "—",
      icon: DollarSign,
    },
    {
      label: "עמלה משוערת ($)",
      value: usd.format(stats.estimatedCommissionUsd),
      icon: Wallet,
    },
    { label: "קופונים פעילים", value: stats.activeCoupons, icon: Ticket },
    { label: "שימושי קופון", value: stats.couponUses, icon: TicketPercent },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
