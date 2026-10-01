import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface AttentionRow {
  key: string;
  /** The screen where this row is handled. */
  href: string;
  title: ReactNode;
  detail?: ReactNode;
  /** Short text at the far end of the row - a date, days left. */
  aside?: ReactNode;
}

interface AttentionListProps {
  title: string;
  /** What puts a row on this list, in one sentence. */
  description: string;
  rows: AttentionRow[];
  /** How many rows exist in all; the list itself shows the first `limit`. */
  total: number;
  /** Shown instead of the list when nothing needs handling. */
  emptyText: string;
  /** Where the whole list lives - the link under a cut list. */
  moreHref: string;
  limit?: number;
}

/** One "needs attention" list of the Tours overview: every row is a link to where it gets fixed. */
export function AttentionList({
  title,
  description,
  rows,
  total,
  emptyText,
  moreHref,
  limit = 20,
}: AttentionListProps) {
  const shown = rows.slice(0, limit);
  const hidden = total - shown.length;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold leading-snug">{title}</CardTitle>
          <Badge variant={total > 0 ? "destructive" : "secondary"} className="shrink-0 tabular-nums">
            {total.toLocaleString("he-IL")}
          </Badge>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {shown.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {emptyText}
          </div>
        ) : (
          <ul className="divide-y">
            {shown.map((row) => (
              <li key={row.key}>
                <Link
                  href={row.href}
                  className="group flex items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{row.title}</div>
                    {row.detail && (
                      <div className="truncate text-xs text-muted-foreground">{row.detail}</div>
                    )}
                  </div>
                  {row.aside && (
                    <div className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.aside}</div>
                  )}
                  <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:-translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <Link
            href={moreHref}
            className="mt-2 inline-block px-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            ועוד {hidden.toLocaleString("he-IL")} - לרשימה המלאה
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
