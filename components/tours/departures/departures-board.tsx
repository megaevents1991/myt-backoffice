"use client";

/**
 * The departures board (/tours/departures) - the screen that replaces the
 * Google Sheet the Mega Family team edits every day.
 *
 * One fetch brings the departures of the chosen season years with their prices,
 * promotions, flights and seat counts; everything after that (grouping by
 * series, filtering, selection) happens here. The filters live in the query
 * string so a view can be sent as a link, and `?code=CBEA1014` opens that
 * departure's card.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Tag,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { PageHeader } from "@/components/page-header";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionState } from "@/hooks/use-view-state";
import { cn } from "@/lib/utils";
import { SALE_STATUSES, SALE_STATUS_LABELS, type SaleStatus } from "@/types/tours.types";
import {
  exportDeparturesXlsx,
  getBoardRows,
  getDeparturesBoard,
  saveDeparturePrices,
  setDeparturesPublished,
  setDeparturesSaleStatus,
  updateDeparture,
} from "@/lib/actions/tours-departure-actions";
import {
  BulkOutcomeDialog,
  BulkPromotionDialog,
  CopyPricesDialog,
  NewDepartureDialog,
  PastePricesDialog,
} from "./board-dialogs";
import { BoardRowView, type CardTab } from "./board-row";
import { DepartureCard, type CardTarget } from "./departure-card";
import { doublePricePerPerson, nightsBetween, periodLabel, periodsOverlapping, todayIso } from "./departure-utils";
import type { BoardData, BoardRow, BulkOutcome } from "./types";
import { Ltr, Notice, selectClass } from "./ui-bits";
import { afterUrlWrite, useQueryState } from "./use-query-state";

const CARD_TABS: readonly CardTab[] = ["general", "prices", "promotions", "flights", "sales"];
/** Everything the board keeps in the query string: the filters, and the open card (`code`, `tab`). */
const QUERY_KEYS = [
  "year",
  "season",
  "series",
  "page",
  "status",
  "published",
  "noflight",
  "noprice",
  "upcoming",
  "deleted",
  "q",
  "code",
  "tab",
] as const;
const NO_FILTERS = {
  year: "",
  season: "",
  series: "",
  page: "",
  status: "",
  published: "",
  noflight: "",
  noprice: "",
  upcoming: "",
  deleted: "",
  q: "",
};
const COLUMN_COUNT = 15;

const th =
  "sticky top-0 z-10 h-9 whitespace-nowrap bg-muted px-1.5 text-start text-xs font-semibold text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]";

const sortRows = (rows: BoardRow[]): BoardRow[] =>
  [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));

