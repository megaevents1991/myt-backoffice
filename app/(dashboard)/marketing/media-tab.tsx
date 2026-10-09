"use client";

import { useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { DataTable, SortableHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CampaignPnl } from "@/lib/services/marketing-pnl";
import {
  BRAND_LABEL,
  MarketingFilters,
  ordersText,
  PLATFORM_LABEL,
  poasTone,
  usd,
  useMarketingPnl,
  type PnlResult,
} from "./marketing-shared";

const num = (n: number) => n.toLocaleString("en-US");
/** A null POAS sorts below every real one. */
const poasSortKey = (r: CampaignPnl) => r.poas ?? Number.NEGATIVE_INFINITY;
const ctrOf = (r: CampaignPnl) => (r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null);

const COLUMNS: ColumnDef<CampaignPnl>[] = [
  {
    id: "platform",
    accessorFn: (r) => r.platform,
    header: "Platform",
    cell: ({ row }) => (
      <Badge variant={row.original.platform === "meta" ? "secondary" : "outline"}>
        {PLATFORM_LABEL[row.original.platform]}
      </Badge>
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
  {
    id: "brand",
    accessorFn: (r) => r.brand,
    header: "Brand",
    cell: ({ row }) => BRAND_LABEL[row.original.brand],
  },
  {
    id: "status",
    accessorFn: (r) => r.status ?? "",
    header: "Status",
    cell: ({ row }) => row.original.status ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "spendUsd",
    accessorKey: "spendUsd",
    header: ({ column }) => <SortableHeader label="Spend" column={column} />,
    cell: ({ row }) => <span className="tabular-nums">{usd(row.original.spendUsd)}</span>,
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
    header: ({ column }) => <SortableHeader label="Purchases (platform)" column={column} />,
    cell: ({ row }) => (
      <span
        className="tabular-nums"
        title={`Platform-reported revenue: ${usd(row.original.platformValue)}`}
      >
        {num(row.original.platformPurchases)}
      </span>
    ),
  },
  {
    id: "purchases",
    accessorKey: "purchases",
    header: ({ column }) => <SortableHeader label="Purchases (ours)" column={column} />,
    cell: ({ row }) => <span className="tabular-nums">{num(row.original.purchases)}</span>,
  },
  {
    id: "revenueUsd",
    accessorKey: "revenueUsd",
    header: ({ column }) => <SortableHeader label="Revenue" column={column} />,
    cell: ({ row }) => <span className="tabular-nums">{usd(row.original.revenueUsd)}</span>,
  },
  {
    id: "cogsUsd",
    accessorKey: "cogsUsd",
    header: ({ column }) => <SortableHeader label="COGS" column={column} />,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        {usd(row.original.cogsUsd)}
        {row.original.estimatedCount > 0 && (
          <span
            role="img"
            aria-label="Estimated"
            title={`${row.original.estimatedCount} estimated`}
            className="inline-block h-2 w-2 rounded-full bg-amber-500"
          />
        )}
      </span>
    ),
  },
  {
    id: "poas",
    accessorFn: poasSortKey,
    header: ({ column }) => <SortableHeader label="POAS" column={column} />,
    cell: ({ row }) => (
      <span className={cn("font-medium tabular-nums", poasTone(row.original.poas))}>
        {row.original.poas === null ? "—" : row.original.poas.toFixed(2)}
      </span>
    ),
  },
  {
    id: "roas",
    accessorFn: (r) => r.roas ?? Number.NEGATIVE_INFINITY,
    header: ({ column }) => <SortableHeader label="ROAS" column={column} />,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.roas === null ? "—" : `${row.original.roas.toFixed(2)}×`}
      </span>
    ),
  },
];

function AdsetRows({ campaign }: { campaign: CampaignPnl }) {
  if (campaign.adsets.length === 0) {
    return <p className="text-sm text-muted-foreground">No ad sets in this campaign.</p>;
  }
  // The row spans every column of a table that may scroll sideways - keep the panel in view.
  return (
    <div className="sticky left-0 max-w-2xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ad set</TableHead>
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
              <TableCell className="tabular-nums">{usd(a.spendUsd)}</TableCell>
              <TableCell className="tabular-nums">{num(a.purchases)}</TableCell>
              <TableCell className="tabular-nums">{usd(a.revenueUsd)}</TableCell>
              <TableCell className={cn("font-medium tabular-nums", poasTone(a.poas))}>
                {a.poas === null ? "—" : a.poas.toFixed(2)}
              </TableCell>
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

/** The campaign table + the three cards of revenue no campaign row of this view holds. Data in, so it can be rendered without a load. */
export function MediaBody({ data, loading }: { data: PnlResult; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      <div className={cn(loading && "opacity-60 transition-opacity")}>
        <DataTable
          columns={COLUMNS}
          data={data.campaigns}
          searchColumns={["name"]}
          searchPlaceholder="Search campaigns..."
          defaultSorting={[{ id: "spendUsd", desc: true }]}
          getRowId={(r) => r.key}
          onRowClick={(r) => setExpanded((cur) => (cur === r.key ? null : r.key))}
          expandedRowId={expanded}
          renderExpandedRow={(r) => <AdsetRows campaign={r} />}
          emptyState={{
            title: "No campaigns in this range",
            description: "After the first sync, the campaigns appear here with their spend and revenue.",
          }}
          dense
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SideCard title="Unresolved">
          {data.unresolved.length === 0 ? (
            <p className="text-muted-foreground">No unresolved orders.</p>
          ) : (
            data.unresolved.map((u) => (
              <p key={u.platform}>
                <span className="font-medium">{PLATFORM_LABEL[u.platform]}</span> · {ordersText(u.purchases)} ·{" "}
                {usd(u.revenueUsd)}
              </p>
            ))
          )}
        </SideCard>
        <SideCard title="Unattributed">
          <p>
            {ordersText(data.unattributed.purchases)} · {usd(data.unattributed.revenueUsd)}
          </p>
        </SideCard>
        <SideCard title="Other brand campaign">
          <p>
            {ordersText(data.otherBrand.purchases)} · {usd(data.otherBrand.revenueUsd)}
          </p>
          <p className="text-xs text-muted-foreground">Credited to a campaign outside the chosen brand (a campaign the system does not know counts as &quot;Other brand&quot;).</p>
        </SideCard>
      </div>
    </>
  );
}

export function MediaTab() {
  const { range, setRange, brand, setBrand, data, error, loading } = useMarketingPnl();

  return (
    <div className="space-y-4">
      <MarketingFilters range={range} setRange={setRange} brand={brand} setBrand={setBrand} />

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <MediaBody data={data} loading={loading} />
      )}
    </div>
  );
}
