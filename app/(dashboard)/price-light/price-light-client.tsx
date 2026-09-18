"use client";

// The /price-light screen: what the competitors charge for the same event,
// and what to do about a red light. Pattern = price-changes-client.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Columns2, ExternalLink, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type DataTableView } from "@/components/data-table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  type CompetitorAnswer,
  type CompetitorKey,
  type Light,
  type PriceLightRow,
  type PriceLightScopeCell,
  type Scope,
} from "@/types/price-light.types";
import { ComparisonSheet } from "./comparison-sheet";
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

/**
 * The ticket / package filter (partner, 2026-09-14: "פלטור של כרטיס / חבילה"). It is a LENS, not a
 * view: with "חבילה" picked, a row's ticket conclusion is not just hidden from the table, it stops
 * counting in every tile and view too - "3 red" then means three red PACKAGES.
 */
type ScopeFilter = "all" | Scope;

const SCOPE_FILTERS: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "חבילה + כרטיס" },
  { id: "package", label: "חבילה" },
  { id: "ticket", label: "כרטיס" },
];

function cellsIn(row: PriceLightRow, scope: ScopeFilter): PriceLightScopeCell[] {
  return scope === "all" ? rowScopes(row) : [row[scope]].filter((c): c is PriceLightScopeCell => c != null);
}