function downloadBase64(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function FilterToggle({ label, active, onChange, tone }: { label: string; active: boolean; onChange: (next: boolean) => void; tone?: "bad" }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange(!active)}
      className={cn(
        "h-9 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? tone === "bad"
            ? "border-destructive/40 bg-destructive/10 font-semibold text-destructive"
            : "border-primary bg-primary font-semibold text-primary-foreground"
          : "border-input bg-background text-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

export function DeparturesBoard() {
  const thisYear = useMemo(() => Number(todayIso().slice(0, 4)), []);
  const today = useMemo(() => todayIso(), []);

  // ---- view state: filters in the URL, folded groups in the browser tab
  const [params, setParams] = useQueryState(QUERY_KEYS);
  const {
    year: yearParam,
    season,
    series: seriesCode,
    page: pageId,
    status,
    published,
    noflight: noFlight,
    noprice: noPrice,
    upcoming,
    deleted,
    q: query,
    code: codeParam,
  } = params;
  const tab: CardTab = (CARD_TABS as readonly string[]).includes(params.tab) ? (params.tab as CardTab) : "general";
  const setTab = useCallback((next: CardTab) => setParams({ tab: next === "general" ? "" : next }), [setParams]);
  const [collapsed, setCollapsed] = useSessionState<string[]>("departures:collapsed", []);

  // ---- data
  const [data, setData] = useState<BoardData | null>(null);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [cardTarget, setCardTarget] = useState<CardTarget | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ title: string; outcome: BulkOutcome } | null>(null);
  const [dialog, setDialog] = useState<"new" | "paste" | "copy" | "promotion" | null>(null);
  const [exporting, setExporting] = useState(false);

  const showDeleted = deleted === "1";
  const years = useMemo(
    () => (yearParam === "all" ? [] : /^\d{4}$/.test(yearParam) ? [Number(yearParam)] : [thisYear, thisYear + 1]),
    [yearParam, thisYear],
  );
  const yearsKey = years.join(",");

  const load = useCallback(async () => {
    setLoading(true);
    await afterUrlWrite();
    const result = await getDeparturesBoard({ years: yearsKey ? yearsKey.split(",").map(Number) : [], includeDeleted: showDeleted });
    if (result.success) {
      setData(result.data);
      setRows(result.data.rows);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [yearsKey, showDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  // `?code=` opens the card; closing it clears the param.
  useEffect(() => {
    if (!codeParam) {
      setCardTarget((current) => (current ? null : current));
    } else {
      setCardTarget((current) => (current?.code === codeParam ? current : { code: codeParam }));
    }
  }, [codeParam]);

  const seriesById = useMemo(() => new Map((data?.series ?? []).map((s) => [s.id, s])), [data]);
  const packageById = useMemo(() => new Map((data?.packages ?? []).map((p) => [p.id, p])), [data]);
  const periods = useMemo(() => data?.periods ?? [], [data]);

  const holidaysById = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of rows) {
      const hits = periodsOverlapping(periods, r.start_date, r.end_date);
      if (hits.length) out.set(r.id, hits.map(periodLabel).join("\n"));
    }
    return out;
  }, [rows, periods]);

  const typicalNights = useMemo(() => {
    const counts = new Map<string, Map<number, number>>();
    for (const r of rows) {
      const nights = nightsBetween(r.start_date, r.end_date);
      if (nights == null || nights <= 0) continue;
      const perSeries = counts.get(r.series_id) ?? new Map<number, number>();
      perSeries.set(nights, (perSeries.get(nights) ?? 0) + 1);
      counts.set(r.series_id, perSeries);
    }
    const out = new Map<string, number>();
    for (const [seriesId, perSeries] of counts) {
      out.set(seriesId, [...perSeries.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
    return out;
  }, [rows]);

  const options = useMemo(() => {
    const seasons = new Set<string>();
    const labels = new Set<string>();
    const seriesIds = new Set<string>();
    const packageIds = new Set<string>();
    for (const r of rows) {
      if (r.season) seasons.add(r.season);
      for (const l of r.date_labels) labels.add(l);
      seriesIds.add(r.series_id);
      packageIds.add(r.package_id);
    }
    return {
      seasons: [...seasons].sort((a, b) => a.localeCompare(b, "he")),
      labels: [...labels].sort((a, b) => a.localeCompare(b, "he")),
      series: (data?.series ?? []).filter((s) => seriesIds.has(s.id)),
      packages: (data?.packages ?? []).filter((p) => packageIds.has(p.id)),
    };
  }, [rows, data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return rows.filter((r) => {
      if (showDeleted ? !r.is_deleted : Boolean(r.is_deleted)) return false;
      if (season && r.season !== season) return false;
      if (seriesCode && seriesById.get(r.series_id)?.code !== seriesCode) return false;
      if (pageId && r.package_id !== pageId) return false;
      if (status && r.sale_status !== status) return false;
      if (published === "yes" && !r.is_published) return false;
      if (published === "no" && r.is_published) return false;
      if (noFlight === "1" && r.stats.liveBlocks > 0) return false;
      if (noPrice === "1" && doublePricePerPerson(r).price != null) return false;
      if (upcoming === "1" && r.end_date < today) return false;
      if (needle && !r.code.toUpperCase().includes(needle)) return false;
      return true;
    });
  }, [rows, showDeleted, season, seriesCode, pageId, status, published, noFlight, noPrice, upcoming, query, seriesById, today]);

  const groups = useMemo(() => {
    const bySeries = new Map<string, BoardRow[]>();
    for (const r of filtered) bySeries.set(r.series_id, [...(bySeries.get(r.series_id) ?? []), r]);
    return [...bySeries.entries()]
      .map(([seriesId, groupRows]) => ({ seriesId, series: seriesById.get(seriesId), rows: groupRows }))
      .sort((a, b) => (a.series?.code ?? "").localeCompare(b.series?.code ?? ""));
  }, [filtered, seriesById]);

  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);
  const visibleRows = useMemo(() => groups.flatMap((g) => (collapsedSet.has(g.seriesId) ? [] : g.rows)), [groups, collapsedSet]);
  const visibleRef = useRef<BoardRow[]>([]);
  visibleRef.current = visibleRows;

  const selectedRows = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected]);
  const filterCount =
    [season, seriesCode, pageId, status, published, noFlight, noPrice, upcoming, deleted, query].filter(Boolean).length + (yearParam ? 1 : 0);

  const clearFilters = () => setParams(NO_FILTERS);

  // ---- row plumbing
  const patchRow = useCallback((id: string, patch: Partial<BoardRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Swap in the stored state of some departures (after a card edit or a bulk action). */
  const refreshRows = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const result = await getBoardRows(ids);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const fresh = new Map(result.data.map((r) => [r.id, r]));
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.id));
      const merged = prev.map((r) => fresh.get(r.id) ?? r);
      const added = result.data.filter((r) => !known.has(r.id));
      return added.length ? sortRows([...merged, ...added]) : merged;
    });
  }, []);

  const onSelect = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openCard = useCallback(
    (row: BoardRow, nextTab: CardTab = "general") => {
      setCardTarget({ id: row.id, code: row.code });
      setParams({ code: row.code, tab: nextTab === "general" ? "" : nextTab });
    },
    [setParams],
  );

  const closeCard = useCallback(() => {
    setCardTarget(null);
    setParams({ code: "", tab: "" });
  }, [setParams]);

  const onPublish = useCallback(
    async (row: BoardRow, next: boolean) => {
      markBusy(row.id, true);
      const result = await setDeparturesPublished([row.id], next);
      markBusy(row.id, false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const skipped = result.data.skipped[0];
      if (skipped) {
        toast.error(`אי אפשר לפרסם את ${row.code}: ${skipped.reason}`, { duration: 7000 });
        return;
      }
      patchRow(row.id, { is_published: next });
      const warning = result.data.warnings[0];
      if (warning) toast(`${row.code} פורסמה. ${warning.reason}`, { duration: 7000 });
      else toast.success(next ? `${row.code} פורסמה` : `${row.code} הוסרה מהפרסום`);
    },
    [markBusy, patchRow],
  );

  const onSaleStatus = useCallback(
    async (row: BoardRow, next: SaleStatus) => {
      patchRow(row.id, { sale_status: next });
      const result = await updateDeparture(row.id, { sale_status: next });
      if (!result.success) {
        patchRow(row.id, { sale_status: row.sale_status });
        toast.error(result.error);
        return;
      }
      toast.success(`${row.code}: ${SALE_STATUS_LABELS[next]}`);
    },
    [patchRow],
  );

  const onLabels = useCallback(
    async (row: BoardRow, labels: string[]) => {
      patchRow(row.id, { date_labels: labels });
      const result = await updateDeparture(row.id, { date_labels: labels });
      if (!result.success) {
        patchRow(row.id, { date_labels: row.date_labels });
        toast.error(result.error);
        return;
      }
      toast.success(`${row.code}: התגיות עודכנו`);
    },
    [patchRow],
  );

  const onDoublePrice = useCallback(
    async (row: BoardRow, price: number | null, next: boolean) => {
      // Enter walks down the column like a spreadsheet, skipping rows whose price is not typed in.
      let nextId: string | null = null;
      if (next) {
        const list = visibleRef.current;
        const index = list.findIndex((r) => r.id === row.id);
        const target = list.slice(index + 1).find((r) => !r.is_deleted && !doublePricePerPerson(r).derived);
        nextId = target?.id ?? null;
      }
      setPriceEditId(nextId);
      const before = row.prices["adult:2"] ?? null;
      if (price === before) return;
      const prices = { ...row.prices };
      if (price === null) delete prices["adult:2"];
      else prices["adult:2"] = price;
      patchRow(row.id, { prices });
      const result = await saveDeparturePrices(row.id, [{ paxType: "adult", position: 2, price }]);
      if (!result.success) {
        patchRow(row.id, { prices: row.prices });
        toast.error(`${row.code}: ${result.error}`, { duration: 7000 });
        return;
      }
      toast.success(`${row.code}: המחיר עודכן`);
    },
    [patchRow],
  );

  const onCardChanged = useCallback((id: string) => void refreshRows([id]), [refreshRows]);

  // ---- bulk actions
  const finishBulk = async (title: string, result: BulkOutcome) => {
    await refreshRows(result.done);
    if (result.skipped.length || result.warnings.length) setOutcome({ title, outcome: result });
    else toast.success(`${title}: ${result.done.length} יציאות`);
    if (result.skipped.length === 0) setSelected(new Set());
  };

  const bulkPublish = async (next: boolean) => {
    setBulkBusy(true);
    const result = await setDeparturesPublished(selectedRows.map((r) => r.id), next);
    setBulkBusy(false);
    if (!result.success) toast.error(result.error);
    else await finishBulk(next ? "פרסום" : "הסרה מפרסום", result.data);
  };

  const bulkStatus = async (next: string) => {
    if (!next) return;
    setBulkBusy(true);
    const result = await setDeparturesSaleStatus(selectedRows.map((r) => r.id), next);
    setBulkBusy(false);
    if (!result.success) toast.error(result.error);
    else await finishBulk(`סטטוס מכירה "${SALE_STATUS_LABELS[next as SaleStatus]}"`, result.data);
  };

  const exportView = async () => {
    setExporting(true);
    const result = await exportDeparturesXlsx(filtered.map((r) => r.id));
    setExporting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    downloadBase64(result.data.filename, result.data.base64);
    toast.success(`יוצאו ${filtered.length} יציאות`);
  };

  const toggleGroup = (seriesId: string) =>
    setCollapsed((prev) => (prev.includes(seriesId) ? prev.filter((id) => id !== seriesId) : [...prev, seriesId]));

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const publishedCount = filtered.filter((r) => r.is_published).length;
  const noFlightCount = filtered.filter((r) => r.stats.liveBlocks === 0).length;
  const yearOptions = useMemo(() => {
    const min = Math.min(data?.yearRange?.min ?? thisYear, thisYear);
    const max = Math.max(data?.yearRange?.max ?? thisYear + 1, thisYear + 1);
    const out: number[] = [];
    for (let y = min; y <= max; y++) out.push(y);
    return out;
  }, [data, thisYear]);

  return (
    <div dir="rtl" className="min-w-0">
      <PageHeader
        title="לוח יציאות"
        description="כל היציאות של החברה, מקובצות לפי סדרה. כאן מעדכנים פרסום, סטטוס מכירה, תגיות ומחיר בלחיצה על התא. כל שאר הפרטים בכרטיס היציאה."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/tours/series">סדרות ושכפול עונה</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={exportView} disabled={exporting || filtered.length === 0}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
              ייצוא לאקסל
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("paste")} disabled={!data}>
              <ClipboardPaste />
              הדבקת מחירים מאקסל
            </Button>
            <Button size="sm" onClick={() => setDialog("new")} disabled={!data}>
              <Plus />
              יציאה חדשה
            </Button>
            <PublishSiteButton />
          </>
        }
      />

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="שנה" className={selectClass} value={yearParam} onChange={(e) => setParams({ year: e.target.value })}>
          <option value="">
            {thisYear} + {thisYear + 1}
          </option>
          {yearOptions.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
          <option value="all">כל השנים</option>
        </select>
        <select aria-label="עונה" className={selectClass} value={season} onChange={(e) => setParams({ season: e.target.value })}>
          <option value="">כל העונות</option>
          {season && !options.seasons.includes(season) && <option value={season}>{season}</option>}
          {options.seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select aria-label="סדרה" className={selectClass} value={seriesCode} onChange={(e) => setParams({ series: e.target.value })}>
          <option value="">כל הסדרות</option>
          {seriesCode && !options.series.some((s) => s.code === seriesCode) && <option value={seriesCode}>{seriesCode}</option>}
          {options.series.map((s) => (
            <option key={s.id} value={s.code}>
              {s.code}
              {s.label ? ` · ${s.label}` : ""}
            </option>
          ))}
        </select>
        <select aria-label="עמוד באתר" className={cn(selectClass, "max-w-56")} value={pageId} onChange={(e) => setParams({ page: e.target.value })}>
          <option value="">כל העמודים</option>
          {options.packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select aria-label="סטטוס מכירה" className={selectClass} value={status} onChange={(e) => setParams({ status: e.target.value })}>
          <option value="">כל הסטטוסים</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SALE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select aria-label="פרסום" className={selectClass} value={published} onChange={(e) => setParams({ published: e.target.value })}>
          <option value="">מפורסם + טיוטה</option>
          <option value="yes">מפורסם</option>
          <option value="no">לא מפורסם</option>
        </select>
        <FilterToggle label="בלי טיסה חיה" tone="bad" active={noFlight === "1"} onChange={(v) => setParams({ noflight: v ? "1" : "" })} />
        <FilterToggle label="בלי מחיר" tone="bad" active={noPrice === "1"} onChange={(v) => setParams({ noprice: v ? "1" : "" })} />
        <FilterToggle label="רק עתידיות" active={upcoming === "1"} onChange={(v) => setParams({ upcoming: v ? "1" : "" })} />
        <FilterToggle label="מחוקות" active={showDeleted} onChange={(v) => setParams({ deleted: v ? "1" : "" })} />
        <Input
          dir="ltr"
          aria-label="חיפוש לפי קוד"
          placeholder="חיפוש קוד"
          className="h-9 w-32 font-mono placeholder:font-sans"
          value={query}
          onChange={(e) => setParams({ q: e.target.value })}
        />
        {filterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            ניקוי
          </Button>
        )}
      </div>

      {/* summary + bulk bar */}
      <div className="mb-2 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {selectedRows.length > 0 ? (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-accent/60 px-3 py-1.5">
            <span className="font-semibold">{selectedRows.length} נבחרו</span>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => bulkPublish(true)}>
              פרסום
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => bulkPublish(false)}>
              הסרה מפרסום
            </Button>
            <select
              aria-label="שינוי סטטוס מכירה לנבחרות"
              className={cn(selectClass, "h-8")}
              value=""
              disabled={bulkBusy}
              onChange={(e) => void bulkStatus(e.target.value)}
            >
              <option value="">שינוי סטטוס מכירה…</option>
              {SALE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SALE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => setDialog("copy")}>
              <Copy />
              העתקת מחירים מיציאה
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => setDialog("promotion")}>
              <Tag />
              הוספת הטבה
            </Button>
            {bulkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            <Button size="sm" variant="ghost" className="ms-auto h-8" onClick={() => setSelected(new Set())}>
              ביטול הבחירה
            </Button>
          </div>
        ) : (
          <>
            <span className="text-muted-foreground">
              {loading && !data ? "טוען…" : `${filtered.length} מתוך ${rows.filter((r) => (showDeleted ? r.is_deleted : !r.is_deleted)).length} יציאות`}
              {!loading && filtered.length > 0 && (
                <>
                  {" · "}
                  {publishedCount} מפורסמות
                  {" · "}
                  <span className={cn(noFlightCount > 0 && "text-destructive")}>{noFlightCount} בלי טיסה חיה</span>
                </>
              )}
            </span>
            {groups.length > 1 && (
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCollapsed(groups.map((g) => g.seriesId))}>
                  כיווץ הכול
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCollapsed([])}>
                  פתיחת הכול
                </Button>
              </span>
            )}
            <Button variant="ghost" size="sm" className="ms-auto h-7 text-xs" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} />
              רענון
            </Button>
          </>
        )}
      </div>

      {error ? (
        <Notice tone="error" className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            ניסיון נוסף
          </Button>
        </Notice>
      ) : (
        <div className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto rounded-lg border bg-card" data-testid="departures-board">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={cn(th, "w-8 ps-2")}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                    aria-label="בחירת כל היציאות שבתצוגה"
                    checked={allVisibleSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className={th}>פרסום</th>
                <th className={th}>קוד</th>
                <th className={th}>תאריכים</th>
                <th className={cn(th, "text-center")}>לילות</th>
                <th className={th}>מסלול</th>
                <th className={th}>עונה</th>
                <th className={th}>סטטוס מכירה</th>
                <th className={th}>תגיות תאריך</th>
                <th className={cn(th, "text-center")}>מטבע</th>
                <th className={cn(th, "text-end")} title="מחיר לאדם בחדר זוגי, ומתחתיו המחיר אחרי הנחה קבועה פעילה">
                  מחיר זוגי
                </th>
                <th className={th}>הטבה פעילה</th>
                <th className={th}>טיסה</th>
                <th className={cn(th, "text-center")} title="מושבים משויכים בבלוקים חיים / נמכרו / יתרה">
                  מושבים
                </th>
                <th className={cn(th, "pe-2")}>Docket</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={COLUMN_COUNT} className="border-b px-3 py-2">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-3 py-16 text-center text-muted-foreground">
                    <p className="mb-3">{rows.length === 0 ? "אין יציאות בשנים שנבחרו." : "אין יציאות שמתאימות לסינון."}</p>
                    {filterCount > 0 && (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        ניקוי הסינון
                      </Button>
                    )}
                  </td>
                </tr>
              ) : (
                groups.map((g) => {
                  const folded = collapsedSet.has(g.seriesId);
                  const groupSelected = g.rows.every((r) => selected.has(r.id));
                  const pkg = g.series?.package_id ? packageById.get(g.series.package_id) : undefined;
                  const live = g.rows.filter((r) => r.is_published).length;
                  return (
                    <Fragment key={g.seriesId}>
                      <tr className="cursor-pointer select-none bg-secondary/80 hover:bg-secondary" data-series={g.series?.code} onClick={() => toggleGroup(g.seriesId)}>
                        <td className="border-b border-t px-1.5 py-1.5 ps-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                            aria-label={`בחירת כל היציאות של ${g.series?.code ?? "הסדרה"}`}
                            checked={groupSelected}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                for (const r of g.rows) {
                                  if (e.target.checked) next.add(r.id);
                                  else next.delete(r.id);
                                }
                                return next;
                              })
                            }
                          />
                        </td>
                        <td colSpan={COLUMN_COUNT - 1} className="border-b border-t px-2 py-1.5">
                          <span className="flex items-center gap-2">
                            {folded ? <ChevronLeft className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            <Ltr className="font-mono text-sm font-bold">{g.series?.code ?? "?"}</Ltr>
                            {g.series?.label && <span className="text-sm font-medium">{g.series.label}</span>}
                            <span className="truncate text-sm text-muted-foreground">{pkg?.name ?? "אין עמוד באתר"}</span>
                            <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">{g.rows.length}</span>
                            {live > 0 && <span className="text-xs text-success">{live} מפורסמות</span>}
                          </span>
                        </td>
                      </tr>
                      {!folded &&
                        g.rows.map((r) => (
                          <BoardRowView
                            key={r.id}
                            row={r}
                            series={g.series}
                            holidays={holidaysById.get(r.id) ?? ""}
                            selected={selected.has(r.id)}
                            busy={busyIds.has(r.id)}
                            isPast={r.end_date < today}
                            today={today}
                            priceEditing={priceEditId === r.id}
                            onSelect={onSelect}
                            onOpen={openCard}
                            onPublish={onPublish}
                            onSaleStatus={onSaleStatus}
                            onLabels={onLabels}
                            onPriceEdit={setPriceEditId}
                            onDoublePrice={onDoublePrice}
                          />
                        ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="tours-date-label-suggestions">
        {options.labels.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="tours-season-suggestions">
        {options.seasons.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <DepartureCard target={cardTarget} tab={tab} onTabChange={setTab} periods={periods} onClose={closeCard} onChanged={onCardChanged} />

      {data && (
        <>
          <NewDepartureDialog
            open={dialog === "new"}
            onOpenChange={(open) => setDialog(open ? "new" : null)}
            series={data.series}
            packages={data.packages}
            periods={periods}
            typicalNights={typicalNights}
            defaultSeriesId={data.series.find((s) => s.code === seriesCode)?.id}
            onCreated={(created) => {
              setCardTarget({ id: created.id, code: created.code });
              setParams({ code: created.code, tab: "" });
              void afterUrlWrite().then(() => refreshRows([created.id]));
            }}
          />
          <PastePricesDialog
            open={dialog === "paste"}
            onOpenChange={(open) => setDialog(open ? "paste" : null)}
            rows={rows}
            onApplied={(result) => void finishBulk("הדבקת מחירים", result)}
          />
          <CopyPricesDialog
            open={dialog === "copy"}
            onOpenChange={(open) => setDialog(open ? "copy" : null)}
            rows={rows}
            targets={selectedRows}
            onApplied={(result) => void finishBulk("העתקת מחירים", result)}
          />
          <BulkPromotionDialog
            open={dialog === "promotion"}
            onOpenChange={(open) => setDialog(open ? "promotion" : null)}
            targets={selectedRows}
            onApplied={(result) => void finishBulk("הוספת הטבה", result)}
          />
        </>
      )}
      <BulkOutcomeDialog title={outcome?.title ?? ""} outcome={outcome?.outcome ?? null} onClose={() => setOutcome(null)} />
    </div>
  );
}
