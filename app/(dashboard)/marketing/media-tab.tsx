"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { getMarketingPnl } from "@/lib/actions/marketing-actions";
import type { CampaignPnl, MarketingCurrency, PnlTotals } from "@/lib/services/marketing-pnl";
import { DataTable, SortableHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BRAND_LABEL,
  money,
  ordersText,
  PLATFORM_LABEL,
  poasTone,
  useMarketingFilters,
  useMarketingLoad,
} from "./marketing-shared";

type PnlResult = Awaited<ReturnType<typeof getMarketingPnl>>;

const num = (n: number) => n.toLocaleString("en-US");
/** Google's attribution splits a purchase across clicks ("0.5"); a whole number stays whole. */
const platformCount = (n: number) => (Number.isInteger(n) ? num(n) : n.toFixed(1));
/** A null POAS / ROAS sorts below every real one. */
const nullLast = (v: number | null) => v ?? Number.NEGATIVE_INFINITY;
const ctrOf = (r: CampaignPnl) => (r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null);

/** The column explanations (spec 2026-10-14 section 5) - Tom's doc asked what platform vs ours means. */
const HINT = {
  platformPurchases:
    "What Meta / Google claim with their own pixel and attribution window - a view or a click days earlier counts, and both platforms may claim the same sale. Purchase events only.",
  platformValue: "The purchase value the platform's pixel reported, in the chosen currency.",
  purchases: "Paid orders in our database credited to this campaign by the last paid click (fbclid / Meta ad id, gclid). This is the number to trust.",
  revenue: "What our credited Paid orders paid (coupon and agent-card discount already off).",
  cogs: "Supplier cost of those orders: flight + hotel + ticket. A dot = some costs are estimated.",
  poas: "Profit on ad spend = (revenue - COGS - fee - spend) / spend. Above 1 the campaign earns more than it costs.",
  roas: "Return on ad spend = revenue / spend.",
} as const;

