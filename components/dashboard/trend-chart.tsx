"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** One day of a series: yyyy-mm-dd and how many rows it had. */
export type TrendPoint = { date: string; count: number };

export const TREND_RANGES = ["7d", "30d", "90d", "ytd", "1y"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

const presets: { key: TrendRange; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "Last year" },
];

interface TrendChartProps {
  /** "Reservations Over Time". */
  title: string;
  /** The tooltip name of one point: "Reservations". */
  seriesLabel: string;
  /** Loads the daily series of a range. Called again whenever the range changes. */
  load: (range: TrendRange) => Promise<TrendPoint[]>;
}

/** A daily line chart with the range presets of the dashboard. */
export function TrendChart({ title, seriesLabel, load }: TrendChartProps) {
  const [range, setRange] = useState<TrendRange>("30d");
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const series = await load(range);
        if (!cancelled) setData(series);
      } catch (error) {
        console.error(`Error loading ${title}:`, error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [range, load, title]);

  const chartConfig = useMemo(
    () => ({ series: { label: seriesLabel, color: "hsl(var(--primary))" } }),
    [seriesLabel]
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setRange(p.key)}
              className={`px-2 py-1 rounded border text-xs ${range === p.key ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="w-full h-64">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={24} />
              <YAxis allowDecimals={false} />
              <Line type="monotone" dataKey="count" name="series" stroke="var(--color-series)" dot={false} />
              <ChartTooltip content={<ChartTooltipContent nameKey="series" />} />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
        {loading && <div className="text-xs text-muted-foreground mt-2">Loading…</div>}
      </CardContent>
    </Card>
  );
}
