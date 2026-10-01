import Link from "next/link";

import type { NavItem } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shortcuts to the main tours screens. The items come from the sidebar's own
 * list (lib/nav.ts), so a name or a route can never differ between the two.
 */
export function QuickLinks({ items }: { items: NavItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">קישורים מהירים</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{item.name}</span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
