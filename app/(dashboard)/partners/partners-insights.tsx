import Link from "next/link";
import {
  ClipboardList,
  DollarSign,
  Flame,
  Handshake,
  Package,
  Percent,
  Ticket,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PartnersOverview } from "@/lib/actions/partners-dashboard-actions";
import type { InsightsRange } from "@/lib/actions/partner-performance-actions";
import { EntryFunnelsGrid } from "./entry-funnel-cards";
import { HotEventsTable, TopEventsTable, TopPartnersTable } from "./insights-tables";

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

/** The cross-partner insights block - the opening view of /partners. */
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
          : "-",
      hint: `${overview.trackedVisitors} visitors → ${overview.paidReservations} paid`,
      icon: Percent,
    },
    {
      label: "Cost per conversion",
      value:
        overview.costPerConversionUsd != null
          ? usdExact.format(overview.costPerConversionUsd)
          : "-",
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

      {overview.truncated && (
        <p className="rounded-md border border-dashed border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          הטווח הזה עבר את תקרת הסריקה - המספרים מחושבים מהרשומות האחרונות בלבד
          וסוכמים פחות מהאמת. צמצמו את הטווח לקבלת תמונה מלאה.
        </p>
      )}

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

      <EntryFunnelsGrid entryFunnels={overview.entryFunnels} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted-foreground" />
              Top events this period
            </CardTitle>
            <CardDescription>Top 15 by paid tickets.</CardDescription>
          </CardHeader>
          <CardContent className="px-3">
            <TopEventsTable events={overview.topBookedEvents} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-muted-foreground" />
            Hot events right now
          </CardTitle>
          <CardDescription>
            Most-clicked events across every partner&apos;s audience in this period -
            event, date and location. Converted counts only bookings that are
            PAID and attributed to a real partner or agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HotEventsTable events={overview.hotEvents} />
        </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top partners</CardTitle>
            <CardDescription>
              By paid sales in the selected period. Click through for the full
              per-partner picture.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TopPartnersTable partners={overview.topPartners} range={range} />
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

    </div>
  );
}
