"use client";

// The /price-light screen: what the competitors charge for the same event,
// and what to do about a red light. Pattern = price-changes-client.tsx.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type DataTableView } from "@/components/data-table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  aiCostThisMonth,
  listCrawlRuns,
  listPriceLight,
  type CrawlPanelRow,
} from "@/lib/actions/price-light-actions";
import { signedUsd } from "@/lib/services/price-light";
import { COMPETITOR_LABEL, HE_REASON, heLabel, PILL } from "@/app/(dashboard)/events/price-light-ui";
import {
  rowScopes,
  type Light,
  type PriceLightRow,
  type PriceLightScopeCell,
} from "@/types/price-light.types";
import { CompetitorsPanel } from "./competitors-panel";
import { DecisionActions } from "./decision-actions";

function addDaysStr(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "מעולם לא";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return "כעת";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

/** The silence is on the EVENT, so it mutes both scopes at once. Compared as a TIMESTAMP, not as
 *  a string: Postgres hands back `+00` offsets while `new Date().toISOString()` ends in `Z`, so a
 *  lexical `>` compares two differently-shaped strings and silently mis-reads the silence. */
function isSilenced(row: PriceLightRow, now: number): boolean {
  return row.silenced_until != null && Date.parse(row.silenced_until) > now;
}

/** "ממתינים להחלטה", per scope: red, not silenced right now, no open task chasing it already. */
function scopePending(row: PriceLightRow, cell: PriceLightScopeCell, now: number): boolean {
  return cell.light === "red" && !isSilenced(row, now) && !cell.has_open_task;
}

/** A row waits for a human when EITHER of its two conclusions does. */
function isPending(row: PriceLightRow, now: number): boolean {
  return rowScopes(row).some((cell) => scopePending(row, cell, now));
}


const TILE_LABEL: Record<string, string> = {
  alone: "לבד בשוק",
  green: "ירוק",
  orange: "כתום",
  red: "אדום",
  unchecked: "לא נבדק",
  pending: "ממתינים להחלטה",
};

const SCOPE_HE: Record<PriceLightScopeCell["scope"], string> = { package: "חבילה", ticket: "כרטיס" };

/** Same duration line as the events-table tooltip (price-light-ui.tsx `nightsLine`) - our packages
 *  are often a night longer, and that is the first thing to check when a comparison looks wrong.
 *  Null for a ticket (no duration) and for a light that predates the field. */
function nightsLine(cell: PriceLightScopeCell): string | null {
  if (cell.scope !== "package" || cell.competitor == null) return null;
  // A light computed before this field existed has neither duration and no doubt recorded.
  // Printing "לא ידוע / לא פורסם" for it would be an invented statement about a comparison
  // nobody measured that way - say nothing until the next pass rewrites the row.
  if (cell.nights_ours == null && cell.nights_theirs == null && cell.uncertainty_usd === 0) return null;
  const ours = cell.nights_ours == null ? "לא ידוע" : `${cell.nights_ours}`;
  if (cell.nights_theirs != null) return `לילות: ${ours} שלנו מול ${cell.nights_theirs} שלהם`;
  const band = cell.uncertainty_usd ? ` (±$${cell.uncertainty_usd})` : "";
  return `לילות: ${ours} שלנו · אצלהם לא פורסם${band}`;
}

/** Why a competitor has no number, when it has none. */
function noPriceText(status: PriceLightScopeCell["competitors"][number]["status"]): string {
  switch (status) {
    case "not_selling": return "לא מוכר";
    case "unsure": return "לא ודאי";
    case "na": return "לא רלוונטי";
    case "found": return "ללא מחיר";
    default: return "לא נבדק";
  }
}

/**
 * The per-event summary against EVERY competitor (Dor, 2026-09-14): one line per competitor, its
 * own normalized price, its own gap and its own light colour - so "are we dear against everyone,
 * or only against Golasso" is one glance rather than an inference. The competitor that set the
 * scope's light is marked; the others are the context that makes it readable.
 */
function CompetitorMatrix({ cell }: { cell: PriceLightScopeCell }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {cell.competitors.map((a) => (
          <tr key={a.competitor} className="align-baseline">
            <td className="py-0.5 pe-2 whitespace-nowrap">
              {a.decided && <span className="me-1 text-muted-foreground" title="קבע את האור">●</span>}
              <span className={a.decided ? "font-medium" : "text-muted-foreground"}>
                {COMPETITOR_LABEL[a.competitor] ?? a.competitor}
              </span>
            </td>
            <td className="py-0.5 pe-2 tabular-nums whitespace-nowrap">
              {a.normalized_usd != null
                ? `$${a.normalized_usd}`
                : <span className="text-muted-foreground">{noPriceText(a.status)}</span>}
            </td>
            <td className="py-0.5 tabular-nums whitespace-nowrap">
              {a.light && a.diff_usd != null && (
                <span className={cn("inline-flex rounded-full px-1.5 py-0.5 font-medium", PILL[a.light])}>
                  {signedUsd(a.diff_usd)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Our own side of a package comparison, as the pricing rule defines it. */
function OurBreakdown({ cell }: { cell: PriceLightScopeCell }) {
  if (cell.ours.length === 0) return null;
  return (
    <table className="w-full text-xs">
      <tbody>
        {cell.ours.map((line) => (
          <tr key={line.label} className="align-baseline">
            <td className="py-0.5 pe-2 whitespace-nowrap text-muted-foreground">{line.label}</td>
            <td className="py-0.5 pe-2">{line.detail}</td>
            <td className="py-0.5 tabular-nums whitespace-nowrap">{line.usd != null ? `$${line.usd}` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LightBadge({ cell }: { cell: PriceLightScopeCell }) {
  // Hebrew throughout and the competitor's display name, not its key: this tooltip is the
  // explanation a staff member reads before deciding to drop a price or pull an event.
  const tip = [
    `${SCOPE_HE[cell.scope]}`,
    cell.competitor
      ? `${COMPETITOR_LABEL[cell.competitor] ?? cell.competitor}: ${cell.raw ?? "?"} ${cell.raw_currency ?? ""} → מנורמל $${cell.normalized_usd ?? "?"}`
      : null,
    cell.our_usd != null ? `שלנו: $${cell.our_usd}` : null,
    // Our own ticket prices move between nightly runs, so the number the light was computed
    // against is not always today's. Say so rather than let a stale figure pass for current.
    cell.our_usd != null && cell.our_usd_now != null && cell.our_usd_now !== cell.our_usd
      ? `המחיר שלנו זז מאז הבדיקה: כעת $${cell.our_usd_now}`
      : null,
    nightsLine(cell),
    ...cell.adjustments,
    cell.partial ? "כיסוי חלקי בנרמול" : null,
    cell.crawled_at ? `נסרק ${cell.crawled_at.slice(0, 10)}` : null,
    cell.reason ? HE_REASON[cell.reason] : null,
  ].filter(Boolean).join("\n");
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", PILL[cell.light])}>
            <span className="opacity-70">{SCOPE_HE[cell.scope]}</span>
            {heLabel(cell.light, cell.diff_usd)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line text-xs">{tip || "לא נבדק עדיין"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PriceLightClient() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<PriceLightRow[]>([]);
  const [runs, setRuns] = useState<CrawlPanelRow[]>([]);
  const [cost, setCost] = useState<{ usd: number; calls: number }>({ usd: 0, calls: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("pending");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c, a] = await Promise.all([listPriceLight(), listCrawlRuns(), aiCostThisMonth()]);
      setRows(r);
      setRuns(c);
      setCost(a);
    } catch (e) {
      console.error("price-light reload failed", e);
      toast({ variant: "destructive", title: "טעינה נכשלה", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ?f= preselects a view on arrival (e.g. a link from the dashboard widget) - read once.
  useEffect(() => {
    const f = searchParams.get("f");
    if (f) setView(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const now = Date.now();
    const soonCutoff = addDaysStr(new Date(now).toISOString().slice(0, 10), 45);
    const c = {
      alone: 0, green: 0, orange: 0, red: 0, unchecked: 0, pending: 0,
      orangePlus: 0, package: 0, ticket: 0, soon: 0, partial: 0, changed: 0, aiSample: 0,
    };
    // Counted per EVENT, not per conclusion: a row with a red package and a red ticket is one
    // event to deal with, and the tiles are a to-do list, not a tally of verdicts.
    for (const row of rows) {
      const cells = rowScopes(row);
      const has = (pred: (c: PriceLightScopeCell) => boolean) => cells.some(pred);
      if (has((x) => x.light === "alone")) c.alone++;
      if (has((x) => x.light === "green")) c.green++;
      if (has((x) => x.light === "orange")) c.orange++;
      if (has((x) => x.light === "red")) c.red++;
      if (has((x) => x.light === "orange" || x.light === "red")) c.orangePlus++;
      if (has((x) => x.light === "unchecked")) c.unchecked++;
      if (isPending(row, now)) c.pending++;
      if (row.package) c.package++;
      if (row.ticket) c.ticket++;
      if (row.date <= soonCutoff) c.soon++;
      if (has((x) => x.partial)) c.partial++;
      if (has((x) => x.changed_this_week)) c.changed++;
      if (has((x) => x.method === "ai")) c.aiSample++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const soonCutoff = addDaysStr(new Date(now).toISOString().slice(0, 10), 45);
    // Every view asks "does EITHER conclusion qualify" - the row is the event now, and an event
    // with a red ticket belongs in the red view whatever its package says.
    const some = (pred: (c: PriceLightScopeCell) => boolean) => (r: PriceLightRow) => rowScopes(r).some(pred);
    switch (view) {
      case "pending": return rows.filter((r) => isPending(r, now));
      case "red": return rows.filter(some((c) => c.light === "red"));
      case "orange_plus": return rows.filter(some((c) => c.light === "orange" || c.light === "red"));
      case "package": return rows.filter((r) => r.package != null);
      case "ticket": return rows.filter((r) => r.ticket != null);
      case "soon": return rows.filter((r) => r.date <= soonCutoff);
      case "partial": return rows.filter(some((c) => c.partial));
      case "changed": return rows.filter(some((c) => c.changed_this_week));
      case "unchecked": return rows.filter(some((c) => c.light === "unchecked"));
      case "ai_sample": return rows.filter(some((c) => c.method === "ai"));
      case "alone": return rows.filter(some((c) => c.light === "alone"));
      case "green": return rows.filter(some((c) => c.light === "green"));
      case "all": return rows;
      default: return rows;
    }
  }, [rows, view]);

  const tiles: { id: string; count: number; light: Light }[] = [
    { id: "alone", count: counts.alone, light: "alone" },
    { id: "green", count: counts.green, light: "green" },
    { id: "orange", count: counts.orange, light: "orange" },
    { id: "red", count: counts.red, light: "red" },
    { id: "unchecked", count: counts.unchecked, light: "unchecked" },
    { id: "pending", count: counts.pending, light: "red" },
  ];

  const views: DataTableView[] = [
    { id: "pending", label: "ממתינים להחלטה", count: counts.pending },
    { id: "red", label: "אדום", count: counts.red },
    { id: "orange_plus", label: "כתום ומעלה", count: counts.orangePlus },
    { id: "package", label: "חבילה", count: counts.package },
    { id: "ticket", label: "כרטיס", count: counts.ticket },
    { id: "soon", label: "בקרוב (45 יום)", count: counts.soon },
    { id: "partial", label: "כיסוי חלקי", count: counts.partial },
    { id: "changed", label: "השתנה השבוע", count: counts.changed },
    { id: "unchecked", label: "לא נבדק", count: counts.unchecked },
    { id: "ai_sample", label: "מדגם AI", count: counts.aiSample },
    { id: "all", label: "הכול", count: rows.length },
  ];

  const columns = useMemo<ColumnDef<PriceLightRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "אירוע",
        cell: ({ row }) => (
          <Link href={`/events/${row.original.event_id}`} className="block font-medium hover:underline">
            <div>{row.original.name}</div>
            <div className="text-xs font-normal text-muted-foreground">
              {row.original.date}
              {row.original.city ? ` · ${row.original.city}` : ""}
            </div>
          </Link>
        ),
      },
      {
        id: "lights",
        header: "רמזור",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            {rowScopes(row.original).map((cell) => (
              <LightBadge key={cell.scope} cell={cell} />
            ))}
          </div>
        ),
      },
      {
        id: "ours",
        header: "המחיר שלנו",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs tabular-nums">
            {rowScopes(row.original).map((cell) => {
              // The live figure wins the line when it has moved since the light was computed -
              // the recorded one stays visible, struck through, so the drift is legible.
              const moved = cell.our_usd != null && cell.our_usd_now != null && cell.our_usd_now !== cell.our_usd;
              return (
                <div key={cell.scope} className="flex items-baseline gap-1">
                  <span className="text-muted-foreground">{SCOPE_HE[cell.scope]}</span>
                  <span className="font-medium">
                    {cell.our_usd_now != null ? `$${cell.our_usd_now}` : cell.our_usd != null ? `$${cell.our_usd}` : "—"}
                  </span>
                  {moved && <span className="text-muted-foreground line-through">${cell.our_usd}</span>}
                </div>
              );
            })}
          </div>
        ),
      },
      {
        id: "competitors",
        header: "מתחרים",
        cell: ({ row }) => {
          const cells = rowScopes(row.original).filter((c) => c.competitors.length > 0);
          if (cells.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="space-y-1.5 text-xs">
              {cells.map((cell) => {
                const nights = nightsLine(cell);
                return (
                  <div key={cell.scope} className="space-y-1">
                    <div className="flex items-center gap-1 font-medium">
                      <span className="text-muted-foreground">{SCOPE_HE[cell.scope]}</span>
                      {cell.listing_url && (
                        <a href={cell.listing_url} target="_blank" rel="noreferrer" title="לצפייה במודעה">
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      )}
                    </div>
                    <OurBreakdown cell={cell} />
                    <CompetitorMatrix cell={cell} />
                    {nights && <div className="text-muted-foreground">{nights}</div>}
                    {cell.adjustments.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {cell.adjustments.map((a) => (
                          <span key={a} className="rounded bg-muted px-1 py-0.5 text-muted-foreground">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        },
      },
      {
        id: "diff",
        header: "פער",
        // Sort by the WORST gap on the row (most over-priced first) - that is the one that will
        // make someone act, whichever half of the package it came from.
        accessorFn: (row) => Math.max(...rowScopes(row).map((c) => c.diff_usd ?? -Infinity), -Infinity),
        cell: ({ row }) => {
          const cells = rowScopes(row.original).filter((c) => c.diff_usd != null);
          if (cells.length === 0) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="space-y-1 text-xs tabular-nums">
              {cells.map((cell) => (
                <div key={cell.scope} className="flex items-baseline gap-1">
                  <span className="text-muted-foreground">{SCOPE_HE[cell.scope]}</span>
                  <span
                    className={cn(
                      "font-medium",
                      (cell.diff_usd ?? 0) < 0 ? "text-success" : (cell.diff_usd ?? 0) > 0 ? "text-destructive" : "",
                    )}
                  >
                    {signedUsd(cell.diff_usd ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          );
        },
      },
      {
        id: "crawled_at",
        header: "נסרק",
        cell: ({ row }) => {
          // The freshest crawl behind either conclusion - "when did we last see the market".
          const newest = rowScopes(row.original)
            .map((c) => c.crawled_at)
            .filter((x): x is string => !!x)
            .sort()
            .at(-1) ?? null;
          return <span className="text-xs text-muted-foreground">{relativeTime(newest)}</span>;
        },
      },
      {
        id: "decision",
        header: "",
        cell: ({ row }) => <DecisionActions row={row.original} onDone={reload} />,
      },
    ],
    [reload],
  );

  const emptyState = useMemo(() => {
    if (loading) return { title: "טוען…" };
    const descriptions: Record<string, string> = {
      pending: "כל האדומים כבר טופלו, מושתקים או בעלי משימה פתוחה.",
      red: "אין כרגע אירועים באדום.",
      orange_plus: "אין כרגע אירועים בכתום או אדום.",
      soon: "אין אירועים ב-45 הימים הקרובים.",
      changed: "שום דבר לא השתנה השבוע.",
    };
    return { title: "אין שורות בתצוגה הזו", description: descriptions[view] };
  }, [view, loading]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium tabular-nums text-foreground">{rows.length}</span> שורות
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-medium tabular-nums text-foreground">{runs.length}</span> מתחרים פעילים
        </span>
        <span aria-hidden>·</span>
        <span>
          AI החודש <span className="font-medium tabular-nums text-foreground">${cost.usd.toFixed(2)}</span>
          {cost.calls > 0 ? ` ב-${cost.calls} קריאות` : " · אין קריאות"}
        </span>
      </div>

      {/* `text-start`, not `text-right`: the dashboard is RTL, so the label must hug the
          reading edge rather than a hardcoded side. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setView(t.id)}
            aria-pressed={view === t.id}
            className={cn(
              "rounded-lg border bg-card p-3 text-start transition-colors hover:bg-accent",
              view === t.id && "border-ring ring-2 ring-ring",
            )}
          >
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", PILL[t.light])}>
              {TILE_LABEL[t.id]}
            </span>
            <div className="mt-1.5 text-2xl font-bold tabular-nums">{t.count}</div>
          </button>
        ))}
      </div>

      <CompetitorsPanel runs={runs} onDone={reload} />

      <DataTable
        columns={columns}
        data={filtered}
        searchColumns={["name", "competitor"]}
        searchPlaceholder="חיפוש אירוע או מתחרה..."
        views={views}
        activeView={view}
        onViewChange={setView}
        defaultSorting={[{ id: "diff_usd", desc: true }]}
        dense
        getRowId={(row) => row.id}
        emptyState={emptyState}
      />
    </div>
  );
}
