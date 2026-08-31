"use client";

import type React from "react";

import { useState } from "react";
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
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

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
  views,
  activeView,
  onViewChange,
  filters,
  emptyState,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>(
    {},
  );
  const isControlled = controlledRowSelection !== undefined;
  const rowSelection = isControlled ? controlledRowSelection : internalRowSelection;
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize ?? 25,
  });
  const [globalFilter, setGlobalFilter] = useState<string>("");

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
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue ?? "")
        .toLowerCase()
        .trim();
      if (!query) return true;
      const keys = Array.isArray(searchColumns) ? searchColumns : [];
      if (keys.length === 0) {
        // Fallback: search over all visible columns
        return row
          .getAllCells()
          .some((cell) =>
            String(cell.getValue() ?? "")
              .toLowerCase()
              .includes(query),
          );
      }
      return keys.some((key) =>
        String(row.getValue(key as string) ?? "")
          .toLowerCase()
          .includes(query),
      );
    },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const firstRow = filteredCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, filteredCount);
  const searchValue = searchColumns?.length
    ? ((table.getState().globalFilter as string) ?? "")
    : searchColumn
      ? ((table.getColumn(searchColumn)?.getFilterValue() as string) ?? "")
      : "";
  const setSearchValue = (value: string) => {
    if (searchColumns?.length) table.setGlobalFilter(value);
    else if (searchColumn) table.getColumn(searchColumn)?.setFilterValue(value);
  };

  return (
    <div className="relative space-y-3">
      {/* Saved views - one click for the filters people actually re-apply. */}
      {views && views.length > 0 && (
        <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/60 p-1">
          {views.map((view) => {
            const isActive = view.id === activeView;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => onViewChange?.(view.id)}
                aria-pressed={isActive}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {view.label}
                {view.count !== undefined && (
                  <span className="ml-1.5 text-xs tabular text-muted-foreground">
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              className="h-9 w-[260px] pl-8"
            />
          </div>
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

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                      dense && "h-10 px-2",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={getRowClassName?.(row, index, sorting)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={dense ? "p-2" : undefined}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
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
        <div className="sticky bottom-4 z-10 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary px-3 py-2 text-primary-foreground shadow-lg">
          <span className="text-sm font-medium">
            <span className="tabular">{selectedCount}</span> selected
          </span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions}</div>
        </div>
      )}
    </div>
  );
}
