"use client";

import { useEffect, useState } from "react";

import { getMarketingAlerts } from "@/lib/actions/marketing-actions";
import { writeUrlParam } from "@/hooks/use-view-state";
import type { MarketingAlertRow } from "@/types/marketing.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText } from "./marketing-shared";

const KIND_LABEL: Record<MarketingAlertRow["kind"], string> = {
  budget_bleed: "דימום תקציב",
  viral_post: "פוסט ויראלי",
};
const KIND_TAB: Record<MarketingAlertRow["kind"], string> = {
  budget_bleed: "media",
  viral_post: "instagram",
};

const textOf = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);

/** The one sentence under an alert's name, from the numbers its rule stored in `payload`. */
function detailOf(alert: MarketingAlertRow): string | null {
  const p = alert.payload;
  if (alert.kind === "budget_bleed") {
    const spend = textOf(p.spend_ils);
    const days = textOf(p.days);
    return spend && days ? `₪${Math.round(Number(spend)).toLocaleString("en-US")} ב-${days} ימים בלי רכישה` : null;
  }
  const engagement = textOf(p.engagement);
  const mean = textOf(p.mean);
  return engagement && mean ? `${engagement} מעורבות מול ממוצע ${mean}` : null;
}

function AlertRow({ alert }: { alert: MarketingAlertRow }) {
  const name = textOf(alert.payload.name) ?? textOf(alert.payload.media_id) ?? alert.key;
  const detail = detailOf(alert);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <Badge variant={alert.kind === "budget_bleed" ? "destructive" : "secondary"}>{KIND_LABEL[alert.kind]}</Badge>
      <span dir="auto" className="min-w-0 max-w-[28rem] truncate font-medium" title={name}>
        {name}
      </span>
      {detail && (
        <span dir="rtl" className="text-muted-foreground">
          {detail}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{new Date(alert.first_seen_at).toLocaleString("he-IL")}</span>
      {alert.last_mailed_at && (
        <Badge variant="outline" dir="rtl">
          נשלח במייל
        </Badge>
      )}
      {/* The tab strip's own mechanism (a history.replaceState on ?tab=): no page load, range / brand stay in the URL. */}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="ms-auto h-auto p-0 text-xs"
        onClick={() => writeUrlParam("tab", KIND_TAB[alert.kind], "exec")}
      >
        {alert.kind === "budget_bleed" ? "לקמפיינים" : "לפוסטים"}
      </Button>
    </li>
  );
}

function AlertList({ title, alerts, empty }: { title: string; alerts: MarketingAlertRow[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle dir="rtl" className="text-sm font-medium">
          {title} ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p dir="rtl" className="text-sm text-muted-foreground">
            {empty}
          </p>
        ) : (
          <ul className="divide-y">
            {alerts.map((a) => (
              <AlertRow key={`${a.kind}:${a.key}:${a.first_seen_at}`} alert={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AlertsView({ alerts }: { alerts: MarketingAlertRow[] }) {
  return (
    <div className="space-y-4">
      <AlertList title="פתוחות" alerts={alerts.filter((a) => !a.resolved_at)} empty="אין התראות פתוחות." />
      <AlertList title="נפתרו" alerts={alerts.filter((a) => a.resolved_at)} empty="עוד לא נפתרה אף התראה." />
    </div>
  );
}

export function AlertsTab() {
  const [alerts, setAlerts] = useState<MarketingAlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const rows = await getMarketingAlerts();
        if (!cancelled) setAlerts(rows);
      } catch (e) {
        console.error("Error loading the marketing alerts:", e);
        if (!cancelled) setError(errorText(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!alerts) return <Skeleton className="h-48 w-full" />;
  return <AlertsView alerts={alerts} />;
}
