"use client";

import type React from "react";

import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type Updater,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Inbox,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { tableStateKey } from "@/lib/view-state";
import {
  cleanStoredFilters,
  filterSummary,
  matchesHeaderFilter,
  rowsLeftFilter,
  type HeaderFilterKind,
  type HeaderFilterValue,
} from "@/lib/table-filters";
import { useSessionState } from "@/hooks/use-view-state";
import { useToast } from "@/hooks/use-toast";
import {
  HeaderFilterPopover,
  headerFilterCell,
  headerValueLabel,
  type HeaderFilterSpec,
} from "@/components/data-table-header-filter";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/search-input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Skeleton } from "@/components/ui/skeleton";

/** A saved view - a named filter over the same rows, with its own count. */
export interface DataTableView {
  id: string;
  label: string;
  count?: number;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchColumn?: string;
  searchPlaceholder?: string;
  searchColumns?: string[]; // Multi-column search (global filter)
  enableRowSelection?: boolean;
  rowSelection?: Record<string, boolean>;
  onRowSelectionChange?: (rowSelection: Record<string, boolean>) => void;
  getRowId?: (row: TData) => string;
  bulkActions?: React.ReactNode;
  defaultPageSize?: number;
  rightActions?: React.ReactNode;
  pageSizeOptions?: number[];
  getRowClassName?: (
    row: Row<TData>,
    index: number,
    sorting: SortingState,
  ) => string | undefined;
  /** Tighter cell padding so wide tables fit without horizontal scroll. */
  dense?: boolean;
  /** A spreadsheet grid: a line between every column too, like the tours sheets - for wide rows of many short fields. */
  grid?: boolean;
  /** Initial sort, e.g. [{ id: "id", desc: true }] for newest-first. */
  defaultSorting?: SortingState;
  /** Segmented control above the toolbar - "All / Prioritized / Deleted". */
  views?: DataTableView[];
  activeView?: string;
  onViewChange?: (viewId: string) => void;
  /** Filter chips / selects rendered on the toolbar row, left of the actions. */
  filters?: React.ReactNode;
  /** Shown instead of a bare "No results." when there is nothing to list. */
  emptyState?: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  };
  /** Clicking a row (not a control inside it) calls this - /tasks opens the thread. */
  onRowClick?: (row: TData) => void;
  /** Row id (getRowId, or the index) whose detail panel is open under it. */
  expandedRowId?: string | null;
  /** The detail panel - rendered full-width under the expanded row. */
  renderExpandedRow?: (row: TData) => React.ReactNode;
  /**
   * Name under which this table remembers its search, sort, page and hidden
   * columns for the browser tab (a refresh, or coming back from an editor,
   * lands where you were). Defaults to a key made from the column ids - pass
   * one only when the columns change with the data (price-light's competitors).
   */
  stateKey?: string;
  /**
   * Rows the reader drags into an order (the tours TODAY list, 21.10). A handle column is prepended; a drop
   * calls `onMove(activeId, overId)` with the two row ids (getRowId) and the SCREEN keeps and saves the order.
   * Dragging is live only while `enabled`, the table's own search is empty and the rows are sorted by
   * `orderColumnId` ascending (or not sorted) - any other sort would save a slice that is not the list.
   */
  rowReorder?: {
    enabled: boolean;
    orderColumnId: string;
    onMove: (activeId: string, overId: string) => void;
  };
}

/** The id TanStack gives a column: its own `id`, else the accessor key. */
function columnIdOf<TData, TValue>(column: ColumnDef<TData, TValue>): string {
  if (column.id) return column.id;
  const accessorKey = (column as { accessorKey?: unknown }).accessorKey;
  return typeof accessorKey === "string" ? accessorKey : "";
}

/** A click that landed on a control inside the row belongs to that control. */
const ROW_CLICK_IGNORE =
  "a,button,input,textarea,select,label,[role=combobox],[role=checkbox],[role=switch],[role=menuitem],[data-drag-handle]";

/** Compact pager: 1 … 4 [5] 6 … 13 - never more than 7 buttons wide. */
function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - (sorted[index - 1] as number) > 1) out.push("gap");
    out.push(page);
  });
  return out;
}

