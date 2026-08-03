import Link from "next/link";
import {
  ClipboardList,
  DollarSign,
  Handshake,
  Ticket,
  TrendingUp,
  Wallet,
} from "lucide-react";
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
import type { PartnersOverview } from "@/lib/actions/partners-dashboard-actions";
import type { InsightsRange } from "@/lib/actions/partner-performance-actions";
import { OverviewChart } from "./overview-chart";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const INSIGHTS_RANGE_OPTIONS: { key: InsightsRange; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

/** The cross-partner insights block — the opening view of /partners. */
export function PartnersInsights({
  overview,
  range,
}: {
  overview: PartnersOverview;
  range: InsightsRange;
}) {
  const tiles = [
    {
      label: "Partner sales",
      value: usd.format(overview.totalSalesUsd),
      hint: `${overview.paidReservations} paid bookings · ${overview.paidTickets} tickets`,
      icon: DollarSign,
    },
    {
      label: "Commission owed",
      value: usd.format(overview.totalCommissionUsd),
      hint: "Per each partner's own terms",
      icon: Wallet,
    },
    {
      label: "Net after commission",
      value: usd.format(overview.netAfterCommissionUsd),
      hint: "Before supplier costs",
      icon: TrendingUp,
    },
    {
      label: "Coupon discounts",
      value: usd.format(overview.couponDiscountUsd),
      hint: "Given on paid partner bookings",
      icon: Ticket,
    },
    {
      label: "Producing partners",
      value: overview.producingPartners,
      hint: "With a paid booking in this period",
      icon: ClipboardList,
    },
    {
      label: "Active partners",
      value: overview.activeAgents + overview.activeAffiliates,
      hint: `${overview.activeAgents} agents · ${overview.activeAffiliates} affiliates`,
      icon: Handshake,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Period:</span>
        {INSIGHTS_RANGE_OPTIONS.map((option) => (
          <Link
            key={option.key}
            href={`/partners?range=${option.key}`}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tile.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tile.value}</div>
                <p className="text-xs text-muted-foreground">{tile.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sales vs commission by month</CardTitle>
          <CardDescription>
            Paid partner-attributed reservations only, in USD.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OverviewChart data={overview.monthly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top partners</CardTitle>
          <CardDescription>
            By paid sales in the selected period. Click through for the full
            per-partner picture.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.topPartners.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No paid partner-attributed reservations in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Paid bookings</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.topPartners.map((partner) => (
                  <TableRow key={partner.code}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/partners/${partner.code}/view?range=${range}`}
                        className="hover:underline"
                      >
                        {partner.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {partner.code}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={partner.type === "agent" ? "default" : "secondary"}>
                        {partner.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {partner.paidReservations}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{partner.tickets}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usd.format(partner.salesUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usd.format(partner.commissionUsd)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {usd.format(partner.salesUsd - partner.commissionUsd)}
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
