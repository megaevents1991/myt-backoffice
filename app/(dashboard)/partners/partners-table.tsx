"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Trash2, Eye, MoreHorizontal, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import {
  MARKETING_PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  isCustomerRefundPartner,
  type PartnerType,
} from "@/types/partner.types";
import {
  getPartners,
  deletePartner,
  bulkDeletePartners,
  bulkDuplicatePartners,
  type PartnerListItem,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "all" means all *marketing* partners — refund rows are their own tab. */
type TypeFilter = PartnerType | "all";
type StatusFilter = "all" | "active" | "inactive";

/** Effective type for display, resolving legacy untyped rows. */
function partnerType(partner: PartnerListItem): PartnerType {
  if (isCustomerRefundPartner(partner)) return "customer_refund";
  return partner.type === "agent" ? "agent" : "affiliate";
}

export function PartnersTable() {
  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
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

  const filtered = useMemo(
    () =>
      partners.filter((partner) => {
        const type = partnerType(partner);
        // Refund rows only ever show under their own tab — never under "all".
        if (typeFilter === "all") {
          if (type === "customer_refund") return false;
        } else if (type !== typeFilter) {
          return false;
        }
        if (statusFilter === "active" && !partner.is_active) return false;
        if (statusFilter === "inactive" && partner.is_active) return false;
        return true;
      }),
    [partners, typeFilter, statusFilter]
  );

  const counts = useMemo(() => {
    const active = partners.filter((p) => p.is_active);
    const activeType = (t: PartnerType) =>
      active.filter((p) => partnerType(p) === t).length;
    return {
      all: partners.filter((p) => partnerType(p) !== "customer_refund").length,
      agent: activeType("agent"),
      affiliate: activeType("affiliate"),
      customer_refund: activeType("customer_refund"),
      inactive: partners.length - active.length,
    };
  }, [partners]);

  const selectedCodes = useMemo(
    () => Object.keys(rowSelection).filter((code) => rowSelection[code]),
    [rowSelection]
  );

  const handleDelete = async (trackingCode: string) => {
    try {
      await deletePartner(trackingCode);
      setPartners((prev) =>
        prev.filter((partner) => partner.partner_tracking_code !== trackingCode)
      );
      toast({ title: "Partner deleted", description: "Partner has been deleted." });
    } catch (error) {
      console.error("Error deleting partner:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: deleteErrorMessage(error),
      });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCodes.length === 0) return;
    setBusy(true);
    try {
      await bulkDeletePartners(selectedCodes);
      setPartners((prev) =>
        prev.filter((partner) => !selectedCodes.includes(partner.partner_tracking_code))
      );
      setRowSelection({});
      toast({
        title: "Partners deleted",
        description: `${selectedCodes.length} partners have been deleted.`,
      });
    } catch (error) {
      console.error("Error bulk deleting partners:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: deleteErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDuplicate = async () => {
    if (selectedCodes.length === 0) return;
    setBusy(true);
    try {
      const created = await bulkDuplicatePartners(selectedCodes);
      setPartners((prev) => [...created, ...prev]);
      setRowSelection({});
      // Copies are created inactive — show them, or they'd land outside the
      // default "active" filter and look like nothing happened.
      setStatusFilter("inactive");
      toast({
        title: "Partners duplicated",
        description: `${created.length} inactive copies created. Edit them before activating.`,
      });
    } catch (error) {
      console.error("Error duplicating partners:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to duplicate partners. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnDef<PartnerListItem>[] = [
    {
      accessorKey: "name_hebrew",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const partner = row.original;
        return (
          <Link
            href={`/partners/${partner.partner_tracking_code}/view`}
            className="font-medium hover:underline"
          >
            {partner.name_hebrew || partner.email}
          </Link>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const type = partnerType(row.original);
        return (
          <Badge
            variant={
              type === "agent"
                ? "default"
                : type === "customer_refund"
                  ? "outline"
                  : "secondary"
            }
          >
            {PARTNER_TYPE_LABELS[type]}
          </Badge>
        );
      },
    },
    {
      accessorKey: "partner_tracking_code",
      header: "Tracking Code",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.partner_tracking_code}</span>
      ),
    },
    { accessorKey: "email", header: "Email" },
    {
      accessorKey: "commission",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Commission / ticket
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => usd.format(row.original.commission ?? 0),
    },
    {
      accessorKey: "user_discount",
      header: "User Discount",
      cell: ({ row }) => usd.format(row.original.user_discount ?? 0),
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="destructive">Inactive</Badge>
        ),
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Created
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => new Date(row.original.created_at).toLocaleDateString(),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const trackingCode = row.original.partner_tracking_code;

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
                    <Eye className="mr-2 h-4 w-4" />
                    <span>View performance</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/partners/${trackingCode}`} className="flex items-center">
                    <Edit className="mr-2 h-4 w-4" />
                    <span>Edit</span>
                  </Link>
                </DropdownMenuItem>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem className="flex items-center text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this partner?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes {trackingCode} and cannot be undone. Past
                  reservations keep their tracking code but the partner will vanish from
                  reports. To stop paying a partner while keeping their history, set them
                  to Inactive instead.
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
      data={filtered}
      searchColumns={["name_hebrew", "email", "partner_tracking_code"]}
      searchPlaceholder="Search by name, email or tracking code..."
      enableRowSelection
      getRowId={(row) => row.partner_tracking_code}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      bulkActions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={handleBulkDuplicate}
          >
            <Copy className="mr-2 h-4 w-4" />
            Duplicate ({selectedCodes.length})
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={busy}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete ({selectedCodes.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {selectedCodes.length} partners?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. Consider setting them Inactive instead to keep
                  their reporting history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      }
      rightActions={
        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { key: "all" as TypeFilter, label: `All (${counts.all})` },
              ...MARKETING_PARTNER_TYPES.map((type) => ({
                key: type as TypeFilter,
                label: `${PARTNER_TYPE_LABELS[type]} (${counts[type]})`,
              })),
              {
                key: "customer_refund" as TypeFilter,
                label: `${PARTNER_TYPE_LABELS.customer_refund} (${counts.customer_refund})`,
              },
            ]}
          />
          <span className="mx-1 h-5 w-px bg-border" />
          <FilterGroup
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { key: "active", label: "Active" },
              { key: "inactive", label: `Inactive (${counts.inactive})` },
              { key: "all", label: "Any" },
            ]}
          />
        </div>
      }
    />
  );
}

function FilterGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((option) => (
        <Button
          key={option.key}
          type="button"
          size="sm"
          variant={value === option.key ? "default" : "outline"}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * A partner with a portal user can't be deleted — `user_profiles` references it
 * with no ON DELETE rule, so Postgres raises a foreign-key violation.
 */
function deleteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/foreign key|violates/i.test(message)) {
    return "This partner has a portal user or other linked records. Remove the user first, or set the partner to Inactive instead.";
  }
  return "Failed to delete partner. Please try again.";
}
