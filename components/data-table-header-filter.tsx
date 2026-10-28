"use client";

/**
 * A column's header filter (Alon 28.10: Excel's "filter by what is in the column", multi-select). A column opts in
 * with `meta.filter`; DataTable gives it the filter function, keeps the state (remembered for the tab) and draws
 * this funnel in the header - also opened by a double-click on the header cell. The rules are pure in
 * lib/table-filters.ts.
 */
import { useMemo, useState } from "react";
import type { Column, Row, RowData } from "@tanstack/react-table";
import { Filter } from "lucide-react";

import { cn } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { distinctValues, isActiveFilter, type HeaderFilterKind, type HeaderFilterValue } from "@/lib/table-filters";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A column's opt-in: what kind of filter, its name on a chip, and (optionally) how a cell reads and prints. */
export interface HeaderFilterSpec<TData> {
  kind: HeaderFilterKind;
  /** The column's name on the filter chip ("Status: ..."). */
  label: string;
  /** The cell as the filter reads it; default = the column's accessor value as text. */
  value?: (row: TData) => string;
  /** How a value prints in the list and on the chip (a status key -> its label; "" -> "Unassigned"). */
  valueLabel?: (value: string) => string;
}

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    filter?: HeaderFilterSpec<TData>;
  }
}

/** The cell as a column's filter reads it. */
export function headerFilterCell<TData>(spec: HeaderFilterSpec<TData>, row: Row<TData>, columnId: string): string {
  if (spec.value) return spec.value(row.original);
  const value = row.getValue(columnId);
  return value === null || value === undefined ? "" : String(value);
}

/** What a value prints: the column's own label, else the value, else "None" for an empty one. */
export function headerValueLabel<TData>(spec: HeaderFilterSpec<TData>, value: string): string {
  return spec.valueLabel?.(value) ?? (value === "" ? "None" : value);
}

export function HeaderFilterPopover<TData>({
  column,
  spec,
  open,
  onOpenChange,
}: {
  column: Column<TData, unknown>;
  spec: HeaderFilterSpec<TData>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = column.getFilterValue() as HeaderFilterValue | undefined;
  const active = !!current && isActiveFilter(current);
  const set = (next: HeaderFilterValue) => column.setFilterValue(isActiveFilter(next) ? next : undefined);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter ${spec.label}`}
          title={`Filter ${spec.label} (or double-click the header)`}
          className={cn(
            "ms-1 inline-flex h-6 w-6 items-center justify-center rounded align-middle text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100",
            active ? "bg-primary/10 text-primary opacity-100" : "opacity-0 group-hover/th:opacity-100",
          )}
        >
          <Filter className={cn("h-3.5 w-3.5", active && "fill-current")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 normal-case tracking-normal" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{spec.label}</div>
        {spec.kind === "values" && (
          <ValuesBody column={column} spec={spec} selected={current?.kind === "values" ? current.values : []} onChange={(values) => set({ kind: "values", values })} />
        )}
        {spec.kind === "text" && (
          <Input
            autoFocus
            dir="auto"
            placeholder="Contains..."
            value={current?.kind === "text" ? current.text : ""}
            onChange={(e) => set({ kind: "text", text: e.target.value })}
          />
        )}
        {spec.kind === "date" && <DateBody value={current?.kind === "date" ? current : { kind: "date", from: null, to: null }} onChange={set} />}
      </PopoverContent>
    </Popover>
  );
}

/** Tick any of the column's values: the most common first, a search over the list, All / Clear. */
function ValuesBody<TData>({
  column,
  spec,
  selected,
  onChange,
}: {
  column: Column<TData, unknown>;
  spec: HeaderFilterSpec<TData>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [q, setQ] = useState("");
  // counted over the rows the OTHER filters leave (Excel's list), plus a ticked value no row carries any more - it
  // must stay visible to be un-ticked
  const facetRows = column.getFacetedRowModel().rows;
  const options = useMemo(() => {
    const counted = distinctValues(facetRows.map((row) => headerFilterCell(spec, row, column.id)));
    const missing = selected.filter((v) => !counted.some((o) => o.value === v)).map((value) => ({ value, count: 0 }));
    return [...counted, ...missing];
  }, [facetRows, spec, column.id, selected]);
  const shown = options.filter((o) => !q || matchesSearch(q, headerValueLabel(spec, o.value), o.value));
  const toggle = (value: string, on: boolean) => onChange(on ? [...selected, value] : selected.filter((v) => v !== value));
  return (
    <div className="space-y-2">
      {options.length > 8 && <Input autoFocus dir="auto" placeholder="Search the list..." value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />}
      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.value)])])}
        >
          {q ? "Select these" : "Select all"}
        </Button>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={selected.length === 0} onClick={() => onChange([])}>
          Clear
        </Button>
      </div>
      <div className="max-h-64 space-y-0.5 overflow-y-auto pe-1">
        {shown.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">Nothing matches</div>}
        {shown.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
              <Checkbox checked={checked} onCheckedChange={(next) => toggle(o.value, next === true)} />
              <span dir="auto" className={cn("min-w-0 flex-1 truncate", o.value === "" && "text-muted-foreground")}>
                {headerValueLabel(spec, o.value)}
              </span>
              <span className="tabular text-xs text-muted-foreground">{o.count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** From / to, both days included; either may stay empty. */
function DateBody({ value, onChange }: { value: Extract<HeaderFilterValue, { kind: "date" }>; onChange: (next: HeaderFilterValue) => void }) {
  const day = (raw: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
  return (
    <div className="space-y-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        From
        <Input type="date" dir="ltr" className="h-8" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: day(e.target.value) })} />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        To
        <Input type="date" dir="ltr" className="h-8" value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: day(e.target.value) })} />
      </label>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!value.from && !value.to} onClick={() => onChange({ kind: "date", from: null, to: null })}>
        Clear
      </Button>
    </div>
  );
}
