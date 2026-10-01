"use client";

import type React from "react";

import { Fragment, useEffect, useRef, useState } from "react";
import {
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
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  SlidersHorizontal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { tableStateKey } from "@/lib/view-state";
import { useSessionState } from "@/hooks/use-view-state";
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
}

/** The id TanStack gives a column: its own `id`, else the accessor key. */
function columnIdOf<TData, TValue>(column: ColumnDef<TData, TValue>): string {
  if (column.id) return column.id;
  const accessorKey = (column as { accessorKey?: unknown }).accessorKey;
  return typeof accessorKey === "string" ? accessorKey : "";
}

/** A click that landed on a control inside the row belongs to that control. */
const ROW_CLICK_IGNORE =
  "a,button,input,textarea,select,label,[role=combobox],[role=checkbox],[role=switch],[role=menuitem]";

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
 */
const PINNED_COLUMN_ID = "actions";
const PINNED_CELL =
  "sticky end-0 z-[1] bg-card shadow-[inset_0_-1px_0_hsl(var(--border))] [tr:last-child>&]:shadow-none [tr:hover>&]:bg-[color:color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--card)))] [tr[data-state=selected]>&]:bg-muted";
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
}: DataTableProps<TData, TValue>) {
  // Search, sort, page and hidden columns are remembered for the browser tab
  // (hooks/use-view-state.ts) - a refresh used to throw you back to page 1 of
  // an unfiltered list. The selection is not: ticked rows are a pending action.
  const memory = `table:${stateKey ?? tableStateKey(columns.map(columnIdOf))}`;
  const [sorting, setSorting] = useSessionState<SortingState>(
    `${memory}:sort`,
    defaultSorting ?? [],
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
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

  const allColumns = [...selectionColumns, ...columns];

  const table = useReactTable({
    data,
    columns: allColumns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
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

  // Rows can also shrink from outside (a filter chip, a bulk delete): never sit
  // on a page past the last one, which showed as an empty table with rows in it.
  useEffect(() => {
    if (pageCount > 0 && pageIndex > pageCount - 1) table.setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex, table]);

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

      {/* The table scrolls inside this card in both directions: on a long page
          the header stays in view and the sideways bar stays within reach,
          instead of sitting under row 50. Phones keep plain page scrolling. */}
      <div className="relative overflow-hidden rounded-lg border bg-card">
        <Table ref={tableRef} containerClassName="md:max-h-[calc(100svh-9rem)]">
          {/* Solid card under the tint - rows scroll beneath a sticky header. */}
          <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/60 hover:bg-muted/60">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                      className={cn(
                        "h-10 whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        // A collapsed border does not travel with a sticky cell.
                        "shadow-[inset_0_-1px_0_hsl(var(--border))]",
                        "aria-[sort]:text-foreground",
                        HEADER_BUTTON,
                        dense && "px-2",
                        pinsActions && header.column.id === PINNED_COLUMN_ID && PINNED_HEAD,
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsSelected() && "selected"}
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
                  </TableRow>
                  {renderExpandedRow && expandedRowId === row.id && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={allColumns.length} className="bg-muted/20 p-4">
                        {renderExpandedRow(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={allColumns.length} className="h-40">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
                    <Inbox className="h-7 w-7 text-muted-foreground/60" />
                    <p className="font-medium">
                      {searchValue
                        ? "Nothing matches that search"
                        : (emptyState?.title ?? "Nothing here yet")}
                    </p>
                    {(emptyState?.description || searchValue) && (
                      <p className="text-sm text-muted-foreground">
                        {searchValue
                          ? "Try a shorter search, or clear the filters above."
                          : emptyState?.description}
                      </p>
                    )}
                    {!searchValue && emptyState?.action}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
