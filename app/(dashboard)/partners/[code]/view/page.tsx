import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BedDouble,
  ClipboardList,
  DollarSign,
  Edit,
  Percent,
  Plane,
  Ticket,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
import {
  getPartnerPerformance,
  type InsightsRange,
  type TopCount,
} from "@/lib/actions/partner-performance-actions";
import { getPartnerCredit } from "@/lib/actions/partner-credit-actions";
import { describeCommission } from "@/lib/partner-commission";
import { PARTNER_TYPE_LABELS, isCustomerRefundPartner } from "@/types/partner.types";
import { EntryFunnelsGrid } from "../../entry-funnel-cards";
import { PerformanceChart } from "./performance-chart";
import { ReservationsTable } from "./reservations-table";

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

const RANGE_OPTIONS: { key: InsightsRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export default async function ViewPartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { code } = await params;
  const { range: rangeParam } = await searchParams;
  const range: InsightsRange = RANGE_OPTIONS.some((o) => o.key === rangeParam)
    ? (rangeParam as InsightsRange)
    : "all";

  // Let auth/DB errors reach the error boundary - only a missing row is a 404.
  const partner = await getPartner(code).catch((error: unknown) => {
    if (isRowNotFound(error)) return null;
    throw error;
  });
  if (!partner) notFound();

  const [performance, credit] = await Promise.all([
    getPartnerPerformance(code, range),
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
      label: "Pending",
      value: usd.format(performance.pendingCommissionUsd),
      // Same `billed_at` fact the cron bills on and the partner's own portal
      // shows, so staff arbitrating a dispute read the partner's number.
      hint: "Not yet in a monthly report",
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
    {
      label: "Conversion",
      value:
        performance.conversionRate != null
          ? `${(performance.conversionRate * 100).toFixed(2)}%`
          : "-",
      hint: `${performance.trackedVisitors} distinct visitors → ${performance.paidReservations} paid`,
      icon: Percent,
    },
    {
      label: "Avg order value",
      value:
        performance.avgOrderValueUsd != null
          ? usd.format(performance.avgOrderValueUsd)
          : "-",
      hint: `${performance.mix.avgPartySize || "-"} tickets per booking`,
      icon: TrendingUp,
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

      {/* Time window - plain links so the whole server page re-renders scoped. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Period:</span>
        {RANGE_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={`/partners/${partner.partner_tracking_code}/view?range=${option.key}`}
            className={cn(
              "rounded border px-2 py-1 text-xs",
              range === option.key
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            )}
          >
            {option.label}
          </Link>
        ))}
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
              value={partner.supplier_number?.toString() ?? "-"}
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
                // Widest stage, not VISIT - if a later stage were ever recorded
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

      <EntryFunnelsGrid entryFunnels={performance.entryFunnels} />

      <Card>
        <CardHeader>
          <CardTitle>What&apos;s in demand</CardTitle>
          <CardDescription>
            The exact events (name, date, location) this partner&apos;s audience clicked.
            &quot;Never booked&quot; is interest they haven&apos;t converted yet - that&apos;s
            the list marketing should act on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {performance.clickedEvents.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No event clicks recorded in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead>Converted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance.clickedEvents.map((event) => (
                  <TableRow key={`${event.name}-${event.date ?? ""}-${event.location ?? ""}`}>
                    <TableCell className="max-w-[16rem] truncate font-medium">
                      {event.name}
                    </TableCell>
                    <TableCell>
                      {event.date ? new Date(event.date).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate">
                      {event.location ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{event.visitors}</TableCell>
                    <TableCell className="text-right tabular-nums">{event.clicks}</TableCell>
                    <TableCell>
                      {event.booked ? (
                        <Badge>Booked</Badge>
                      ) : (
                        <Badge variant="secondary">Never booked</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plane className="h-4 w-4 text-muted-foreground" />
              Flights their customers pick
            </CardTitle>
            <CardDescription>Paid bookings only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <TopList items={performance.mix.airlines} emptyText="No flights booked yet." />
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span>{performance.mix.offlineFlights} our inventory</span>
              <span>{performance.mix.liveFlights} live (Amadeus)</span>
              <span>{performance.mix.flightSkipped} skipped flight</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-muted-foreground" />
              Hotels their customers pick
            </CardTitle>
            <CardDescription>Star level, property and meal plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <TopList items={performance.mix.hotelStars} emptyText="No hotels booked yet." />
            <TopList items={performance.mix.hotelNames} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              {performance.mix.meals.map((meal) => (
                <span key={meal.label}>
                  {meal.label} × {meal.count}
                </span>
              ))}
              <span>{performance.mix.hotelSkipped} skipped hotel</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              Ticket categories
            </CardTitle>
            <CardDescription>Weighted by tickets on paid bookings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <TopList
              items={performance.mix.ticketCategories}
              emptyText="No tickets sold yet."
            />
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Average group size: {performance.mix.avgPartySize || "-"} tickets per booking
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reservations</CardTitle>
          <CardDescription>
            Attributed to {partner.partner_tracking_code}. Only paid reservations earn
            commission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReservationsTable reservations={performance.reservations} />
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

/** Ranked label→count list with proportional bars, shared by the mix cards. */
function TopList({ items, emptyText }: { items: TopCount[]; emptyText?: string }) {
  if (items.length === 0) {
    return emptyText ? (
      <p className="text-sm text-muted-foreground">{emptyText}</p>
    ) : null;
  }
  const top = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((item.count / top) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
