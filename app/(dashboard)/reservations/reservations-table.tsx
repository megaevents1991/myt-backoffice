"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table";
import type { Reservation } from "@/types/reservation.types";
import { getReservations, updateReservation, updateReservationsStatus } from "@/lib/actions/reservation-actions";
import { useToast } from "@/hooks/use-toast";

export function ReservationsTable() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isIdle, setIsIdle] = useState(false);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const { toast } = useToast();
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

  // Function to check for new reservations
  async function checkForNewReservations() {
    try {
      const data = await getReservations();
      if (data.length > reservations.length) {
        setReservations(data);
        toast({
          variant: "default",
          title: "New Reservations",
          description: "The table has been updated with new reservations.",
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
      if (isIdle) {
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
  }, [isIdle, reservations]);

  async function handleInlineUpdate(
    id: number,
    field: keyof Pick<Reservation, "comments" | "accounting_number">,
    value: string
  ) {
    // Prepare payload
    const payload: Partial<Reservation> = {};
    if (field === "accounting_number") {
      // Keep only digits
      const digits = (value || "").replace(/\D/g, "");
      if (digits.length === 0) {
        setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, accounting_number: (null as unknown as number) } : r)));
        try {
          await updateReservation(id, { accounting_number: (null as unknown as number) });
          toast({ title: "Updated", description: "Accounting number cleared." });
        } catch (e) {
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
      } catch (e) {
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
      } catch (e) {
        setReservations((prev) => prev);
        toast({ variant: "destructive", title: "Error", description: "Failed to save comment." });
      }
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
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update statuses." });
    }
  }

  const columns: ColumnDef<Reservation>[] = [
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
        const paymentType = reservation.payment_info ? "Card" : "Phone";
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
        return <div>{status || "-"}</div>;
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
      id: "actions",
      cell: ({ row }) => {
        const reservation = row.original;

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
          </div>
        );
      },
    },
  ];

  if (loading) {
    return <div>Loading reservations...</div>;
  }

  return (
    <DataTable
      columns={columns}
      data={reservations}
      searchColumns={[
        "id",
        "main_contact_first_name",
        "main_contact_last_name",
        "main_contact_phone_number",
        "main_contact_email",
      ]}
      searchPlaceholder="Search by name, phone, or email..."
      defaultPageSize={50}
  pageSizeOptions={[10, 25, 50, 100]}
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
        </div>
      }
      rightActions={
        <Button variant="outline" size="sm" onClick={refreshNow} title="Refresh data">
          Refresh
        </Button>
      }
    />
  );
}
