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
 *
 * `readOnly` is the board of a sales agent (role tours_agent): the server
 * sends it only the departures on sale and only the fields an agent may see,
 * and this component then draws no checkbox, no publish toggle, no docket, no
 * edit in place and no action button; the card opens as DepartureViewCard.
 * The flag only decides what is drawn - every edit action refuses that role
 * on the server whatever the screen shows.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  PlusCircle,
  RefreshCw,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { Chip, Ltr, Notice, selectClass } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionToast } from "@/hooks/use-action-toast";
import { useToast } from "@/hooks/use-toast";
import { afterUrlWrite, useQueryState, useSessionState } from "@/hooks/use-view-state";
import { downloadBase64 } from "@/lib/download";
import { nightsBetween, todayIso } from "@/lib/tours/format";
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
import { DepartureCard } from "./departure-card";
import type { CardTarget } from "./departure-sheet";
import { DepartureViewCard, VIEW_TABS } from "./departure-view-card";
import { doublePricePerPerson, periodLabel, periodsOverlapping } from "./departure-utils";
import type { BoardData, BoardRow, BulkOutcome } from "./types";
import { STICKY_TH, usePublishToast } from "./ui-bits";

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
/** Without the checkbox, the publish toggle and the docket. */
const READ_ONLY_COLUMN_COUNT = 12;

const th = `${STICKY_TH} px-1.5`;

const sortRows = (rows: BoardRow[]): BoardRow[] =>
  [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.code.localeCompare(b.code));

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