/**
 * A sort button in a header cell is a stock ghost Button: its own padding
 * pushed the label 16px in from the cells under it, and it set its own size and
 * case, so sortable headers read "Name" beside plain ones reading "LOCATION".
 * One rule here instead of a fix in every column definition. The checkbox in
 * the select column is a button too - leave it alone.
 */
// Spelled out in full - Tailwind only generates classes it can read as literals.
const HEADER_BUTTON =
  "[&>button:not([role=checkbox])]:-ms-2 [&>button:not([role=checkbox])]:h-8 [&>button:not([role=checkbox])]:px-2 [&>button:not([role=checkbox])]:text-xs [&>button:not([role=checkbox])]:font-semibold [&>button:not([role=checkbox])]:uppercase [&>button:not([role=checkbox])]:tracking-wide";

/**
 * A last column with the id "actions" is pinned to the table's trailing edge, so
 * a row's Edit / View / ⋯ never sits behind a sideways scroll. The pinned cell
 * needs a solid fill to cover what scrolls under it, so each row tint (hover,
 * selected, open) is mixed over the card instead of layered with alpha.
 *
 * A row that wears a translucent wash of its own (the tours TODAY rows) names it in
 * `--row-wash` / `--row-wash-hover`: the pinned cell lays that same wash over its
 * opaque fill as a background image - the card plus the wash, exactly what the
 * rest of the row shows - so the colour reaches the row's last cell (Alon 28.10).
 * `--row-pin-hover` / `--row-pin-selected` replace the grey hover / selected fills
 * under it (a ticked tinted row shows its hover wash, the pinned cell the same).
 * Rows that set none look as before.
 */
const PINNED_COLUMN_ID = "actions";
const PINNED_CELL =
  "sticky end-0 z-[1] bg-card shadow-[inset_0_-1px_0_hsl(var(--border))] [tr:last-child>&]:shadow-none [tr:hover>&]:bg-[color:var(--row-pin-hover,color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--card))))] [tr[data-state=selected]>&]:bg-[color:var(--row-pin-selected,hsl(var(--muted)))] [background-image:linear-gradient(var(--row-wash,transparent),var(--row-wash,transparent))] [tr:hover>&]:[background-image:linear-gradient(var(--row-wash-hover,transparent),var(--row-wash-hover,transparent))] [tr[data-state=selected]>&]:[background-image:linear-gradient(var(--row-wash-hover,transparent),var(--row-wash-hover,transparent))]";
const PINNED_CELL_OPEN = "bg-[color:color-mix(in_srgb,hsl(var(--muted))_40%,hsl(var(--card)))]";
const PINNED_HEAD =
  "sticky end-0 z-[1] bg-[color:color-mix(in_srgb,hsl(var(--muted))_60%,hsl(var(--card)))]";
// The soft edge that says "columns continue under here" - only while some do.
const PINNED_EDGE =
  "before:pointer-events-none before:absolute before:inset-y-0 before:-start-4 before:w-4 before:bg-gradient-to-l before:from-black/10 before:to-transparent before:opacity-0 before:transition-opacity before:duration-200 before:content-[''] rtl:before:bg-gradient-to-r dark:before:from-black/50";

interface ScrollEdges {
  left: boolean;
  right: boolean;
  /** Thickness of the scroller's own bars, so a shadow never sits on one. */
  barX: number;
  barY: number;
  rtl: boolean;
  /** The last column takes too much of the view to pin - it would hide the rest. */
  lastTooWide: boolean;
}

const NO_EDGES: ScrollEdges = {
  left: false,
  right: false,
  barX: 0,
  barY: 0,
  rtl: false,
  lastTooWide: false,
};

/** A pinned column may cover at most this share of the table's width (price-changes
 *  keeps four labelled buttons in its actions cell - pinned, they hid the table). */
const PIN_MAX_SHARE = 0.35;

/**
 * Which sides of a wide table still hide columns. The table scrolls inside its
 * card, and a column cut off at the edge with no cue reads as "that is all".
 */
