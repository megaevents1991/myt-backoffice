"use client";

/**
 * The Pricing sheet: every sub-tour of the organized tours in one spreadsheet,
 * the tour's name as a header row and its sub-tours under it (mega-family
 * docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 4-6). Tours > Pricing shows all the
 * tours; a tour page's Dates & Prices tab shows the same sheet for that tour.
 *
 * Edits stay in the sheet, marked, until Save (Dor, 03.10.2026): click or arrow
 * to a cell, type, Enter; paste a block from Excel or Google Sheets; tick rows
 * and "Set for selected". Save sends the changed cells with the value they had
 * when the sheet was loaded, so a row someone else changed meanwhile is skipped
 * and named. Model and parsing: ./sheet-model.ts. Server: tours-pricing-sheet-actions.ts.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { ExternalLink, ListChecks, Loader2, RotateCcw, Save, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useActionData } from "@/hooks/use-action-data";
import { useToast } from "@/hooks/use-toast";
import { LoadError, Ltr, Notice, selectClass, Toggle } from "@/components/tours/ui";
import { SaleStatusBadge } from "@/components/tours/departures/ui-bits";
import { getPricingSheet, savePricingSheet } from "@/lib/actions/tours-pricing-sheet-actions";
import { fmtDateRange, fmtPrice, nightsBetween } from "@/lib/tours/format";
import { departureHref, linkClass } from "@/lib/tours/links";
import { CURRENCIES, SALE_STATUSES, SALE_STATUS_LABELS } from "@/types/tours.types";
import {
  adjustNumber,
  cellValue,
  columnByKey,
  columnsFor,
  displayText,
  editText,
  isEditable,
  parseCell,
  pasteBlock,
  rowChanges,
  sameValue,
  SHEET_COLUMNS,
  type SheetColumn,
  type SheetRow,
  type SheetSaveOutcome,
  type SheetValue,
  type SheetView,
} from "./sheet-model";

type Edits = Record<string, Record<string, SheetValue>>;
type CellRef = { id: string; key: string };
const cellId = (id: string, key: string) => `${id}|${key}`;
const NUMERIC = new Set(["price", "money", "int"]);
const CHECK_WIDTH = 36;
const CODE_WIDTH = 110;

export function PricingSheet({
  packageId,
  focusTour,
  onSaved,
  refreshKey = 0,
}: {
  /** One tour's sheet (its page); all organized tours when absent. */
  packageId?: string;
  /** Tours > Pricing opened for one tour (?tour=): the filter starts there, and can be cleared. */
  focusTour?: string | null;
  /** After a save that changed something (the tour page refreshes its Ready for the Site list). */
  onSaved?: () => void;
  /** Bumped by the host when dates were added elsewhere: the rows reload, unsaved edits stay. */
  refreshKey?: number;
}) {
  const { toast } = useToast();
  const [includePast, setIncludePast] = useState(false);
  const sheet = useActionData(() => getPricingSheet({ packageId, includePast }), [packageId, includePast]);
  const data = sheet.data;

  const [view, setView] = useState<SheetView>("prices");
  const [search, setSearch] = useState("");
  const [season, setSeason] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyDrafts, setOnlyDrafts] = useState(false);
  const [tourFilter, setTourFilter] = useState<string | null>(focusTour ?? null);

  const [edits, setEdits] = useState<Edits>({});
  /** Text typed into a cell that means nothing (shown red, blocks Save). */
  const [bad, setBad] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<(CellRef & { text: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState<SheetSaveOutcome["skipped"]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const rowsById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  const columns = useMemo(() => columnsFor(view), [view]);
  const seasons = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.season).filter((s): s is string => !!s))].sort(),
    [data],
  );
  const tourName = useMemo(() => new Map((data?.tours ?? []).map((t) => [t.id, t.name])), [data]);

  // --- what is shown: tour groups in order, each with its filtered rows
  const groups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const keep = (r: SheetRow) =>
      (!tourFilter || r.packageId === tourFilter) &&
      (!season || r.season === season) &&
      (!onlyMissing || r.prices[1] == null) &&
      (!onlyDrafts || !r.isPublished) &&
      (!q || r.code.toLowerCase().includes(q) || (tourName.get(r.packageId) ?? "").toLowerCase().includes(q));
    return data.tours
      .map((tour) => ({ tour, rows: data.rows.filter((r) => r.packageId === tour.id && keep(r)) }))
      .filter((g) => g.rows.length > 0);
  }, [data, search, season, onlyMissing, onlyDrafts, tourFilter, tourName]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  const valueOf = (row: SheetRow, key: string): SheetValue => {
    const e = edits[row.id];
    return e && key in e ? e[key] : cellValue(row, key);
  };
  const changes = useMemo(() => rowChanges(rowsById, edits), [rowsById, edits]);
  const changedCells = changes.reduce((n, c) => n + Object.keys(c.cells).length, 0);
  const badCount = Object.keys(bad).length;
  const dirty = changedCells > 0 || badCount > 0;

  const firstKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== firstKey.current) void sheet.reload({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the host asks
  }, [refreshKey]);

  // leaving with unsaved edits asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // the active cell stays in view
  useEffect(() => {
    if (!active) return;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(cellId(active.id, active.key))}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // --- writing cells
  const setCell = (id: string, key: string, value: SheetValue) => {
    const row = rowsById.get(id);
    if (!row) return;
    setEdits((prev) => {
      const cells = { ...(prev[id] ?? {}) };
      if (sameValue(value, cellValue(row, key))) delete cells[key];
      else cells[key] = value;
      const next = { ...prev };
      if (Object.keys(cells).length) next[id] = cells;
      else delete next[id];
      return next;
    });
    setBad((prev) => {
      if (!(cellId(id, key) in prev)) return prev;
      const next = { ...prev };
      delete next[cellId(id, key)];
      return next;
    });
  };
  /** Text typed or pasted into a cell: its value, or kept red when it means nothing. */
  const writeText = (id: string, col: SheetColumn, text: string) => {
    if (!isEditable(col)) return;
    const parsed = parseCell(col, text);
    if ("error" in parsed) setBad((prev) => ({ ...prev, [cellId(id, col.key)]: text }));
    else setCell(id, col.key, parsed.value);
  };

  // --- moving around
  const move = (dRow: number, dCol: number) => {
    if (!flat.length || !columns.length) return;
    const r0 = active ? flat.findIndex((r) => r.id === active.id) : 0;
    const c0 = active ? columns.findIndex((c) => c.key === active.key) : 0;
    const r = Math.min(flat.length - 1, Math.max(0, (r0 < 0 ? 0 : r0) + dRow));
    const c = Math.min(columns.length - 1, Math.max(0, (c0 < 0 ? 0 : c0) + dCol));
    setActive({ id: flat[r].id, key: columns[c].key });
  };
  const focusGrid = () => requestAnimationFrame(() => gridRef.current?.focus());

  const startEdit = (ref: CellRef, typed?: string) => {
    const col = columnByKey.get(ref.key);
    const row = rowsById.get(ref.id);
    if (!col || !row || !isEditable(col)) return;
    if (col.kind === "bool") {
      setCell(ref.id, ref.key, !(valueOf(row, ref.key) === true));
      return;
    }
    const pending = bad[cellId(ref.id, ref.key)];
    setEditing({ ...ref, text: typed ?? pending ?? editText(col, valueOf(row, ref.key)) });
  };
  const commit = (then?: () => void) => {
    if (!editing) return;
    const col = columnByKey.get(editing.key);
    if (col) writeText(editing.id, col, editing.text);
    setEditing(null);
    then?.();
    focusGrid();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    const keys: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (keys[e.key]) {
      e.preventDefault();
      move(...keys[e.key]);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
      return;
    }
    if (!active) return;
    const col = columnByKey.get(active.key);
    if (!col || !isEditable(col)) return;
    if (e.key === "Enter" || e.key === "F2" || (e.key === " " && col.kind === "bool")) {
      e.preventDefault();
      startEdit(active);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (col.kind === "bool") setCell(active.id, active.key, false);
      else if (col.kind !== "status" && col.kind !== "currency") writeText(active.id, col, "");
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && col.kind !== "bool") {
      e.preventDefault();
      startEdit(active, col.kind === "status" || col.kind === "currency" ? undefined : e.key);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !active) return;
    const block = pasteBlock(e.clipboardData.getData("text/plain"));
    if (!block.length) return;
    e.preventDefault();
    const r0 = flat.findIndex((r) => r.id === active.id);
    const c0 = columns.findIndex((c) => c.key === active.key);
    if (r0 < 0 || c0 < 0) return;
    // one value onto ticked rows: the same column of each
    if (block.length === 1 && block[0].length === 1 && selected.size > 1 && selected.has(active.id)) {
      const col = columns[c0];
      for (const id of selected) writeText(id, col, block[0][0]);
      return;
    }
    block.forEach((cells, dr) => {
      const row = flat[r0 + dr];
      if (!row) return;
      cells.forEach((text, dc) => {
        const col = columns[c0 + dc];
        if (col) writeText(row.id, col, text);
      });
    });
  };
  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !active) return;
    const row = rowsById.get(active.id);
    const col = columnByKey.get(active.key);
    if (!row || !col) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", isEditable(col) ? editText(col, valueOf(row, col.key)) : readonlyText(row, col.key));
  };

  // --- selection
  const toggleRows = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const allShown = flat.map((r) => r.id);
  const allTicked = allShown.length > 0 && allShown.every((id) => selected.has(id));

  // --- save / discard
  const discard = () => {
    setEdits({});
    setBad({});
    setSkipped([]);
    setEditing(null);
  };
  const save = async () => {
    if (saving) return;
    if (badCount) {
      toast({ variant: "destructive", title: "Fix the red cells first", description: `${badCount} cell(s) hold a value that means nothing.` });
      return;
    }
    if (!changes.length) return;
    setSaving(true);
    try {
      const res = await savePricingSheet(changes);
      if (!res.success) {
        toast({ variant: "destructive", title: "Not saved", description: res.error });
        return;
      }
      const { saved, skipped: notSaved, rows } = res.data;
      const fresh = new Map(rows.map((r) => [r.id, r]));
      sheet.setData((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => fresh.get(r.id) ?? r) } : prev));
      setEdits((prev) => {
        const next = { ...prev };
        for (const id of saved) delete next[id];
        return next;
      });
      setSkipped(notSaved);
      if (saved.length || rows.length) onSaved?.();
      toast({
        variant: notSaved.length ? "destructive" : "default",
        title: notSaved.length ? `${saved.length} saved, ${notSaved.length} not` : `${saved.length} sub-tour(s) saved`,
        description: notSaved.length ? "The rows not saved are listed above the sheet, with the reason." : undefined,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Not saved", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setSaving(false);
    }
  };

  // --- render
  if (sheet.error && !data) return <LoadError message={sheet.error} onRetry={() => void sheet.reload()} />;
  if (!data) return <Skeleton className="h-96 w-full" />;

  const editableCols = SHEET_COLUMNS.filter(isEditable);
  const width = CHECK_WIDTH + CODE_WIDTH + columns.reduce((n, c) => n + c.width, 0);

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Columns">
          {(["prices", "details"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "prices" ? "Prices" : "Details"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={packageId ? "Code" : "Tour or code"}
            className="h-9 w-48 ps-8"
          />
        </div>
        {seasons.length > 0 && (
          <select className={selectClass} value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
            <option value="">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {!packageId && tourFilter && (
          <Button size="sm" variant="secondary" onClick={() => setTourFilter(null)}>
            {tourName.get(tourFilter) ?? "One tour"} ✕
          </Button>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={onlyMissing} onCheckedChange={(v) => setOnlyMissing(v === true)} />
          No double price
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={onlyDrafts} onCheckedChange={(v) => setOnlyDrafts(v === true)} />
          Not on the site
        </label>
        <label className="flex items-center gap-1.5 text-sm" title={dirty ? "Save or discard your changes first" : undefined}>
          <Toggle checked={includePast} onChange={setIncludePast} disabled={dirty} label="Show past dates" size="sm" />
          Past dates
        </label>
        <div className="ms-auto flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
            <ListChecks />
            Set for selected{selected.size ? ` (${selected.size})` : ""}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={dirty || sheet.loading}
            title={dirty ? "Save or discard your changes first" : "Load the sheet again"}
            onClick={() => void sheet.reload()}
          >
            <RotateCcw />
            Reload
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Click a cell and type, or paste a block from Excel / Google Sheets. Enter or double-click edits, Delete clears,
        arrows and Tab move. Prices are per person and final - the flight column is its cost, for the margin. Nothing is
        saved until you press Save.
      </p>

      {skipped.length > 0 && (
        <Notice tone="warning">
          <span className="font-medium">Not saved:</span>
          <ul className="mt-1 list-disc ps-5">
            {skipped.map((s) => (
              <li key={s.id}>
                <Ltr className="font-mono">{s.code || "?"}</Ltr> - {s.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/* the sheet */}
      {groups.length === 0 ? (
        <Notice>
          {packageId && data.rows.length === 0 ? (
            <>
              No dates yet. Dates come from a flight series: Offline Flights &gt;{" "}
              <Link href="/offline-flights/series/new" className={linkClass}>
                New Series
              </Link>
              , tick &ldquo;Organized tour&rdquo; and give this tour&apos;s code.
            </>
          ) : (
            "No sub-tours match. Clear the filters, or show past dates."
          )}
        </Notice>
      ) : (
        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCopy={onCopy}
          className="max-h-[70vh] overflow-auto rounded-md border bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Pricing sheet"
          dir="ltr"
        >
          <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width }}>
            <colgroup>
              <col style={{ width: CHECK_WIDTH }} />
              <col style={{ width: CODE_WIDTH }} />
              {columns.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-muted text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-30 border-b border-r bg-muted px-2 py-2">
                  <Checkbox
                    checked={allTicked}
                    onCheckedChange={(v) => toggleRows(allShown, v === true)}
                    aria-label="Select every row shown"
                  />
                </th>
                <th className="sticky z-30 border-b border-r bg-muted px-2 py-2 text-left" style={{ left: CHECK_WIDTH }}>
                  Code
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    title={c.title ?? c.label}
                    className={cn(
                      "truncate border-b border-r px-2 py-2",
                      NUMERIC.has(c.kind) || c.key === "flightCost" ? "text-right" : "text-left",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ tour, rows }) => {
                const ids = rows.map((r) => r.id);
                const ticked = ids.length > 0 && ids.every((id) => selected.has(id));
                return (
                  <Fragment key={tour.id}>
                    <tr>
                      <td className="sticky left-0 z-10 border-b border-r bg-muted px-2 py-1.5">
                        <Checkbox
                          checked={ticked}
                          onCheckedChange={(v) => toggleRows(ids, v === true)}
                          aria-label={`Select the dates of ${tour.name}`}
                        />
                      </td>
                      <td colSpan={columns.length + 1} className="border-b bg-muted px-2 py-1.5">
                        <div className="sticky flex w-fit items-center gap-2" style={{ left: CHECK_WIDTH + 8 }}>
                          <span className="font-semibold" dir="auto">
                            {tour.name}
                          </span>
                          <Ltr className="font-mono text-xs text-muted-foreground">{tour.codes.join(" · ")}</Ltr>
                          <span className="text-xs text-muted-foreground">{rows.length} date(s)</span>
                          {!tour.isActive && (
                            <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Draft tour
                            </span>
                          )}
                          {!packageId && (
                            <Link
                              href={`/tours/packages/${tour.id}?tab=dates`}
                              target="_blank"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              Tour page
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1">
                          <Checkbox
                            checked={selected.has(row.id)}
                            onCheckedChange={(v) => toggleRows([row.id], v === true)}
                            aria-label={`Select ${row.code}`}
                          />
                        </td>
                        <td
                          className="sticky z-10 truncate border-b border-r bg-card px-2 py-1 font-mono text-xs font-semibold"
                          style={{ left: CHECK_WIDTH }}
                        >
                          <Link href={departureHref(row.code)} target="_blank" className={linkClass} title="Open the sub-tour's card">
                            {row.code}
                          </Link>
                        </td>
                        {columns.map((col) => {
                          const key = cellId(row.id, col.key);
                          const isActive = active?.id === row.id && active.key === col.key;
                          const isEditing = editing?.id === row.id && editing.key === col.key;
                          const wrong = bad[key];
                          const changed = wrong === undefined && isEditable(col) && !!edits[row.id] && col.key in edits[row.id];
                          return (
                            <td
                              key={col.key}
                              data-cell={key}
                              onMouseDown={(e) => {
                                if (isEditing) return;
                                e.preventDefault();
                                setActive({ id: row.id, key: col.key });
                                gridRef.current?.focus();
                              }}
                              onDoubleClick={() => startEdit({ id: row.id, key: col.key })}
                              title={wrong !== undefined ? parseErrorOf(col, wrong) : undefined}
                              className={cn(
                                "h-8 truncate border-b border-r px-2",
                                NUMERIC.has(col.kind) || col.key === "flightCost" ? "text-right tabular-nums" : "text-left",
                                !isEditable(col) && "bg-muted/30 text-muted-foreground",
                                changed && "bg-amber-50 font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                                wrong !== undefined && "bg-destructive/10 text-destructive",
                                isActive && "outline outline-2 -outline-offset-2 outline-primary",
                              )}
                            >
                              {isEditing && editing ? (
                                <CellEditor
                                  col={col}
                                  text={editing.text}
                                  onText={(text) => setEditing({ ...editing, text })}
                                  onDone={(how) => {
                                    if (how === "cancel") {
                                      setEditing(null);
                                      focusGrid();
                                    } else {
                                      commit(() => move(how === "down" ? 1 : 0, how === "right" ? 1 : how === "left" ? -1 : 0));
                                    }
                                  }}
                                />
                              ) : wrong !== undefined ? (
                                wrong
                              ) : col.key === "saleStatus" ? (
                                <SaleStatusBadge status={String(valueOf(row, col.key))} />
                              ) : isEditable(col) ? (
                                displayText(col, valueOf(row, col.key))
                              ) : (
                                readonlyText(row, col.key)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* save bar */}
      {dirty && (
        <div className="sticky bottom-3 z-30 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="text-sm">
            <span className="font-semibold">{changedCells}</span> change(s) in{" "}
            <span className="font-semibold">{changes.length}</span> sub-tour(s)
            {badCount > 0 && <span className="ms-2 text-destructive">· {badCount} red cell(s) to fix</span>}
          </span>
          <div className="ms-auto flex gap-2">
            <Button variant="ghost" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button onClick={() => void save()} disabled={saving || badCount > 0 || changes.length === 0}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save
            </Button>
          </div>
        </div>
      )}

      <SetForSelected
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        count={selected.size}
        columns={editableCols}
        onApply={(col, mode, text) => {
          for (const id of selected) {
            const row = rowsById.get(id);
            if (!row) continue;
            if (mode === "set") {
              writeText(id, col, text);
            } else {
              const current = valueOf(row, col.key);
              setCell(id, col.key, adjustNumber(typeof current === "number" ? current : null, mode, Number(text.replace(/[,\s]/g, ""))));
            }
          }
          setBulkOpen(false);
          focusGrid();
        }}
      />
    </div>
  );
}

/** The text of a read-only cell. */
function readonlyText(row: SheetRow, key: string): string {
  switch (key) {
    case "dates":
      return `${fmtDateRange(row.startDate, row.endDate)} · ${nightsBetween(row.startDate, row.endDate) ?? "?"}n`;
    case "route":
      return row.route;
    case "seats":
      return row.seats.allocated ? `${row.seats.sold}/${row.seats.allocated}` : "-";
    case "flightCost":
      return row.flightCost
        ? `${fmtPrice(row.flightCost.amount, row.flightCost.currency)}${row.flightCost.more ? ` +${row.flightCost.more}` : ""}`
        : "";
    default:
      return "";
  }
}

const parseErrorOf = (col: SheetColumn, text: string): string => {
  const parsed = parseCell(col, text);
  return "error" in parsed ? parsed.error : "";
};

/** The input inside a cell being edited: text for most, a list for status and currency. */
function CellEditor({
  col,
  text,
  onText,
  onDone,
}: {
  col: SheetColumn;
  text: string;
  onText: (text: string) => void;
  onDone: (how: "down" | "right" | "left" | "stay" | "cancel") => void;
}) {
  // One ending per edit: a blur that follows Enter or Escape must not save again (or save a cancelled text).
  const ended = useRef(false);
  const end = (how: "down" | "right" | "left" | "stay" | "cancel") => {
    if (ended.current) return;
    ended.current = true;
    onDone(how);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      end("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      end(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      end("cancel");
    }
  };
  const cls = "h-7 w-full rounded-sm border border-primary bg-background px-1 text-sm focus:outline-none";
  if (col.kind === "status" || col.kind === "currency") {
    const options =
      col.kind === "status"
        ? SALE_STATUSES.map((s) => ({ value: s as string, label: SALE_STATUS_LABELS[s] }))
        : CURRENCIES.map((c) => ({ value: c as string, label: c as string }));
    return (
      <select
        autoFocus
        className={cls}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={keys}
        onBlur={() => end("stay")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      autoFocus
      className={cn(cls, NUMERIC.has(col.kind) && "text-right")}
      dir={col.kind === "text" || col.kind === "labels" ? "auto" : "ltr"}
      value={text}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={keys}
      onBlur={() => end("stay")}
    />
  );
}

/** Set one column of every ticked row: a value, or for numbers an amount or a percent to add. */
function SetForSelected({
  open,
  onOpenChange,
  count,
  columns,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  columns: SheetColumn[];
  onApply: (col: SheetColumn, mode: "set" | "add" | "percent", text: string) => void;
}) {
  const [key, setKey] = useState(columns.find((c) => c.key === "price1")?.key ?? columns[0]?.key ?? "");
  const [mode, setMode] = useState<"set" | "add" | "percent">("set");
  const [text, setText] = useState("");
  const col = columns.find((c) => c.key === key);
  const numeric = !!col && NUMERIC.has(col.kind);
  const problem = !col
    ? "Choose a column"
    : mode === "set"
      ? parseErrorOf(col, text) || null
      : text.trim() === "" || !Number.isFinite(Number(text.replace(/[,\s]/g, "")))
        ? "Type a number"
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set for {count} selected sub-tour(s)</DialogTitle>
          <DialogDescription>The change is marked in the sheet; nothing is saved until you press Save.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            Column
            <select
              className={selectClass}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setMode("set");
              }}
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title ? `${c.label} - ${c.title}` : c.label}
                </option>
              ))}
            </select>
          </label>
          {numeric && (
            <div className="inline-flex w-fit rounded-md border p-0.5 text-sm">
              {(
                [
                  ["set", "Set to"],
                  ["add", "Add"],
                  ["percent", "Add %"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn("rounded px-3 py-1", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <label className="grid gap-1 text-sm">
            {mode === "set" ? "Value" : mode === "add" ? "Amount to add (negative lowers)" : "Percent to add (negative lowers)"}
            <Input
              dir="ltr"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                col?.kind === "bool"
                  ? "yes / no"
                  : col?.kind === "status"
                    ? "Open / Guaranteed / Last places / Sold out / Closed"
                    : col?.kind === "labels"
                      ? "label, label"
                      : col?.kind === "datetime"
                        ? "2026-07-03 05:30"
                        : ""
              }
            />
            {text !== "" && problem && <span className="text-xs text-destructive">{problem}</span>}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!!problem || !col} onClick={() => col && onApply(col, mode, text)}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