function HintHeader<T>({ label, hint, column }: { label: string; hint: string; column: Column<T, unknown> }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <SortableHeader label={label} column={column} />
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`About ${label}`} onClick={(e) => e.stopPropagation()}>
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs font-normal normal-case tracking-normal">{hint}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function columnsFor(cur: MarketingCurrency): ColumnDef<CampaignPnl>[] {
  const m = (n: number) => money(n, cur);
  return [
    {
      id: "platform",
      accessorFn: (r) => r.platform,
      header: "Platform",
      cell: ({ row }) => (
        <Badge variant={row.original.platform === "meta" ? "secondary" : "outline"}>{PLATFORM_LABEL[row.original.platform]}</Badge>
      ),
    },
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <SortableHeader label="Campaign" column={column} />,
      cell: ({ row }) => (
        <span dir="auto" className="inline-block max-w-[26rem] truncate align-bottom font-medium" title={row.original.name}>
          {row.original.name}
        </span>
      ),
    },
    { id: "brand", accessorFn: (r) => r.brand, header: "Brand", cell: ({ row }) => BRAND_LABEL[row.original.brand] },
    {
      id: "status",
      accessorFn: (r) => r.status ?? "",
      header: "Status",
      cell: ({ row }) => row.original.status ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "spend",
      accessorKey: "spend",
      header: ({ column }) => <SortableHeader label="Spend" column={column} />,
      cell: ({ row }) => <span className="tabular-nums">{m(row.original.spend)}</span>,
    },
    {
      id: "clicks",
      accessorKey: "clicks",
      header: ({ column }) => <SortableHeader label="Clicks · CTR" column={column} />,
      cell: ({ row }) => {
        const ctr = ctrOf(row.original);
        return (
          <span className="whitespace-nowrap tabular-nums">
            {num(row.original.clicks)}
            <span className="text-muted-foreground"> · {ctr === null ? "—" : `${ctr.toFixed(2)}%`}</span>
          </span>
        );
      },
    },
    {
      id: "platformPurchases",
      accessorKey: "platformPurchases",
      header: ({ column }) => <HintHeader label="Purchases (platform)" hint={HINT.platformPurchases} column={column} />,
      cell: ({ row }) => <span className="tabular-nums">{platformCount(row.original.platformPurchases)}</span>,
    },
    {
      id: "platformValue",
      accessorKey: "platformValue",
      header: ({ column }) => <HintHeader label="Platform revenue" hint={HINT.platformValue} column={column} />,
      cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{m(row.original.platformValue)}</span>,
    },
    {
      id: "purchases",
      accessorKey: "purchases",
      header: ({ column }) => <HintHeader label="Purchases (ours)" hint={HINT.purchases} column={column} />,
      cell: ({ row }) => <span className="font-medium tabular-nums">{num(row.original.purchases)}</span>,
    },
    {
      id: "revenue",
      accessorKey: "revenue",
      header: ({ column }) => <HintHeader label="Revenue" hint={HINT.revenue} column={column} />,
      cell: ({ row }) => <span className="tabular-nums">{m(row.original.revenue)}</span>,
    },
    {
      id: "cogs",
      accessorKey: "cogs",
      header: ({ column }) => <HintHeader label="COGS" hint={HINT.cogs} column={column} />,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {m(row.original.cogs)}
          {row.original.estimatedCount > 0 && (
            <span role="img" aria-label="Estimated" title={`${row.original.estimatedCount} estimated`} className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          )}
        </span>
      ),
    },
    {
      id: "poas",
      accessorFn: (r) => nullLast(r.poas),
      header: ({ column }) => <HintHeader label="POAS" hint={HINT.poas} column={column} />,
      cell: ({ row }) => (
        <span className={cn("font-medium tabular-nums", poasTone(row.original.poas))}>
          {row.original.poas === null ? "—" : row.original.poas.toFixed(2)}
        </span>
      ),
    },
    {
      id: "roas",
      accessorFn: (r) => nullLast(r.roas),
      header: ({ column }) => <HintHeader label="ROAS" hint={HINT.roas} column={column} />,
      cell: ({ row }) => <span className="tabular-nums">{row.original.roas === null ? "—" : `${row.original.roas.toFixed(2)}×`}</span>,
    },
  ];
}