function useScrollEdges(tableRef: React.RefObject<HTMLTableElement | null>): ScrollEdges {
  const [edges, setEdges] = useState(NO_EDGES);

  useEffect(() => {
    const table = tableRef.current;
    const scroller = table?.parentElement;
    if (!table || !scroller) return;

    const measure = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      // An RTL scroller counts scrollLeft down from 0, so only the distance matters.
      const offset = Math.abs(scroller.scrollLeft);
      const rtl = getComputedStyle(scroller).direction === "rtl";
      const pastStart = max > 1 && offset > 1;
      const beforeEnd = max > 1 && offset < max - 1;
      const lastCell = table.querySelector<HTMLTableCellElement>("tbody tr:first-child > td:last-child");
      const next: ScrollEdges = {
        left: rtl ? beforeEnd : pastStart,
        right: rtl ? pastStart : beforeEnd,
        barX: scroller.offsetWidth - scroller.clientWidth,
        barY: scroller.offsetHeight - scroller.clientHeight,
        rtl,
        lastTooWide: !!lastCell && lastCell.offsetWidth > scroller.clientWidth * PIN_MAX_SHARE,
      };
      setEdges((prev) =>
        prev.left === next.left &&
        prev.right === next.right &&
        prev.barX === next.barX &&
        prev.barY === next.barY &&
        prev.rtl === next.rtl &&
        prev.lastTooWide === next.lastTooWide
          ? prev
          : next,
      );
    };

    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(table);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [tableRef]);

  return edges;
}

