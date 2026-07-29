import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Edit, Ticket, Wallet, DollarSign, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { getPartner } from "@/lib/actions/partner-actions";
import { getPartnerPerformance } from "@/lib/actions/partner-performance-actions";
import { getPartnerCredit } from "@/lib/actions/partner-credit-actions";
import { PAID_STATUS, describeCommission } from "@/lib/partner-commission";
import { PARTNER_TYPE_LABELS, isCustomerRefundPartner } from "@/types/partner.types";
import { PerformanceChart } from "./performance-chart";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Credit is shown to the cent, matching what the partner sees in their portal. */
const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export default async function ViewPartnerPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  // Let auth/DB errors reach the error boundary — only a missing row is a 404.
  const partner = await getPartner(code).catch((error: unknown) => {
    if (isRowNotFound(error)) return null;
    throw error;
  });
  if (!partner) notFound();

  const [performance, credit] = await Promise.all([
    getPartnerPerformance(code),
    getPartnerCredit(code),
  ]);

  const type = isCustomerRefundPartner(partner)
    ? "customer_refund"
    : partner.type === "agent"
      ? "agent"
      : "affiliate";
  const stats = [
    {
      label: "Commission earned",
      value: usd.format(performance.commissionUsd),
      hint: describeCommission({
        type: performance.commissionType,
        rate: performance.commissionRate,
      }),
      icon: Wallet,
    },
    {
      label: "This month",
      value: usd.format(performance.currentMonthCommissionUsd),
      hint: "Billed by the monthly report",
      icon: DollarSign,
    },
    {
      label: "Paid reservations",
      value: performance.paidReservations,
      hint: `${performance.totalReservations} total`,
      icon: ClipboardList,
    },
    {
      label: "Total sales",
      value: usd.format(performance.totalSalesUsd),
      hint: `${performance.paidTickets} tickets`,
      icon: Ticket,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/partners">
            <Button variant="ghost">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {partner.name_hebrew || partner.email}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                variant={
                  type === "agent"
                    ? "default"
                    : type === "customer_refund"
                      ? "outline"
                      : "secondary"
                }
              >
                {PARTNER_TYPE_LABELS[type]}
              </Badge>
              {!partner.is_active && <Badge variant="outline">Inactive</Badge>}
              <span className="font-mono text-sm text-muted-foreground">
                {partner.partner_tracking_code}
              </span>
            </div>
          </div>
        </div>
        <Link href={`/partners/${partner.partner_tracking_code}`}>
          <Button>
            <Edit className="mr-2 h-4 w-4" />
            Edit Partner
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Commission by month</CardTitle>
            <CardDescription>Paid reservations only, in USD.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceChart data={performance.monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Detail label="Email" value={partner.email} />
            <Detail
              label="Commission"
              value={describeCommission({
                type: performance.commissionType,
                rate: performance.commissionRate,
              })}
            />
            <Detail label="User discount" value={usd.format(partner.user_discount)} />
            <Detail
              label="Supplier number"
              value={partner.supplier_number?.toString() ?? "—"}
            />
            <Detail
              label="Site credit"
              value={
                credit.creditPerTicket > 0
                  ? `${usdExact.format(credit.balanceUsd)} available · ${usdExact.format(credit.creditPerTicket)}/ticket`
                  : "Not on the credit agreement"
              }
            />
            <Detail
              label="Credit converted"
              value={
                credit.history.length === 0
                  ? "Never"
                  : `${usdExact.format(credit.redeemedUsd)} across ${credit.history.length} coupons` +
                    (credit.returnedUsd > 0
                      ? ` · ${usdExact.format(credit.returnedUsd)} returned unspent`
                      : "")
              }
            />
            <Detail
              label="Coupons"
              value={`${performance.activeCoupons} active · ${performance.couponUses} uses`}
            />
            <Detail
              label="Created"
              value={new Date(partner.created_at).toLocaleDateString()}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Traffic &amp; funnel</CardTitle>
          <CardDescription>
            Distinct visitors who arrived through {partner.partner_tracking_code} and how
            far they got.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!performance.traffic.hasData ? (
            <p className="py-6 text-sm text-muted-foreground">
              No visits recorded for this partner yet. Traffic is logged by the booking
              site when someone arrives on a link carrying this tracking code.
            </p>
          ) : (
            <div className="space-y-3">
              {performance.traffic.byStage.map((stage) => {
                // Widest stage, not VISIT — if a later stage were ever recorded
                // without one, dividing by VISIT would give bars over 100%.
                const top = Math.max(
                  ...performance.traffic.byStage.map((s) => s.visitors),
                  1
                );
                const share = Math.round((stage.visitors / top) * 100);
                return (
                  <div key={stage.stage} className="space-y-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{stage.label}</span>
                      <span className="font-medium tabular-nums">
                        {stage.visitors}
                        {stage.stage !== "VISIT" && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {share}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-xs text-muted-foreground">
                {performance.traffic.totalVisitors} distinct visitors
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reservations</CardTitle>
          <CardDescription>
            Attributed to {partner.partner_tracking_code}. Only paid reservations earn
            commission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {performance.reservations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No reservations attributed to this partner yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance.reservations.map((reservation) => (
                  <TableRow key={reservation.id}>
                    <TableCell>
                      {new Date(reservation.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>{reservation.customer_name}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">
                      {reservation.event_title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          reservation.status === PAID_STATUS ? "default" : "secondary"
                        }
                      >
                        {reservation.status || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{reservation.tickets}</TableCell>
                    <TableCell className="text-right">
                      {usd.format(reservation.sales_usd)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {reservation.commission_usd > 0
                        ? usd.format(reservation.commission_usd)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** PostgREST raises PGRST116 when `.single()` matches no row. */
function isRowNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "PGRST116"
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
