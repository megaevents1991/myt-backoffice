"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCreativeGapCounts } from "@/lib/actions/creative-gap-actions";
import { GAP_KINDS, GAP_META, type GapCounts } from "@/types/creative-gap.types";

/** Dashboard summary of every visual asset still missing on the site. */
export function CreativeGapsPanel() {
  const [gaps, setGaps] = useState<GapCounts | null>(null);

  useEffect(() => {
    getCreativeGapCounts().then(setGaps);
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageOff className="h-4 w-4 text-muted-foreground" />
          Creative gaps
          {gaps && gaps.total > 0 && (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-display text-xs font-bold tabular-nums text-destructive">
              {gaps.total}
            </span>
          )}
        </CardTitle>
        <Link
          href="/tasks?tab=gaps"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Details
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </CardHeader>
      <CardContent>
        {gaps === null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : gaps.total === 0 ? (
          <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            Everything has its creative - nothing missing.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {GAP_KINDS.filter((kind) => (gaps.counts[kind] ?? 0) > 0).map((kind) => {
              const meta = GAP_META[kind];
              const count = gaps.counts[kind];
              return (
                <Link
                  key={kind}
                  href={meta.href}
                  className="rounded-lg border bg-card p-3 transition-colors hover:bg-muted/60"
                  dir="rtl"
                >
                  <div
                    className={cn(
                      "font-display text-xl font-bold tabular-nums",
                      meta.severity === "crit" ? "text-destructive" : "text-warning",
                    )}
                  >
                    {count}
                  </div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    {meta.label}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
