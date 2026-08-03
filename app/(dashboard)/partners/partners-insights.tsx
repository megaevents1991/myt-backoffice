import Link from "next/link";
import {
  ClipboardList,
  DollarSign,
  Flame,
  Handshake,
  Hourglass,
  Package,
  Percent,
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
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "3d", label: "3 days" },
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
      hint: `Paid only · ${usd.format(overview.grossSalesUsd)} ordered in total`,
      icon: DollarSign,
    },
    {
      label: "Orders entered",
      value: overview.totalReservations,
      hint: "Any status, this period",
      icon: ClipboardList,
    },
    {
      label: "Paid orders",
      value: overview.paidReservations,
      hint: `Commission owed: ${usd.format(overview.totalCommissionUsd)}`,
      icon: Wallet,
    },
    {
      label: "Tickets",
      value: overview.paidTickets,
      hint: `Paid only · ${overview.allTickets} ordered in total`,
      icon: Ticket,
    },
    {
      label: "Net after costs",
      value: usd.format(overview.netAfterCostsUsd),
      hint: `Paid − commission − ${usd.format(overview.knownSupplierCostsUsd)} known costs · ticket costs not tracked`,
      icon: TrendingUp,
    },
    {
      label: "Producing partners",
      value: overview.producingPartners,
      hint: "With a paid booking in this period",
      icon: ClipboardList,
    },
    {
      label: "Live holds",
      value: overview.openHolds.count,
      hint: `${usd.format(overview.openHolds.valueUsd)} in flight right now`,
      icon: Hourglass,
    },
    {
      label: "Active partners",
      value: overview.activeAgents + overview.activeAffiliates,
      hint: `${overview.activeAgents} agents · ${overview.activeAffiliates} affiliates`,
      icon: Handshake,
    },
    {
      label: "Conversion",
      value:
        overview.globalConversionRate != null
          ? `${(overview.globalConversionRate * 100).toFixed(2)}%`
          : "—",
      hint: `${overview.globalFunnel.totalVisitors} visitors → ${overview.paidReservations} paid`,
      icon: Percent,
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

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
            <CardTitle>All-partner funnel</CardTitle>
            <CardDescription>
              Every visitor who arrived through any partner link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!overview.globalFunnel.hasData ? (
              <p className="py-6 text-sm text-muted-foreground">
                No partner traffic recorded in this period.
              </p>
            ) : (
              <div className="space-y-3">
                {overview.globalFunnel.byStage.map((stage) => {
                  const top = Math.max(
                    ...overview.globalFunnel.byStage.map((s) => s.visitors),
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              Top events this period
            </CardTitle>
            <CardDescription>Top 3 by paid tickets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {overview.topBookedEvents.length === 0 ? (
              <p className="py-4 text-muted-foreground">
                No paid bookings in this period.
              </p>
            ) : (
              overview.topBookedEvents.map((event, i) => (
                <div
                  key={`${event.name}-${event.date ?? ""}`}
                  className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="text-muted-foreground">{i + 1}.</span> {event.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.date ? new Date(event.date).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {event.tickets} tickets
                    </p>
                    <p>
                      {event.bookings} bookings · {usd.format(event.salesUsd)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-muted-foreground" />
            Hot events right now
          </CardTitle>
          <CardDescription>
            Most-clicked events across every partner&apos;s audience in this period —
            event, date and location, and whether the interest converted anywhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.hotEvents.length === 0 ? (
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
                  <TableHead className="text-right">Partners</TableHead>
                  <TableHead>Converted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.hotEvents.map((event) => (
                  <TableRow key={`${event.name}-${event.date ?? ""}-${event.location ?? ""}`}>
                    <TableCell className="max-w-[16rem] truncate font-medium">
                      {event.name}
                    </TableCell>
                    <TableCell>
                      {event.date ? new Date(event.date).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate">
                      {event.location ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{event.visitors}</TableCell>
                    <TableCell className="text-right tabular-nums">{event.clicks}</TableCell>
                    <TableCell className="text-right tabular-nums">{event.partners}</TableCell>
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
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-muted-foreground" />
              Live holds — leads in flight
            </CardTitle>
            <CardDescription>
              24-hour price holds still inside their window, right now (not
              period-filtered). These are customers deciding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {overview.openHolds.count === 0 ? (
              <p className="py-4 text-muted-foreground">No live holds at the moment.</p>
            ) : (
              <>
                <p>
                  <span className="text-2xl font-bold">{overview.openHolds.count}</span>{" "}
                  holds · {usd.format(overview.openHolds.valueUsd)} potential sales
                </p>
                <div className="space-y-1 border-t pt-3">
                  {overview.openHolds.top.map((row) => (
                    <div key={row.code} className="flex items-baseline justify-between">
                      <Link
                        href={`/partners/${row.code}/view?range=${range}`}
                        className="truncate hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.count} · {usd.format(row.valueUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Prepared packages
            </CardTitle>
            <CardDescription>
              Live links partners built in this period, and how many were followed
              by a paid booking of the same event.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {overview.packages.created === 0 ? (
              <p className="py-4 text-muted-foreground">
                No packages built in this period.
              </p>
            ) : (
              <>
                <p>
                  <span className="text-2xl font-bold">{overview.packages.created}</span>{" "}
                  built · {overview.packages.locked} locked ·{" "}
                  {overview.packages.editable} editable ·{" "}
                  <span className="font-medium">{overview.packages.matched} matched a paid booking</span>
                </p>
                <div className="space-y-1 border-t pt-3">
                  {overview.packages.topCreators.map((row) => (
                    <div key={row.code} className="flex items-baseline justify-between">
                      <Link
                        href={`/partners/${row.code}/view?range=${range}`}
                        className="truncate hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.count} packages
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

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
                  <TableHead className="text-right">Visitors</TableHead>
                  <TableHead className="text-right">Paid bookings</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
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
                      {partner.visitors || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {partner.paidReservations}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {partner.conversionRate != null
                        ? `${(partner.conversionRate * 100).toFixed(2)}%`
                        : "—"}
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
