"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table";
import type { ReservationListRow } from "@/types/reservation.types";
import {
  getReservations,
  getReservationsCount,
  updateReservation,
  updateReservationsStatus,
  softDeleteReservation,
  bulkSoftDeleteReservations,
} from "@/lib/actions/reservation-actions";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";

function isOfflineReservation(r: ReservationListRow) {
  return r.offline_flight_id != null || r.offline_hotel_id != null;
}

export function ReservationsTable() {
  const [reservations, setReservations] = useState<ReservationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isIdle, setIsIdle] = useState(false);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const { toast } = useToast();
  const confirm = useConfirm();
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Refs mirror state for the poll interval, so the effect below can run once
  // on mount instead of tearing down/re-adding the interval + window listeners
  // on every data change.
  const isIdleRef = useRef(false);
  // Last server row-count the poll saw. Compared count-to-count: the table
  // fetch is capped at 1000 rows by Supabase, so comparing the exact count
  // against loaded rows.length fired "New Reservations" on every poll once
  // the table passed 1000 rows.
  const lastCountRef = useRef<number | null>(null);
  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  useEffect(() => {
    async function fetchReservations() {
      try {
        const data = await getReservations();
        setReservations(data);
      } catch (error) {
        console.error("Error fetching reservations:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load reservations. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchReservations();
  }, [toast]);
  async function refreshNow() {
    try {
      const data = await getReservations();
      setReservations(data);
      toast({ title: "Refreshed", description: "Latest reservations loaded." });
    } catch (error) {
      console.error("Error refreshing reservations:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to refresh reservations." });
    }
  }

  // Function to check for new reservations. Cheap count probe first - the
  // full table is only re-downloaded when something actually arrived.
  async function checkForNewReservations() {
    try {
      const count = await getReservationsCount();
      const last = lastCountRef.current;
      lastCountRef.current = count;
      // First probe only records the baseline - no toast.
      if (last !== null && count > last) {
        const data = await getReservations();
        setReservations(data);
        // Rows are ordered created_at desc and never hard-deleted, so the
        // first (count - last) rows are exactly the new arrivals.
        const newCount = count - last;
        const names = data
          .slice(0, Math.min(newCount, 3))
          .map((r) =>
            [r.main_contact_first_name, r.main_contact_last_name]
              .filter(Boolean)
              .join(" ") || `#${r.id}`
          );
        const more = newCount - names.length;
        toast({
          variant: "default",
          title: `${newCount} New Reservation${newCount > 1 ? "s" : ""}`,
          description: `${names.join(", ")}${more > 0 ? ` +${more} more` : ""}`,
        });
      }
    } catch (error) {
      console.error("Error checking for new reservations:", error);
    }
  }

  // Handle user activity to reset idle state
  function handleUserActivity() {
    setIsIdle(false);
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    idleTimeoutRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 30000); // 30 seconds of inactivity to consider the user idle
  }

  useEffect(() => {
    // Add event listeners for user activity
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("click", handleUserActivity);

    // Start polling for new reservations
    pollingIntervalRef.current = setInterval(() => {
      if (isIdleRef.current) {
        checkForNewReservations();
      }
    }, 30000); // Check every 30 seconds

    return () => {
      // Cleanup event listeners and intervals
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("click", handleUserActivity);
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
    // Mount-once: interval + listeners read live values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInlineUpdate(
    id: number,
    field: keyof Pick<ReservationListRow, "comments" | "accounting_number">,
    value: string
  ) {
    if (field === "accounting_number") {
      // Keep only digits
      const digits = (value || "").replace(/\D/g, "");
      if (digits.length === 0) {
        setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, accounting_number: (null as unknown as number) } : r)));
        try {
          await updateReservation(id, { accounting_number: (null as unknown as number) });
          toast({ title: "Updated", description: "Accounting number cleared." });
        } catch {
          toast({ variant: "destructive", title: "Error", description: "Failed to clear accounting number." });
        }
        return;
      }

      // Validate non-negative and within safe integer range
      try {
        const asBig = BigInt(digits);
        const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
        if (asBig > maxSafe) {
          toast({
            variant: "destructive",
            title: "Number too large",
            description: `Please enter a value up to ${Number.MAX_SAFE_INTEGER}.`,
          });
          return;
        }
        const num = Number(digits);
        // Optimistic update
        setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, accounting_number: (num as unknown as number) } : r)));
        await updateReservation(id, { accounting_number: (num as unknown as number) });
        toast({ title: "Updated", description: "Accounting number saved." });
      } catch {
        toast({ variant: "destructive", title: "Error", description: "Failed to save accounting number." });
      }
      return;
    }

    if (field === "comments") {
      const comments = value;
      setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, comments } : r)));
      try {
        await updateReservation(id, { comments });
        toast({ title: "Updated", description: "Comment saved." });
      } catch {
        setReservations((prev) => prev);
        toast({ variant: "destructive", title: "Error", description: "Failed to save comment." });
      }
    }
  }

  async function handleDelete(id: number) {
    try {
      const formattedDate = await softDeleteReservation(id).then(
        (r) => r.is_deleted as string,
      );
      setReservations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_deleted: formattedDate } : r))
      );
      toast({ title: "Deleted", description: "Reservation marked as deleted." });
    } catch (error) {
      console.error("Error deleting reservation:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to delete reservation." });
    }
  }

  async function handleBulkDelete() {
    const selectedIndexes = Object.keys(rowSelection).filter((k) => rowSelection[k]);
    const selectedIds = selectedIndexes
      .map((k) => Number.parseInt(k, 10))
      .filter((i) => !Number.isNaN(i))
      .map((i) => reservations[i]?.id)
      .filter((id): id is number => typeof id === "number");
    if (selectedIds.length === 0) return;
    if (
      !(await confirm({
        title: `Delete ${selectedIds.length} reservation(s)?`,
        description:
          "They are soft-deleted (marked as deleted) and stay recoverable.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await bulkSoftDeleteReservations(selectedIds);
      const formattedDate = new Date();
      const stamp = `${(formattedDate.getMonth() + 1).toString().padStart(2, "0")}-${formattedDate.getDate().toString().padStart(2, "0")}-${formattedDate.getFullYear()}`;
      setReservations((prev) =>
        prev.map((r) => (selectedIds.includes(r.id) ? { ...r, is_deleted: stamp } : r))
      );
      setRowSelection({});
      toast({ title: "Deleted", description: `${selectedIds.length} reservation(s) marked as deleted.` });
    } catch (error) {
      console.error("Bulk delete failed:", error);
      toast({ variant: "destructive", title: "Error", description: "Bulk delete failed." });
    }
  }

  async function applyBulkStatus() {
    const selectedIndexes = Object.keys(rowSelection).filter((k) => rowSelection[k]);
    if (selectedIndexes.length === 0 || !bulkStatus) return;
    const selectedIds = selectedIndexes
      .map((k) => Number.parseInt(k, 10))
      .filter((i) => !Number.isNaN(i))
      .map((i) => reservations[i]?.id)
      .filter((id): id is number => typeof id === "number");

    if (selectedIds.length === 0) return;

    try {
      await updateReservationsStatus(selectedIds, bulkStatus);
      setReservations((prev) => prev.map((r) => (selectedIds.includes(r.id) ? { ...r, status: bulkStatus } : r)));
      toast({ title: "Status updated", description: `Updated ${selectedIds.length} reservation(s).` });
      setBulkStatus("");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update statuses." });
    }
  }

  const columns: ColumnDef<ReservationListRow>[] = [
    {
      accessorKey: "id",
      header: "ID",
    },
    {
      accessorKey: "main_contact_first_name",
      header: "First Name",
    },
    { accessorKey: "main_contact_last_name", header: "Last Name" },
    {
      accessorKey: "main_contact_phone_number",
      header: "Phone",
      cell: ({ row }) => {
        const phone = row.getValue("main_contact_phone_number") as string;
        return <div>{phone || "-"}</div>;
      },
    },
    {
      accessorKey: "main_contact_email",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Email
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
    },
    {
      accessorKey: "event_id",
      header: "Event ID",
    },
    {
      accessorKey: "user_shown_price",
      header: "Price",
      cell: ({ row }) => {
        const price = Number.parseFloat(row.getValue("user_shown_price"));
        return <div>${price.toFixed(2)}</div>;
      },
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Created At
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue("created_at"));
        return <div>{date.toLocaleDateString()}</div>;
      },
    },
    {
      accessorKey: "comments",
      header: "Comment",
      cell: ({ row }) => {
        const reservation = row.original;
        const input = (
          <Input
            defaultValue={reservation.comments || ""}
            placeholder="Add a comment"
            onBlur={(e) =>
              handleInlineUpdate(reservation.id, "comments", e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        );
        if (!reservation.comments) return input;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>{input}</TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm break-words">
                {reservation.comments}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      accessorKey: "accounting_number",
      header: "Acc No.",
      cell: ({ row }) => {
        const reservation = row.original;
        return (
          <Input
            type="number"
            className="min-w-[10ch] no-spinner"
            defaultValue={reservation.accounting_number ?? undefined}
            placeholder="TBD"
            onChange={(e) => {
              // Allow only digits and limit to 19 digits (Postgres BIGINT max)
              const clean = e.target.value.replace(/\D/g, "").slice(0, 19);
              if (e.target.value !== clean) {
                e.currentTarget.value = clean;
              }
            }}
            onBlur={(e) =>
              handleInlineUpdate(
                reservation.id,
                "accounting_number",
                e.target.value
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        );
      },
    },
    {
      id: "payment_type",
      header: "Payment Type",
      cell: ({ row }) => {
        const reservation = row.original;
        const paymentType = reservation.has_payment_info ? "Card" : "Phone";
        return <div>{paymentType}</div>;
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Status
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        const settlementMethod = row.original.partner_settlement_method;
        return (
          <div className="flex items-center gap-1.5">
            {status || "-"}
            {settlementMethod === "voucher" && (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800"
                title="Awaiting voucher from partner - do not call customer for payment"
              >
                Voucher
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "aff_partner_tracking_code",
      header: "Source",
      cell: ({ row }) => {
        const trackingCode = row.getValue("aff_partner_tracking_code");
        // Convert to string or use "Organic" if trackingCode is falsy or an empty object
        return (
          <div>
            {trackingCode && typeof trackingCode !== "object"
              ? String(trackingCode)
              : "Organic"}
          </div>
        );
      },
    },
    {
      accessorKey: "agent_label",
      header: "סוכן",
      cell: ({ row }) => {
        const label = row.getValue("agent_label") as string | null;
        return <div>{label || "-"}</div>;
      },
    },
    {
      accessorKey: "is_deleted",
      header: "Deleted",
      cell: ({ row }) => {
        const deletedDate = row.getValue("is_deleted") as string | null | undefined;
        return deletedDate ? <div>{String(deletedDate)}</div> : <div>-</div>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const reservation = row.original;
        const isDeleted = Boolean(reservation.is_deleted);

        return (
          <div className="flex items-center gap-2">
            <Link href={`/reservations/${reservation.id}`}>
              <Button variant="ghost" size="icon">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            <Link href={`/reservations/${reservation.id}/edit`}>
              <Button variant="ghost" size="icon">
                <Edit className="h-4 w-4" />
              </Button>
            </Link>
            {!isDeleted && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: "Delete this reservation?",
                      description:
                        "It is soft-deleted (marked as deleted) and stays recoverable.",
                      confirmLabel: "Delete",
                      destructive: true,
                    }))
                  )
                    return;
                  handleDelete(reservation.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) {
    return <div>Loading reservations...</div>;
  }

  const visibleReservations = reservations
    .filter((r) => showDeleted || !r.is_deleted)
    .filter((r) => !offlineOnly || isOfflineReservation(r));

  return (
    <DataTable
      columns={columns}
      data={visibleReservations}
      searchColumns={[
        "id",
        "main_contact_first_name",
        "main_contact_last_name",
        "main_contact_phone_number",
        "main_contact_email",
        "accounting_number",
      ]}
      searchPlaceholder="Search by name, phone, email, or acc no..."
      defaultPageSize={50}
  pageSizeOptions={[10, 25, 50, 100]}
      dense
      enableRowSelection
      onRowSelectionChange={(selection) => setRowSelection(selection)}
      bulkActions={
        <div className="flex items-center gap-2">
          <select
            className="border rounded px-2 py-1"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
          >
            <option value="">Set status…</option>
            <option value="Paid">Paid</option>
            <option value="Lost">Lost</option>
            <option value="Pending">Pending</option>
            <option value="Follow-up">Follow-up</option>
          </select>
          <Button size="sm" onClick={applyBulkStatus} disabled={!bulkStatus}>
            Apply
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDelete}
          >
            Delete
          </Button>
        </div>
      }
      rightActions={
        <div className="flex items-center gap-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-deleted-reservations"
              checked={showDeleted}
              onCheckedChange={(checked) => setShowDeleted(checked as boolean)}
            />
            <label htmlFor="show-deleted-reservations" className="text-sm font-medium">
              Show deleted
            </label>
          </div>
          <Button
            variant={offlineOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setOfflineOnly((v) => !v)}
            title="Show only Mega offline inventory bookings"
          >
            {offlineOnly ? "Showing Mega only" : "Mega only"}
          </Button>
          <Button variant="outline" size="sm" onClick={refreshNow} title="Refresh data">
            Refresh
          </Button>
        </div>
      }
    />
  );
}
