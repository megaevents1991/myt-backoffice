import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A dashboard card with a title and a link to the screen behind it ("All tasks →").
 * Every company's dashboard widgets use it.
 */
export function WidgetCard({
  title,
  icon: Icon,
  badge,
  href,
  linkLabel,
  children,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  /** A count next to the title. */
  badge?: ReactNode;
  href: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
          {badge}
        </CardTitle>
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {linkLabel}
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}
