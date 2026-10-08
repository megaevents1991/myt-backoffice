"use client";

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
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
import { MarketingFilters, poasTone, usd, useMarketingPnl, type PnlResult } from "./marketing-shared";

const chartConfig = {
  spend: { label: "הוצאה", color: "hsl(var(--chart-2))" },
  revenue: { label: "הכנסה", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

const GOOD = "text-emerald-600 dark:text-emerald-400";

/** A tooltip row in dollars like the cards. `ChartTooltipContent`'s `formatter` REPLACES the whole row (dot, name,
 *  value), so this draws all three - a bare `usd(value)` would drop the series name and its colour. */
const tooltipRow: ComponentProps<typeof ChartTooltipContent>["formatter"] = (value, name, item) => (
  <div className="flex w-full items-center justify-between gap-3">
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
      {chartConfig[String(name) as keyof typeof chartConfig]?.label ?? name}
    </span>
    <span className="font-mono font-medium tabular-nums text-foreground">{usd(Number(value))}</span>
  </div>
);

/** One executive number: Hebrew title, the value (always left-to-right), a small note under it. */
function Metric({
  title,
  value,
  tone,
  dim,
  children,
}: {
  title: string;
  value: string;
  tone?: string;
  dim?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card dir="rtl" className={cn(dim && "opacity-60 transition-opacity")}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div dir="ltr" className={cn("text-right text-2xl font-semibold tabular-nums", tone)}>
          {value}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const Note = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>
);

export function ExecTab() {
  const { range, setRange, brand, setBrand, data, error, loading } = useMarketingPnl();

  return (
    <div className="space-y-4">
      <MarketingFilters range={range} setRange={setRange} brand={brand} setBrand={setBrand} />

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ExecBody data={data} range={range} dim={loading} />
      )}
    </div>
  );
}

export function ExecBody({
  data,
  range,
  dim,
}: {
  data: PnlResult;
  range: string;
  dim: boolean;
}) {
  const { totals, unattributed, otherBrand, since, until, settings } = data;
  // The chart's keys are the ChartConfig's (spend / revenue) - the legend and the tooltip find their labels by them.
  const daily = useMemo(
    () => data.daily.map((d) => ({ day: d.day, spend: d.spendUsd, revenue: d.revenueUsd })),
    [data.daily],
  );
  const target = settings.monthly_profit_target_usd;
  // The card shows the MEDIA-credited net; the monthly target is a business number, so it is held against the
  // all-in net = media net + the unattributed bookings + the bookings credited to another brand's campaign (every
  // one of them is our booking; only the chosen brand's ad spend is inside the media net). The colour sits on the
  // line that prints that all-in number, never on the media net above it.
  const allInNet = totals.netUsd + unattributed.netUsd + otherBrand.netUsd;
  const onTarget = allInNet >= target;
  // The monthly target only means something against the month so far.
  const netTone = range === "month" && target > 0 ? (onTarget ? GOOD : "text-destructive") : undefined;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="הוצאה" value={usd(totals.spendUsd)} dim={dim}>
          <Note>
            <span dir="ltr">
              <span className="whitespace-nowrap">{since}</span> → <span className="whitespace-nowrap">{until}</span>
            </span>
          </Note>
        </Metric>

        <Metric title="הכנסה" value={usd(totals.revenueUsd)} dim={dim}>
          <Note>{totals.purchases} הזמנות</Note>
          <Note>
            לא מיוחס: {unattributed.purchases} הזמנות · {usd(unattributed.revenueUsd)}
          </Note>
          <Note>
            קמפיין של מותג אחר: {otherBrand.purchases} הזמנות · {usd(otherBrand.revenueUsd)}
          </Note>
        </Metric>

        <Metric title="עלות ספקים" value={usd(totals.cogsUsd)} dim={dim}>
          <Note>
            {totals.estimatedCount > 0 && <>משוער ב-{totals.estimatedCount} הזמנות · </>}
            עמלת סליקה {usd(totals.feeUsd)}
          </Note>
        </Metric>

        <Metric title="רווח נקי ממדיה" value={usd(totals.netUsd)} dim={dim}>
          <Note>
            לא מיוחס: {usd(unattributed.netUsd)} · מותג אחר: {usd(otherBrand.netUsd)}
          </Note>
          {range === "month" && (
            <Note className={netTone}>
              {target > 0 ? `יעד ${usd(target)} מול רווח כולל ${usd(allInNet)}` : "יעד לא הוגדר"}
            </Note>
          )}
        </Metric>

        <Metric title="CAC" value={totals.cacUsd === null ? "—" : usd(totals.cacUsd)} dim={dim} />
        <Metric title="ROAS" value={totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`} dim={dim} />
        <Metric
          title="POAS"
          value={totals.poas === null ? "—" : totals.poas.toFixed(2)}
          tone={poasTone(totals.poas)}
          dim={dim}
        />
      </div>

      <Card className={cn(dim && "opacity-60 transition-opacity")}>
        <CardHeader>
          <CardTitle dir="rtl" className="text-sm font-medium">
            הוצאה מול הכנסה ביום
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
            <LineChart data={daily} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" minTickGap={24} />
              <YAxis tickFormatter={(v: number) => usd(v)} width={64} />
              <ChartTooltip content={<ChartTooltipContent formatter={tooltipRow} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Line type="monotone" dataKey="spend" stroke="var(--color-spend)" dot={false} />
              <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" dot={false} />
            </LineChart>
          </ChartContainer>
          {daily.length === 0 && (
            <p dir="rtl" className="mt-2 text-xs text-muted-foreground">
              אין עדיין נתוני הוצאה או הכנסה בטווח הזה.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
