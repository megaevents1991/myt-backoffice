"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { DataTable, DataTableSkeleton } from "@/components/data-table";
import type { ReservationListRow } from "@/types/reservation.types";
import {
  getReservations,
  getReservationsCount,
  updateReservation,
  updateReservationsStatus,
  softDeleteReservation,
  bulkSoftDeleteReservations,
} from "@/lib/actions/reservation-actions";
import { setFollowUpDate } from "@/lib/actions/reservation-follow-up-actions";
import { useToast } from "@/hooks/use-toast";
import { useSessionState, useUrlState } from "@/hooks/use-view-state";
import { useConfirm } from "@/components/confirm-provider";
import { useAuth } from "@/contexts/auth-context";
import { FOLLOW_UP_TONE } from "@/components/follow-up-widget";
import { cn } from "@/lib/utils";
import { israelDate } from "@/lib/tasks/reminders";
import {
  FOLLOW_UP_STATUS,
  compareFollowUps,
  followUpDateOnSave,
  followUpLabel,
  followUpState,
  isFollowUpDate,
  isFollowUpStatus,
  needsCallNow,
} from "@/lib/reservations/follow-up";

function isOfflineReservation(r: ReservationListRow) {
  return r.offline_flight_id != null || r.offline_hotel_id != null;
}

// "Which pile am I looking at" lives in the URL (?status=Follow-up) - the dashboard and the
// morning mail link straight to it, and a refresh keeps it.
const STATUS_VIEWS = ["all", FOLLOW_UP_STATUS] as const;
type StatusView = (typeof STATUS_VIEWS)[number];

const STATUS_TONE: Record<string, string> = {
  paid: "border-success/30 bg-success-muted text-success",
  pending: "border-info/30 bg-info-muted text-info",
  lost: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
};

/** Follow-up is the one status that asks for an action, so it is the one that shouts. */
function statusTone(status: string | null | undefined) {
  if (isFollowUpStatus(status)) return "border-warning/40 bg-warning-muted text-warning";
  return STATUS_TONE[(status ?? "").trim().toLowerCase()] ?? "border-border bg-background text-foreground";
}

/**
 * The call-back day of a Follow-up row, edited in place. Uncontrolled like the row's other
 * inline boxes: a picked or fully typed day saves at once, an emptied box saves on blur -
 * a controlled box would read every half-typed day as "cleared".
 */
function FollowUpDay({
  date,
  today,
  onSave,
}: {
  date: string | null;
  today: string;
  onSave: (next: string | null) => void;
}) {
  const state = followUpState(date, today);
  return (
    <div className="flex items-center gap-1.5">
      <input
        // Remount when the stored day changes elsewhere (a bulk status change, a failed save).
        key={date ?? "none"}
        type="date"
        aria-label="Call the customer back on"
        title="The day to call the customer back"
        defaultValue={date ?? ""}
        onChange={(e) => {
          if (isFollowUpDate(e.target.value)) onSave(e.target.value);
        }}
        onBlur={(e) => {
          if (e.target.value === "") onSave(null);
        }}
        className={cn(
          "h-7 rounded-md border bg-background px-1.5 text-xs tabular text-foreground",
          state === "overdue" && "border-destructive/60",
          state === "today" && "border-warning/60",
        )}
      />
      <span
        className={cn(
          "whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-semibold",
          FOLLOW_UP_TONE[state],
        )}
      >
        {followUpLabel(date, today, "en")}
      </span>
    </div>
  );
}

