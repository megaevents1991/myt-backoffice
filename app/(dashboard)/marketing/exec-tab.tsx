"use client";

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, LineChart, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { getMarketingOverview } from "@/lib/actions/marketing-actions";
import { SOURCE_LABEL } from "@/lib/marketing/order-source";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CURRENCY_SIGN, money, ordersText, poasTone, useMarketingFilters, useMarketingLoad } from "./marketing-shared";

type Overview = Awaited<ReturnType<typeof getMarketingOverview>>;

const GOOD = "text-emerald-600 dark:text-emerald-400";
const num = (n: number) => n.toLocaleString("en-US");
const dash = "—";

/** Axis ticks: "₪1.4K". */
const compact = (n: number, cur: MarketingCurrency) =>
  `${CURRENCY_SIGN[cur]}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
/** "07-14" under a daily chart. */
const shortDay = (d: string) => d.slice(5);

/** The reference dashboard's small-caps label over each row of cards. */
function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      {children}
      {note}
    </section>
  );
}

function Metric({
  title,
  value,
  tone,
  hint,
  accent,
  children,
}: {
  title: string;
  value: string;
  tone?: string;
  hint?: string;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className={cn(accent && "border-transparent bg-primary text-primary-foreground")}>
      <CardHeader className="pb-1">
        <CardTitle className={cn("text-[11px] font-medium uppercase tracking-wider", accent ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div dir="ltr" className={cn("text-3xl font-semibold tabular-nums", tone)}>
          {value}
        </div>
        {hint && <p className={cn("text-xs", accent ? "text-primary-foreground/80" : "text-muted-foreground")}>{hint}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

const Note = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>
);

const spendConfig = {
  spendMeta: { label: "Meta", color: "hsl(var(--chart-1))" },
  spendGoogle: { label: "Google", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const funnelConfig = {
  leads: { label: "Leads", color: "hsl(var(--chart-1))" },
  signups: { label: "Signups", color: "hsl(var(--chart-2))" },
  passengers: { label: "Passengers", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

const crossConfig = {
  spend: { label: "Spend", color: "hsl(var(--chart-3))" },
  revenue: { label: "Revenue", color: "hsl(var(--chart-2))" },
  signups: { label: "Signups", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

/** A tooltip row: dot, series name, value. `ChartTooltipContent`'s `formatter` REPLACES the whole row. */
function tooltipRow(config: ChartConfig, fmt: (key: string, v: number) => string): ComponentProps<typeof ChartTooltipContent>["formatter"] {
  return function TooltipRow(value, name, item) {
    return (
      <div className="flex w-full items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
          {config[String(name)]?.label ?? name}
        </span>
        <span className="font-mono font-medium tabular-nums text-foreground">{fmt(String(name), Number(value))}</span>
      </div>
    );
  };
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ExecTab() {
  const { data, error, loading } = useMarketingLoad(getMarketingOverview);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className={cn("space-y-6", loading && "opacity-60 transition-opacity")}>
      <ExecBody data={data} />
    </div>
  );
}

export function ExecBody({ data }: { data: Overview }) {
  const { cur, brand } = useMarketingFilters();
  const { pnl, funnel, src } = data;
  const m = (n: number | null) => (n === null ? dash : money(n, cur));
  const paidSource = src === "all" || src === "meta" || src === "google";
  const otherBrand = brand === "other";

  const share = (part: number) => (funnel.spend > 0 ? `${((part / funnel.spend) * 100).toFixed(1)}% of spend` : "No spend in this period");

  // Every day of the period (the funnel's series), crossed with the P&L's attributed revenue of that day.
  const revenueByDay = useMemo(() => new Map(pnl.daily.map((d) => [d.day, d.revenue])), [pnl.daily]);
  const cross = useMemo(
    () => funnel.daily.map((d) => ({ day: d.day, spend: d.spend, revenue: paidSource ? revenueByDay.get(d.day) ?? 0 : 0, signups: d.signups, leads: d.leads })),
    [funnel.daily, revenueByDay, paidSource],
  );

  const { totals, unattributed, otherBrand: other, settings } = pnl;
  const targetInCur = settings.monthly_profit_target_usd * (cur === "ils" ? pnl.usdIls : 1);
  const allInNet = totals.net + unattributed.net + other.net;
  const showTarget = pnl.range === "month" && src === "all";
  const netTone = showTarget && targetInCur > 0 ? (allInNet >= targetInCur ? GOOD : "text-destructive") : undefined;

  return (
    <>
      <Section
        title="Spend"
        note={!paidSource && <Note>No ad spend for this source - spend and cost per step read for Meta and Google only.</Note>}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Metric title="Total spend" value={money(funnel.spend, cur)} accent hint={`${pnl.since} → ${pnl.until}`} />
          <Metric title="Google" value={money(funnel.spendGoogle, cur)} hint={share(funnel.spendGoogle)} tone="text-sky-600 dark:text-sky-400" />
          <Metric title="Meta" value={money(funnel.spendMeta, cur)} hint={share(funnel.spendMeta)} tone="text-indigo-600 dark:text-indigo-400" />
        </div>
      </Section>

      {otherBrand ? (
        <Section title="Funnel">
          <Note>The funnel counts the Mega Events site&apos;s orders - pick &quot;Mega Events&quot; or &quot;All brands&quot; to see it against the spend.</Note>
        </Section>
      ) : (
        <>
          <Section title="Funnel" note={<Note>Every order of the period, from {src === "all" ? "every source" : SOURCE_LABEL[src]} - orders are ours, not the platforms&apos;.</Note>}>
            <div className="grid gap-4 md:grid-cols-3">
              <Metric title="Leads" value={num(funnel.leads)} hint="Orders entered, any status" />
              <Metric title="Signups" value={num(funnel.signups)} hint="Paid orders" tone={GOOD} />
              <Metric title="Passengers" value={num(funnel.passengers)} hint="Tickets on Paid orders" tone="text-amber-600 dark:text-amber-400" />
            </div>
          </Section>

          <Section title="Efficiency">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metric title="Cost / lead" value={m(funnel.costPerLead)} />
              <Metric title="Cost / signup" value={m(funnel.costPerSignup)} tone={GOOD} />
              <Metric title="Cost / passenger" value={m(funnel.costPerPassenger)} tone="text-amber-600 dark:text-amber-400" />
              <Metric title="Lead → signup" value={funnel.leadToSignup === null ? dash : `${funnel.leadToSignup.toFixed(1)}%`} hint="Conversion rate" tone="text-sky-600 dark:text-sky-400" />
              <Metric title="Pax / signup" value={funnel.paxPerSignup === null ? dash : funnel.paxPerSignup.toFixed(2)} hint="Avg passengers per signup" tone="text-fuchsia-600 dark:text-fuchsia-400" />
            </div>
          </Section>
        </>
      )}

      <Section title="Profit from media">
        {paidSource ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <Metric title="Revenue" value={money(totals.revenue, cur)} hint={ordersText(totals.purchases)}>
              {src === "all" && (
                <>
                  <Note>Unattributed: {ordersText(unattributed.purchases)} · {money(unattributed.revenue, cur)}</Note>
                  <Note>Other brand campaign: {ordersText(other.purchases)} · {money(other.revenue, cur)}</Note>
                </>
              )}
            </Metric>
            <Metric title="COGS" value={money(totals.cogs, cur)}>
              <Note>
                {totals.estimatedCount > 0 && <>{totals.estimatedCount} estimated · </>}
                Processing fee {money(totals.fee, cur)}
              </Note>
            </Metric>
            <Metric title="Net profit from media" value={money(totals.net, cur)}>
              {src === "all" && <Note>Unattributed: {money(unattributed.net, cur)} · Other brand: {money(other.net, cur)}</Note>}
              {showTarget && (
                <Note className={netTone}>
                  {targetInCur > 0 ? `Target ${money(targetInCur, cur)} vs all-in net ${money(allInNet, cur)}` : "Target not set"}
                </Note>
              )}
            </Metric>
            <Metric title="ROAS" value={totals.roas === null ? dash : `${totals.roas.toFixed(2)}×`} />
            <Metric title="POAS" value={totals.poas === null ? dash : totals.poas.toFixed(2)} tone={poasTone(totals.poas)} />
            <Metric title="CAC" value={m(totals.cac)} hint="Spend per attributed order" />
          </div>
        ) : (
          <Note>Media P&amp;L covers paid campaigns - pick All sources, Meta or Google.</Note>
        )}
      </Section>

      <ChartCard title="Daily spend - Google vs Meta">
        <ChartContainer config={spendConfig} className="aspect-auto h-[260px] w-full">
          <AreaChart data={funnel.daily} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={16} />
            <YAxis tickFormatter={(v: number) => compact(v, cur)} width={56} />
            <ChartTooltip content={<ChartTooltipContent formatter={tooltipRow(spendConfig, (_k, v) => money(v, cur))} />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Area type="monotone" dataKey="spendMeta" stroke="var(--color-spendMeta)" fill="var(--color-spendMeta)" fillOpacity={0.25} />
            <Area type="monotone" dataKey="spendGoogle" stroke="var(--color-spendGoogle)" fill="var(--color-spendGoogle)" fillOpacity={0.25} />
          </AreaChart>
        </ChartContainer>
      </ChartCard>

      {!otherBrand && (
        <ChartCard title="Leads, signups & passengers over time">
          <ChartContainer config={funnelConfig} className="aspect-auto h-[260px] w-full">
            <LineChart data={funnel.daily} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={16} />
              <YAxis allowDecimals={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent formatter={tooltipRow(funnelConfig, (_k, v) => num(v))} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line type="monotone" dataKey="leads" stroke="var(--color-leads)" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="signups" stroke="var(--color-signups)" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="passengers" stroke="var(--color-passengers)" dot={false} strokeWidth={2} strokeDasharray="5 4" />
            </LineChart>
          </ChartContainer>
        </ChartCard>
      )}

      {!otherBrand && (
        <ChartCard title="Spend vs results">
          <ChartContainer config={crossConfig} className="aspect-auto h-[280px] w-full">
            <ComposedChart data={cross} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={16} />
              <YAxis yAxisId="money" tickFormatter={(v: number) => compact(v, cur)} width={56} />
              <YAxis yAxisId="count" orientation="right" allowDecimals={false} width={32} />
              <ChartTooltip
                content={<ChartTooltipContent formatter={tooltipRow(crossConfig, (k, v) => (k === "signups" ? num(v) : money(v, cur)))} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar yAxisId="money" dataKey="spend" fill="var(--color-spend)" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
              {paidSource && <Line yAxisId="money" type="monotone" dataKey="revenue" stroke="var(--color-revenue)" dot={false} strokeWidth={2} />}
              <Line yAxisId="count" type="monotone" dataKey="signups" stroke="var(--color-signups)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ChartContainer>
          <Note className="mt-2">
            Bars = spend per day. Revenue = Paid orders credited to the ads (media P&amp;L). Signups = every Paid order of the source, on the right axis.
          </Note>
        </ChartCard>
      )}
    </>
  );
}
