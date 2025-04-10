"use client";

import { useState, useEffect } from "react";
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
  const { toast } = useToast();

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