/** A row waits for a human when EITHER of its conclusions in scope does. */
function isPending(row: PriceLightRow, now: number, scope: ScopeFilter): boolean {
  return cellsIn(row, scope).some((cell) => scopePending(row, cell, now));
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
function noPriceText(answer: PriceLightScopeCell["competitors"][number]): string {
  // LiveEvents sells most sports packages "לקבלת הצעת מחיר" - they DO sell it, there is just no
  // published number. Calling that "לא ודאי" read as "maybe they don't have it" (225 events).
  if (answer.quote_only) return "מוכר · הצעת מחיר";
  switch (answer.status) {
    case "not_selling": return "לא מוכר";
    case "unsure": return "לא ודאי";
    case "na": return "לא רלוונטי";
    case "found": return "ללא מחיר";
    default: return "לא נבדק";
  }
}

/** Column order for the competitor columns - the registry order staff already know from the panel. */
const COMPETITOR_ORDER: CompetitorKey[] = ["liveevents", "issta", "golasso", "ontour", "livetickets"];

/** One competitor's answer for one scope of a row, or null when that competitor is not in play there. */
function answerFor(cell: PriceLightScopeCell, competitor: CompetitorKey): CompetitorAnswer | null {
  return cell.competitors.find((a) => a.competitor === competitor) ?? null;
}

/** A scope's gap: against the picked competitor when there is one, else the gap that set the light. */
function gapOf(cell: PriceLightScopeCell, competitor: CompetitorKey | null): number | null {
  return competitor ? answerFor(cell, competitor)?.diff_usd ?? null : cell.diff_usd;
}

/** "Sells it" for the header filter: a priced listing or a quote-only one. */
function sellsIt(a: CompetitorAnswer | null): boolean {
  return a != null && (a.normalized_usd != null || a.quote_only);
}

/**
 * One competitor, one row (notes 1 + 3): a fixed column per competitor instead of a list inside one
 * cell, so the eye runs DOWN a competitor and "where is Golasso cheaper than us" is a scan, not a read.
 * One line per scope in the lens; the dot marks the competitor that set that scope's light.
 */
function CompetitorCell({ row, scope, competitor }: { row: PriceLightRow; scope: ScopeFilter; competitor: CompetitorKey }) {
  const lines = cellsIn(row, scope)
    .map((cell) => ({ cell, answer: answerFor(cell, competitor) }))
    .filter((x): x is { cell: PriceLightScopeCell; answer: CompetitorAnswer } => x.answer != null);
  if (lines.length === 0) return <span className="text-xs text-muted-foreground/60">—</span>;
  return (
    <div className="space-y-1 text-xs tabular-nums">
      {lines.map(({ cell, answer }) => (
        <div key={cell.scope} className="flex items-center gap-1 whitespace-nowrap">
          {lines.length > 1 && <span className="text-muted-foreground">{SCOPE_HE[cell.scope]}</span>}
          {answer.decided && <span className="text-muted-foreground" title="קבע את האור">●</span>}
          {answer.normalized_usd != null ? (
            <>
              <span className="font-medium">${answer.normalized_usd}</span>
              {answer.light && answer.diff_usd != null && (
                <span className={cn("inline-flex rounded-full px-1.5 py-0.5 font-medium", PILL[answer.light])}>
                  {signedUsd(answer.diff_usd)}
                </span>
              )}
            </>
          ) : (
            <span className={answer.status === "not_selling" ? "text-muted-foreground/60" : "text-muted-foreground"}>
              {answer.status === "skipped" ? "לא מכוסה" : noPriceText(answer)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Competitor column header (note 3). First click filters to the events this competitor sells,
 * second sorts by the gap against it (dearest first), third clears both. The filter is the
 * caller's state (it also lives in the URL); the sort is the table's own.
 */
function CompetitorHeader({
  competitor, active, sorted, onFilter, onSort, onClear,
}: {
  competitor: CompetitorKey; active: boolean; sorted: boolean;
  onFilter: () => void; onSort: () => void; onClear: () => void;
}) {
  const next = !active ? onFilter : !sorted ? onSort : onClear;
  const hint = !active ? "סנן לאירועים שהמתחרה מוכר" : !sorted ? "מיין לפי הפער מולו" : "נקה סינון ומיון";
  return (
    <button
      type="button"
      onClick={next}
      title={hint}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal transition-colors hover:bg-accent",
        active && "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {COMPETITOR_LABEL[competitor] ?? competitor}
      {active && <span aria-hidden>{sorted ? "↓" : "•"}</span>}
    </button>
  );
}

/**
 * Our own side of a package comparison, as the pricing rule defines it - four numbers that sum to
 * the price above them (flight / hotel / ticket / customer fees). Compact on purpose: the full
 * wording of each line is in its tooltip and in the comparison sheet.
 */
function OurBreakdown({ cell }: { cell: PriceLightScopeCell }) {
  if (cell.ours.length === 0) return null;
  return (
    <div className="flex max-w-56 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {cell.ours.map((line) => (
        <span key={line.label} title={line.detail} className="whitespace-nowrap">
          {line.label} <span className="tabular-nums text-foreground/80">{line.usd != null ? `$${line.usd}` : "—"}</span>
        </span>
      ))}
    </div>
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
    // Renamed 2026-09-17: this is the NORMALIZATION gap (the competitor's page never said what
    // its package contains), not the coverage one the "כיסוי חלקי" view is about.
    cell.partial ? "נרמול חלקי (חסרים פרטי חבילה)" : null,
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
  const [cost, setCost] = useState<{ usd: number; calls: number } | null>(null);
  const [loading, setLoading] = useState(true);
  // True while `rows` holds only the red events (the first paint) - every count that is not
  // about red is unknown until the full list lands, and is shown as "…" rather than as 0.
  const [partial, setPartial] = useState(false);
  const [runsLoading, setRunsLoading] = useState(true);
  const [view, setView] = useState("pending");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [compare, setCompare] = useState<PriceLightRow | null>(null);
  // The competitor picked from a column header (note 3) - kept in the URL (`?comp=`) next to
  // `?scope=`, so a filtered table can be linked to and survives a refresh.
  const [comp, setComp] = useState<CompetitorKey | null>(null);
  const pickCompetitor = useCallback((next: CompetitorKey | null) => {
    setComp(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("comp", next); else url.searchParams.delete("comp");
    window.history.replaceState(null, "", url);
  }, []);
  /** A decision hands back the ONE fresh row (note 14): patch it in place - a full reload re-sorted
   *  the table and the row the reader was on jumped away. null = the row no longer belongs here. */
  const patchRow = useCallback((eventId: number, fresh: PriceLightRow | null) => {
    setRows((prev) => (fresh ? prev.map((r) => (r.event_id === eventId ? fresh : r)) : prev.filter((r) => r.event_id !== eventId)));
  }, []);
  // Two answers can be in flight for the rows (red-first, then everything); a stale one must
  // never land on top of a newer load, e.g. a decision's refresh racing the opening full list.
  const rowsSeq = useRef(0);

  // Three loads, three arrivals. They used to sit behind one Promise.all, so the table - the
  // thing the reader came for - waited for the slowest of the three (the competitors panel).
  // Now each part fills in as its own answer lands; a failure in one leaves the others standing.
  //
  // `redFirst` (the opening load only): the default view is "ממתינים להחלטה", a subset of the
  // red events, so the red rows are fetched alone first - about half the catalog's rows and
  // bytes (238 of 426 events were red on 2026-09-16) - and the table paints from them while
  // the full list is still on its way. The full answer then replaces them wholesale.
  const reloadRows = useCallback(async (redFirst = false) => {
    const seq = ++rowsSeq.current;
    setLoading(true);
    try {
      if (redFirst) {
        const red = await listPriceLight({ onlyRed: true });
        if (seq !== rowsSeq.current) return;
        setRows(red);
        setPartial(true);
        setLoading(false);
      }
      const all = await listPriceLight();
      if (seq !== rowsSeq.current) return;
      setRows(all);
      setPartial(false);
    } catch (e) {
      console.error("price-light rows failed", e);
      toast({ variant: "destructive", title: "טעינה נכשלה", description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      if (seq === rowsSeq.current) setLoading(false);
    }
  }, [toast]);
  const reloadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      setRuns(await listCrawlRuns());
    } catch (e) {
      console.error("price-light crawl panel failed", e);
    } finally {
      setRunsLoading(false);
    }
  }, []);
  const reloadCost = useCallback(async () => {
    try {
      setCost(await aiCostThisMonth());
    } catch (e) {
      console.error("price-light ai cost failed", e);
    }
  }, []);
  const reload = useCallback(() => {
    void reloadRows();
    void reloadRuns();
    void reloadCost();
  }, [reloadRows, reloadRuns, reloadCost]);

  useEffect(() => {
    void reloadRows(true);
    void reloadRuns();
    void reloadCost();
  }, [reloadRows, reloadRuns, reloadCost]);

  // ?f= preselects a view, ?scope= the package/ticket lens, on arrival (e.g. a link from the
  // dashboard widget) - read once.
  useEffect(() => {
    const f = searchParams.get("f");
    if (f) setView(f === "package" || f === "ticket" ? "all" : f);
    const s = searchParams.get("scope") ?? (f === "package" || f === "ticket" ? f : null);
    if (s === "package" || s === "ticket") setScope(s);
    const c = searchParams.get("comp");
    if (c && (COMPETITOR_ORDER as string[]).includes(c)) setComp(c as CompetitorKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The rows that have anything to say under the current lens - a ticket-only lens drops events
  // that have no ticket conclusion at all.
  const scoped = useMemo(() => rows.filter((r) => cellsIn(r, scope).length > 0), [rows, scope]);

  const counts = useMemo(() => {
    const now = Date.now();
    const soonCutoff = addDaysStr(new Date(now).toISOString().slice(0, 10), 45);
    const c = {
      alone: 0, green: 0, orange: 0, red: 0, unchecked: 0, pending: 0,
      orangePlus: 0, soon: 0, partial: 0, quote: 0, changed: 0, aiSample: 0,
    };
    // Counted per EVENT, not per conclusion: a row with a red package and a red ticket is one
    // event to deal with, and the tiles are a to-do list, not a tally of verdicts.
    for (const row of scoped) {
      const cells = cellsIn(row, scope);
      const has = (pred: (c: PriceLightScopeCell) => boolean) => cells.some(pred);
      if (has((x) => x.light === "alone")) c.alone++;
      if (has((x) => x.light === "green")) c.green++;
      if (has((x) => x.light === "orange")) c.orange++;
      if (has((x) => x.light === "red")) c.red++;
      if (has((x) => x.light === "orange" || x.light === "red")) c.orangePlus++;
      if (has((x) => x.light === "unchecked")) c.unchecked++;
      if (isPending(row, now, scope)) c.pending++;
      if (row.date <= soonCutoff) c.soon++;
      if (has((x) => x.partial_coverage)) c.partial++;
      if (has((x) => x.quote_only)) c.quote++;
      if (has((x) => x.changed_this_week)) c.changed++;
      if (has((x) => x.method === "ai")) c.aiSample++;
    }
    return c;
  }, [scoped, scope]);

  const inView = useMemo(() => {
    const now = Date.now();
    const soonCutoff = addDaysStr(new Date(now).toISOString().slice(0, 10), 45);
    // Every view asks "does EITHER conclusion in scope qualify" - the row is the event, and an
    // event with a red ticket belongs in the red view whatever its package says (unless the lens
    // is "package", in which case its ticket is not in the question at all).
    const some = (pred: (c: PriceLightScopeCell) => boolean) => (r: PriceLightRow) => cellsIn(r, scope).some(pred);
    switch (view) {
      case "pending": return scoped.filter((r) => isPending(r, now, scope));
      case "red": return scoped.filter(some((c) => c.light === "red"));
      case "orange_plus": return scoped.filter(some((c) => c.light === "orange" || c.light === "red"));
      case "soon": return scoped.filter((r) => r.date <= soonCutoff);
      // "כיסוי חלקי" is about COVERAGE - a competitor that never answered for this event - which
      // is what the view's name promises. It used to filter `c.partial` (incomplete
      // normalization) and showed 6 rows while ~248 scopes were uncovered.
      case "partial": return scoped.filter(some((c) => c.partial_coverage));
      case "quote": return scoped.filter(some((c) => c.quote_only));
      case "changed": return scoped.filter(some((c) => c.changed_this_week));
      case "unchecked": return scoped.filter(some((c) => c.light === "unchecked"));
      case "ai_sample": return scoped.filter(some((c) => c.method === "ai"));
      case "alone": return scoped.filter(some((c) => c.light === "alone"));
      case "green": return scoped.filter(some((c) => c.light === "green"));
      case "orange": return scoped.filter(some((c) => c.light === "orange"));
      case "all": return scoped;
      default: return scoped;
    }
  }, [scoped, scope, view]);

  // The header filter narrows whatever view is open to the events this competitor sells.
  const filtered = useMemo(
    () => (comp ? inView.filter((r) => cellsIn(r, scope).some((c) => sellsIt(answerFor(c, comp)))) : inView),
    [inView, scope, comp],
  );

  // Only the competitors that are in play for the rows on screen get a column - a music view has
  // no ISSTA to show, and five mostly-empty columns push the decision buttons off the screen.
  // A picked competitor stands alone (staff note 17.09: "שיציג רק את המתחרה הזה אם לחצתי") - the
  // other competitors' columns go, so the table reads as us against that one site.
  const shownCompetitors = useMemo(
    () => (comp
      ? [comp]
      : COMPETITOR_ORDER.filter((k) => filtered.some((r) => cellsIn(r, scope).some((c) => answerFor(c, k) != null)))),
    [filtered, scope, comp],
  );

  // The same filter the column headers set, but where it can be SEEN: clicking a header changed
  // nothing visible when the top rows already belonged to that competitor, and no count moved.
  const competitorFilter = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={comp ?? "all"} onValueChange={(v) => pickCompetitor(v === "all" ? null : (v as CompetitorKey))}>
        <SelectTrigger className="h-8 w-44 text-xs" aria-label="סינון לפי מתחרה">
          <SelectValue placeholder="כל המתחרים" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">כל המתחרים</SelectItem>
          {COMPETITOR_ORDER.map((k) => (
            <SelectItem key={k} value={k}>{COMPETITOR_LABEL[k] ?? k}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {comp && (
        <button
          type="button"
          onClick={() => pickCompetitor(null)}
          title="נקה סינון מתחרה"
          className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          מוכר ע״י {COMPETITOR_LABEL[comp] ?? comp} · {filtered.length} מתוך {inView.length}
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );

  // While only the red rows are in, every count that is not about red is unknown - `null`
  // renders "…". Red and pending are exact from the first paint (every red event is there).
  const known = (n: number, redOnly = false): number | null => (partial && !redOnly ? null : n);
  const tiles: { id: string; count: number | null; light: Light }[] = [
    { id: "alone", count: known(counts.alone), light: "alone" },
    { id: "green", count: known(counts.green), light: "green" },
    { id: "orange", count: known(counts.orange), light: "orange" },
    { id: "red", count: known(counts.red, true), light: "red" },
    { id: "unchecked", count: known(counts.unchecked), light: "unchecked" },
    { id: "pending", count: known(counts.pending, true), light: "red" },
  ];

  const views: DataTableView[] = [
    { id: "pending", label: "ממתינים להחלטה", count: counts.pending },
    { id: "red", label: "אדום", count: counts.red },
    { id: "orange_plus", label: "כתום ומעלה", count: known(counts.orangePlus) ?? undefined },
    { id: "soon", label: "בקרוב (45 יום)", count: known(counts.soon) ?? undefined },
    { id: "partial", label: "כיסוי חלקי", count: known(counts.partial) ?? undefined },
    { id: "quote", label: "הצעת מחיר בלבד", count: known(counts.quote) ?? undefined },
    { id: "changed", label: "השתנה השבוע", count: known(counts.changed) ?? undefined },
    { id: "unchecked", label: "לא נבדק", count: known(counts.unchecked) ?? undefined },
    { id: "ai_sample", label: "מדגם AI", count: known(counts.aiSample) ?? undefined },
    { id: "all", label: "הכול", count: known(scoped.length) ?? undefined },
  ];
  // A non-red view has nothing to show until the full list lands - "loading", not "empty".
  const viewStillLoading = partial && view !== "pending" && view !== "red";

  const columns = useMemo<ColumnDef<PriceLightRow>[]>(
    () => [
      {
        id: "name",
        // Both names in one searchable value: the Hebrew `name` is what the row prints, but staff
        // type "barcelona"/"barca" as often as "ברצלונה" and the English name was not in the
        // haystack at all. `matchesSearch` tokenizes, so one space-joined string is enough.
        // (Sorting by this column is unaffected in practice - the Hebrew name is still the prefix.)
        accessorFn: (row) => [row.name, row.name_english].filter(Boolean).join(" "),
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
            {cellsIn(row.original, scope).map((cell) => (
              <LightBadge key={cell.scope} cell={cell} />
            ))}
          </div>
        ),
      },
      {
        id: "ours",
        // The light compares our margin-free "from" price (2026-09-17); the site card price, which
        // carries the rule's +$100/+$120, sits muted beneath so the two are never confused.
        header: "החל מ- (שלנו)",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs tabular-nums">
            {cellsIn(row.original, scope).map((cell) => {
              // The live figure wins the line when it has moved since the light was computed -
              // the recorded one stays visible, struck through, so the drift is legible.
              const moved = cell.our_usd != null && cell.our_usd_now != null && cell.our_usd_now !== cell.our_usd;
              return (
                <div key={cell.scope}>
                  <div className="flex items-baseline gap-1">
                    <span className="text-muted-foreground">{SCOPE_HE[cell.scope]}</span>
                    <span className="font-medium">
                      {cell.our_usd_now != null ? `$${cell.our_usd_now}` : cell.our_usd != null ? `$${cell.our_usd}` : "—"}
                    </span>
                    {moved && <span className="text-muted-foreground line-through">${cell.our_usd}</span>}
                  </div>
                  {/* Staff note 17.09: with both scopes on the row the site price and the four-line
                      breakdown crowd it - they show under a single-scope lens and in the sheet. */}
                  {scope !== "all" && cell.site_usd != null && (
                    <div className="text-[11px] text-muted-foreground">באתר ${cell.site_usd}</div>
                  )}
                  {scope !== "all" && <OurBreakdown cell={cell} />}
                </div>
              );
            })}
          </div>
        ),
      },
      {
        id: "detail",
        header: "פירוט",
        cell: ({ row }) => {
          const cells = cellsIn(row.original, scope).filter((c) => c.competitors.length > 0);
          if (cells.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="space-y-1.5 text-xs">
              {/* What each package CONTAINS - flight, hotel, seat - per competitor, side by side. */}
              <button
                type="button"
                onClick={() => setCompare(row.original)}
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium hover:bg-accent"
              >
                <Columns2 className="h-3 w-3" aria-hidden />
                השוואה מפורטת
              </button>
              {/* Same note: the listing link, nights line and adjustment chips belong to a
                  single-scope lens; the combined row keeps only the way into the sheet. */}
              {scope !== "all" && cells.map((cell) => {
                const nights = nightsLine(cell);
                return (
                  <div key={cell.scope} className="space-y-1">
                    {cell.listing_url && (
                      <a href={cell.listing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline">
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        המודעה · {SCOPE_HE[cell.scope]}
                      </a>
                    )}
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
      ...shownCompetitors.map((competitor): ColumnDef<PriceLightRow> => ({
        id: `comp_${competitor}`,
        // Sorts by the WORST gap against this competitor; rows it does not price sink to the bottom.
        accessorFn: (row) => Math.max(...cellsIn(row, scope).map((c) => answerFor(c, competitor)?.diff_usd ?? -Infinity), -Infinity),
        sortUndefined: "last",
        header: ({ column }) => (
          <CompetitorHeader
            competitor={competitor}
            active={comp === competitor}
            sorted={column.getIsSorted() !== false}
            onFilter={() => pickCompetitor(competitor)}
            onSort={() => column.toggleSorting(true)}
            onClear={() => { column.clearSorting(); pickCompetitor(null); }}
          />
        ),
        cell: ({ row }) => <CompetitorCell row={row.original} scope={scope} competitor={competitor} />,
      })),
      {
        id: "diff",
        // With a competitor picked the gap is the one against IT, not against whoever set the light.
        header: comp ? `פער מול ${COMPETITOR_LABEL[comp] ?? comp}` : "פער",
        // Sort by the WORST gap on the row (most over-priced first) - that is the one that will
        // make someone act, whichever half of the package it came from.
        accessorFn: (row) => Math.max(...cellsIn(row, scope).map((c) => gapOf(c, comp) ?? -Infinity), -Infinity),
        cell: ({ row }) => {
          const gaps = cellsIn(row.original, scope)
            .map((cell) => ({ scope: cell.scope, diff: gapOf(cell, comp) }))
            .filter((g): g is { scope: Scope; diff: number } => g.diff != null);
          if (gaps.length === 0) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="space-y-1 text-xs tabular-nums">
              {gaps.map((g) => (
                <div key={g.scope} className="flex items-baseline gap-1">
                  <span className="text-muted-foreground">{SCOPE_HE[g.scope]}</span>
                  <span className={cn("font-medium", g.diff < 0 ? "text-success" : g.diff > 0 ? "text-destructive" : "")}>
                    {signedUsd(g.diff)}
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
          const newest = cellsIn(row.original, scope)
            .map((c) => c.crawled_at)
            .filter((x): x is string => !!x)
            .sort()
            .at(-1) ?? null;
          return (
            <div className="whitespace-nowrap text-xs text-muted-foreground">
              <div>נסרק {relativeTime(newest)}</div>
              <div>נבדק {relativeTime(row.original.checked_at)}</div>
            </div>
          );
        },
      },
      {
        id: "decision",
        header: "",
        cell: ({ row }) => <DecisionActions row={row.original} onDone={reload} onRowPatched={patchRow} />,
      },
    ],
    [reload, patchRow, scope, shownCompetitors, comp, pickCompetitor],
  );

  const emptyState = useMemo(() => {
    if (loading || viewStillLoading) return { title: "טוען…" };
    const descriptions: Record<string, string> = {
      pending: "כל האדומים כבר טופלו, מושתקים או בעלי משימה פתוחה.",
      red: "אין כרגע אירועים באדום.",
      orange_plus: "אין כרגע אירועים בכתום או אדום.",
      soon: "אין אירועים ב-45 הימים הקרובים.",
      changed: "שום דבר לא השתנה השבוע.",
    };
    return { title: "אין שורות בתצוגה הזו", description: descriptions[view] };
  }, [view, loading, viewStillLoading]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium tabular-nums text-foreground">{partial ? "…" : scoped.length}</span> אירועים
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-medium tabular-nums text-foreground">{runsLoading && runs.length === 0 ? "…" : runs.length}</span> מתחרים פעילים
        </span>
        <span aria-hidden>·</span>
        <span>
          AI החודש{" "}
          {cost ? (
            <>
              <span className="font-medium tabular-nums text-foreground">${cost.usd.toFixed(2)}</span>
              {cost.calls > 0 ? ` ב-${cost.calls} קריאות` : " · אין קריאות"}
            </>
          ) : (
            <span className="font-medium text-foreground">…</span>
          )}
        </span>
      </div>

      <div role="group" aria-label="חבילה או כרטיס" className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
        {SCOPE_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScope(s.id)}
            aria-pressed={scope === s.id}
            className={cn(
              "rounded-md px-3 py-1 transition-colors",
              scope === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {s.label}
          </button>
        ))}
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
            <div className="mt-1.5 text-2xl font-bold tabular-nums">{t.count ?? "…"}</div>
          </button>
        ))}
      </div>

      <CompetitorsPanel runs={runs} loading={runsLoading} onDone={reload} picked={comp} onPick={pickCompetitor} />

      <DataTable
        columns={columns}
        data={filtered}
        searchColumns={["name"]}
        searchPlaceholder="חיפוש אירוע..."
        filters={competitorFilter}
        views={views}
        activeView={view}
        onViewChange={setView}
        defaultSorting={[{ id: "diff", desc: true }]}
        dense
        getRowId={(row) => row.id}
        emptyState={emptyState}
      />

      {compare && (
        <ComparisonSheet
          eventId={compare.event_id}
          eventName={compare.name}
          open={compare != null}
          onOpenChange={(open) => { if (!open) setCompare(null); }}
          onRowPatched={patchRow}
        />
      )}
    </div>
  );
}
