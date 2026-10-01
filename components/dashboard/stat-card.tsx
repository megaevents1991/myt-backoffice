import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  /** Already formatted - "..." while loading. */
  value: ReactNode;
  /** One line under the number: what exactly was counted. */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** The screen that holds the rows behind the number. Makes the card a link. */
  href?: string;
}

/** One number of a dashboard. Every company's dashboard is built from these. */
export function StatCard({ label, value, hint, icon: Icon, href }: StatCardProps) {
  const card = (
    <Card
      className={
        href ? "h-full transition-colors group-hover:border-foreground/25 group-hover:bg-muted/40" : undefined
      }
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="font-display text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  if (!href) return card;
  return (
    <Link
      href={href}
      className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
  );
}