export function ReservationsTable() {
  const [reservations, setReservations] = useState<ReservationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isIdle, setIsIdle] = useState(false);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState<string>("");
  // Remembered for the browser tab (hooks/use-view-state.ts) - a refresh used to reset both.
  const [offlineOnly, setOfflineOnly] = useSessionState("offlineOnly", false);
  const [showDeleted, setShowDeleted] = useSessionState("showDeleted", false);
  const [statusView, setStatusView] = useUrlState<StatusView>("status", "all", STATUS_VIEWS);
  // A call-back day is a day on the office's calendar, whatever the browser's clock says.
  const today = israelDate(new Date());
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
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

  /** The call-back day of a Follow-up row. Optimistic; a refused save puts the old day back. */
  async function handleFollowUpDate(id: number, date: string | null) {
    const before = reservations.find((r) => r.id === id)?.follow_up_date ?? null;
    if (before === date) return;
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, follow_up_date: date } : r)));
    const result = await setFollowUpDate(id, date).catch(() => ({ ok: false as const, error: "Could not save the date." }));
    if (result.ok) {
      toast({ title: "Updated", description: date ? "Call-back day saved." : "Call-back day cleared." });
      return;
    }
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, follow_up_date: before } : r)));
    toast({ variant: "destructive", title: "Error", description: result.error });
  }

  /**
   * The SELECTED reservation ids. Keys come straight from rowSelection because
   * the table is keyed by reservation id (getRowId below) - they were row
   * INDEXES before, looked up against the unfiltered `reservations` array, so
   * any active filter (Show deleted / Mega only) shifted them and the action
   * hit a different booking than the one ticked (prod, 24.8).
   */
  function selectedReservationIds(): number[] {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => Number.parseInt(key, 10))
      .filter((id) => Number.isFinite(id));
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
    const selectedIds = selectedReservationIds();
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
    if (!bulkStatus) return;
    const selectedIds = selectedReservationIds();
    if (selectedIds.length === 0) return;

    try {
      await updateReservationsStatus(selectedIds, bulkStatus);
      setReservations((prev) =>
        prev.map((r) => {
          if (!selectedIds.includes(r.id)) return r;
          // Same rule the server just applied: a row entering Follow-up gets a call-back day.
          const day = followUpDateOnSave({
            prevStatus: r.status,
            nextStatus: bulkStatus,
            current: r.follow_up_date,
            today,
          });
          return { ...r, status: bulkStatus, ...(day === undefined ? {} : { follow_up_date: day }) };
        }),
      );
      toast({ title: "Status updated", description: `Updated ${selectedIds.length} reservation(s).` });
      setBulkStatus("");
      setRowSelection({});
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
        // One line: a number wrapped at its hyphens and made every row three lines tall.
        return <div className="whitespace-nowrap tabular">{phone || "-"}</div>;
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
        return <div className="whitespace-nowrap tabular">${price.toFixed(2)}</div>;
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
        return <div className="whitespace-nowrap tabular">{date.toLocaleDateString()}</div>;
      },
    },
    {
      accessorKey: "comments",
      header: "Comment",
      cell: ({ row }) => {
        const reservation = row.original;
        const input = (
          <Input
            // A floor on the width: the table squeezed this box to 55px, too
            // narrow to read its own placeholder.
            className="h-8 min-w-[16ch]"
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
            className="h-8 min-w-[10ch] no-spinner"
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
        const reservation = row.original;
        const status = row.getValue("status") as string;
        const settlementMethod = reservation.partner_settlement_method;
        return (
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5">
              {status ? (
                <span
                  className={cn(
                    "whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
                    statusTone(status),
                  )}
                >
                  {status}
                </span>
              ) : (
                "-"
              )}
              {settlementMethod === "voucher" && (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800"
                  title="Awaiting voucher from partner - do not call customer for payment"
                >
                  Voucher
                </span>
              )}
            </div>
            {isFollowUpStatus(status) && (
              <FollowUpDay
                date={reservation.follow_up_date ?? null}
                today={today}
                onSave={(next) => handleFollowUpDate(reservation.id, next)}
              />
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
          <div className="flex items-center gap-0.5">
            <Link href={`/reservations/${reservation.id}`} title="View reservation">
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="View reservation">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            <Link href={`/reservations/${reservation.id}/edit`} title="Edit reservation">
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit reservation">
                <Edit className="h-4 w-4" />
              </Button>
            </Link>
            {isSuperadmin && !isDeleted && (
              <Button
                variant="ghost"
                size="icon"
                title="Delete reservation"
                aria-label="Delete reservation"
                className="h-8 w-8 text-destructive hover:text-destructive"
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
    return <DataTableSkeleton rows={12} label="Loading reservations" />;
  }

  const listedReservations = reservations
    .filter((r) => showDeleted || !r.is_deleted)
    .filter((r) => !offlineOnly || isOfflineReservation(r));
  // The Follow-up view is the pile in the order to work it (longest overdue first), not
  // newest-first like the full list. A column sort the user picks still wins.
  const followUpReservations = listedReservations
    .filter((r) => isFollowUpStatus(r.status))
    .sort((a, b) => compareFollowUps(a, b, today));
  const visibleReservations =
    statusView === FOLLOW_UP_STATUS ? followUpReservations : listedReservations;

  // Non-superadmins never see the Deleted column - they can't reveal deleted
  // rows via the toggle, so it would only ever read "-".
  const visibleColumns = isSuperadmin
    ? columns
    : columns.filter((c) => c.id !== "is_deleted" && (c as { accessorKey?: string }).accessorKey !== "is_deleted");

  return (
    <DataTable
      columns={visibleColumns}
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
      // Selection keyed by reservation id, NOT row index - filters (Show
      // deleted / Mega only) reorder the rendered rows, and index-keyed
      // selection then resolved to the wrong booking.
      getRowId={(row) => String(row.id)}
      views={[
        { id: "all", label: "All", count: listedReservations.length },
        { id: FOLLOW_UP_STATUS, label: "Follow-up", count: followUpReservations.length },
      ]}
      activeView={statusView}
      onViewChange={(id) => setStatusView(id === FOLLOW_UP_STATUS ? FOLLOW_UP_STATUS : "all")}
      // A customer waiting for a call back today stands out in the full list too.
      getRowClassName={(row) => {
        const r = row.original;
        if (!isFollowUpStatus(r.status) || r.is_deleted) return undefined;
        const state = followUpState(r.follow_up_date, today);
        if (!needsCallNow(state)) return undefined;
        return state === "overdue" ? "bg-destructive/5" : "bg-warning-muted/50";
      }}
      emptyState={
        statusView === FOLLOW_UP_STATUS
          ? { title: "Nobody is waiting for a call back", description: "No reservation is in Follow-up right now." }
          : undefined
      }
      rowSelection={rowSelection}
      onRowSelectionChange={(selection) => setRowSelection(selection)}
      bulkActions={
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
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
          {isSuperadmin && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
            >
              Delete
            </Button>
          )}
        </div>
      }
      rightActions={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {isSuperadmin && (
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
          )}
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
