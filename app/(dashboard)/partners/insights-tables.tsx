"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  HotEvent,
  TopBookedEvent,
} from "@/lib/actions/partners-dashboard-actions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type SortValue = string | number | null;
type Sort = { key: string; dir: "asc" | "desc" };

function useSortedRows<T>(
  rows: T[],
  initial: Sort,
  valueOf: (row: T, key: string) => SortValue
) {
  const [sort, setSort] = useState<Sort>(initial);
  const sorted = useMemo(() => {
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = valueOf(a, sort.key);
      const vb = valueOf(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls last either way
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "he") * factor;
      }
      return (va - (vb as number)) * factor;
    });
  }, [rows, sort, valueOf]);
  const toggle = (key: string) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
    );
  return { sorted, sort, toggle };
}

function SortHeader({
  label,
  sortKey,
  sort,
  toggle,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  toggle: (key: string) => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={() => toggle(sortKey)}
      className={`inline-flex items-center gap-1 hover:text-foreground ${
        align === "right" ? "flex-row-reverse" : ""
      } ${sort.key === sortKey ? "text-foreground" : ""}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : "—";

/** Left card: the period's most-booked events, sortable on every column. */
export function TopEventsTable({ events }: { events: TopBookedEvent[] }) {
  const { sorted, sort, toggle } = useSortedRows(
    events,
    { key: "tickets", dir: "desc" },
    (row, key) => {
      switch (key) {
        case "name":
          return row.name;
        case "date":
          return row.date;
        case "bookings":
          return row.bookings;
        case "tickets":
          return row.tickets;
        case "sales":
          return row.salesUsd;
        default:
          return null;
      }
    }
  );

  if (events.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No paid bookings in this period.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="px-2">
            <SortHeader label="Event" sortKey="name" sort={sort} toggle={toggle} />
          </TableHead>
          <TableHead className="px-2">
            <SortHeader label="Date" sortKey="date" sort={sort} toggle={toggle} />
          </TableHead>
          <TableHead className="px-2 text-right">
            <SortHeader label="Bookings" sortKey="bookings" sort={sort} toggle={toggle} align="right" />
          </TableHead>
          <TableHead className="px-2 text-right">
            <SortHeader label="Tickets" sortKey="tickets" sort={sort} toggle={toggle} align="right" />
          </TableHead>
          <TableHead className="px-2 text-right">
            <SortHeader label="Sales" sortKey="sales" sort={sort} toggle={toggle} align="right" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((event) => (
          <TableRow key={`${event.name}-${event.date ?? ""}`}>
            <TableCell className="max-w-[11rem] truncate px-2 font-medium">
              {event.name}
            </TableCell>
            <TableCell className="px-2 text-xs text-muted-foreground">
              {dateLabel(event.date)}
            </TableCell>
            <TableCell className="px-2 text-right tabular-nums">{event.bookings}</TableCell>
            <TableCell className="px-2 text-right tabular-nums">{event.tickets}</TableCell>
            <TableCell className="px-2 text-right tabular-nums">
              {usd.format(event.salesUsd)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Right card: hot events — sortable columns, per-partner hover breakdown. */
export function HotEventsTable({ events }: { events: HotEvent[] }) {
  const { sorted, sort, toggle } = useSortedRows(
    events,
    { key: "visitors", dir: "desc" },
    (row, key) => {
      switch (key) {
        case "name":
          return row.name;
        case "date":
          return row.date;
        case "location":
          return row.location;
        case "visitors":
          return row.visitors;
        case "clicks":
          return row.clicks;
        case "partners":
          return row.partners;
        case "converted":
          return row.paidBookings;
        default:
          return null;
      }
    }
  );

  if (events.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        No event clicks recorded in this period.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortHeader label="Event" sortKey="name" sort={sort} toggle={toggle} />
          </TableHead>
          <TableHead>
            <SortHeader label="Date" sortKey="date" sort={sort} toggle={toggle} />
          </TableHead>
          <TableHead>
            <SortHeader label="Location" sortKey="location" sort={sort} toggle={toggle} />
          </TableHead>
          <TableHead className="text-right">
            <SortHeader label="Visitors" sortKey="visitors" sort={sort} toggle={toggle} align="right" />
          </TableHead>
          <TableHead className="text-right">
            <SortHeader label="Clicks" sortKey="clicks" sort={sort} toggle={toggle} align="right" />
          </TableHead>
          <TableHead className="text-right">
            <SortHeader label="Partners" sortKey="partners" sort={sort} toggle={toggle} align="right" />
          </TableHead>
          <TableHead className="text-right">
            <SortHeader label="Converted" sortKey="converted" sort={sort} toggle={toggle} align="right" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((event) => (
          <TableRow key={`${event.name}-${event.date ?? ""}-${event.location ?? ""}`}>
            <TableCell className="max-w-[16rem] truncate font-medium">
              {event.name}
            </TableCell>
            <TableCell>{dateLabel(event.date)}</TableCell>
            <TableCell className="max-w-[12rem] truncate">
              {event.location ?? "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{event.visitors}</TableCell>
            <TableCell className="text-right tabular-nums">{event.clicks}</TableCell>
            <TableCell className="text-right tabular-nums">
              {event.partnerBreakdown.length > 0 ? (
                <HoverCard openDelay={150}>
                  <HoverCardTrigger asChild>
                    <span className="cursor-help underline decoration-dotted underline-offset-4">
                      {event.partners}
                    </span>
                  </HoverCardTrigger>
                  <HoverCardContent align="end" className="w-64 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Visitors each partner brought
                    </p>
                    <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
                      {event.partnerBreakdown.map((share) => (
                        <div
                          key={share.code}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <span className="min-w-0 truncate">{share.name}</span>
                          <span className="shrink-0 tabular-nums">
                            {share.visitors}
                            <span className="ml-1 text-xs text-muted-foreground">
                              · {share.clicks} clicks
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                event.partners
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {event.paidBookings > 0 ? (
                <>
                  <span className="font-medium">{event.paidBookings}</span>
                  {event.conversionRate != null && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {(event.conversionRate * 100).toFixed(
                        event.conversionRate < 0.01 ? 1 : 0
                      )}
                      %
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