export function DeparturesBoard({ readOnly: readOnlyViewer = false }: { readOnly?: boolean } = {}) {
  const thisYear = useMemo(() => Number(todayIso().slice(0, 4)), []);
  const today = useMemo(() => todayIso(), []);
  const run = useActionToast();
  const publishToast = usePublishToast();
  const { toast } = useToast();

  // ---- data
  const [data, setData] = useState<BoardData | null>(null);
  const [rows, setRows] = useState<BoardRow[]>([]);
  // The page says who is looking (the session's role); the server's answer says it again with the data.
  const readOnly = readOnlyViewer || data?.readOnly === true;
  const columnCount = readOnly ? READ_ONLY_COLUMN_COUNT : COLUMN_COUNT;

  // ---- view state: filters in the URL, folded groups in the browser tab
  const [params, setParams] = useQueryState(QUERY_KEYS);
  const { year: yearParam, season, series: seriesCode, page: pageId, status, upcoming, q: query, code: codeParam } = params;
  // Filters of things a read-only viewer never has (drafts, deleted, data gaps) are off for it, link or no link.
  const published = readOnly ? "" : params.published;
  const noFlight = readOnly ? "" : params.noflight;
  const noPrice = readOnly ? "" : params.noprice;
  const deleted = readOnly ? "" : params.deleted;
  const cardTabs = readOnly ? VIEW_TABS : CARD_TABS;
  const tab: CardTab = (cardTabs as readonly string[]).includes(params.tab) ? (params.tab as CardTab) : "general";
  const setTab = useCallback((next: CardTab) => setParams({ tab: next === "general" ? "" : next }), [setParams]);
  const [collapsed, setCollapsed] = useSessionState<string[]>("departures:collapsed", []);

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

  // The filters most screens need stay in sight; the rest fold behind "More filters",
  // which opens by itself while one of them is set.
  const secondaryFilters = [season, seriesCode, pageId, noFlight, noPrice, upcoming, deleted].filter(Boolean).length;
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(secondaryFilters > 0);
  const showMoreFilters = moreFiltersOpen || secondaryFilters > 0;

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
    const result = await run(() => getBoardRows(ids));
    if (!result.success) return;
    const fresh = new Map(result.data.map((r) => [r.id, r]));
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.id));
      const merged = prev.map((r) => fresh.get(r.id) ?? r);
      const added = result.data.filter((r) => !known.has(r.id));
      return added.length ? sortRows([...merged, ...added]) : merged;
    });
  }, [run]);

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
      const result = await run(() => setDeparturesPublished([row.id], next));
      markBusy(row.id, false);
      if (result.success && publishToast(result.data, next, row.code)) patchRow(row.id, { is_published: next });
    },
    [markBusy, patchRow, run, publishToast],
  );

  const onSaleStatus = useCallback(
    async (row: BoardRow, next: SaleStatus) => {
      patchRow(row.id, { sale_status: next });
      const result = await run(() => updateDeparture(row.id, { sale_status: next }), `${row.code}: ${SALE_STATUS_LABELS[next]}`);
      if (!result.success) patchRow(row.id, { sale_status: row.sale_status });
    },
    [patchRow, run],
  );

  const onLabels = useCallback(
    async (row: BoardRow, labels: string[]) => {
      patchRow(row.id, { date_labels: labels });
      const result = await run(() => updateDeparture(row.id, { date_labels: labels }), `${row.code}: date tags updated`);
      if (!result.success) patchRow(row.id, { date_labels: row.date_labels });
    },
    [patchRow, run],
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
      // A plain toast, not useActionToast: Enter has already moved on, so the error must say which row it was.
      if (!result.success) {
        patchRow(row.id, { prices: row.prices });
        toast({ variant: "destructive", title: "Error", description: `${row.code}: ${result.error}`, duration: 7000 });
        return;
      }
      toast({ title: `${row.code}: price updated` });
    },
    [patchRow, toast],
  );

  const onCardChanged = useCallback((id: string) => void refreshRows([id]), [refreshRows]);

  // ---- bulk actions
  const finishBulk = async (title: string, result: BulkOutcome) => {
    await refreshRows(result.done);
    if (result.skipped.length || result.warnings.length) setOutcome({ title, outcome: result });
    else toast({ title: `${title}: ${result.done.length} departures` });
    if (result.skipped.length === 0) setSelected(new Set());
  };

  const bulkPublish = async (next: boolean) => {
    setBulkBusy(true);
    const result = await run(() => setDeparturesPublished(selectedRows.map((r) => r.id), next));
    setBulkBusy(false);
    if (result.success) await finishBulk(next ? "Publish" : "Unpublish", result.data);
  };

  const bulkStatus = async (next: string) => {
    if (!next) return;
    setBulkBusy(true);
    const result = await run(() => setDeparturesSaleStatus(selectedRows.map((r) => r.id), next));
    setBulkBusy(false);
    if (result.success) await finishBulk(`Sale status "${SALE_STATUS_LABELS[next as SaleStatus]}"`, result.data);
  };

  const exportView = async () => {
    setExporting(true);
    const result = await run(() => exportDeparturesXlsx(filtered.map((r) => r.id)), () => `Exported ${filtered.length} departures`);
    setExporting(false);
    if (result.success) downloadBase64(result.data.base64, result.data.filename);
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
    <div className="min-w-0">
      <PageHeader
        title="Tours"
        description={
          readOnly
            ? "The departures on sale, grouped by series: dates, route, price, promotions, flight and seats left. Click a departure code for its full details."
            : "Every departure date of every tour, grouped by series. Publish, set the sale status, date tags and double-room price right in the row; click a code for the full departure card."
        }
        actions={
          readOnly ? (
            <Chip className="gap-1 px-2.5 py-1 text-xs" title="This account can't edit">
              <Eye className="h-3.5 w-3.5" />
              View only
            </Chip>
          ) : (
          <>
            <PublishSiteButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="More actions">
                  {exporting ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link href="/tours/series">
                    <Copy />
                    Series &amp; Seasons
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("paste")} disabled={!data}>
                  <ClipboardPaste />
                  Paste Prices
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportView()} disabled={exporting || filtered.length === 0}>
                  <Download />
                  Export to Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setDialog("new")} disabled={!data}>
              <PlusCircle />
              Add Departure
            </Button>
          </>
          )
        }
      />

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          dir="ltr"
          aria-label="Search by code"
          placeholder="Search code"
          wrapperClassName="w-40 sm:w-40"
          className="font-mono placeholder:font-sans"
          value={query}
          onValueChange={(q) => setParams({ q })}
        />
        <select aria-label="Year" className={selectClass} value={yearParam} onChange={(e) => setParams({ year: e.target.value })}>
          <option value="">
            {thisYear} + {thisYear + 1}
          </option>
          {yearOptions.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
          <option value="all">All years</option>
        </select>
        <select aria-label="Sale status" className={selectClass} value={status} onChange={(e) => setParams({ status: e.target.value })}>
          <option value="">All sale statuses</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SALE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {!readOnly && (
          <select aria-label="Published" className={selectClass} value={published} onChange={(e) => setParams({ published: e.target.value })}>
            <option value="">Published + draft</option>
            <option value="yes">Published</option>
            <option value="no">Draft</option>
          </select>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          aria-expanded={showMoreFilters}
          onClick={() => setMoreFiltersOpen((open) => !open)}
          disabled={secondaryFilters > 0}
        >
          <SlidersHorizontal />
          More filters{secondaryFilters > 0 ? ` (${secondaryFilters})` : ""}
        </Button>
        {filterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X />
            Clear
          </Button>
        )}
        {showMoreFilters && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <select aria-label="Season" className={selectClass} value={season} onChange={(e) => setParams({ season: e.target.value })}>
              <option value="">All seasons</option>
              {season && !options.seasons.includes(season) && <option value={season}>{season}</option>}
              {options.seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select aria-label="Series" className={selectClass} value={seriesCode} onChange={(e) => setParams({ series: e.target.value })}>
              <option value="">All series</option>
              {seriesCode && !options.series.some((s) => s.code === seriesCode) && <option value={seriesCode}>{seriesCode}</option>}
              {options.series.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.code}
                  {s.label ? ` · ${s.label}` : ""}
                </option>
              ))}
            </select>
            <select aria-label="Tour page" className={cn(selectClass, "max-w-56")} value={pageId} onChange={(e) => setParams({ page: e.target.value })}>
              <option value="">All tour pages</option>
              {options.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!readOnly && (
              <>
                <FilterToggle label="No live flight" tone="bad" active={noFlight === "1"} onChange={(v) => setParams({ noflight: v ? "1" : "" })} />
                <FilterToggle label="No price" tone="bad" active={noPrice === "1"} onChange={(v) => setParams({ noprice: v ? "1" : "" })} />
              </>
            )}
            <FilterToggle label="Upcoming only" active={upcoming === "1"} onChange={(v) => setParams({ upcoming: v ? "1" : "" })} />
            {!readOnly && <FilterToggle label="Deleted" active={showDeleted} onChange={(v) => setParams({ deleted: v ? "1" : "" })} />}
          </div>
        )}
      </div>

      {/* summary + bulk bar */}
      <div className="mb-2 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {selectedRows.length > 0 ? (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-accent/60 px-3 py-1.5">
            <span className="font-semibold">{selectedRows.length} selected</span>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => bulkPublish(true)}>
              Publish
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => bulkPublish(false)}>
              Unpublish
            </Button>
            <select
              aria-label="Set the sale status of the selected departures"
              className={cn(selectClass, "h-8")}
              value=""
              disabled={bulkBusy}
              onChange={(e) => void bulkStatus(e.target.value)}
            >
              <option value="">Set sale status…</option>
              {SALE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SALE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => setDialog("copy")}>
              <Copy />
              Copy Prices
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy} onClick={() => setDialog("promotion")}>
              <Tag />
              Add Promotion
            </Button>
            {bulkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            <Button size="sm" variant="ghost" className="ms-auto h-8" onClick={() => setSelected(new Set())}>
              Clear Selection
            </Button>
          </div>
        ) : (
          <>
            <span className="text-muted-foreground">
              {loading && !data
                ? "Loading…"
                : `${filtered.length} of ${rows.filter((r) => (showDeleted ? r.is_deleted : !r.is_deleted)).length} departures${readOnly ? " on sale" : ""}`}
              {!loading && !readOnly && filtered.length > 0 && (
                <>
                  {" · "}
                  {publishedCount} published
                  {" · "}
                  <span className={cn(noFlightCount > 0 && "text-destructive")}>{noFlightCount} with no live flight</span>
                </>
              )}
            </span>
            {groups.length > 1 && (
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCollapsed(groups.map((g) => g.seriesId))}>
                  Collapse all
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCollapsed([])}>
                  Expand all
                </Button>
              </span>
            )}
            <Button variant="ghost" size="sm" className="ms-auto h-7 text-xs" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
          </>
        )}
      </div>

      {error ? (
        <Notice tone="error" className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try Again
          </Button>
        </Notice>
      ) : (
        <div className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto rounded-lg border bg-card" data-testid="departures-board">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {!readOnly && (
                  <th className={cn(th, "w-8 ps-2")}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                      aria-label="Select every departure in view"
                      checked={allVisibleSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())}
                    />
                  </th>
                )}
                {!readOnly && <th className={th}>Published</th>}
                <th className={cn(th, readOnly && "ps-3")}>Code</th>
                <th className={th}>Dates</th>
                <th className={cn(th, "text-center")}>Nights</th>
                <th className={th}>Route</th>
                <th className={th}>Season</th>
                <th className={th}>Sale status</th>
                <th className={th}>Date tags</th>
                <th className={cn(th, "text-center")}>Currency</th>
                <th className={cn(th, "text-end")} title="Price per person in a double room; below it, the price after an active fixed discount">
                  Double-room price
                </th>
                <th className={th}>Active promotion</th>
                <th className={th}>Flight</th>
                <th
                  className={cn(th, "text-center", readOnly && "pe-2")}
                  title={readOnly ? "Seats on confirmed flights / Sold / Left" : "Allocated on live blocks / Sold / Left"}
                >
                  Seats
                </th>
                {!readOnly && <th className={cn(th, "pe-2")}>Docket</th>}
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={columnCount} className="border-b px-3 py-2">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-16 text-center text-muted-foreground">
                    <p className="mb-3">
                      {rows.length === 0
                        ? readOnly
                          ? "No departures on sale in the selected years."
                          : "No departures in the selected years."
                        : "No departures match the filters."}
                    </p>
                    {filterCount > 0 && (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear Filters
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
                        {!readOnly && (
                          <td className="border-b border-t px-1.5 py-1.5 ps-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                              aria-label={`Select every departure of ${g.series?.code ?? "the series"}`}
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
                        )}
                        <td colSpan={readOnly ? columnCount : columnCount - 1} className="border-b border-t px-2 py-1.5">
                          <span className="flex items-center gap-2">
                            {folded ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            <Ltr className="font-mono text-sm font-bold">{g.series?.code ?? "?"}</Ltr>
                            {g.series?.label && <span className="text-sm font-medium">{g.series.label}</span>}
                            <span className="truncate text-sm text-muted-foreground">{pkg?.name ?? "No tour page"}</span>
                            <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">{g.rows.length}</span>
                            {live > 0 && !readOnly && <span className="text-xs text-success">{live} published</span>}
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
                            readOnly={readOnly}
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

      {readOnly ? (
        <DepartureViewCard target={cardTarget} tab={tab} onTabChange={setTab} periods={periods} onClose={closeCard} />
      ) : (
        <DepartureCard target={cardTarget} tab={tab} onTabChange={setTab} periods={periods} onClose={closeCard} onChanged={onCardChanged} />
      )}

      {data && !readOnly && (
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
            onApplied={(result) => void finishBulk("Paste Prices", result)}
          />
          <CopyPricesDialog
            open={dialog === "copy"}
            onOpenChange={(open) => setDialog(open ? "copy" : null)}
            rows={rows}
            targets={selectedRows}
            onApplied={(result) => void finishBulk("Copy Prices", result)}
          />
          <BulkPromotionDialog
            open={dialog === "promotion"}
            onOpenChange={(open) => setDialog(open ? "promotion" : null)}
            targets={selectedRows}
            onApplied={(result) => void finishBulk("Add Promotion", result)}
          />
        </>
      )}
      <BulkOutcomeDialog title={outcome?.title ?? ""} outcome={outcome?.outcome ?? null} onClose={() => setOutcome(null)} />
    </div>
  );
}
