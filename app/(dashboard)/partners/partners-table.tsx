"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDown,
  Edit,
  Trash2,
  Eye,
  LogIn,
  MoreHorizontal,
  Copy,
  Power,
  PowerOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/data-table";
import {
  MARKETING_PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  isCustomerRefundPartner,
  type PartnerType,
} from "@/types/partner.types";
import {
  getPartners,
  getCustomerRefundPartners,
  deletePartner,
  bulkDeletePartners,
  bulkDuplicatePartners,
  setPartnersActive,
  type CustomerRefundPartners,
  type PartnerListItem,
} from "@/lib/actions/partner-actions";
import { impersonatePartner } from "@/lib/actions/impersonate-actions";
import { describeCommission } from "@/lib/partner-commission";
import { ADMIN_ROLES } from "@/types/auth.types";
import { useAuth } from "@/contexts/auth-context";
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
  // Refund rows live in their own tab and load on demand — there are thousands,
  // and fetching them alongside the real partners is what truncated this list.
  const [refunds, setRefunds] = useState<CustomerRefundPartners | null>(null);
  const [refundsLoading, setRefundsLoading] = useState(false);
  const { toast } = useToast();
  // Editing a partner also creates/updates its portal login, which is an
  // admin-only action — so editors get a read-only list rather than buttons
  // that fail with "Unauthorized".
  const { user: me } = useAuth();
  const canManage = !!me && ADMIN_ROLES.includes(me.role);
  const isSuperadmin = me?.role === "superadmin";

  // Superadmin "login as partner": mint the /portal-scoped impersonation
  // cookie, then open the portal in a fresh window — the dashboard session in
  // this and every other tab is untouched (the cookie only rides on /portal).
  const handleImpersonate = async (trackingCode: string) => {
    // Open synchronously so popup blockers don't eat the window, navigate
    // once the cookie is set.
    const win = window.open("about:blank", "_blank");
    try {
      const result = await impersonatePartner(trackingCode);
      if (!result.ok) {
        win?.close();
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }
      if (win) win.location.href = "/portal";
      else window.open("/portal", "_blank");
    } catch (error) {
      win?.close();
      console.error("Error impersonating partner:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to open the portal as this partner.",
      });
    }
  };

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

  // The "fetched already" flag is a ref, not state, and the deps list holds only
  // `typeFilter`: a state flag here would re-render, tear this effect down, and
  // cancel its own in-flight request — leaving the tab loading forever.
  const refundsRequested = useRef(false);

  useEffect(() => {
    if (typeFilter !== "customer_refund" || refundsRequested.current) return;
    refundsRequested.current = true;
    setRefundsLoading(true);
    getCustomerRefundPartners()
      .then(setRefunds)
      .catch((error: unknown) => {
        console.error("Error fetching customer-refund partners:", error);
        refundsRequested.current = false; // let re-opening the tab retry
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load customer-refund rows.",
        });
      })
      .finally(() => setRefundsLoading(false));
  }, [typeFilter, toast]);

  const filtered = useMemo(() => {
    // The refund tab reads its own lazily-fetched page; `partners` deliberately
    // never carries those rows (see getPartners).
    const source =
      typeFilter === "customer_refund" ? (refunds?.rows ?? []) : partners;
    return source.filter((partner) => {
      const type = partnerType(partner);
      if (typeFilter === "all") {
        if (type === "customer_refund") return false;
      } else if (type !== typeFilter) {
        return false;
      }
      if (statusFilter === "active" && !partner.is_active) return false;
      if (statusFilter === "inactive" && partner.is_active) return false;
      return true;
    });
  }, [partners, refunds, typeFilter, statusFilter]);

  const counts = useMemo(() => {
    const active = partners.filter((p) => p.is_active);
    const activeType = (t: PartnerType) =>
      active.filter((p) => partnerType(p) === t).length;
    // Marketing counts are active-only, matching the default status filter — so
    // "All" always equals agent + affiliate and never overstates the rows shown.
    const marketing = active.filter((p) => partnerType(p) !== "customer_refund");
    return {
      all: marketing.length,
      agent: activeType("agent"),
      affiliate: activeType("affiliate"),
      // Whole-table total from a count query — those rows aren't loaded here.
      customer_refund: refunds?.total ?? null,
      // Scoped to the type tab in view — the status filter is orthogonal to it,
      // so a global number would contradict the rows on the refund tab. On the
      // refund tab this counts the loaded page only, which is all we hold.
      inactive: (typeFilter === "customer_refund"
        ? (refunds?.rows ?? [])
        : partners
      ).filter(
        (p) =>
          !p.is_active &&
          (typeFilter === "all"
            ? partnerType(p) !== "customer_refund"
            : partnerType(p) === typeFilter)
      ).length,
    };
  }, [partners, refunds, typeFilter]);

  const selectedCodes = useMemo(
    () => Object.keys(rowSelection).filter((code) => rowSelection[code]),
    [rowSelection]
  );

  /** Drop deleted rows from BOTH lists — the refund tab has its own copy. */
  const forgetPartners = (codes: string[]) => {
    setPartners((prev) =>
      prev.filter((p) => !codes.includes(p.partner_tracking_code))
    );
    setRefunds((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.filter((p) => !codes.includes(p.partner_tracking_code));
      return { ...prev, rows, total: prev.total - (prev.rows.length - rows.length) };
    });
  };

  const handleDelete = async (trackingCode: string) => {
    try {
      // Structured result — production masks thrown server-action messages,
      // so the real reason (FK block, login removal failure) must come back
      // as a value, not an exception.
      const result = await deletePartner(trackingCode);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }
      forgetPartners([trackingCode]);
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
      const result = await bulkDeletePartners(selectedCodes);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }
      forgetPartners(selectedCodes);
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

  // Row toggle and bulk buttons share this — old-data cleanup shouldn't need
  // the edit form for every partner.
  const handleSetActive = async (codes: string[], active: boolean) => {
    setBusy(true);
    try {
      const result = await setPartnersActive(codes, active);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }
      setPartners((prev) =>
        prev.map((p) =>
          codes.includes(p.partner_tracking_code) ? { ...p, is_active: active } : p
        )
      );
      setRowSelection({});
      toast({
        title: active ? "Activated" : "Deactivated",
        description: `${codes.length} partner${codes.length > 1 ? "s" : ""} ${active ? "activated" : "deactivated"}.`,
      });
    } catch (error) {
      console.error("Error toggling partner status:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update partner status. Please try again.",
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
          Commission
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      // The column carries no unit of its own — a percentage partner formatted
      // as currency reads as "$8" when they actually earn 8% of the sale.
      cell: ({ row }) =>
        describeCommission({
          type: row.original.commission_type,
          rate: row.original.commission,
        }),
    },
    {
      accessorKey: "user_discount",
      header: "Follower Discount",
      cell: ({ row }) => usd.format(row.original.user_discount ?? 0),
    },
    {
      accessorKey: "is_active",
      header: "Status",
      // Admins flip status inline (also syncs the portal login); read-only
      // roles keep the badge. Note the default filter shows Active only, so a
      // toggled-off row moves to the Inactive tab immediately — expected.
      cell: ({ row }) =>
        canManage ? (
          <div className="flex items-center gap-2">
            <Switch
              checked={row.original.is_active}
              disabled={busy}
              onCheckedChange={(v) =>
                handleSetActive([row.original.partner_tracking_code], v === true)
              }
              aria-label="Toggle partner active"
            />
            <span className="text-xs text-muted-foreground">
              {row.original.is_active ? "Active" : "Inactive"}
            </span>
          </div>
        ) : row.original.is_active ? (
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
        const type = partnerType(row.original);

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
                {canManage && (
                  <DropdownMenuItem asChild>
                    <Link href={`/partners/${trackingCode}`} className="flex items-center">
                      <Edit className="mr-2 h-4 w-4" />
                      <span>Edit</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                {/* Refund rows aren't partners — nothing to log into. */}
                {isSuperadmin && type !== "customer_refund" && (
                  <DropdownMenuItem
                    className="flex items-center"
                    onClick={() => handleImpersonate(trackingCode)}
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    <span>Login as {type === "agent" ? "agent" : "affiliate"}</span>
                  </DropdownMenuItem>
                )}
                {canManage && (
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem className="flex items-center text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                )}
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

  const onRefundTab = typeFilter === "customer_refund";

  return (
    <div className="space-y-3">
      {onRefundTab && refundsLoading && (
        <p className="text-sm text-muted-foreground">
          Loading customer-refund rows…
        </p>
      )}
      {onRefundTab && refunds?.truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the {refunds.rows.length} most recent of {refunds.total} customer-refund
          rows. These are opened automatically per booking and are not partner marketing.
        </p>
      )}
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
        !canManage ? undefined : (
        <div className="flex items-center gap-2">
          {/* Bulk status flip — the old-data cleanup path. Refund rows have no
              meaningful active state, same reason Duplicate skips that tab. */}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || onRefundTab}
            onClick={() => handleSetActive(selectedCodes, true)}
          >
            <Power className="mr-2 h-4 w-4" />
            Activate ({selectedCodes.length})
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || onRefundTab}
            onClick={() => handleSetActive(selectedCodes, false)}
          >
            <PowerOff className="mr-2 h-4 w-4" />
            Deactivate ({selectedCodes.length})
          </Button>
          {/* Refund rows are opened per booking, never templated from — and a
              copy would land on a tab the user isn't looking at. */}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || onRefundTab}
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
        )
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
                // Count is unknown until the tab is opened and the page loads.
                label:
                  counts.customer_refund == null
                    ? PARTNER_TYPE_LABELS.customer_refund
                    : `${PARTNER_TYPE_LABELS.customer_refund} (${counts.customer_refund})`,
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
    </div>
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
