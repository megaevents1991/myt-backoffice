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

type Point = { date: string; count: number };

const presets = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "Last year" },
];

export function ReservationsTrend() {
  const [range, setRange] = useState<string>("30d");
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/dashboard/reservations-series?range=${range}`);
        if (!res.ok) throw new Error("Failed to load series");
        const json = await res.json();
        if (!cancelled) setData(json.series as Point[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const chartConfig = useMemo(
    () => ({ reservations: { label: "Reservations", color: "hsl(var(--primary))" } }),
    []
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-sm font-medium">Reservations Over Time</CardTitle>
        <div className="flex gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
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
              <Line type="monotone" dataKey="count" name="reservations" stroke="var(--color-reservations)" dot={false} />
              <ChartTooltip content={<ChartTooltipContent nameKey="reservations" />} />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
        {loading && <div className="text-xs text-muted-foreground mt-2">Loading…</div>}
      </CardContent>
    </Card>
  );
}