/** The empty state of a list - the one DataTable draws, for lists that are not a DataTable. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground/60" />
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** A column header that sorts its column - the button every sortable DataTable column uses. */
export function SortableHeader({
  label,
  column,
}: {
  label: React.ReactNode;
  column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" };
}) {
  return (
    <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
      {label}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}

/**
 * The table's own outline while the first rows load, in place of a bare
 * "Loading…" line that jumps into a full table when the data lands.
 */
export function DataTableSkeleton({
  rows = 8,
  label = "Loading",
}: {
  rows?: number;
  /** Read out to screen readers - say what is loading. */
  label?: string;
}) {
  return (
    <div className="space-y-3" role="status">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-9 w-full sm:w-[300px]" />
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="h-10 border-b bg-muted/60" />
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-6 border-b px-3 py-3.5 last:border-b-0"
          >
            <Skeleton className="h-4 w-10 shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24 shrink-0" />
            <Skeleton className="hidden h-4 w-20 shrink-0 md:block" />
            <Skeleton className="hidden h-4 w-28 shrink-0 lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

const REORDER_COLUMN_ID = "reorder";

/** What the row hands its drag handle: the sortable bits of useSortable, and whether dragging is live. */
type RowDrag = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners" | "setActivatorNodeRef"> & { live: boolean };
const RowDragContext = createContext<RowDrag | null>(null);

interface RowShellProps {
  rowId: string;
  live: boolean;
  selected: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLTableRowElement>;
  children: React.ReactNode;
}

/** The row as it always was. */
function PlainRow({ selected, className, onClick, children }: RowShellProps) {
  return (
    <TableRow data-state={selected && "selected"} className={className} onClick={onClick}>
      {children}
    </TableRow>
  );
}

/** The row as a sortable item: it moves with the drag, and its handle gets the listeners. */
function SortableRow({ rowId, live, selected, className, onClick, children }: RowShellProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: rowId, disabled: !live });
  return (
    <RowDragContext.Provider value={{ attributes, listeners, setActivatorNodeRef, live }}>
      <TableRow
        ref={setNodeRef}
        data-state={selected && "selected"}
        className={cn(className, isDragging && "relative z-20 bg-card shadow-lg")}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        onClick={onClick}
      >
        {children}
      </TableRow>
    </RowDragContext.Provider>
  );
}

/** The grip at the start of a reorderable row - greyed while dragging is not live. */
function DragHandle() {
  const drag = useContext(RowDragContext);
  const live = !!drag?.live;
  return (
    <button
      type="button"
      data-drag-handle
      ref={drag?.setActivatorNodeRef}
      {...(live ? drag?.attributes : {})}
      {...(live ? drag?.listeners : {})}
      disabled={!live}
      aria-label="Drag to reorder"
      title={live ? "Drag to reorder" : "Clear the search and sort by # to drag"}
      className={cn(
        "inline-flex h-7 w-7 touch-none items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        live ? "cursor-grab hover:bg-muted active:cursor-grabbing" : "cursor-not-allowed opacity-40",
      )}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumn,
  searchPlaceholder = "Search...",
  searchColumns,
  enableRowSelection = false,
  rowSelection: controlledRowSelection,
  onRowSelectionChange,
  getRowId,
  bulkActions,
  defaultPageSize,
  rightActions,
  pageSizeOptions = [10, 25, 50, 100],
  getRowClassName,
  dense = false,
  grid = false,
  defaultSorting,
  views,
  activeView,
  onViewChange,
  filters,
  emptyState,
  onRowClick,
  expandedRowId,
  renderExpandedRow,
  stateKey,
  rowReorder,
}: DataTableProps<TData, TValue>) {
  // Search, sort, page and hidden columns are remembered for the browser tab
  // (hooks/use-view-state.ts) - a refresh used to throw you back to page 1 of
  // an unfiltered list. The selection is not: ticked rows are a pending action.
  const memory = `table:${stateKey ?? tableStateKey(columns.map(columnIdOf))}`;
  const [sorting, setSorting] = useSessionState<SortingState>(
    `${memory}:sort`,
    defaultSorting ?? [],
  );
  // Header filters (a column's `meta.filter`, Alon 28.10) are remembered like the search - and read back only where
  // they still fit the columns (cleanStoredFilters), so a stale one never hides rows nobody can see why.
  const filterSpecs = useMemo(() => {
    const specs = new Map<string, HeaderFilterSpec<TData>>();
    for (const column of columns) {
      const spec = column.meta?.filter;
      const id = columnIdOf(column);
      if (spec && id) specs.set(id, spec);
    }
    return specs;
  }, [columns]);
  const filterKindsKey = [...filterSpecs].map(([id, spec]) => `${id}:${spec.kind}`).join("|");
  const filterKinds = useMemo(
    () => Object.fromEntries([...filterSpecs].map(([id, spec]) => [id, spec.kind])) as Record<string, HeaderFilterKind>,
    // the kinds, not the specs' identity: a column list rebuilt every render must not re-clean
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKindsKey],
  );
  const [storedFilters, setStoredFilters] = useSessionState<ColumnFiltersState>(`${memory}:filters`, []);
  const columnFilters = useMemo<ColumnFiltersState>(() => cleanStoredFilters(storedFilters, filterKinds), [storedFilters, filterKinds]);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // a double-click is two clicks first: a sortable header sorted twice - the sort before the first click comes back
  const sortBeforeClick = useRef<SortingState>([]);
  const { toast } = useToast();
  const [columnVisibility, setColumnVisibility] = useSessionState<VisibilityState>(
    `${memory}:columns`,
    {},
  );
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>(
    {},
  );
  const isControlled = controlledRowSelection !== undefined;
  const rowSelection = isControlled ? controlledRowSelection : internalRowSelection;
  const [pagination, setPagination] = useSessionState<PaginationState>(`${memory}:page`, {
    pageIndex: 0,
    pageSize: defaultPageSize ?? 25,
  });
  const [globalFilter, setGlobalFilter] = useSessionState<string>(`${memory}:search`, "");

  // Dragging is live only in the order column's own ascending sort (or no sort) with no search and no header filter:
  // anything else would hand the screen a slice that is not the list it keeps.
  const reorderLive =
    !!rowReorder &&
    rowReorder.enabled &&
    !globalFilter &&
    columnFilters.length === 0 &&
    (sorting.length === 0 || (sorting.length === 1 && sorting[0].id === rowReorder.orderColumnId && !sorting[0].desc));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!rowReorder || !over || active.id === over.id) return;
    rowReorder.onMove(String(active.id), String(over.id));
  };
  const reorderColumns: ColumnDef<TData, TValue>[] = rowReorder
    ? [
        {
          id: REORDER_COLUMN_ID,
          header: () => <span className="sr-only">Drag</span>,
          cell: () => <DragHandle />,
          enableSorting: false,
          enableHiding: false,
        },
      ]
    : [];

  // Add selection column if row selection is enabled
  const selectionColumns: ColumnDef<TData, TValue>[] = enableRowSelection
    ? [
        {
          id: "select",
          header: ({ table }) => (
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
              aria-label="Select all"
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="Select row"
            />
          ),
          enableSorting: false,
          enableHiding: false,
        },
      ]
    : [];

  // a column that opts into a header filter gets its filter function here (a column's own filterFn stays its own)
  const filterableColumns = columns.map((column) => {
    const spec = column.meta?.filter;
    if (!spec || column.filterFn) return column;
    return {
      ...column,
      filterFn: (row: Row<TData>, columnId: string, value: unknown) =>
        matchesHeaderFilter(headerFilterCell(spec, row, columnId), value as HeaderFilterValue),
    } as ColumnDef<TData, TValue>;
  });
  const allColumns = [...reorderColumns, ...selectionColumns, ...filterableColumns];

  const table = useReactTable({
    data,
    columns: allColumns,
    onSortingChange: setSorting,
    // a filter change lands on page 1 of what it leaves, like the search
    onColumnFiltersChange: (updater: Updater<ColumnFiltersState>) => {
      setStoredFilters((previous) => {
        const base = cleanStoredFilters(previous, filterKinds);
        return typeof updater === "function" ? updater(base) : updater;
      });
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      if (!isControlled) setInternalRowSelection(next);
      onRowSelectionChange?.(next);
    },
    getRowId,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
      globalFilter,
    },
    enableRowSelection,
    autoResetPageIndex: false,
    // Token search, not verbatim: "real madrid champion" must find
    // "Real Madrid vs Arsenal - UEFA Champions League". All named columns are
    // combined into one haystack so a query can span fields.
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue ?? "");
      const keys = searchColumns?.length
        ? searchColumns
        : searchColumn
          ? [searchColumn]
          : [];
      const fields =
        keys.length === 0
          ? row.getAllCells().map((cell) => cell.getValue())
          : keys.map((key) => row.getValue(key as string));
      return matchesSearch(query, ...fields);
    },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const firstRow = filteredCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, filteredCount);
  const searchValue = (table.getState().globalFilter as string) ?? "";
  const activeFilters = columnFilters.flatMap((f) => {
    const spec = filterSpecs.get(f.id);
    return spec ? [{ id: f.id, value: f.value as HeaderFilterValue, spec }] : [];
  });
  const totalCount = table.getCoreRowModel().rows.length;
  const shownIds = table.getFilteredRowModel().rows.map((row) => row.id);
  // A search typed on page 3 has to land on page 1 of what it found - the page
  // index does not reset by itself (that would throw you back on every inline edit).
  const setSearchValue = (value: string) => {
    table.setGlobalFilter(value);
    table.setPageIndex(0);
  };
  const tableRef = useRef<HTMLTableElement>(null);
  const edges = useScrollEdges(tableRef);
  const visibleColumns = table.getVisibleLeafColumns();
  const pinsActions =
    visibleColumns[visibleColumns.length - 1]?.id === PINNED_COLUMN_ID && !edges.lastTooWide;
  // Columns still hidden past the trailing edge (the left one in an RTL table).
  const trailingHidden = edges.rtl ? edges.left : edges.right;

  // A filter is live: a row an edit took out of the filtered list leaves it at once - and says so, or a saved row
  // would seem to vanish. Only when the DATA changed and the filters did not (a filter change explains itself).
  const lastView = useRef<{ data: TData[]; filters: ColumnFiltersState; search: string; shown: string[] } | null>(null);
  useEffect(() => {
    const before = lastView.current;
    lastView.current = { data, filters: columnFilters, search: globalFilter, shown: shownIds };
    if (!before || before.data === data || before.filters !== columnFilters || before.search !== globalFilter) return;
    if (activeFilters.length === 0) return;
    const left = rowsLeftFilter(before.shown, shownIds, table.getCoreRowModel().rows.map((row) => row.id));
    if (left.length > 0) {
      toast({ title: left.length === 1 ? "The row no longer matches the filter" : `${left.length} rows no longer match the filter` });
    }
  });

  // Rows can also shrink from outside (a filter chip, a bulk delete): never sit
  // on a page past the last one, which showed as an empty table with rows in it.
  useEffect(() => {
    if (pageCount > 0 && pageIndex > pageCount - 1) table.setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex, table]);

  // A table nobody drags renders exactly as before: no DndContext, no sortable rows, no handle column.
  const RowShell = rowReorder ? SortableRow : PlainRow;
  const pageRowIds = table.getRowModel().rows.map((row) => row.id);
  const sortable = (rows: React.ReactNode) =>
    rowReorder ? (
      <SortableContext items={pageRowIds} strategy={verticalListSortingStrategy}>
        {rows}
      </SortableContext>
    ) : (
      rows
    );
  const dnd = (node: React.ReactNode) =>
    rowReorder ? (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {node}
      </DndContext>
    ) : (
      node
    );

  return (
    <div className="relative space-y-3">
      {/* Saved views - one click for the filters people actually re-apply.
          They wrap: a strip that scrolled sideways hid the last views. */}
      {views && views.length > 0 && (
        <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border bg-muted/60 p-1">
          {views.map((view) => {
            const isActive = view.id === activeView;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => onViewChange?.(view.id)}
                aria-pressed={isActive}
                className={cn(
                  // `inline-flex` + `gap-1.5`, not a margin on the count: the dashboard is RTL,
                  // so a physical `ml-` put the space on the far side of the count and the chip
                  // read "אדום245". A flex gap is direction-agnostic.
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {view.label}
                {view.count !== undefined && (
                  // `tabular-nums` - "tabular" alone is not a Tailwind class and did nothing,
                  // so counts jittered as they changed width.
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {view.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(searchColumn || searchColumns?.length) && (
          <SearchInput
            value={searchValue}
            onValueChange={setSearchValue}
            placeholder={searchPlaceholder}
          />
        )}
        {filters}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {rightActions}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Columns
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {column.id.replace(/[._]/g, " ")}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* A narrowed list says so: one chip per header filter (a click opens it, the cross drops it). */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
          {activeFilters.map(({ id, value, spec }) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/5 ps-2.5 text-xs"
            >
              <button
                type="button"
                className="min-w-0 truncate py-1 text-start"
                onClick={() => setOpenFilter(id)}
                title={`Change the ${spec.label} filter`}
              >
                <span className="font-semibold">{spec.label}:</span>{" "}
                <span dir="auto">{filterSummary(value, (v) => headerValueLabel(spec, v))}</span>
              </button>
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove the ${spec.label} filter`}
                onClick={() => table.getColumn(id)?.setFilterValue(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => table.resetColumnFilters()}>
            Clear all
          </Button>
        </div>
      )}

      {/* The table scrolls inside this card in both directions: on a long page
          the header stays in view and the sideways bar stays within reach,
          instead of sitting under row 50. Phones keep plain page scrolling. */}
      <div className="relative overflow-hidden rounded-lg border bg-card">
        {dnd(
        <Table ref={tableRef} containerClassName="md:max-h-[calc(100svh-9rem)]">
          {/* Solid card under the tint - rows scroll beneath a sticky header. */}
          <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/60 hover:bg-muted/60">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const filterSpec = header.isPlaceholder ? undefined : filterSpecs.get(header.column.id);
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                      // Alon's gesture: a double-click on the header opens its filter. Only clicks on the header
                      // itself count - React bubbles the popover's own clicks (a portal) up to here.
                      onMouseDown={
                        filterSpec
                          ? (event) => {
                              if (event.detail === 1 && event.currentTarget.contains(event.target as Node)) {
                                sortBeforeClick.current = sorting;
                              }
                            }
                          : undefined
                      }
                      onDoubleClick={
                        filterSpec
                          ? (event) => {
                              if (!event.currentTarget.contains(event.target as Node)) return;
                              setSorting(sortBeforeClick.current);
                              setOpenFilter(header.column.id);
                            }
                          : undefined
                      }
                      className={cn(
                        filterSpec && "group/th select-none",
                        "h-10 whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        // A collapsed border does not travel with a sticky cell.
                        "shadow-[inset_0_-1px_0_hsl(var(--border))]",
                        "aria-[sort]:text-foreground",
                        HEADER_BUTTON,
                        dense && "px-2",
                        grid && "border-e border-border last:border-e-0 bg-muted",
                        pinsActions && header.column.id === PINNED_COLUMN_ID && PINNED_HEAD,
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {filterSpec && (
                        // in a span: HEADER_BUTTON styles the header's direct button children (the sort button)
                        <span className="inline-flex align-middle">
                          <HeaderFilterPopover
                            column={header.column as Column<TData, unknown>}
                            spec={filterSpec}
                            open={openFilter === header.column.id}
                            onOpenChange={(next) => setOpenFilter(next ? header.column.id : null)}
                          />
                        </span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              sortable(
                table.getRowModel().rows.map((row, index) => (
                <Fragment key={row.id}>
                  <RowShell
                    rowId={row.id}
                    live={reorderLive}
                    selected={row.getIsSelected()}
                    className={cn(
                      getRowClassName?.(row, index, sorting),
                      onRowClick && "cursor-pointer",
                      expandedRowId === row.id && "bg-muted/40",
                    )}
                    onClick={
                      onRowClick
                        ? (event) => {
                            if ((event.target as HTMLElement).closest(ROW_CLICK_IGNORE)) return;
                            onRowClick(row.original);
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "px-3 py-2.5",
                          dense && "p-2",
                          // Coarse pointers get taller rows - 32px icon buttons in
                          // a dense row are under the comfortable touch target.
                          "[@media(pointer:coarse)]:py-3",
                          grid && "border-e border-border/80 last:border-e-0",
                          pinsActions &&
                            cell.column.id === PINNED_COLUMN_ID && [
                              PINNED_CELL,
                              PINNED_EDGE,
                              trailingHidden && "before:opacity-100",
                              expandedRowId === row.id && PINNED_CELL_OPEN,
                            ],
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </RowShell>
                  {renderExpandedRow && expandedRowId === row.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={allColumns.length} className="bg-muted/20 p-4">
                        {renderExpandedRow(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
                )),
              )
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={allColumns.length} className="h-40">
                  {searchValue || activeFilters.length > 0 ? (
                    <EmptyState
                      title={activeFilters.length > 0 ? "Nothing matches the filters" : "Nothing matches that search"}
                      description="Try a shorter search, or clear the filters above."
                    />
                  ) : (
                    <EmptyState
                      title={emptyState?.title ?? "Nothing here yet"}
                      description={emptyState?.description}
                      action={emptyState?.action}
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>,
        )}
        {/* More columns this way. The trailing side is left to the pinned
            actions column when there is one - it draws its own edge. */}
        {!(pinsActions && edges.rtl) && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-0 z-20 w-6 bg-gradient-to-r from-black/10 to-transparent opacity-0 transition-opacity duration-200 dark:from-black/50",
              edges.left && "opacity-100",
            )}
            style={{ left: edges.rtl ? edges.barX : 0, bottom: edges.barY }}
          />
        )}
        {!(pinsActions && !edges.rtl) && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-0 z-20 w-6 bg-gradient-to-l from-black/10 to-transparent opacity-0 transition-opacity duration-200 dark:from-black/50",
              edges.right && "opacity-100",
            )}
            style={{ right: edges.rtl ? 0 : edges.barX, bottom: edges.barY }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span>
          {filteredCount === 0 ? (
            "No rows"
          ) : (
            <>
              Showing{" "}
              <span className="font-medium tabular text-foreground">
                {firstRow}–{lastRow}
              </span>{" "}
              of{" "}
              <span className="font-medium tabular text-foreground">{filteredCount}</span>
            </>
          )}
          {activeFilters.length > 0 && <span className="tabular"> ({totalCount} in all)</span>}
        </span>

        <div className="flex items-center gap-1.5">
          <span className="text-xs">Rows</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={pageSize}
            onChange={(event) => table.setPageSize(parseInt(event.target.value, 10))}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {pageCount > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {pageWindow(pageIndex + 1, pageCount).map((page, index) =>
              page === "gap" ? (
                <span key={`gap-${index}`} className="px-1 text-xs">
                  …
                </span>
              ) : (
                <Button
                  key={page}
                  variant={page === pageIndex + 1 ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8 tabular text-xs"
                  onClick={() => table.setPageIndex(page - 1)}
                  aria-current={page === pageIndex + 1 ? "page" : undefined}
                >
                  {page}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Bulk actions follow the selection instead of hiding in the toolbar. */}
      {enableRowSelection && selectedCount > 0 && bulkActions && (
        <div
          className={cn(
            "sticky bottom-4 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2",
            "rounded-lg border border-primary/20 bg-primary px-3 py-2 text-primary-foreground shadow-lg",
            // Arrives as an object rising into place rather than blinking in.
            // The blanket reduced-motion rule in globals.css flattens this.
            "animate-in fade-in slide-in-from-bottom-2 duration-200",
          )}
        >
          <span className="text-sm font-medium">
            <span className="tabular">{selectedCount}</span> selected
          </span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions}</div>
        </div>
      )}
    </div>
  );
}
