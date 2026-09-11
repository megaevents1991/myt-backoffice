"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gauge } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { listPriceLight, type PriceLightRow } from "@/lib/actions/price-light-actions";
import { PILL } from "@/app/(dashboard)/events/price-light-ui";
import { ADMIN_ROLES } from "@/types/auth.types";
import type { Light } from "@/types/price-light.types";

// Colours come from `PILL` (app/(dashboard)/events/price-light-ui.tsx) - the one
// place the רמזור palette lives, shared by the events cell and the /price-light
// screen. Both modules are client-only, so importing it here is free.

const SEGMENT_LABEL: Record<Light, string> = {
  red: "אדום",
  orange: "כתום",
  unchecked: "לא נבדק",
  green: "ירוק",
  alone: "לבד בשוק",
  na: "—",
};

// Worst-first, matching the /events רמזור column sort (price-light-cell.tsx LIGHT_SORT_ORDER).
// `na` is never in this list - listPriceLight() already excludes light === "na" rows.
const SEGMENT_ORDER: Light[] = ["red", "orange", "unchecked", "green", "alone"];

const EMPTY_COUNTS: Record<Light, number> = {
  alone: 0,
  green: 0,
  orange: 0,
  red: 0,
  unchecked: 0,
  na: 0,
};

/**
 * Dashboard summary of the price-light (רמזור) sweep: a segmented bar of how many
 * (event, scope) rows sit in each light, and how many reds still need a decision.
 * Client Component - same pattern as its siblings (MyTasksWidget, CreativeGapsPanel):
 * fetch through a server action in useEffect. On failure this renders nothing rather
 * than break the dashboard.
 *
 * Admin-only, matching `/price-light` itself (`lib/nav.ts` gates the screen on
 * ADMIN_ROLES): an editor has no decision to make here, and should not be shown the
 * red count. The gate is cosmetic - `listPriceLight` still enforces its own guard.
 */
export function PriceLightWidget() {
  const { user } = useAuth();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const [rows, setRows] = useState<PriceLightRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listPriceLight()
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((e) => {
        console.error("PriceLightWidget: listPriceLight failed", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin) return null;
  if (failed) return null;

  if (rows === null) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            רמזור מחירים
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
    );
  }

  const counts = { ...EMPTY_COUNTS };
  let redTotal = 0;
  let pending = 0;
  const now = Date.now();
  for (const row of rows) {
    counts[row.light] += 1;
    if (row.light === "red") {
      redTotal += 1;
      const silencedActive = row.silenced_until != null && Date.parse(row.silenced_until) > now;
      if (!silencedActive && !row.has_open_task) pending += 1;
    }
  }

  const total = rows.length;

  return (
    // Full-width on the dashboard's two-column row: this is the third card, and a
    // segmented bar reads better across the row than squeezed into half of it.
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          רמזור מחירים
        </CardTitle>
        <Link
          href="/price-light?f=pending"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          פירוט
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            אין עדיין אירועים ברשימת הרמזור.
          </p>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {SEGMENT_ORDER.map((light) =>
                counts[light] > 0 ? (
                  <div
                    key={light}
                    className={PILL[light]}
                    style={{ width: `${(counts[light] / total) * 100}%` }}
                    title={`${SEGMENT_LABEL[light]}: ${counts[light]}`}
                  />
                ) : null,
              )}
            </div>
            <p className="text-sm text-muted-foreground" dir="rtl">
              {redTotal} אדומים · {pending} ממתינים להחלטה
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
