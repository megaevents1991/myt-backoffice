"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import type { PartnersOverviewMonthlyPoint } from "@/lib/actions/partners-dashboard-actions";

const chartConfig = {
  sales: { label: "Sales ($)", color: "hsl(var(--primary))" },
  commission: { label: "Commission ($)", color: "hsl(var(--muted-foreground))" },
};

export function OverviewChart({ data }: { data: PartnersOverviewMonthlyPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No paid partner-attributed reservations in this period.
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
          <Bar dataKey="sales_usd" name="sales" fill="var(--color-sales)" radius={[4, 4, 0, 0]} />
          <Bar
            dataKey="commission_usd"
            name="commission"
            fill="var(--color-commission)"
            radius={[4, 4, 0, 0]}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
