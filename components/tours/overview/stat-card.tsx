import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: number;
  /** One line under the number: what exactly was counted. */
  hint?: string;
  /** The screen that holds the rows behind the number. */
  href: string;
  icon: LucideIcon;
}

/** One number of the Tours overview. Same build as the Mega Events dashboard cards, and it is a link. */
export function StatCard({ label, value, hint, href, icon: Icon }: StatCardProps) {
  return (
    <Link
      href={href}
      className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors group-hover:border-foreground/25 group-hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-display text-2xl font-bold tabular-nums tracking-tight">
            {value.toLocaleString("he-IL")}
          </div>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
