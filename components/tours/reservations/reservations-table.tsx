"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, SortableHeader } from "@/components/data-table";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { EMPTY, fmtInstant, formatDateShort } from "@/lib/tours/format";
import { departureHref, linkClass } from "@/lib/tours/links";
import { deleteToursReservation } from "@/lib/actions/tours-reservation-actions";
import type { ToursReservationRow } from "@/components/tours/reservations/types";

type View = "all" | "bookings" | "cancellations";

interface ToursReservationsTableProps {
  rows: ToursReservationRow[];
  onDeleted: (id: string) => void;
  /** Inside one departure's card: its own departure columns are left out. */
  oneDeparture?: boolean;
  /** No delete button (a deleted departure). */
  readOnly?: boolean;
}

/**
 * The reservations of a tours company on the shared DataTable - the same
 * table look as the Mega Events Reservations screen. One row per booking
 * (+travelers) or cancellation (-travelers).
 */
export function ToursReservationsTable({ rows, onDeleted, oneDeparture, readOnly }: ToursReservationsTableProps) {
  const confirm = useConfirm();
  const run = useActionToast();
  const [view, setView] = useState<View>("all");
  const [removing, setRemoving] = useState<string | null>(null);
  // The columns are memoized; the delete button must still call the latest callback.
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  const remove = async (row: ToursReservationRow) => {
    const agreed = await confirm({
      title: "Delete this reservation?",
      description: `${Math.abs(row.pax)} travelers on ${row.departureCode}, entered ${fmtInstant(row.createdAt)}. The row is marked deleted and stops counting on the departure; it stays recoverable.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!agreed) return;
    setRemoving(row.id);
    const result = await run(() => deleteToursReservation(row.id), "Reservation deleted");
    setRemoving(null);
    if (result.success) onDeletedRef.current(row.id);
  };

  const columns = useMemo<ColumnDef<ToursReservationRow>[]>(() => {
    const all: (ColumnDef<ToursReservationRow> | false)[] = [
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader label="Created At" column={column} />,
        cell: ({ row }) => <div className="whitespace-nowrap tabular">{fmtInstant(row.original.createdAt)}</div>,
      },
      {
        accessorKey: "customerName",
        header: "Customer",
        cell: ({ row }) => <div dir="auto">{row.original.customerName || EMPTY}</div>,
      },
      {
        accessorKey: "customerPhone",
        header: "Phone",
        cell: ({ row }) => <div className="whitespace-nowrap tabular">{row.original.customerPhone || EMPTY}</div>,
      },
      { accessorKey: "customerEmail", header: "Email", cell: ({ row }) => row.original.customerEmail || EMPTY },
      !oneDeparture && {
        accessorKey: "tourName",
        header: ({ column }) => <SortableHeader label="Tour" column={column} />,
        cell: ({ row }) => <div dir="auto">{row.original.tourName || EMPTY}</div>,
      },
      !oneDeparture && {
        accessorKey: "departureCode",
        header: ({ column }) => <SortableHeader label="Departure" column={column} />,
        cell: ({ row }) => (
          <Link href={departureHref(row.original.departureCode)} className={cn(linkClass, "whitespace-nowrap")}>
            {row.original.departureCode}
            {row.original.departureDate && (
              <span className="ms-1.5 font-normal text-muted-foreground tabular">
                {formatDateShort(row.original.departureDate)}
              </span>
            )}
          </Link>
        ),
      },
      {
        accessorKey: "pax",
        header: ({ column }) => <SortableHeader label="Travelers" column={column} />,
        cell: ({ row }) => (
          <div className={cn("font-semibold tabular", row.original.pax < 0 ? "text-destructive" : "text-success")}>
            {row.original.pax > 0 ? `+${row.original.pax}` : row.original.pax}
          </div>
        ),
      },
      // "TBD" until accounting gives the number - the Mega Events reservations show the same.
      { accessorKey: "docketNo", header: "Docket", cell: ({ row }) => <div className="tabular">{row.original.docketNo || "TBD"}</div> },
      {
        accessorKey: "note",
        header: "Note",
        cell: ({ row }) => (
          <div dir="auto" className="max-w-[16rem] truncate text-muted-foreground" title={row.original.note ?? undefined}>
            {row.original.note || ""}
          </div>
        ),
      },
      { accessorKey: "enteredBy", header: "Entered By", cell: ({ row }) => row.original.enteredBy || EMPTY },
      !readOnly && {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="Delete reservation"
            aria-label="Delete reservation"
            disabled={removing === row.original.id}
            onClick={() => remove(row.original)}
          >
            {removing === row.original.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        ),
      },
    ];
    return all.filter((c): c is ColumnDef<ToursReservationRow> => Boolean(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneDeparture, readOnly, removing]);

  const bookings = rows.filter((r) => r.pax > 0);
  const cancellations = rows.filter((r) => r.pax < 0);
  const shown = view === "bookings" ? bookings : view === "cancellations" ? cancellations : rows;
  // A departure's card remembers its search for that departure only (every row of the card carries it).
  // The key also remounts the table, so moving to another departure reads that departure's search.
  const stateKey = oneDeparture ? `tours-reservations-card:${rows[0]?.departureId ?? ""}` : "tours-reservations";

  return (
    <DataTable
      key={stateKey}
      columns={columns}
      data={shown}
      searchColumns={
        oneDeparture
          ? ["customerName", "customerPhone", "customerEmail", "docketNo", "note"]
          : ["customerName", "customerPhone", "customerEmail", "docketNo", "departureCode", "tourName", "note"]
      }
      searchPlaceholder={oneDeparture ? "Search by customer, phone or docket..." : "Search by customer, phone, docket or tour..."}
      defaultPageSize={oneDeparture ? 10 : 50}
      pageSizeOptions={[10, 25, 50, 100]}
      dense
      getRowId={(row) => row.id}
      defaultSorting={[{ id: "createdAt", desc: true }]}
      views={[
        { id: "all", label: "All", count: rows.length },
        { id: "bookings", label: "Bookings", count: bookings.length },
        { id: "cancellations", label: "Cancellations", count: cancellations.length },
      ]}
      activeView={view}
      onViewChange={(id) => setView(id as View)}
      stateKey={stateKey}
      emptyState={{
        title: "No reservations yet",
        description: oneDeparture
          ? "Travelers sold on this departure appear here."
          : "Add a reservation for every booking taken outside the site - it counts on the departure's seats.",
      }}
    />
  );
}
