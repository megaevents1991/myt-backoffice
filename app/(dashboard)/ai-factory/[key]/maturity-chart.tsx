"use client";

// Agreed vs disagreed, one bar per week for the last 8 weeks - the "בשלות" tab's chart.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { MaturityWeekPoint } from "@/types/ai-factory.types";

const CONFIG = {
  agreed: { label: "הסכמה (הוזל/הוסר/נמכר)", color: "hsl(var(--primary))" },
  disagreed: { label: "חוסר הסכמה (השתקה/דריסה)", color: "hsl(var(--destructive))" },
};

export function MaturityChart({ weekly }: { weekly: MaturityWeekPoint[] }) {
  const data = weekly.map((w) => ({
    week: new Date(w.weekStart).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" }),
    agreed: w.agreed,
    disagreed: w.disagreed,
  }));
  return (
    <ChartContainer config={CONFIG} className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" fontSize={11} />
          <YAxis allowDecimals={false} fontSize={11} width={28} />
          <Bar dataKey="agreed" fill="var(--color-agreed)" radius={2} />
          <Bar dataKey="disagreed" fill="var(--color-disagreed)" radius={2} />
          <ChartTooltip content={<ChartTooltipContent />} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
