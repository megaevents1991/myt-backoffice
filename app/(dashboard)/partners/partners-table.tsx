"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Trash2, Copy, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import type { Partner } from "@/types/partner.types";
import {
  getPartners,
  bulkDeletePartners,
  bulkDuplicatePartners,
} from "@/lib/actions/partner-actions";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function PartnersTable() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [selectedTrackingCodes, setSelectedTrackingCodes] = useState<string[]>(
    []
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
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

  useEffect(() => {
    // Extract the tracking codes from the selected rows
    const trackingCodes = Object.entries(selectedRows)
      .filter(([_, isSelected]) => isSelected)
      .map(([id]) => id);

    const codes = [] as string[];
    Object.entries(selectedRows).forEach(([id, isSelected]) => {
      if (isSelected) {
        const code = partners[parseInt(id)].partner_tracking_code;
        codes.push(code);
      }
    });
    setSelectedTrackingCodes(codes);
  }, [selectedRows]);

  const handleBulkDelete = async () => {
    if (selectedTrackingCodes.length === 0) return;

    setIsDeleting(true);
    try {
      await bulkDeletePartners(selectedTrackingCodes);

      // Update the local state
      setPartners(
        partners.filter(
          (partner) =>
            !selectedTrackingCodes.includes(partner.partner_tracking_code)
        )
      );

      toast({
        title: "Partners deleted",
        description: `${selectedTrackingCodes.length} partners have been deleted.`,
      });

      // Clear selection
      setSelectedRows({});
    } catch (error) {
      console.error("Error deleting partners:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete partners. Please try again.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDuplicate = async () => {
    if (selectedTrackingCodes.length === 0) return;

    setIsDuplicating(true);
    try {
      const duplicatedPartners = await bulkDuplicatePartners(
        selectedTrackingCodes
      );

      // Update the local state
      setPartners([...duplicatedPartners, ...partners]);

      toast({
        title: "Partners duplicated",
        description: `${selectedTrackingCodes.length} partners have been duplicated.`,
      });

      // Clear selection
      setSelectedRows({});
    } catch (error) {
      console.error("Error duplicating partners:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to duplicate partners. Please try again.",
      });
    } finally {
      setIsDuplicating(false);
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

        return (
          <div className="flex items-center gap-2">
            <Link href={`/partners/${partner.partner_tracking_code}/view`}>
              <Button variant="ghost" size="icon">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            <Link href={`/partners/${partner.partner_tracking_code}`}>
              <Button variant="ghost" size="icon">
                <Edit className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        );
      },
    },
  ];

  const BulkActions = () => {
    const [deleteConfirmation, setDeleteConfirmation] = useState("");
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    const expectedDeleteText = "delete these partners";
    const isDeleteConfirmed =
      deleteConfirmation.toLowerCase() === expectedDeleteText;

    return (
      <div className="flex gap-2">
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
        >
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeleting || selectedTrackingCodes.length === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {selectedTrackingCodes.length}{" "}
                partner(s). This action cannot be undone.
                <div className="mt-4">
                  <Label
                    htmlFor="delete-confirmation"
                    className="text-sm font-medium"
                  >
                    Type <span className="font-bold">{expectedDeleteText}</span>{" "}
                    to confirm
                  </Label>
                  <Input
                    id="delete-confirmation"
                    value={deleteConfirmation}
                    onChange={(e) => setDeleteConfirmation(e.target.value)}
                    className="mt-2"
                    placeholder={expectedDeleteText}
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteConfirmation("")}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  handleBulkDelete();
                  setDeleteConfirmation("");
                }}
                disabled={!isDeleteConfirmed}
                className={
                  !isDeleteConfirmed ? "opacity-50 cursor-not-allowed" : ""
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button
          variant="outline"
          size="sm"
          onClick={handleBulkDuplicate}
          disabled={isDuplicating || selectedTrackingCodes.length === 0}
        >
          <Copy className="h-4 w-4 mr-2" />
          Duplicate Selected
        </Button>
      </div>
    );
  };

  if (loading) {
    return <div>Loading partners...</div>;
  }

  return (
    <DataTable
      columns={columns}
      data={partners}
      searchColumn="email"
      searchPlaceholder="Search partners..."
      enableRowSelection={true}
      onRowSelectionChange={setSelectedRows}
      bulkActions={<BulkActions />}
    />
  );
}
