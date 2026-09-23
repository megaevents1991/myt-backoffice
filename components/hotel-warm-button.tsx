"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Hotel } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getWarmStatus,
  warmHotelsStep,
  type WarmPoint,
  type WarmStatus,
} from "@/lib/actions/hotel-warm-actions";

/**
 * "טען מלונות" for one point: a status line ("מלונות: 182 · נטען 20.09" / "לא נטען" /
 * "נטען חלקית") and a button that loops warmHotelsStep until `remaining` is 0 or the
 * user stops it. Each step loads ~12 hotels (RateHawk hotel/info 30/min, shared), so a
 * cold city of 150-250 hotels takes 15-20 minutes - the page can be left open.
 */
export function HotelWarmButton({ point, compact = false }: { point: WarmPoint; compact?: boolean }) {
  const [status, setStatus] = useState<WarmStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const valid = Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) && Number(point.latitude) !== 0;

  useEffect(() => {
    if (!valid) return;
    getWarmStatus([point]).then((rows) => setStatus(rows[0] ?? null)).catch(() => {});
    // identity inputs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.latitude, point.longitude, point.radius]);

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    setError(null);
    try {
      for (let i = 0; i < 40 && !stopRef.current; i++) {
        const r = await warmHotelsStep(point);
        if (!r.ok) { setError(r.error); break; }
        setStatus(r.status);
        if (r.status.error) { setError(r.status.error); break; }
        if (r.status.remaining <= 0) break;
      }
    } finally {
      setRunning(false);
    }
  };

  if (!valid) return null;

  const line = !status
    ? "מלונות: לא נטען"
    : status.remaining > 0
      ? `מלונות: נטען חלקית · ${status.existing + status.loaded} מתוך ${status.found}`
      : `מלונות: ${status.existing + status.loaded} · נטען ${status.warmed_at ? new Date(status.warmed_at).toLocaleDateString("he-IL") : ""}`;

  return (
    <div className={compact ? "flex items-center gap-2 text-xs" : "flex flex-wrap items-center gap-3 text-sm"} dir="rtl">
      <span className="text-muted-foreground">{line}</span>
      {running ? (
        <Button type="button" size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>
          <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> עצירה
        </Button>
      ) : (
        <Button type="button" size="sm" variant={status && status.remaining === 0 ? "ghost" : "outline"} onClick={run}>
          <Hotel className="ml-1 h-3.5 w-3.5" />
          {status && status.remaining === 0 ? "רענון מלונות" : status ? "המשך טעינה" : "טען מלונות"}
        </Button>
      )}
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
