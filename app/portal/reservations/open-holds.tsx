"use client";

import { useEffect, useState } from "react";


import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PortalReservation } from "@/lib/actions/portal-actions";

/** Hours left, floored, or null once it has lapsed. */
function hoursLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 ? Math.floor(ms / (60 * 60 * 1000)) : null;
}

export function OpenHolds({ holds }: { holds: PortalReservation[] }) {
  // Computed after mount, not during render: a client component is still
  // server-rendered, so reading the clock in render ships the server's time and
  // then hydrates with the browser's — a mismatch right on an hour boundary.
  const [live, setLive] = useState<{ hold: PortalReservation; left: number }[]>([]);

  useEffect(() => {
    setLive(
      holds
        .map((hold) => ({ hold, left: hoursLeft(hold.hold_expires_at) }))
        .filter(
          (row): row is { hold: PortalReservation; left: number } => row.left !== null
        )
    );
  }, [holds]);

  if (live.length === 0) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">הצעות פתוחות</CardTitle>
        <CardDescription>
          לקוחות ששמרו חבילה ולא השלימו תשלום. הקישור להמשך ההזמנה נשלח אליהם במייל
          — שווה להזכיר להם לפני שהזמן נגמר. השמירה לא מבטיחה מלאי, אז מה שאזל
          יוצע להם מחדש.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {live.map(({ hold, left }) => (
          <div
            key={hold.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {hold.customer_name || "לקוח"} · {hold.event_title ?? `#${hold.event_id}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {hold.tickets} כרטיסים · {hold.pax} נוסעים
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Floor means a hold with 40 minutes left reads as 0 — say
                  "under an hour", not "expired", on the most urgent one. */}
              <Badge variant={left <= 6 ? "destructive" : "secondary"}>
                {left === 0 ? "נותרה פחות משעה" : `נותרו ${left} שעות`}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