/** The campaign rows added up - the table has no footer, so the sums sit in a strip above it. */
function TotalsStrip({ totals, cur }: { totals: PnlTotals; cur: MarketingCurrency }) {
  const m = (n: number) => money(n, cur);
  const items: [string, ReactNode, string?][] = [
    ["Spend", m(totals.spend)],
    ["Clicks", num(totals.clicks)],
    ["Purchases (platform)", platformCount(totals.platformPurchases)],
    ["Platform revenue", m(totals.platformValue)],
    ["Purchases (ours)", num(totals.purchases)],
    ["Revenue", m(totals.revenue)],
    ["COGS", m(totals.cogs)],
    ["POAS", totals.poas === null ? "—" : totals.poas.toFixed(2), poasTone(totals.poas)],
    ["ROAS", totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`],
  ];
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 py-3">
        <span className="self-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Totals</span>
        {items.map(([label, value, tone]) => (
          <div key={label} className="space-y-0.5">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div dir="ltr" className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AdsetRows({ campaign, cur }: { campaign: CampaignPnl; cur: MarketingCurrency }) {
  if (campaign.adsets.length === 0) {
    return <p className="text-sm text-muted-foreground">No ad sets in this campaign.</p>;
  }
  // The row spans every column of a table that may scroll sideways - keep the panel in view.
  return (
    <div className="sticky left-0 max-w-3xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{campaign.platform === "meta" ? "Ad set" : "Ad group"}</TableHead>
            <TableHead>Spend</TableHead>
            <TableHead>Orders</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>POAS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaign.adsets.map((a) => (
            <TableRow key={a.key} className="hover:bg-transparent">
              <TableCell>
                <span dir="auto" className="inline-block max-w-[26rem] truncate align-bottom" title={a.name}>
                  {a.name}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">{money(a.spend, cur)}</TableCell>
              <TableCell className="tabular-nums">{num(a.purchases)}</TableCell>
              <TableCell className="tabular-nums">{money(a.revenue, cur)}</TableCell>
              <TableCell className={cn("font-medium tabular-nums", poasTone(a.poas))}>{a.poas === null ? "—" : a.poas.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">{children}</CardContent>
    </Card>
  );
}

/** The table's rows added up (the brand's campaigns; the unresolved orders have their own card). */
function sumCampaigns(campaigns: CampaignPnl[], base: PnlTotals): PnlTotals {
  const sum = (k: "spend" | "clicks" | "platformPurchases" | "platformValue" | "purchases" | "revenue" | "cogs" | "net") => campaigns.reduce((a, c) => a + c[k], 0);
  const spend = sum("spend");
  const revenue = sum("revenue");
  const net = sum("net");
  return {
    ...base,
    spend,
    clicks: sum("clicks"),
    platformPurchases: Math.round(sum("platformPurchases") * 10) / 10,
    platformValue: sum("platformValue"),
    purchases: sum("purchases"),
    revenue,
    cogs: sum("cogs"),
    net,
    poas: spend > 0 ? net / spend : null,
    roas: spend > 0 ? revenue / spend : null,
  };
}

/** The campaign table + the three cards of revenue no campaign row of this view holds. Data in, so it can be rendered without a load. */
export function MediaBody({ data, loading }: { data: PnlResult; loading: boolean }) {
  const { cur } = useMarketingFilters();
  const [expanded, setExpanded] = useState<string | null>(null);
  const columns = useMemo(() => columnsFor(cur), [cur]);
  const campaignTotals = useMemo(() => sumCampaigns(data.campaigns, data.totals), [data]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn("space-y-4", loading && "opacity-60 transition-opacity")}>
        <TotalsStrip totals={campaignTotals} cur={cur} />
        <DataTable
          columns={columns}
          data={data.campaigns}
          searchColumns={["name"]}
          searchPlaceholder="Search campaigns..."
          defaultSorting={[{ id: "spend", desc: true }]}
          getRowId={(r) => r.key}
          onRowClick={(r) => setExpanded((c) => (c === r.key ? null : r.key))}
          expandedRowId={expanded}
          renderExpandedRow={(r) => <AdsetRows campaign={r} cur={cur} />}
          emptyState={{
            title: "No campaigns in this range",
            description: "After the first sync, the campaigns appear here with their spend and revenue.",
          }}
          dense
        />

        <div className="grid gap-4 md:grid-cols-3">
          <SideCard title="Unresolved">
            {data.unresolved.length === 0 ? (
              <p className="text-muted-foreground">No unresolved orders.</p>
            ) : (
              data.unresolved.map((u) => (
                <p key={u.platform}>
                  <span className="font-medium">{PLATFORM_LABEL[u.platform]}</span> · {ordersText(u.purchases)} · {money(u.revenue, cur)}
                </p>
              ))
            )}
          </SideCard>
          <SideCard title="Unattributed">
            <p>
              {ordersText(data.unattributed.purchases)} · {money(data.unattributed.revenue, cur)}
            </p>
          </SideCard>
          <SideCard title="Other brand campaign">
            <p>
              {ordersText(data.otherBrand.purchases)} · {money(data.otherBrand.revenue, cur)}
            </p>
            <p className="text-xs text-muted-foreground">Credited to a campaign outside the chosen brand (a campaign the system does not know counts as &quot;Other brand&quot;).</p>
          </SideCard>
        </div>
      </div>
    </TooltipProvider>
  );
}

export function MediaTab() {
  const { src } = useMarketingFilters();
  const { data, error, loading } = useMarketingLoad(getMarketingPnl);
  if (src !== "all" && src !== "meta" && src !== "google") {
    return <p className="text-sm text-muted-foreground">The Media tab lists paid campaigns - pick All sources, Meta or Google.</p>;
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-64 w-full" />;
  return <MediaBody data={data} loading={loading} />;
}
