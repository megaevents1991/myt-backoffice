"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Trash2, Eye, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import type { Partner } from "@/types/partner.types";
import { getPartners, deletePartner } from "@/lib/actions/partner-actions";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PartnersTable() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchPartners() {
      try {
        const data = await getPartners();
        setPartners(data);
      } catch (error) {
        console.error("Error fetching partners:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load partners. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchPartners();
  }, [toast]);

  const handleDelete = async (trackingCode: string) => {
    try {
      await deletePartner(trackingCode);

      // Update the local state
      setPartners(
        partners.filter(
          (partner) => partner.partner_tracking_code !== trackingCode
        )
      );

      toast({
        title: "Partner deleted",
        description: "Partner has been deleted.",
      });
    } catch (error) {
      console.error("Error deleting partner:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete partner. Please try again.",
      });
    }
  };

  const columns: ColumnDef<Partner>[] = [
    {
      accessorKey: "partner_tracking_code",
      header: "Tracking Code",
    },
    {
      accessorKey: "email",
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
      accessorKey: "name_hebrew",
      header: "Hebrew Name",
      cell: ({ row }) => {
        const name = row.getValue("name_hebrew") as string;
        return <div>{name}</div>;
      },
    },
    {
      accessorKey: "commission",
      header: "Commission ($)",
      cell: ({ row }) => {
        const commission = Number.parseFloat(row.getValue("commission"));
        return <div>${commission.toFixed(2)}</div>;
      },
    },
    {
      accessorKey: "user_discount",
      header: "User Discount ($)",
      cell: ({ row }) => {
        const discount = Number.parseFloat(row.getValue("user_discount"));
        return <div>${discount.toFixed(2)}</div>;
      },
    },
    {
      accessorKey: "created_at",
      header: "Created At",
      cell: ({ row }) => {
        const date = new Date(row.getValue("created_at"));
        return <div>{date.toLocaleDateString()}</div>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const partner = row.original;
        const trackingCode = partner.partner_tracking_code;

        return (
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link
                    href={`/partners/${trackingCode}/view`}
                    className="flex items-center"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    <span>View</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href={`/partners/${trackingCode}`}
                    className="flex items-center"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    <span>Edit</span>
                  </Link>
                </DropdownMenuItem>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem className="text-destructive flex items-center focus:text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this partner. This action cannot
                  be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleDelete(trackingCode)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      },
    },
  ];

  if (loading) {
    return <div>Loading partners...</div>;
  }

  return (
    <DataTable
      columns={columns}
      data={partners}
      searchColumn="email"
      searchPlaceholder="Search partners..."
      enableRowSelection={false}
    />
  );
}
