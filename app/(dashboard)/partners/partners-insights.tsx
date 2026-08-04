import Link from "next/link";
import {
  ClipboardList,
  DollarSign,
  Flame,
  Handshake,
  Home,
  Hourglass,
  Music,
  Package,
  Percent,
  Ticket,
  TrendingUp,
  Wallet,
  type LucideIcon,
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
import type { FunnelStage, PartnerTraffic } from "@/lib/partner-funnel";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

interface EntryFunnelRow {
  key: string;
  label: string;
  /** null = the flow has this step but nothing tracks it yet — rendered as "—". */
  visitors: number | null;
  /** Small print after the label — what this row really measures. */
  note?: string;
  /** Show the share un-rounded (Confirmed: 0.4% must not read as 0%). */
  precise?: boolean;
}

const stageVisitors = (funnel: PartnerTraffic, stage: FunnelStage) =>
  funnel.byStage.find((s) => s.stage === stage)?.visitors ?? 0;

/** Home/artist entries: the funnel exactly as recorded. */
const recordedRows = (funnel: PartnerTraffic): EntryFunnelRow[] =>
  funnel.byStage.map((s) => ({
    key: s.stage,
    label: s.label,
    visitors: s.visitors,
    precise: s.stage === "CONFIRMED",
  }));

/**
 * Event deep-links land inside the order flow, so there is no "picked an
 * event" moment, and the wizard fires each stage on the click that LEAVES its
 * screen (see main's OrderForm nextStep): a ticket pick means moving on to
 * flights, a flight pick (chosen or skipped) moving on to the hotel, a hotel
 * pick reaching the order summary. Same counts, honest captions — plus one
 * caveat: /order pages fire no VISIT, so "Visited" only holds visitors who
 * advanced at least one screen; pure bounces are invisible until main tracks
 * order-page landings.
 */
const eventEntryRows = (funnel: PartnerTraffic, paid: number): EntryFunnelRow[] => [
  {
    key: "VISIT",
    label: "Visited",
    note: "advanced at least one screen — landings aren't logged yet",
    visitors: funnel.totalVisitors,
  },
  {
    key: "TICKET_SELECTED",
    label: "Picked tickets",
    note: "moved on to flights",
    visitors: stageVisitors(funnel, "TICKET_SELECTED"),
  },
  {
    key: "FLIGHT_SELECTED",
    label: "Picked a flight",
    note: "moved on to the hotel",
    visitors: stageVisitors(funnel, "FLIGHT_SELECTED"),
  },
  {
    key: "HOTEL_SELECTED",
    label: "Picked a hotel",
    note: "reached the order summary",
    visitors: stageVisitors(funnel, "HOTEL_SELECTED"),
  },
  {
    key: "CONFIRMED",
    label: "Confirmed",
    note: "paid or asked for an agent",
    visitors: stageVisitors(funnel, "CONFIRMED"),
    precise: true,
  },
  {
    key: "PAID",
    label: "Paid",
    note: "order now marked Paid — matched by partner, event & time",
    visitors: paid,
    precise: true,
  },
];

/** Exact enough to never show a real signal as 0%: 0.36%, 1.2%, 4.0%. */
const preciseShare = (pct: number) =>
  pct === 0 ? "0" : pct < 1 ? pct.toFixed(2) : pct.toFixed(1);

/** One entry-segment funnel: who landed there, how far they got. */
function EntryFunnelCard({
  icon: Icon,
  title,
  description,
  hasData,
  rows,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  hasData: boolean;
  rows: EntryFunnelRow[];
}) {
  const top = Math.max(...rows.map((r) => r.visitors ?? 0), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-6 text-sm text-muted-foreground">
            No visitors in this period.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const pct = row.visitors != null ? (row.visitors / top) * 100 : null;
              return (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      {row.label}
                      {row.note && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.note}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {row.visitors ?? "—"}
                      {pct != null && row.key !== "VISIT" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.precise ? preciseShare(pct) : Math.round(pct)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
      hint: "After flights, hotels, tickets & commission",
      icon: TrendingUp,
    },
    {
      label: "Producing partners",
      value: overview.producingPartners,
      hint: "With a paid booking in this period",
      icon: ClipboardList,
    },
    {
      label: "Traffic partners",
      value: overview.producingTrafficPartners,
      hint: "Brought at least one visitor this period",
      icon: Handshake,
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
    {
      label: "Cost per conversion",
      value:
        overview.costPerConversionUsd != null
          ? usdExact.format(overview.costPerConversionUsd)
          : "—",
      hint: "Commission + coupons per paid ticket",
      icon: Wallet,
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
        <EntryFunnelCard
          icon={Home}
          title="Entered on the homepage"
          description="Visitors whose first page through a partner link was the homepage."
          hasData={overview.entryFunnels.home.hasData}
          rows={recordedRows(overview.entryFunnels.home)}
        />
        <EntryFunnelCard
          icon={Music}
          title="Entered on an artist page"
          description="First landed on an artist or team page."
          hasData={overview.entryFunnels.artist.hasData}
          rows={recordedRows(overview.entryFunnels.artist)}
        />
        <EntryFunnelCard
          icon={Ticket}
          title="Entered on a specific event"
          description="Landed straight inside the order flow — package deep-links included. Each step below marks moving one screen deeper."
          hasData={overview.entryFunnels.event.hasData}
          rows={eventEntryRows(overview.entryFunnels.event, overview.entryFunnels.eventPaid)}
        />
      </div>
      {(overview.entryFunnels.otherVisitors > 0 ||
        overview.entryFunnels.approximate) && (
        <p className="-mt-4 text-xs text-muted-foreground">
          {overview.entryFunnels.otherVisitors > 0 &&
            `${overview.entryFunnels.otherVisitors} more visitors entered on other pages (categories, blog…).`}
          {overview.entryFunnels.approximate &&
            " Numbers are approximate until the entry-funnel DB function is deployed."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              Top events this period
            </CardTitle>
            <CardDescription>Top 15 by paid tickets.</CardDescription>
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
            event, date and location. Converted counts only bookings that are
            PAID and attributed to a real partner or agent.
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
                  <TableHead className="text-right">Converted</TableHead>
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
                    <TableCell className="text-right tabular-nums">
                      {event.paidBookings > 0 ? (
                        <>
                          <span className="font-medium">{event.paidBookings}</span>
                          {event.conversionRate != null && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {(event.conversionRate * 100).toFixed(
                                event.conversionRate < 0.01 ? 1 : 0
                              )}
                              %
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">0</span>
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
