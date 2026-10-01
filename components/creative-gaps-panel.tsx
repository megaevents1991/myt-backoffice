"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { WidgetCard } from "@/components/dashboard/widget-card";
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
    <WidgetCard
      title="Creative gaps"
      icon={ImageOff}
      badge={
        gaps && gaps.total > 0 ? (
          <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-display text-xs font-bold tabular-nums text-destructive">
            {gaps.total}
          </span>
        ) : null
      }
      href="/tasks?tab=gaps"
      linkLabel="Details"
    >
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
    </WidgetCard>
  );
}
