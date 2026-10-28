"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Crown, Percent, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { getInfluencers } from "@/lib/actions/marketing-sales-actions";
import { trendOf } from "@/lib/marketing/sales";
import type { InfluencerRow } from "@/lib/marketing/influencers";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, PerfFlagBadge, prevPeriodText, TrendChip, useMarketingLoad, type LoadedView } from "./marketing-shared";

type Influencers = Awaited<ReturnType<typeof getInfluencers>>;

const num = (n: number) => n.toLocaleString("en-US");
const pctText = (p: number | null) => (p === null ? "—" : `${p.toFixed(p > 0 && p < 1 ? 2 : 1)}%`);

/** The staff view of one partner (Partners screen). */
const partnerHref = (code: string) => `/partners/${encodeURIComponent(code)}/view`;

/** One influencer leader: who, and the numbers that made them the leader. */
export function InfluencerCard({ icon: Icon, title, row, cur, metric, empty }: { icon: LucideIcon; title: string; row: InfluencerRow | null; cur: MarketingCurrency; metric: "sales" | "traffic" | "conversion"; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {row ? (
          <>
            <Link href={partnerHref(row.code)} dir="auto" className="block truncate text-left text-xl font-semibold hover:underline" title={`${row.name} (${row.code})`}>
              {row.name}
            </Link>
            <div dir="ltr" className="truncate text-xs text-muted-foreground">{row.code}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {metric === "traffic" ? (
                <>
                  <span className="tabular-nums">
                    {num(row.visitors)} visitors · {num(row.paid)} paid
                  </span>
                  <TrendChip trend={row.visitorsTrend} title={`Previous period: ${num(row.prevVisitors)} visitors`} />
                </>
              ) : metric === "conversion" ? (
                <span className="tabular-nums">
                  {pctText(row.conversion)} · {num(row.paid)} of {num(row.visitors)} visitors
                </span>
              ) : (
                <>
                  <span className="tabular-nums">
                    {num(row.paid)} paid · {num(row.tickets)} tickets · {money(row.revenue, cur)}
                  </span>
                  <TrendChip trend={row.trend} title={`Previous period: ${num(row.prevPaid)} paid orders`} />
                </>
              )}
            </div>
          </>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ title, value, hint, children }: { title: string; value: string; hint?: string; children?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div dir="ltr" className="text-3xl font-semibold tabular-nums">{value}</div>
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function InfluencersTab() {
  const { data, view, error, loading } = useMarketingLoad(getInfluencers);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
      <InfluencersBody data={data} view={view} />
    </div>
  );
}

export function InfluencersBody({ data, view }: { data: Influencers; view: LoadedView }) {
  const { cur } = view;
  const t = data.totals;
  const { influencer_min_visitors: minVisitors, influencer_hot_orders: hotOrders } = data.thresholds;
  const prev = (n: string) => `previous period: ${n}`;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Every influencer (affiliate partner) in {data.since} → {data.until}, {prevPeriodText(data.prevSince, data.prevUntil)}. Visitors = people their links brought,
        orders = bookings carrying their code - the Partners screen&apos;s numbers. Agents are not here.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat title="Visitors" value={num(t.visitors)}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendChip trend={trendOf(t.visitors, t.prevVisitors)} />
            <span>{prev(num(t.prevVisitors))}</span>
          </div>
        </Stat>
        <Stat title="Paid orders" value={num(t.paid)} hint={`${num(t.leads)} orders entered, any status`}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendChip trend={trendOf(t.paid, t.prevPaid)} />
            <span>{prev(num(t.prevPaid))}</span>
          </div>
        </Stat>
        <Stat title="Revenue" value={money(t.revenue, cur)}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendChip trend={trendOf(t.revenue, t.prevRevenue)} />
            <span>{prev(money(t.prevRevenue, cur))}</span>
          </div>
        </Stat>
        <Stat title="Commission" value={money(t.commission, cur)} hint="Their own terms, Paid orders" />
        <Stat title="Conversion" value={pctText(t.conversion)} hint="Paid orders / visitors" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <InfluencerCard icon={Crown} title="Top seller" row={data.topSeller} cur={cur} metric="sales" empty="No influencer sold in this period." />
        <InfluencerCard icon={Users} title="Top traffic maker" row={data.topTraffic} cur={cur} metric="traffic" empty="No influencer brought visitors in this period." />
        <InfluencerCard icon={Percent} title="Best conversion" row={data.bestConversion} cur={cur} metric="conversion" empty={`Nobody with ${minVisitors}+ visitors sold.`} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Influencers <span className="text-sm font-normal text-muted-foreground">({data.rows.length})</span>
          </CardTitle>
          <CardDescription>
            &quot;No sales&quot; = {minVisitors}+ visitors and no Paid order; &quot;Selling&quot; = {hotOrders}+ Paid orders - the influencer alerts&apos; rule (Settings tab).
            Click a name for the partner&apos;s own page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.rows.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No influencer traffic or orders in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Influencer</TableHead>
                    <TableHead className="text-end">Visitors</TableHead>
                    <TableHead className="text-end">Orders</TableHead>
                    <TableHead className="text-end">Paid</TableHead>
                    <TableHead className="text-end">Tickets</TableHead>
                    <TableHead className="text-end">Revenue</TableHead>
                    <TableHead className="text-end">Commission</TableHead>
                    <TableHead className="text-end">Conversion</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="max-w-[16rem]">
                        <Link href={partnerHref(r.code)} dir="auto" className="block truncate text-left font-medium hover:underline" title={r.name}>
                          {r.name}
                        </Link>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span dir="ltr">{r.code}</span>
                          {!r.active && (
                            <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
                              inactive
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="tabular-nums">{num(r.visitors)}</div>
                        <TrendChip trend={r.visitorsTrend} title={`Previous period: ${num(r.prevVisitors)}`} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.leads)}</TableCell>
                      <TableCell className="text-end">
                        <div className="font-medium tabular-nums">{num(r.paid)}</div>
                        <TrendChip trend={r.trend} title={`Previous period: ${num(r.prevPaid)}`} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.tickets)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.revenue, cur)}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">{money(r.commission, cur)}</TableCell>
                      <TableCell className="text-end tabular-nums">{pctText(r.conversion)}</TableCell>
                      <TableCell>
                        <PerfFlagBadge flag={r.flag} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
