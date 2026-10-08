"use client";

/**
 * The spreadsheet grid of the tours sheets: rows in groups (a tour and its
 * sub-tours, a flight series and its flights) with a header row per group,
 * edited the way Google Sheets is - click or arrow to a cell and type, Enter /
 * F2 / double-click to edit, Delete to clear, paste a block from Excel or
 * Sheets, tick rows and "Set for selected". Edits stay in the grid, marked,
 * until Save; Save hands the changed cells (with the value each had when the
 * sheet was loaded) to the host, which answers which rows were saved.
 *
 * Alon, 08.10.2026: a cell that was opened by typing closes on an arrow and
 * moves (as in Sheets); a range is picked with Shift + arrows, Shift + click or
 * by dragging - Delete clears it, Ctrl+C copies it, Ctrl+D fills it down from
 * its first row, a paste of one value fills it; the small square at the
 * range's corner (the fill handle) drags the values onto the rows below or
 * above. "Set for selected" sets several columns in one go.
 *
 * The grid knows nothing about what a row is: the host gives the columns of the
 * view, the value of a cell, the text of a read-only cell and the first sticky
 * cell of a row. Model and parsing: ./sheet-core.ts. Hosts: the departures /
 * pricing sheet (components/tours/pricing/pricing-sheet.tsx) and the flights
 * sheet (components/tours/flights/flights-sheet.tsx).
 */
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ListChecks, Loader2, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Ltr, Notice, selectClass } from "@/components/tours/ui";
import {
  adjustNumber,
  changesOf,
  displayText,
  editText,
  isEditable,
  NUMERIC_KINDS,
  parseCell,
  pasteBlock,
  RIGHT_ALIGNED_KINDS,
  sameValue,
  type SheetColumn,
  type SheetEdits,
  type SheetOption,
  type SheetRowChange,
  type SheetSaveResult,
  type SheetValue,
} from "./sheet-core";

type CellRef = { id: string; key: string };
const cellId = (id: string, key: string) => `${id}|${key}`;
const CHECK_WIDTH = 36;

/** A rectangle of cells, by row and column index in the sheet as shown. */
type Range = { r1: number; r2: number; c1: number; c2: number };

export interface SheetGroup<R> {
  key: string;
  /** What the group's header row shows after its checkbox. */
  header: ReactNode;
  /** The checkbox's name for screen readers, e.g. "Select the dates of ...". */
  selectLabel: string;
  rows: R[];
}

export type SheetSaveAnswer = ({ ok: true } & SheetSaveResult) | { ok: false; error: string };

/** One column of "Set for selected": a value, or for numbers an amount or a percent to add. */
export interface BulkEntry {
  key: string;
  mode: "set" | "add" | "percent";
  text: string;
}

export interface SheetGridProps<R extends { id: string }> {
  /** The columns of the view in sight, in order. */
  columns: SheetColumn[];
  /** Every column of the sheet (an edit of a column of another view is still kept and saved). */
  allColumns: SheetColumn[];
  groups: SheetGroup<R>[];
  /** Every loaded row, shown or filtered out - edits of a row out of sight are still saved. */
  rowsById: Map<string, R>;
  cellValue: (row: R, key: string) => SheetValue;
  /** The text of a read-only cell (also what Copy takes from it). */
  readonlyText: (row: R, key: string) => string;
  /** Draw a cell some other way than its text (a badge, a link); undefined = the text. */
  renderCell?: (row: R, col: SheetColumn, value: SheetValue) => ReactNode | undefined;
  /** The list of a choice column whose options depend on the row. */
  optionsOf?: (row: R, col: SheetColumn) => readonly SheetOption[] | undefined;
  /** A cell of an editable column that this row may not edit (shown as read-only). */
  lockedCell?: (row: R, col: SheetColumn) => boolean;
  /** The first, sticky cell of a row: its code, linked to its card. */
  rowHead: (row: R) => ReactNode;
  /** How a row is called in the checkbox labels (its code). */
  rowName: (row: R) => string;
  headLabel: string;
  headWidth?: number;
  /** "sub-tour" / "flight" - the word the save bar and the toasts count. */
  noun: string;
  ariaLabel: string;
  /** Shown instead of the grid when no group has rows. */
  empty: ReactNode;
  /** Filters and view switch, left of the grid's own buttons. */
  filters?: ReactNode;
  /** Buttons after "Set for selected". */
  actions?: ReactNode;
  hint?: ReactNode;
  save: (changes: SheetRowChange[]) => Promise<SheetSaveAnswer>;
  /** The grid holds unsaved edits (the host locks what would lose them). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Which column Set for Selected opens on. */
  bulkDefaultKey?: string;
}

