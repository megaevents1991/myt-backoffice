"use client";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { PartnerMonthlyPoint } from "@/lib/actions/partner-performance-actions";

const chartConfig = {
  commission: { label: "Commission ($)", color: "hsl(var(--primary))" },
};

export function PerformanceChart({ data }: { data: PartnerMonthlyPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No paid reservations yet.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" minTickGap={16} />
          <YAxis allowDecimals={false} />
          <Bar
            dataKey="commission_usd"
            name="commission"
            fill="var(--color-commission)"
            radius={[4, 4, 0, 0]}
          />
          <ChartTooltip content={<ChartTooltipContent nameKey="commission" />} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
