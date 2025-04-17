"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import type { Reservation } from "@/types/reservation.types";
import { getReservations } from "@/lib/actions/reservation-actions";
import { useToast } from "@/hooks/use-toast";

export function ReservationsTable() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isIdle, setIsIdle] = useState(false);
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

  const columns: ColumnDef<Reservation>[] = [
    {
      accessorKey: "id",
      header: "ID",
    },
    {
      accessorKey: "main_contact_first_name",
      header: "First Name",
    },
    {
      accessorKey: "main_contact_last_name",
      header: "Last Name",
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
      header: "Is Partner",
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
      searchColumn="main_contact_email"
      searchPlaceholder="Search reservations..."
    />
  );
}
