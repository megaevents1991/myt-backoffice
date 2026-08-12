"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "react-hot-toast";
import { useConfirm } from "@/components/confirm-provider";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  Eye,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { OfflineFlight } from "@/types/offline-flight.types";
import type { Event } from "@/types/app.types";
import {
  updateOfflineFlight,
  softDeleteOfflineFlight,
  restoreOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import {
  bulkAdjustPrice,
  bulkRestoreOfflineFlights,
  bulkSetEventLink,
  bulkSoftDeleteOfflineFlights,
  bulkUpdateOfflineFlights,
} from "@/lib/actions/offline-flight-bulk-actions";
import { getActiveEvents } from "@/lib/actions/event-actions";
import {
  DEFAULT_VISIBLE_COLUMNS,
  FLIGHT_FIELDS,
  FLIGHT_FIELD_BY_KEY,
  FLIGHT_FIELD_GROUPS,
  formatFlightValue,
  fromInputValue,
  toInputValue,
  type FlightField,
} from "@/components/flight-field-groups";
import type { FlightWritableColumn } from "@/lib/actions/offline-flight-columns";
import { FlightAllocationsPanel } from "@/components/flight-allocations-panel";
import { useTablePreferences } from "@/hooks/use-table-preferences";

// Preferences are stored per staff account (see useTablePreferences), so the
// same column choice follows you between machines.
const TABLE_KEY = "offline-flights";
const DEADLINE_WARNING_DAYS = 7;

export type FlightsEditableTableProps = {
  flights: OfflineFlight[];
  /**
   * When set, the table is scoped to one event: the event filter is hidden and
   * bulk event-link actions default to this id.
   */
  eventId?: number;
  /** Rendered in the toolbar; used by the event page to add its own actions. */
  toolbarExtra?: React.ReactNode;
  onChanged?: () => void;
};

type Filters = {
  airline: string;
  from: string;
  to: string;
  series: string;
  blockStatus: string;
  eventId: string;
  showDeleted: boolean;
};

const EMPTY_FILTERS: Filters = {
  airline: "",
  from: "",
  to: "",
  series: "",
  blockStatus: "",
  eventId: "",
  showDeleted: false,
};

/** Days until an ISO date, or null when there is no date. Negative = past. */
function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(`${String(date).slice(0, 10)}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

/**
 * A block that still has to be ticketed and is about to lose its seats. This is
 * the whole reason the deadline columns exist, so it gets a visible marker.
 */
function deadlineWarning(flight: OfflineFlight): string | null {
  if (flight.block_status === "ticketed") return null;
  const checks: [string, number | null][] = [
    ["Ticketing deadline", daysUntil(flight.ticketing_deadline)],
    ["Option expiry", daysUntil(flight.option_expiry)],
  ];
  for (const [label, days] of checks) {
    if (days === null) continue;
    if (days < 0) return `${label} passed ${Math.abs(days)} day(s) ago`;
    if (days <= DEADLINE_WARNING_DAYS) return `${label} in ${days} day(s)`;
  }
  return null;
}

export function FlightsEditableTable({
  flights: flightsProp,
  eventId,
  toolbarExtra,
  onChanged,
}: FlightsEditableTableProps) {
  const [flights, setFlights] = useState<OfflineFlight[]>(flightsProp);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drawerFlight, setDrawerFlight] = useState<OfflineFlight | null>(null);
  const [editing, setEditing] = useState<{ id: number; key: string } | null>(null);
  const [columnPrefs, setColumnPrefs] = useTablePreferences<{
    visibleColumns: FlightWritableColumn[];
  }>(TABLE_KEY, { visibleColumns: DEFAULT_VISIBLE_COLUMNS });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [events, setEvents] = useState<Pick<Event, "id" | "name" | "date">[]>([]);
  const [bulkField, setBulkField] = useState<string>("");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [priceMode, setPriceMode] = useState<"set" | "delta" | "percent">("percent");
  const [priceValue, setPriceValue] = useState<string>("");
  const [bulkEventId, setBulkEventId] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();

  useEffect(() => setFlights(flightsProp), [flightsProp]);

  useEffect(() => {
    if (eventId) return;
    getActiveEvents()
      .then((data) =>
        setEvents(data.map((e) => ({ id: e.id, name: e.name, date: e.date }))),
      )
      .catch((error) => console.error("Failed to load events:", error));
  }, [eventId]);

  // Guards against a stale stored key (a column that was renamed or dropped)
  // silently blanking a table cell.
  const visibleColumns = useMemo(
    () =>
      (columnPrefs.visibleColumns ?? DEFAULT_VISIBLE_COLUMNS).filter((key) =>
        FLIGHT_FIELD_BY_KEY.has(key),
      ),
    [columnPrefs.visibleColumns],
  );

  const toggleColumn = (key: FlightWritableColumn) => {
    setColumnPrefs({
      visibleColumns: visibleColumns.includes(key)
        ? visibleColumns.filter((c) => c !== key)
        : [...visibleColumns, key],
    });
  };

  const commit = (id: number, key: string, value: unknown) => {
    const before = flights.find((f) => f.id === id);
    setFlights((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [key]: value } : f)),
    );
    setDrawerFlight((prev) =>
      prev && prev.id === id ? { ...prev, [key]: value } : prev,
    );
    startTransition(async () => {
      try {
        await updateOfflineFlight(id, { [key]: value } as Partial<OfflineFlight>);
        onChanged?.();
      } catch (error) {
        console.error("Failed to update flight:", error);
        setFlights((prev) => prev.map((f) => (f.id === id && before ? before : f)));
        toast.error(error instanceof Error ? error.message : "Update failed");
      }
    });
  };

  const runBulk = async (
    label: string,
    fn: () => Promise<number>,
    { confirmText }: { confirmText?: string } = {},
  ) => {
    if (
      confirmText &&
      !(await confirm({ description: confirmText, destructive: true }))
    )
      return;
    startTransition(async () => {
      try {
        const count = await fn();
        toast.success(`${label}: ${count} flight(s)`);
        setSelectedRows(new Set());
        onChanged?.();
      } catch (error) {
        console.error(`Bulk action failed (${label}):`, error);
        toast.error(error instanceof Error ? error.message : `${label} failed`);
      }
    });
  };

  const handleDelete = async (id: number) => {
    if (
      !(await confirm({
        title: "Delete flight?",
        description: "This soft deletes the flight. You can restore it later.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      try {
        await softDeleteOfflineFlight(id);
        setFlights((prev) =>
          prev.map((f) => (f.id === id ? { ...f, is_deleted: true } : f)),
        );
        toast.success("Flight soft deleted successfully.");
        onChanged?.();
      } catch (error) {
        console.error("Failed to delete flight:", error);
        toast.error("Failed to delete flight.");
      }
    });
  };

  const handleRestore = async (id: number) => {
    if (
      !(await confirm({
        title: "Restore flight?",
        description: "The flight returns to active status.",
        confirmLabel: "Restore",
      }))
    )
      return;
    startTransition(async () => {
      try {
        await restoreOfflineFlight(id);
        setFlights((prev) =>
          prev.map((f) => (f.id === id ? { ...f, is_deleted: false } : f)),
        );
        toast.success("Flight restored successfully.");
        onChanged?.();
      } catch (error) {
        console.error("Failed to restore flight:", error);
        toast.error("Failed to restore flight.");
      }
    });
  };

  const visibleFields = useMemo(
    () =>
      visibleColumns
        .map((key) => FLIGHT_FIELD_BY_KEY.get(key))
        .filter((f): f is FlightField => Boolean(f)),
    [visibleColumns],
  );

  // Filter options come from the flights you can actually see. A series whose
  // every flight was deleted must not linger in the dropdown - picking it would
  // filter the table down to nothing.
  const filterableFlights = useMemo(
    () => (filters.showDeleted ? flights : flights.filter((f) => !f.is_deleted)),
    [flights, filters.showDeleted],
  );

  const seriesNames = useMemo(
    () =>
      Array.from(
        new Set(
          filterableFlights
            .map((f) => f.series_name)
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort(),
    [filterableFlights],
  );

  const airlines = useMemo(
    () => Array.from(new Set(filterableFlights.map((f) => f.airline_code))).sort(),
    [filterableFlights],
  );

  // Deleting the last flight of a series (or of an airline) while its filter is
  // active would otherwise leave you staring at an empty table with no clue why.
  useEffect(() => {
    setFilters((prev) => {
      const next = { ...prev };
      if (next.series && !seriesNames.includes(next.series)) next.series = "";
      if (next.airline && !airlines.includes(next.airline)) next.airline = "";
      return next.series === prev.series && next.airline === prev.airline ? prev : next;
    });
  }, [seriesNames, airlines]);

  const filtered = useMemo(() => {
    return flights.filter((flight) => {
      if (!filters.showDeleted && flight.is_deleted) return false;
      if (filters.airline && flight.airline_code !== filters.airline) return false;
      if (filters.series && flight.series_name !== filters.series) return false;
      if (filters.blockStatus && flight.block_status !== filters.blockStatus) {
        return false;
      }
      if (filters.eventId && !(flight.event_ids ?? []).includes(Number(filters.eventId))) {
        return false;
      }
      const departure = flight.outbound_departure_time.slice(0, 10);
      if (filters.from && departure < filters.from) return false;
      if (filters.to && departure > filters.to) return false;
      return true;
    });
  }, [flights, filters]);

  const exportHref = (path: string) => {
    const params = new URLSearchParams();
    if (filters.airline) params.set("airline", filters.airline);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (eventId) params.set("eventId", String(eventId));
    else if (filters.eventId) params.set("eventId", filters.eventId);
    if (selectedRows.size > 0) params.set("ids", Array.from(selectedRows).join(","));
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const renderEditor = (
    flight: OfflineFlight,
    field: FlightField,
    onDone: () => void,
  ) => {
    const raw = (flight as unknown as Record<string, unknown>)[field.key];

    if (field.type === "boolean") {
      return (
        <Checkbox
          checked={Boolean(raw)}
          onCheckedChange={(checked) => {
            commit(flight.id, field.key, Boolean(checked));
            onDone();
          }}
        />
      );
    }

    if (field.type === "select") {
      return (
        <Select
          defaultValue={raw ? String(raw) : undefined}
          onValueChange={(value) => {
            commit(flight.id, field.key, value);
            onDone();
          }}
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue placeholder="-" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    const inputType =
      field.type === "number" || field.type === "money"
        ? "number"
        : field.type === "date"
          ? "date"
          : field.type === "datetime"
            ? "datetime-local"
            : "text";

    return (
      <Input
        autoFocus
        className="h-8"
        type={inputType}
        step={field.type === "money" ? "0.01" : undefined}
        defaultValue={toInputValue(field, raw)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
          if (event.key === "Enter") {
            commit(flight.id, field.key, fromInputValue(field, event.currentTarget.value));
            onDone();
          }
        }}
        onBlur={(event) => {
          const next = fromInputValue(field, event.currentTarget.value);
          // Compare against the ORIGINAL round-tripped through the same
          // normalization, not against the raw column value. Postgres returns
          // numeric as "1337.00" while the input yields 1337 - comparing those
          // directly reports a change on every blur, so merely opening and
          // closing the drawer wrote to the database and pushed a new base
          // flight price onto every linked event.
          const unchanged = fromInputValue(field, toInputValue(field, raw));
          if (JSON.stringify(next) !== JSON.stringify(unchanged)) {
            commit(flight.id, field.key, next);
          }
          onDone();
        }}
      />
    );
  };

  const bulkFieldDef = bulkField ? FLIGHT_FIELD_BY_KEY.get(bulkField) : undefined;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((prev) => !prev)}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-96 w-64 overflow-y-auto">
            {FLIGHT_FIELD_GROUPS.map((group) => (
              <div key={group}>
                <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">
                  {group}
                </DropdownMenuLabel>
                {FLIGHT_FIELDS.filter((field) => field.group === group).map((field) => (
                  <DropdownMenuCheckboxItem
                    key={field.key}
                    checked={visibleColumns.includes(field.key)}
                    onCheckedChange={() => toggleColumn(field.key)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {field.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" asChild>
          <a href={exportHref("/api/exports/flights")}>
            <Download className="mr-2 h-4 w-4" />
            Export inventory
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={exportHref("/api/exports/flight-pax")}>
            <Download className="mr-2 h-4 w-4" />
            Export for ticketing
          </a>
        </Button>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {flights.length}
        </span>
        {toolbarExtra}
      </div>

      {/* filters */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
          <label className="text-xs">
            Airline
            <select
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              value={filters.airline}
              onChange={(e) => setFilters({ ...filters, airline: e.target.value })}
            >
              <option value="">All</option>
              {airlines.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Departure from
            <Input
              className="mt-1 h-9"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Departure to
            <Input
              className="mt-1 h-9"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Series
            <select
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              value={filters.series}
              onChange={(e) => setFilters({ ...filters, series: e.target.value })}
            >
              <option value="">All</option>
              {seriesNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Block status
            <select
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              value={filters.blockStatus}
              onChange={(e) => setFilters({ ...filters, blockStatus: e.target.value })}
            >
              <option value="">All</option>
              <option value="option">option</option>
              <option value="confirmed">confirmed</option>
              <option value="ticketed">ticketed</option>
            </select>
          </label>
          {!eventId && (
            <label className="text-xs">
              Event
              <select
                className="mt-1 block h-9 max-w-56 rounded-md border bg-background px-2 text-sm"
                value={filters.eventId}
                onChange={(e) => setFilters({ ...filters, eventId: e.target.value })}
              >
                <option value="">All</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={filters.showDeleted}
              onCheckedChange={(checked) =>
                setFilters({ ...filters, showDeleted: Boolean(checked) })
              }
            />
            Show deleted
          </label>
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear
          </Button>
        </div>
      )}

      {/* bulk toolbar */}
      {selectedRows.size > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <span className="text-sm font-medium">{selectedRows.size} selected</span>

          <label className="text-xs">
            Set field
            <select
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              value={bulkField}
              onChange={(e) => {
                setBulkField(e.target.value);
                setBulkValue("");
              }}
            >
              <option value="">Choose…</option>
              {FLIGHT_FIELDS.filter((f) => f.bulkEditable && f.key !== "price").map(
                (field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ),
              )}
            </select>
          </label>
          {bulkFieldDef && (
            <>
              <label className="text-xs">
                Value
                {bulkFieldDef.type === "select" ? (
                  <select
                    className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {(bulkFieldDef.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : bulkFieldDef.type === "boolean" ? (
                  <select
                    className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <Input
                    className="mt-1 h-9 w-40"
                    type={
                      bulkFieldDef.type === "number" || bulkFieldDef.type === "money"
                        ? "number"
                        : bulkFieldDef.type === "date"
                          ? "date"
                          : "text"
                    }
                    value={bulkValue}
                    onChange={(e) => setBulkValue(e.target.value)}
                  />
                )}
              </label>
              <Button
                size="sm"
                disabled={isPending || bulkValue === ""}
                onClick={() =>
                  runBulk("Updated", () =>
                    bulkUpdateOfflineFlights(Array.from(selectedRows), {
                      [bulkFieldDef.key]:
                        bulkFieldDef.type === "boolean"
                          ? bulkValue === "true"
                          : fromInputValue(bulkFieldDef, bulkValue),
                    }),
                  )
                }
              >
                Apply
              </Button>
            </>
          )}

          <span className="mx-1 h-8 w-px bg-border" />

          <label className="text-xs">
            Price
            <select
              className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
              value={priceMode}
              onChange={(e) =>
                setPriceMode(e.target.value as "set" | "delta" | "percent")
              }
            >
              <option value="percent">± %</option>
              <option value="delta">± $</option>
              <option value="set">set $</option>
            </select>
          </label>
          <Input
            className="h-9 w-28"
            type="number"
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder={priceMode === "percent" ? "10" : "50"}
          />
          <Button
            size="sm"
            disabled={isPending || priceValue === ""}
            onClick={() =>
              runBulk("Price updated", () =>
                bulkAdjustPrice(Array.from(selectedRows), {
                  mode: priceMode,
                  value: Number(priceValue),
                }),
              )
            }
          >
            Apply price
          </Button>

          <span className="mx-1 h-8 w-px bg-border" />

          {!eventId && (
            <label className="text-xs">
              Event
              <select
                className="mt-1 block h-9 max-w-56 rounded-md border bg-background px-2 text-sm"
                value={bulkEventId}
                onChange={(e) => setBulkEventId(e.target.value)}
              >
                <option value="">Choose…</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || (!eventId && !bulkEventId)}
            onClick={() =>
              runBulk("Linked", () =>
                bulkSetEventLink(
                  Array.from(selectedRows),
                  eventId ?? Number(bulkEventId),
                  "add",
                ),
              )
            }
          >
            Link event
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || (!eventId && !bulkEventId)}
            onClick={() =>
              runBulk("Unlinked", () =>
                bulkSetEventLink(
                  Array.from(selectedRows),
                  eventId ?? Number(bulkEventId),
                  "remove",
                ),
              )
            }
          >
            Unlink event
          </Button>

          <span className="mx-1 h-8 w-px bg-border" />

          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              runBulk(
                "Deleted",
                () => bulkSoftDeleteOfflineFlights(Array.from(selectedRows)),
                { confirmText: `Soft delete ${selectedRows.size} flight(s)?` },
              )
            }
          >
            Delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              runBulk("Restored", () =>
                bulkRestoreOfflineFlights(Array.from(selectedRows)),
              )
            }
          >
            Restore
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-8">
                <Checkbox
                  checked={
                    filtered.length > 0 && selectedRows.size === filtered.length
                  }
                  onCheckedChange={(checked) =>
                    setSelectedRows(
                      checked ? new Set(filtered.map((f) => f.id)) : new Set(),
                    )
                  }
                  aria-label="Select all rows"
                />
              </TableHead>
              <TableHead>ID</TableHead>
              {visibleFields.map((field) => (
                <TableHead key={field.key}>{field.label}</TableHead>
              ))}
              <TableHead className="text-right">ORG</TableHead>
              <TableHead className="text-right">TAKEN</TableHead>
              <TableHead className="text-right">AVAILABLE</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((flight) => {
                const available = flight.initial_quantity - flight.consumed_quantity;
                const warning = deadlineWarning(flight);
                const isExpanded = expandedId === flight.id;
                return (
                  <Fragment key={flight.id}>
                    <TableRow data-state={selectedRows.has(flight.id) && "selected"}>
                      <TableCell className="p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Seat allocations"
                          onClick={() => setExpandedId(isExpanded ? null : flight.id)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={selectedRows.has(flight.id)}
                          onCheckedChange={() =>
                            setSelectedRows((prev) => {
                              const next = new Set(prev);
                              if (next.has(flight.id)) next.delete(flight.id);
                              else next.add(flight.id);
                              return next;
                            })
                          }
                          aria-label={`Select row ${flight.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="hover:underline"
                          title="Open all fields"
                          onClick={() => setDrawerFlight(flight)}
                        >
                          {flight.id}
                        </button>
                        {warning && (
                          <span
                            className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"
                            title={warning}
                          />
                        )}
                      </TableCell>

                      {visibleFields.map((field) => {
                        const isEditing =
                          editing?.id === flight.id && editing.key === field.key;
                        const value = (flight as unknown as Record<string, unknown>)[
                          field.key
                        ];
                        return (
                          <TableCell
                            key={field.key}
                            className="cursor-pointer"
                            onClick={() =>
                              !isEditing &&
                              setEditing({ id: flight.id, key: field.key })
                            }
                          >
                            {isEditing
                              ? renderEditor(flight, field, () => setEditing(null))
                              : formatFlightValue(field, value)}
                          </TableCell>
                        );
                      })}

                      <TableCell className="text-right">
                        {flight.initial_quantity}
                      </TableCell>
                      <TableCell className="text-right">
                        {flight.consumed_quantity}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            available > 0
                              ? "font-medium text-green-600"
                              : "font-medium text-red-600"
                          }
                        >
                          {available}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={flight.is_deleted ? "destructive" : "outline"}>
                          {flight.is_deleted ? "Deleted" : "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/offline-flights/${flight.id}`}
                            title="View Flight"
                          >
                            <Button variant="ghost" size="icon">
                              <Eye className="h-4 w-4" />
                              <span className="sr-only">View Flight</span>
                            </Button>
                          </Link>
                          {flight.is_deleted ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Restore Flight"
                              onClick={() => handleRestore(flight.id)}
                              disabled={isPending}
                              className="text-green-600 hover:text-green-700"
                            >
                              <RotateCcw className="h-4 w-4" />
                              <span className="sr-only">Restore Flight</span>
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete Flight"
                              onClick={() => handleDelete(flight.id)}
                              disabled={isPending}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Delete Flight</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={visibleFields.length + 8} className="bg-muted/40">
                          <FlightAllocationsPanel
                            flightId={flight.id}
                            highlightEventId={eventId}
                            onChanged={onChanged}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={visibleFields.length + 8}
                  className="h-24 text-center"
                >
                  No flights found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={Boolean(drawerFlight)}
        onOpenChange={(open) => !open && setDrawerFlight(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {drawerFlight && (
            <>
              <SheetHeader>
                <SheetTitle>
                  Flight #{drawerFlight.id} · {drawerFlight.airline_code}{" "}
                  {drawerFlight.outbound_flight_number}
                </SheetTitle>
                <SheetDescription>
                  {drawerFlight.outbound_departure_airport} →{" "}
                  {drawerFlight.outbound_arrival_airport} ·{" "}
                  {drawerFlight.outbound_departure_time.slice(0, 10)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-6">
                {FLIGHT_FIELD_GROUPS.map((group) => (
                  <div key={group}>
                    <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      {group}
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {FLIGHT_FIELDS.filter((field) => field.group === group).map(
                        (field) => (
                          <label key={field.key} className="text-xs">
                            {field.label}
                            <div className="mt-1">
                              {renderEditor(drawerFlight, field, () => undefined)}
                            </div>
                          </label>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
