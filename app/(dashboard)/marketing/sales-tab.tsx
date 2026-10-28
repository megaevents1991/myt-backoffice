"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, Flame, Music, Trophy, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { eventSiteUrl } from "@/lib/site";
import { getSales } from "@/lib/actions/marketing-sales-actions";
import { SOURCE_LABEL } from "@/lib/marketing/order-source";
import { trendOf, type RisingRow, type SalesRow } from "@/lib/marketing/sales";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, prevPeriodText, TrendChip, useMarketingLoad, type LoadedView } from "./marketing-shared";

type Sales = Awaited<ReturnType<typeof getSales>>;

const num = (n: number) => n.toLocaleString("en-US");
/** A table opens on this many rows; "Show all" opens the rest. */
const FIRST_ROWS = 10;

function Stat({ title, value, trend, previous }: { title: string; value: string; trend: SalesRow["trend"]; previous: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div dir="ltr" className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TrendChip trend={trend} />
          <span>previous period: {previous}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/** One leader: the name, its tickets and revenue, the move against the previous period. */
export function LeaderCard({ icon: Icon, title, row, cur, empty, footer }: { icon: LucideIcon; title: string; row: SalesRow | null; cur: MarketingCurrency; empty: string; footer?: ReactNode }) {
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
            <div dir="auto" className="truncate text-left text-xl font-semibold" title={row.sublabel ? `${row.label} · ${row.sublabel}` : row.label}>
              {row.label}
            </div>
            {row.sublabel && <div className="truncate text-xs text-muted-foreground">{row.sublabel}</div>}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {num(row.tickets)} tickets · {num(row.orders)} orders · {money(row.revenue, cur)}
              </span>
              <TrendChip trend={row.trend} title={`Previous period: ${num(row.prevTickets)} tickets`} />
            </div>
          </>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{empty}</p>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}

/** The biggest gains in tickets - artists and teams together. */
export function RisingList({ rows }: { rows: RisingRow[] }) {
  if (rows.length === 0) return <p className="py-2 text-sm text-muted-foreground">Nothing rose against the previous period.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-baseline gap-1.5" title={r.sublabel ?? r.label}>
            <span dir="auto" className="truncate">{r.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.group}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
            {num(r.prevTickets)} → {num(r.tickets)}
            <TrendChip trend={r.trend} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function BreakdownTable({
  title,
  description,
  nameHead,
  rows,
  total,
  cur,
  link,
  className,
}: {
  title: string;
  description?: ReactNode;
  nameHead: string;
  rows: SalesRow[];
  /** Tickets of the whole period - the share column. */
  total: number;
  cur: MarketingCurrency;
  link?: (row: SalesRow) => string | null;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing sold in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{nameHead}</TableHead>
                  <TableHead className="text-end">Orders</TableHead>
                  <TableHead className="text-end">Tickets</TableHead>
                  <TableHead className="text-end">Share</TableHead>
                  <TableHead className="text-end">Revenue</TableHead>
                  <TableHead className="text-end">vs previous</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => {
                  const href = link?.(r) ?? null;
                  return (
                    <TableRow key={r.key}>
                      <TableCell className="max-w-[22rem]">
                        <div dir="auto" className="truncate text-left font-medium" title={r.label}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                              {r.label}
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                            </a>
                          ) : (
                            r.label
                          )}
                        </div>
                        {r.sublabel && <div className="truncate text-xs text-muted-foreground">{r.sublabel}</div>}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{num(r.orders)}</TableCell>
                      <TableCell className="text-end font-medium tabular-nums">{num(r.tickets)}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">{total > 0 ? `${((r.tickets / total) * 100).toFixed(1)}%` : "—"}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.revenue, cur)}</TableCell>
                      <TableCell className="text-end">
                        <TrendChip trend={r.trend} title={`Previous period: ${num(r.prevTickets)} tickets · ${money(r.prevRevenue, cur)}`} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {rows.length > FIRST_ROWS && (
              <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${rows.length}`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SalesTab() {
  const { data, view, error, loading } = useMarketingLoad(getSales);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
      <SalesBody data={data} view={view} />
    </div>
  );
}

export function SalesBody({ data, view }: { data: Sales; view: LoadedView }) {
  const { cur, src, brand } = view;
  const t = data.totals;
  const vs = prevPeriodText(data.prevSince, data.prevUntil);
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Paid orders of {data.since} → {data.until} from {src === "all" ? "every source" : SOURCE_LABEL[src]}, each against the {data.prevSince} → {data.prevUntil} period
        of the same length. Revenue = what the order paid (the Executive tab&apos;s rule).
        {brand !== "mega_events" && " The brand filter does not apply here - these are the Mega Events site's orders."}
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat title="Paid orders" value={num(t.orders)} trend={trendOf(t.orders, t.prevOrders)} previous={num(t.prevOrders)} />
        <Stat title="Tickets sold" value={num(t.tickets)} trend={t.trend} previous={num(t.prevTickets)} />
        <Stat title="Revenue" value={money(t.revenue, cur)} trend={trendOf(t.revenue, t.prevRevenue)} previous={money(t.prevRevenue, cur)} />
      </div>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Trends · {vs}</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <LeaderCard icon={Music} title="Best-selling artist" row={data.bestArtist} cur={cur} empty="No artist sold in this period." />
          <LeaderCard icon={Trophy} title="Best-selling football team" row={data.bestTeam} cur={cur} empty="No football team sold in this period." />
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Flame className="h-3.5 w-3.5" aria-hidden />
                Rising
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RisingList rows={data.rising} />
            </CardContent>
          </Card>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BreakdownTable title="By artist" nameHead="Artist" rows={data.artists} total={t.tickets} cur={cur} />
        <BreakdownTable
          title="By football team"
          description="A match tagged with both teams counts for both."
          nameHead="Team"
          rows={data.teams}
          total={t.tickets}
          cur={cur}
        />
        <BreakdownTable title="By category" description="The event's vertical tag." nameHead="Category" rows={data.categories} total={t.tickets} cur={cur} />
        <BreakdownTable title="By league / genre" nameHead="League or genre" rows={[...data.leagues, ...data.genres].sort((a, b) => b.tickets - a.tickets || b.revenue - a.revenue)} total={t.tickets} cur={cur} />
      </div>

      <BreakdownTable
        title="Events sold"
        description="Click an event to open its page on the site."
        nameHead="Event"
        rows={data.events}
        total={t.tickets}
        cur={cur}
        link={(r) => (r.eventId !== null ? eventSiteUrl(r.eventId) : null)}
      />
    </>
  );
}

