"use client";

import { ExternalLink } from "lucide-react";

import { getMarketingAlerts } from "@/lib/actions/marketing-actions";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { writeUrlParam } from "@/hooks/use-view-state";
import type { MarketingAlertRow } from "@/types/marketing.types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketingLoad } from "./marketing-shared";

const KIND_LABEL: Record<MarketingAlertRow["kind"], string> = {
  budget_bleed: "Budget bleed",
  viral_post: "Viral post",
  page_no_sales: "Page with no sales",
  page_converting: "Converting page",
  influencer_no_sales: "Influencer with no sales",
  influencer_selling: "Influencer selling",
};
const KIND_TAB: Record<MarketingAlertRow["kind"], { tab: string; label: string }> = {
  budget_bleed: { tab: "media", label: "View campaigns" },
  viral_post: { tab: "instagram", label: "View posts" },
  page_no_sales: { tab: "traffic", label: "View pages" },
  page_converting: { tab: "traffic", label: "View pages" },
  influencer_no_sales: { tab: "influencers", label: "View influencers" },
  influencer_selling: { tab: "influencers", label: "View influencers" },
};
/** Good news (green) vs a problem (red); a viral post stays neutral. */
const POSITIVE: ReadonlySet<MarketingAlertRow["kind"]> = new Set(["page_converting", "influencer_selling"]);
const NEGATIVE: ReadonlySet<MarketingAlertRow["kind"]> = new Set(["budget_bleed", "page_no_sales", "influencer_no_sales"]);

const textOf = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);

const n = (v: unknown) => Number(v).toLocaleString("en-US");
/** "· +35% vs the 7 days before" / "· new" - the move the rule stored, if any. */
function moveText(now: unknown, before: unknown, days: string | null): string {
  const a = Number(now);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !days) return "";
  if (b === 0) return a > 0 ? ` · none in the ${days} days before` : "";
  const change = Math.round(((a - b) / b) * 1000) / 10;
  return Math.abs(change) < 5 ? "" : ` · ${change > 0 ? "+" : ""}${change}% vs the ${days} days before`;
}

/** The one sentence under an alert's name, from the numbers its rule stored in `payload`. */
function detailOf(alert: MarketingAlertRow): string | null {
  const p = alert.payload;
  const days = textOf(p.days);
  if (alert.kind === "page_no_sales") {
    return textOf(p.sessions) && days ? `${n(p.sessions)} sessions in ${days} days, no Paid order of what it sells${moveText(p.sessions, p.prev_sessions, days)}` : null;
  }
  if (alert.kind === "page_converting") {
    return textOf(p.sold) && textOf(p.sessions) && days
      ? `${n(p.sold)} Paid orders against ${n(p.sessions)} sessions (${textOf(p.rate_pct) ?? "?"}%) in ${days} days${moveText(p.sold, p.prev_sold, days)}`
      : null;
  }
  if (alert.kind === "influencer_no_sales") {
    return textOf(p.visitors) && days ? `${n(p.visitors)} visitors in ${days} days, no Paid order${moveText(p.visitors, p.prev_visitors, days)}` : null;
  }
  if (alert.kind === "influencer_selling") {
    return textOf(p.paid) && days ? `${n(p.paid)} Paid orders from ${n(p.visitors)} visitors in ${days} days${moveText(p.paid, p.prev_paid, days)}` : null;
  }
  if (alert.kind === "budget_bleed") {
    const spend = textOf(p.spend_ils);
    const days = textOf(p.days);
    return spend && days ? `₪${Math.round(Number(spend)).toLocaleString("en-US")} in ${days} day${days === "1" ? "" : "s"} with no purchase` : null;
  }
  const engagement = textOf(p.engagement);
  const mean = textOf(p.mean);
  return engagement && mean ? `${engagement} engagement vs an average of ${mean}` : null;
}

function AlertRow({ alert }: { alert: MarketingAlertRow }) {
  const page = textOf(alert.payload.page);
  const name = page ?? textOf(alert.payload.name) ?? textOf(alert.payload.media_id) ?? alert.key;
  const detail = detailOf(alert);
  const href = page?.startsWith("/") ? `${PUBLIC_SITE_URL}${page}` : null;
  const target = KIND_TAB[alert.kind] ?? { tab: "exec", label: "View" };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <Badge
        variant={NEGATIVE.has(alert.kind) ? "destructive" : "secondary"}
        className={POSITIVE.has(alert.kind) ? "border-transparent bg-emerald-600 text-white hover:bg-emerald-600" : undefined}
      >
        {KIND_LABEL[alert.kind] ?? alert.kind}
      </Badge>
      <span dir={page ? "ltr" : "auto"} className={cn("min-w-0 max-w-[28rem] truncate font-medium", page && "font-mono text-xs")} title={name}>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
            {name}
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          </a>
        ) : (
          name
        )}
      </span>
      {detail && (
        <span className="text-muted-foreground">
          {detail}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{new Date(alert.first_seen_at).toLocaleString("en-GB")}</span>
      {alert.last_mailed_at && (
        <Badge variant="outline">
          Emailed
        </Badge>
      )}
      {/* The tab strip's own mechanism (a history.replaceState on ?tab=): no page load, range / brand stay in the URL. */}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="ms-auto h-auto p-0 text-xs"
        onClick={() => writeUrlParam("tab", target.tab, "exec")}
      >
        {target.label}
      </Button>
    </li>
  );
}

function AlertList({ title, alerts, empty }: { title: string; alerts: MarketingAlertRow[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium">
          {title} ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
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
      <AlertList title="Open" alerts={alerts.filter((a) => !a.resolved_at)} empty="No open alerts." />
      <AlertList title="Resolved" alerts={alerts.filter((a) => a.resolved_at)} empty="No alert first seen in this period was resolved." />
    </div>
  );
}

export function AlertsTab() {
  const { data, error } = useMarketingLoad(getMarketingAlerts);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-48 w-full" />;
  return <AlertsView alerts={data} />;
}