export function SheetGrid<R extends { id: string }>({
  columns,
  allColumns,
  groups,
  rowsById,
  cellValue,
  readonlyText,
  renderCell,
  optionsOf,
  lockedCell,
  rowHead,
  rowName,
  headLabel,
  headWidth = 110,
  noun,
  ariaLabel,
  empty,
  filters,
  actions,
  hint,
  save: saveChanges,
  onDirtyChange,
  bulkDefaultKey,
}: SheetGridProps<R>) {
  const { toast } = useToast();
  const [edits, setEdits] = useState<SheetEdits>({});
  /** Text typed into a cell that means nothing (shown red, blocks Save). */
  const [bad, setBad] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<CellRef | null>(null);
  /** Where a range started; null = the range is the active cell alone. */
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  /** The mouse is down on a cell: moving over cells extends the range. */
  const [dragging, setDragging] = useState(false);
  /** The fill handle is being dragged: the range it started from and the row it reaches. */
  const [fill, setFill] = useState<{ from: Range; toRow: number } | null>(null);
  const [editing, setEditing] = useState<(CellRef & { text: string; typed: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState<SheetSaveResult["skipped"]>([]);
  const [notes, setNotes] = useState<NonNullable<SheetSaveResult["notes"]>>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const columnByKey = useMemo(() => new Map(allColumns.map((c) => [c.key, c])), [allColumns]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const rowIndex = useMemo(() => new Map(flat.map((r, i) => [r.id, i])), [flat]);
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.key, i])), [columns]);

  const valueOf = (row: R, key: string): SheetValue => {
    const e = edits[row.id];
    return e && key in e ? e[key] : cellValue(row, key);
  };
  const optionsFor = (row: R, col: SheetColumn) => optionsOf?.(row, col) ?? col.options;
  const editable = (row: R, col: SheetColumn) => isEditable(col) && !lockedCell?.(row, col);

  const changes = useMemo(() => changesOf(rowsById, edits, cellValue), [rowsById, edits, cellValue]);
  const changedCells = changes.reduce((n, c) => n + Object.keys(c.cells).length, 0);
  const badCount = Object.keys(bad).length;
  const dirty = changedCells > 0 || badCount > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the host's callback is not part of the state
  }, [dirty]);

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

  // --- the range
  const posOf = (ref: CellRef | null): { r: number; c: number } | null => {
    if (!ref) return null;
    const r = rowIndex.get(ref.id);
    const c = colIndex.get(ref.key);
    return r === undefined || c === undefined ? null : { r, c };
  };
  const range: Range | null = useMemo(() => {
    const a = posOf(active);
    if (!a) return null;
    const b = posOf(anchor) ?? a;
    return { r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- posOf reads the memoized indexes
  }, [active, anchor, rowIndex, colIndex]);
  const multi = !!range && (range.r1 !== range.r2 || range.c1 !== range.c2);
  const inRange = (r: number, c: number) => !!range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
  /** The rows the fill handle reaches beyond the range. */
  const fillRows = (): [number, number] | null => {
    if (!fill) return null;
    if (fill.toRow > fill.from.r2) return [fill.from.r2 + 1, fill.toRow];
    if (fill.toRow < fill.from.r1) return [fill.toRow, fill.from.r1 - 1];
    return null;
  };
  const inFill = (r: number, c: number) => {
    const rows = fillRows();
    return !!fill && !!rows && r >= rows[0] && r <= rows[1] && c >= fill.from.c1 && c <= fill.from.c2;
  };

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
    const row = rowsById.get(id);
    if (!row || !editable(row, col)) return;
    const parsed = parseCell(col, text, optionsFor(row, col));
    if ("error" in parsed) setBad((prev) => ({ ...prev, [cellId(id, col.key)]: text }));
    else setCell(id, col.key, parsed.value);
  };
  /** A value of one cell written into another (fill, Ctrl+D): read again against the other row's list. */
  const copyValue = (fromRow: R, toRow: R, col: SheetColumn) => {
    if (!editable(toRow, col)) return;
    const value = valueOf(fromRow, col.key);
    if (col.kind === "bool") setCell(toRow.id, col.key, value === true);
    else writeText(toRow.id, col, editText(col, value));
  };
  const clearCell = (row: R, col: SheetColumn) => {
    if (!editable(row, col)) return;
    if (col.kind === "bool") setCell(row.id, col.key, false);
    else if (col.kind !== "choice" || col.nullable) writeText(row.id, col, "");
  };
  const parseErrorOf = (row: R, col: SheetColumn, text: string): string => {
    const parsed = parseCell(col, text, optionsFor(row, col));
    return "error" in parsed ? parsed.error : "";
  };
  const cellText = (row: R, col: SheetColumn): string =>
    !isEditable(col)
      ? readonlyText(row, col.key)
      : col.kind === "choice"
        ? displayText(col, valueOf(row, col.key), optionsFor(row, col))
        : editText(col, valueOf(row, col.key));

  // --- moving around
  const move = (dRow: number, dCol: number, extend = false) => {
    if (!flat.length || !columns.length) return;
    const r0 = active ? flat.findIndex((r) => r.id === active.id) : 0;
    const c0 = active ? columns.findIndex((c) => c.key === active.key) : 0;
    const r = Math.min(flat.length - 1, Math.max(0, (r0 < 0 ? 0 : r0) + dRow));
    const c = Math.min(columns.length - 1, Math.max(0, (c0 < 0 ? 0 : c0) + dCol));
    if (extend) setAnchor((a) => a ?? active);
    else setAnchor(null);
    setActive({ id: flat[r].id, key: columns[c].key });
  };
  const focusGrid = () => requestAnimationFrame(() => gridRef.current?.focus());

  const startEdit = (ref: CellRef, typed?: string) => {
    const col = columnByKey.get(ref.key);
    const row = rowsById.get(ref.id);
    if (!col || !row || !editable(row, col)) return;
    setAnchor(null);
    if (col.kind === "bool") {
      setCell(ref.id, ref.key, !(valueOf(row, ref.key) === true));
      return;
    }
    const pending = bad[cellId(ref.id, ref.key)];
    setEditing({ ...ref, text: typed ?? pending ?? editText(col, valueOf(row, ref.key)), typed: typed !== undefined });
  };
  const commit = (then?: () => void) => {
    if (!editing) return;
    const col = columnByKey.get(editing.key);
    if (col) writeText(editing.id, col, editing.text);
    setEditing(null);
    then?.();
    focusGrid();
  };

  /** Every cell of the range: its row, its column, its place. */
  const rangeCells = (): { row: R; col: SheetColumn; r: number; c: number }[] => {
    if (!range) return [];
    const out: { row: R; col: SheetColumn; r: number; c: number }[] = [];
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) out.push({ row: flat[r], col: columns[c], r, c });
    return out;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (editing) {
      // a fast typist: keys that reach the grid between the first key and the input taking focus join the text
      if (e.target === gridRef.current && e.key.length === 1 && !ctrl && !e.altKey) {
        e.preventDefault();
        const key = e.key;
        // several keys can land before a render: each adds to the text as it is then
        setEditing((current) => (current ? { ...current, text: current.text + key } : current));
      }
      return;
    }
    if (ctrl && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    const keys: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (keys[e.key]) {
      e.preventDefault();
      move(...keys[e.key], e.shiftKey);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Escape") {
      setAnchor(null);
      return;
    }
    if (!active) return;
    // Ctrl+D: the first row of the range fills the rows under it (Sheets' fill down)
    if (ctrl && e.key.toLowerCase() === "d" && range && range.r2 > range.r1) {
      e.preventDefault();
      for (let c = range.c1; c <= range.c2; c++) for (let r = range.r1 + 1; r <= range.r2; r++) copyValue(flat[range.r1], flat[r], columns[c]);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      for (const { row, col } of rangeCells()) clearCell(row, col);
      return;
    }
    const col = columnByKey.get(active.key);
    const row = rowsById.get(active.id);
    if (!col || !row || !editable(row, col)) return;
    // a list or a date picker takes no first keystroke - it opens on the value it holds
    const picks = col.kind === "choice" || col.kind === "date" || col.kind === "datetime" || col.kind === "localtime";
    if (e.key === "Enter" || e.key === "F2" || (e.key === " " && col.kind === "bool")) {
      e.preventDefault();
      startEdit(active);
      return;
    }
    if (e.key.length === 1 && !ctrl && !e.altKey && col.kind !== "bool") {
      e.preventDefault();
      startEdit(active, picks ? undefined : e.key);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !active || !range) return;
    const block = pasteBlock(e.clipboardData.getData("text/plain"));
    if (!block.length) return;
    e.preventDefault();
    const one = block.length === 1 && block[0].length === 1 ? block[0][0] : null;
    // one value onto ticked rows: the same column of each
    if (one !== null && selected.size > 1 && selected.has(active.id) && !multi) {
      const col = columns[range.c1];
      for (const id of selected) writeText(id, col, one);
      return;
    }
    // one value onto a range: every cell of it
    if (one !== null && multi) {
      for (const { row, col } of rangeCells()) writeText(row.id, col, one);
      return;
    }
    // a block, from the range's top-left corner
    block.forEach((cells, dr) => {
      const row = flat[range.r1 + dr];
      if (!row) return;
      cells.forEach((text, dc) => {
        const col = columns[range.c1 + dc];
        if (col) writeText(row.id, col, text);
      });
    });
  };
  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !active || !range) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cells: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) cells.push(cellText(flat[r], columns[c]));
      lines.push(cells.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
  };

  // --- the mouse: click, drag a range, drag the fill handle
  const onCellMouseDown = (e: ReactMouseEvent, row: R, col: SheetColumn) => {
    if (editing?.id === row.id && editing.key === col.key) return;
    // a link or a button inside the cell keeps its own click
    if ((e.target as HTMLElement).closest("a,button")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    if (editing) commit();
    if (e.shiftKey && active) setAnchor((a) => a ?? active);
    else {
      setAnchor(null);
      setDragging(true);
    }
    setActive({ id: row.id, key: col.key });
    gridRef.current?.focus();
  };
  const onCellMouseEnter = (row: R, col: SheetColumn) => {
    const r = rowIndex.get(row.id);
    if (fill && r !== undefined) {
      setFill({ ...fill, toRow: r });
      return;
    }
    if (!dragging || !active) return;
    if (active.id === row.id && active.key === col.key) return;
    setAnchor((a) => a ?? active);
    setActive({ id: row.id, key: col.key });
  };
  const startFill = (e: ReactMouseEvent) => {
    if (!range) return;
    e.preventDefault();
    e.stopPropagation();
    setFill({ from: range, toRow: range.r2 });
  };
  useEffect(() => {
    if (!dragging && !fill) return;
    const up = () => {
      if (fill) {
        const rows = fillRows();
        if (rows) {
          const len = fill.from.r2 - fill.from.r1 + 1;
          const down = rows[0] > fill.from.r2;
          for (let c = fill.from.c1; c <= fill.from.c2; c++) {
            for (let r = rows[0]; r <= rows[1]; r++) {
              // the range repeats itself over the rows it is dragged on
              const i = down ? (r - fill.from.r2 - 1) % len : (len - 1 - ((fill.from.r1 - 1 - r) % len)) % len;
              copyValue(flat[fill.from.r1 + i], flat[r], columns[c]);
            }
          }
          setAnchor({ id: flat[Math.min(fill.from.r1, rows[0])].id, key: columns[fill.from.c1].key });
          setActive({ id: flat[Math.max(fill.from.r2, rows[1])].id, key: columns[fill.from.c2].key });
        }
        setFill(null);
      }
      setDragging(false);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebinds as the drag changes
  }, [dragging, fill]);

  // --- selection by checkbox
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
  const selectedRows = useMemo(
    () => [...selected].map((id) => rowsById.get(id)).filter((r): r is R => !!r),
    [selected, rowsById],
  );

  // --- save / discard
  const discard = () => {
    setEdits({});
    setBad({});
    setSkipped([]);
    setNotes([]);
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
      const res = await saveChanges(changes);
      if (!res.ok) {
        toast({ variant: "destructive", title: "Not saved", description: res.error });
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        for (const id of res.saved) delete next[id];
        return next;
      });
      setSkipped(res.skipped);
      setNotes(res.notes ?? []);
      toast({
        variant: res.skipped.length ? "destructive" : "default",
        title: res.skipped.length ? `${res.saved.length} saved, ${res.skipped.length} not` : `${res.saved.length} ${noun}(s) saved`,
        description: res.skipped.length ? "The rows not saved are listed above the sheet, with the reason." : undefined,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Not saved", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setSaving(false);
    }
  };

  const bulkColumns = allColumns.filter((c) => isEditable(c) && !c.noBulk);
  const width = CHECK_WIDTH + headWidth + columns.reduce((n, c) => n + c.width, 0);
  const alignRight = (c: SheetColumn) => RIGHT_ALIGNED_KINDS.has(c.kind);
  const rangeCount = range ? (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) : 0;

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        <div className="ms-auto flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
            <ListChecks />
            Set for selected{selected.size ? ` (${selected.size})` : ""}
          </Button>
          {actions}
        </div>
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

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
      {notes.length > 0 && (
        <Notice tone="info">
          <span className="font-medium">Saved - worth a look:</span>
          <ul className="mt-1 list-disc ps-5">
            {notes.map((n, i) => (
              <li key={i}>
                <Ltr className="font-mono">{n.code}</Ltr> - {n.note}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/* the sheet */}
      {flat.length === 0 ? (
        <Notice>{empty}</Notice>
      ) : (
        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCopy={onCopy}
          className={cn(
            "max-h-[70vh] overflow-auto rounded-md border bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            (dragging || fill) && "select-none",
            fill && "cursor-crosshair",
          )}
          aria-label={ariaLabel}
          dir="ltr"
        >
          <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width }}>
            <colgroup>
              <col style={{ width: CHECK_WIDTH }} />
              <col style={{ width: headWidth }} />
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
                  {headLabel}
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    title={c.title ?? c.label}
                    className={cn("truncate border-b border-r px-2 py-2", alignRight(c) ? "text-right" : "text-left")}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                if (group.rows.length === 0) return null;
                const ids = group.rows.map((r) => r.id);
                const ticked = ids.every((id) => selected.has(id));
                return (
                  <Fragment key={group.key}>
                    <tr>
                      <td className="sticky left-0 z-10 border-b border-r bg-muted px-2 py-1.5">
                        <Checkbox checked={ticked} onCheckedChange={(v) => toggleRows(ids, v === true)} aria-label={group.selectLabel} />
                      </td>
                      <td colSpan={columns.length + 1} className="border-b bg-muted px-2 py-1.5">
                        <div className="sticky flex w-fit items-center gap-2" style={{ left: CHECK_WIDTH + 8 }}>
                          {group.header}
                        </div>
                      </td>
                    </tr>
                    {group.rows.map((row) => {
                      const r = rowIndex.get(row.id) ?? -1;
                      return (
                        <tr key={row.id}>
                          <td className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1">
                            <Checkbox
                              checked={selected.has(row.id)}
                              onCheckedChange={(v) => toggleRows([row.id], v === true)}
                              aria-label={`Select ${rowName(row)}`}
                            />
                          </td>
                          <td
                            className="sticky z-10 truncate border-b border-r bg-card px-2 py-1 font-mono text-xs font-semibold"
                            style={{ left: CHECK_WIDTH }}
                          >
                            {rowHead(row)}
                          </td>
                          {columns.map((col, c) => {
                            const key = cellId(row.id, col.key);
                            const isActive = active?.id === row.id && active.key === col.key;
                            const isEditing = editing?.id === row.id && editing.key === col.key;
                            const canEdit = editable(row, col);
                            const wrong = bad[key];
                            const changed = wrong === undefined && canEdit && !!edits[row.id] && col.key in edits[row.id];
                            const value = valueOf(row, col.key);
                            const drawn = wrong === undefined && !isEditing ? renderCell?.(row, col, value) : undefined;
                            const picked = multi && inRange(r, c);
                            const corner = !!range && r === range.r2 && c === range.c2 && !isEditing;
                            return (
                              <td
                                key={col.key}
                                data-cell={key}
                                data-picked={picked || undefined}
                                onMouseDown={(e) => onCellMouseDown(e, row, col)}
                                onMouseEnter={() => onCellMouseEnter(row, col)}
                                onDoubleClick={() => startEdit({ id: row.id, key: col.key })}
                                title={wrong !== undefined ? parseErrorOf(row, col, wrong) : undefined}
                                className={cn(
                                  "relative h-8 truncate border-b border-r px-2",
                                  alignRight(col) ? "text-right tabular-nums" : "text-left",
                                  !canEdit && "bg-muted/30 text-muted-foreground",
                                  changed && "bg-amber-50 font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                                  wrong !== undefined && "bg-destructive/10 text-destructive",
                                  picked && "bg-primary/10",
                                  inFill(r, c) && "bg-primary/20",
                                  isActive && "outline outline-2 -outline-offset-2 outline-primary",
                                )}
                              >
                                {isEditing && editing ? (
                                  <CellEditor
                                    col={col}
                                    options={optionsFor(row, col)}
                                    text={editing.text}
                                    typed={editing.typed}
                                    onText={(text) => setEditing({ ...editing, text })}
                                    onDone={(how) => {
                                      if (how === "cancel") {
                                        setEditing(null);
                                        focusGrid();
                                      } else {
                                        commit(() => move(how === "down" ? 1 : how === "up" ? -1 : 0, how === "right" ? 1 : how === "left" ? -1 : 0));
                                      }
                                    }}
                                  />
                                ) : wrong !== undefined ? (
                                  wrong
                                ) : drawn !== undefined ? (
                                  drawn
                                ) : isEditable(col) ? (
                                  <span dir={col.kind === "text" || col.kind === "labels" || col.kind === "choice" ? "auto" : undefined}>
                                    {displayText(col, value, optionsFor(row, col))}
                                  </span>
                                ) : (
                                  readonlyText(row, col.key)
                                )}
                                {corner && canEdit && (
                                  <span
                                    data-fill-handle
                                    title="Drag down to fill the rows below with these values"
                                    onMouseDown={startFill}
                                    className="absolute -bottom-px -right-px z-10 h-2 w-2 cursor-crosshair border border-background bg-primary"
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
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
            <span className="font-semibold">{changes.length}</span> {noun}(s)
            {badCount > 0 && <span className="ms-2 text-destructive">· {badCount} red cell(s) to fix</span>}
            {multi && <span className="ms-2 text-muted-foreground">· {rangeCount} cells picked: Delete clears, Ctrl+D fills down</span>}
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

      {bulkOpen && (
        <SetForSelected
          onClose={() => setBulkOpen(false)}
          count={selected.size}
          noun={noun}
          columns={bulkColumns}
          defaultKey={bulkDefaultKey}
          optionsOf={(col) => {
            if (col.options) return col.options;
            // a list that depends on the row: every name any ticked row offers
            const seen = new Map<string, SheetOption>();
            for (const row of selectedRows) for (const o of optionsOf?.(row, col) ?? []) if (!seen.has(o.label)) seen.set(o.label, { value: o.label, label: o.label });
            return [...seen.values()];
          }}
          onApply={(entries) => {
            for (const entry of entries) {
              const col = columnByKey.get(entry.key);
              if (!col) continue;
              for (const row of selectedRows) {
                if (entry.mode === "set") {
                  writeText(row.id, col, entry.text);
                } else if (editable(row, col)) {
                  const current = valueOf(row, col.key);
                  setCell(row.id, col.key, adjustNumber(typeof current === "number" ? current : null, entry.mode, Number(entry.text.replace(/[,\s]/g, ""))));
                }
              }
            }
            setBulkOpen(false);
            focusGrid();
          }}
        />
      )}
    </div>
  );
}

type DoneHow = "down" | "up" | "right" | "left" | "stay" | "cancel";

/**
 * The input inside a cell being edited: text for most, a list for a choice, a
 * picker for dates. A cell opened by typing (`typed`) closes on an arrow key
 * and the grid moves that way, as Sheets does; one opened with Enter keeps the
 * arrows for the caret.
 */
function CellEditor({
  col,
  options,
  text,
  typed,
  onText,
  onDone,
}: {
  col: SheetColumn;
  options: readonly SheetOption[] | undefined;
  text: string;
  typed: boolean;
  onText: (text: string) => void;
  onDone: (how: DoneHow) => void;
}) {
  // One ending per edit: a blur that follows Enter or Escape must not save again (or save a cancelled text).
  const ended = useRef(false);
  const end = (how: DoneHow) => {
    if (ended.current) return;
    ended.current = true;
    onDone(how);
  };
  const arrows: Record<string, DoneHow> = { ArrowDown: "down", ArrowUp: "up", ArrowRight: "right", ArrowLeft: "left" };
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
    } else if (typed && arrows[e.key]) {
      e.preventDefault();
      end(arrows[e.key]);
    }
  };
  const cls = "h-7 w-full rounded-sm border border-primary bg-background px-1 text-sm focus:outline-none";
  if (col.kind === "choice") {
    const list = options ?? [];
    return (
      <select autoFocus className={cls} value={text} onChange={(e) => onText(e.target.value)} onKeyDown={keys} onBlur={() => end("stay")}>
        {(col.nullable || !list.some((o) => o.value === text)) && <option value="">{col.nullable ? (col.nullLabel ?? "-") : ""}</option>}
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const picker = col.kind === "date" ? "date" : col.kind === "datetime" || col.kind === "localtime" ? "datetime-local" : "text";
  return (
    <input
      autoFocus
      type={picker}
      className={cn(cls, RIGHT_ALIGNED_KINDS.has(col.kind) && "text-right")}
      dir={col.kind === "text" || col.kind === "labels" ? "auto" : "ltr"}
      value={picker === "datetime-local" ? text.replace(" ", "T") : text}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={keys}
      onBlur={() => end("stay")}
    />
  );
}

/** One line of "Set for selected": which column, and what to set it to (a value, or for numbers an amount or a percent to add). */
function problemOf(col: SheetColumn | undefined, entry: BulkEntry, list: readonly SheetOption[] | null): string | null {
  if (!col) return "Choose a column";
  if (entry.mode === "set") {
    const parsed = parseCell(col, entry.text, list ?? undefined);
    return "error" in parsed ? parsed.error : null;
  }
  return entry.text.trim() === "" || !Number.isFinite(Number(entry.text.replace(/[,\s]/g, ""))) ? "Type a number" : null;
}

/** Set one or more columns of every ticked row in one go (Alon, 08.10.2026: several fields without opening the dialog again). */
function SetForSelected({
  onClose,
  count,
  noun,
  columns,
  defaultKey,
  optionsOf,
  onApply,
}: {
  onClose: () => void;
  count: number;
  noun: string;
  columns: SheetColumn[];
  defaultKey?: string;
  optionsOf: (col: SheetColumn) => readonly SheetOption[];
  onApply: (entries: BulkEntry[]) => void;
}) {
  const firstKey = columns.find((c) => c.key === defaultKey)?.key ?? columns[0]?.key ?? "";
  const [entries, setEntries] = useState<BulkEntry[]>([{ key: firstKey, mode: "set", text: "" }]);
  const patch = (i: number, change: Partial<BulkEntry>) => setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...change } : e)));
  const taken = new Set(entries.map((e) => e.key));
  const nextFree = columns.find((c) => !taken.has(c.key))?.key ?? "";
  const problems = entries.map((entry) => {
    const col = columns.find((c) => c.key === entry.key);
    const list = col?.kind === "choice" ? optionsOf(col) : col?.kind === "bool" ? BOOL_OPTIONS : null;
    return problemOf(col, entry, list);
  });
  const blocked = problems.some((p) => p !== null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Set for {count} selected {noun}(s)
          </DialogTitle>
          <DialogDescription>
            Every column listed here is set on every ticked row. The change is marked in the sheet; nothing is saved until you press Save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {entries.map((entry, i) => {
            const col = columns.find((c) => c.key === entry.key);
            const numeric = !!col && NUMERIC_KINDS.has(col.kind);
            const list = col?.kind === "choice" ? optionsOf(col) : col?.kind === "bool" ? BOOL_OPTIONS : null;
            const picker = col?.kind === "date" ? "date" : col?.kind === "datetime" || col?.kind === "localtime" ? "datetime-local" : "text";
            const problem = problems[i];
            return (
              <div key={i} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <label className="grid min-w-0 flex-1 gap-1 text-sm">
                    Column
                    <select
                      className={selectClass}
                      value={entry.key}
                      onChange={(e) => patch(i, { key: e.target.value, mode: "set", text: "" })}
                    >
                      {columns.map((c) => (
                        <option key={c.key} value={c.key} disabled={c.key !== entry.key && taken.has(c.key)}>
                          {c.title ? `${c.label} - ${c.title}` : c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {entries.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5 h-8 w-8 text-destructive hover:text-destructive"
                      title="Remove this column"
                      onClick={() => setEntries((list) => list.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
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
                        onClick={() => patch(i, { mode: m })}
                        className={cn("rounded px-3 py-1", entry.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <label className="grid gap-1 text-sm">
                  {entry.mode === "set" ? "Value" : entry.mode === "add" ? "Amount to add (negative lowers)" : "Percent to add (negative lowers)"}
                  {list && entry.mode === "set" ? (
                    <select className={selectClass} value={entry.text} onChange={(e) => patch(i, { text: e.target.value })} dir="auto">
                      <option value="">{col?.nullable ? (col.nullLabel ?? "- (empty)") : "Choose…"}</option>
                      {list.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      dir={col?.kind === "text" || col?.kind === "labels" ? "auto" : "ltr"}
                      type={entry.mode === "set" ? picker : "text"}
                      value={entry.text}
                      onChange={(e) => patch(i, { text: e.target.value })}
                      placeholder={col?.kind === "labels" ? "label, label" : col?.kind === "discount" ? "10% or 80" : ""}
                    />
                  )}
                  {problem && (entry.text !== "" || entry.mode !== "set") && <span className="text-xs text-destructive">{problem}</span>}
                  {col?.kind === "choice" && !col.options && (
                    <span className="text-xs text-muted-foreground">A row that has no such choice turns red and is not saved.</span>
                  )}
                </label>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={!nextFree}
            onClick={() => setEntries((list) => [...list, { key: nextFree, mode: "set", text: "" }])}
          >
            <Plus />
            Another column
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={blocked} onClick={() => onApply(entries)}>
            Apply {entries.length > 1 ? `${entries.length} columns` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BOOL_OPTIONS: readonly SheetOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
