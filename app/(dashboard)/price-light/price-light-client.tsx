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
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  aiCostThisMonth,
  listCrawlRuns,
  listPriceLight,
  type CrawlPanelRow,
  type PriceLightRow,
} from "@/lib/actions/price-light-actions";
import { signedUsd } from "@/lib/services/price-light";
import { COMPETITOR_LABEL, HE_REASON, heLabel, PILL } from "@/app/(dashboard)/events/price-light-ui";
import type { Light } from "@/types/price-light.types";
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

/** "ממתינים להחלטה": red, not silenced right now, and no open task chasing it already.
 *  `silenced_until` is compared as a TIMESTAMP, not as a string: Postgres hands back
 *  `+00` offsets while `new Date().toISOString()` ends in `Z`, so a lexical `>` compares
 *  two differently-shaped strings and silently mis-reads the silence (same comparison the
 *  dashboard widget already does with Date.parse). */
function isPending(row: PriceLightRow, now: number): boolean {
  return row.light === "red" && !(row.silenced_until != null && Date.parse(row.silenced_until) > now) && !row.has_open_task;
}

const TILE_LABEL: Record<string, string> = {
  alone: "לבד בשוק",
  green: "ירוק",
  orange: "כתום",
  red: "אדום",
  unchecked: "לא נבדק",
  pending: "ממתינים להחלטה",
};

/** Same duration line as the events-table tooltip (price-light-ui.tsx `nightsLine`), off the
 *  flattened row fields - our packages are often a night longer, and that is the first thing
 *  to check when a comparison looks wrong. Null when the scope has no duration (ticket) or the
 *  light predates the field. */
function nightsLine(row: PriceLightRow): string | null {
  if (row.scope !== "package" || row.competitor == null) return null;
  // A light computed before this field existed has neither duration and no doubt recorded.
  // Printing "לא ידוע / לא פורסם" for it would be an invented statement about a comparison
  // nobody measured that way - say nothing until the next pass rewrites the row.
  if (row.nights_ours == null && row.nights_theirs == null && row.uncertainty_usd === 0) return null;
  const ours = row.nights_ours == null ? "לא ידוע" : `${row.nights_ours}`;
  if (row.nights_theirs != null) return `לילות: ${ours} שלנו מול ${row.nights_theirs} שלהם`;
  const band = row.uncertainty_usd ? ` (±$${row.uncertainty_usd})` : "";
  return `לילות: ${ours} שלנו · אצלהם לא פורסם${band}`;
}

function LightBadge({ row }: { row: PriceLightRow }) {
  // Hebrew throughout and the competitor's display name, not its key: this tooltip is the
  // explanation a staff member reads before deciding to drop a price or pull an event.
  const tip = [
    row.competitor
      ? `${COMPETITOR_LABEL[row.competitor] ?? row.competitor}: ${row.raw ?? "?"} ${row.raw_currency ?? ""} → מנורמל $${row.normalized_usd ?? "?"}`
      : null,
    row.our_usd != null ? `שלנו: $${row.our_usd}` : null,
    // Our own ticket prices move between nightly runs, so the number the light was computed
    // against is not always today's. Say so rather than let a stale figure pass for current.
    row.our_usd != null && row.our_usd_now != null && row.our_usd_now !== row.our_usd
      ? `המחיר שלנו זז מאז הבדיקה: כעת $${row.our_usd_now}`
      : null,
    nightsLine(row),
    ...row.adjustments,
    row.partial ? "כיסוי חלקי בנרמול" : null,
    row.crawled_at ? `נסרק ${row.crawled_at.slice(0, 10)}` : null,
    row.reason ? HE_REASON[row.reason] : null,
  ].filter(Boolean).join("\n");
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", PILL[row.light])}>
            {heLabel(row.light, row.diff_usd)}
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
    for (const row of rows) {
      if (row.light === "alone") c.alone++;
      if (row.light === "green") c.green++;
      if (row.light === "orange") { c.orange++; c.orangePlus++; }
      if (row.light === "red") {
        c.red++;
        c.orangePlus++;
        if (isPending(row, now)) c.pending++;
      }
      if (row.light === "unchecked") c.unchecked++;
      if (row.scope === "package") c.package++;
      if (row.scope === "ticket") c.ticket++;
      if (row.date <= soonCutoff) c.soon++;
      if (row.partial) c.partial++;
      if (row.changed_this_week) c.changed++;
      if (row.method === "ai") c.aiSample++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const soonCutoff = addDaysStr(new Date(now).toISOString().slice(0, 10), 45);
    switch (view) {
      case "pending": return rows.filter((r) => isPending(r, now));
      case "red": return rows.filter((r) => r.light === "red");
      case "orange_plus": return rows.filter((r) => r.light === "orange" || r.light === "red");
      case "package": return rows.filter((r) => r.scope === "package");
      case "ticket": return rows.filter((r) => r.scope === "ticket");
      case "soon": return rows.filter((r) => r.date <= soonCutoff);
      case "partial": return rows.filter((r) => r.partial);
      case "changed": return rows.filter((r) => r.changed_this_week);
      case "unchecked": return rows.filter((r) => r.light === "unchecked");
      case "ai_sample": return rows.filter((r) => r.method === "ai");
      case "alone": return rows.filter((r) => r.light === "alone");
      case "green": return rows.filter((r) => r.light === "green");
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
        accessorKey: "scope",
        header: "היקף",
        cell: ({ row }) => (
          <Badge variant="outline" className="font-normal">
            {row.original.scope === "package" ? "חבילה" : "כרטיס"}
          </Badge>
        ),
      },
      {
        accessorKey: "our_usd",
        header: "המחיר שלנו",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.our_usd != null ? `$${row.original.our_usd}` : "—"}</span>
        ),
      },
      {
        accessorKey: "competitor",
        header: "מתחרה",
        cell: ({ row }) => {
          const r = row.original;
          if (!r.competitor) return <span className="text-xs text-muted-foreground">—</span>;
          const nights = nightsLine(r);
          return (
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-1 font-medium">
                {COMPETITOR_LABEL[r.competitor] ?? r.competitor}
                {r.listing_url && (
                  <a href={r.listing_url} target="_blank" rel="noreferrer" title="לצפייה במודעה">
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                )}
              </div>
              {r.raw != null && (
                <div className="text-muted-foreground">
                  {r.raw} {r.raw_currency} → ${r.normalized_usd ?? "?"}
                </div>
              )}
              {nights && <div className="text-muted-foreground">{nights}</div>}
              {r.adjustments.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.adjustments.map((a) => (
                    <span key={a} className="rounded bg-muted px-1 py-0.5 text-muted-foreground">
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "diff_usd",
        header: "פער",
        sortingFn: (rowA, rowB) => (rowA.original.diff_usd ?? -Infinity) - (rowB.original.diff_usd ?? -Infinity),
        cell: ({ row }) => {
          const d = row.original.diff_usd;
          if (d == null) return <span className="text-muted-foreground">—</span>;
          return (
            <span className={cn("tabular-nums font-medium", d < 0 ? "text-success" : d > 0 ? "text-destructive" : "")}>
              {signedUsd(d)}
            </span>
          );
        },
      },
      {
        accessorKey: "light",
        header: "רמזור",
        cell: ({ row }) => <LightBadge row={row.original} />,
      },
      {
        accessorKey: "crawled_at",
        header: "נסרק",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{relativeTime(row.original.crawled_at)}</span>,
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
