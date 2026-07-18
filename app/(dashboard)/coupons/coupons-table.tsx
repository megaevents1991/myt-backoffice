"use client";

import { useState, useEffect, useCallback } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PlusCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/data-table";
import type { Coupon } from "@/types/app.types";
import {
  getCoupons,
  createCoupon,
  updateCoupon,
  toggleCouponActive,
  deleteCoupon,
  getCouponEventOptions,
  getCouponPartnerOptions,
  type CouponInput,
} from "@/lib/actions/coupon-actions";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type EventOption = { id: number; name: string; date: string };
type PartnerOption = {
  partner_tracking_code: string;
  name_hebrew: string | null;
  type: string | null;
};

const emptyForm: CouponInput = {
  code: "",
  discount_type: "percent",
  discount_value: 0,
  event_id: null,
  valid_until: null,
  max_uses: null,
  partner_tracking_code: null,
  is_active: true,
};

export function CouponsTable() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<CouponInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchData() {
      try {
        const [couponData, eventData, partnerData] = await Promise.all([
          getCoupons(),
          getCouponEventOptions(),
          getCouponPartnerOptions(),
        ]);
        setCoupons(couponData);
        setEvents(eventData);
        setPartners(partnerData);
      } catch (error) {
        console.error("Error fetching coupons:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load coupons. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [toast]);

  const eventName = useCallback(
    (eventId: number | null) =>
      eventId == null
        ? null
        : events.find((e) => e.id === eventId)?.name ?? `#${eventId}`,
    [events]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditing(coupon);
    setForm({
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      event_id: coupon.event_id,
      valid_until: coupon.valid_until?.slice(0, 10) ?? null,
      max_uses: coupon.max_uses,
      partner_tracking_code: coupon.partner_tracking_code ?? null,
      is_active: coupon.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
      toast({
        variant: "destructive",
        title: "Invalid code",
        description:
          "Use letters, numbers, dash or underscore only (max 64 chars).",
      });
      return;
    }
    if (!form.discount_value || form.discount_value <= 0) {
      toast({
        variant: "destructive",
        title: "Invalid discount",
        description: "Discount value must be greater than 0.",
      });
      return;
    }
    if (form.discount_type === "percent" && form.discount_value > 100) {
      toast({
        variant: "destructive",
        title: "Invalid discount",
        description: "Percent discount can't exceed 100.",
      });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const updated = await updateCoupon(editing.id, { ...form, code });
        setCoupons(coupons.map((c) => (c.id === editing.id ? updated : c)));
        toast({ title: "Coupon updated", description: `${code} saved.` });
      } else {
        const created = await createCoupon({ ...form, code });
        setCoupons([created, ...coupons]);
        toast({ title: "Coupon created", description: `${code} is live.` });
      }
      setDialogOpen(false);
    } catch (error) {
      console.error("Error saving coupon:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          "Failed to save coupon. Is the code unique?",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (coupon: Coupon, isActive: boolean) => {
    // Optimistic — revert on failure.
    setCoupons((prev) =>
      prev.map((c) => (c.id === coupon.id ? { ...c, is_active: isActive } : c))
    );
    try {
      await toggleCouponActive(coupon.id, isActive);
    } catch (error) {
      console.error("Error toggling coupon:", error);
      setCoupons((prev) =>
        prev.map((c) =>
          c.id === coupon.id ? { ...c, is_active: !isActive } : c
        )
      );
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update coupon status.",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCoupon(deleteTarget.id);
      setCoupons(coupons.filter((c) => c.id !== deleteTarget.id));
      toast({
        title: "Coupon deleted",
        description: `${deleteTarget.code} has been deleted.`,
      });
    } catch (error) {
      console.error("Error deleting coupon:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete coupon. Please try again.",
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const columns: ColumnDef<Coupon>[] = [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-mono font-semibold">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "discount_value",
      header: "Discount",
      cell: ({ row }) =>
        row.original.discount_type === "percent"
          ? `${row.original.discount_value}%`
          : `$${row.original.discount_value}`,
    },
    {
      accessorKey: "event_id",
      header: "Event",
      cell: ({ row }) => {
        const name = eventName(row.original.event_id);
        return name ? (
          <span className="max-w-[220px] truncate inline-block">{name}</span>
        ) : (
          <Badge variant="secondary">All events</Badge>
        );
      },
    },
    {
      accessorKey: "valid_until",
      header: "Valid Until",
      cell: ({ row }) =>
        row.original.valid_until ? (
          row.original.valid_until.slice(0, 10)
        ) : (
          <span className="text-muted-foreground">No expiry</span>
        ),
    },
    {
      accessorKey: "times_used",
      header: "Uses",
      cell: ({ row }) =>
        `${row.original.times_used}${
          row.original.max_uses != null ? ` / ${row.original.max_uses}` : ""
        }`,
    },
    {
      accessorKey: "times_paid",
      header: "Paid",
      cell: ({ row }) => (
        <span className="font-semibold text-green-600">
          {row.original.times_paid ?? 0}
        </span>
      ),
    },
    {
      accessorKey: "partner_tracking_code",
      header: "Affiliate",
      cell: ({ row }) => {
        const code = row.original.partner_tracking_code;
        if (!code) return <span className="text-muted-foreground">—</span>;
        const partner = partners.find((p) => p.partner_tracking_code === code);
        return (
          <span className="max-w-[180px] truncate inline-block">
            {partner?.name_hebrew || code}
          </span>
        );
      },
    },
    {
      accessorKey: "is_active",
      header: "Active",
      cell: ({ row }) => (
        <Switch
          checked={row.original.is_active}
          onCheckedChange={(checked) =>
            handleToggleActive(row.original, checked)
          }
          aria-label={`Toggle ${row.original.code}`}
        />
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteTarget(row.original)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Loading coupons...
      </div>
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={coupons}
        searchColumn="code"
        searchPlaceholder="Search codes..."
        rightActions={
          <Button onClick={openCreate}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Coupon
          </Button>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.code}` : "New Coupon"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="coupon-code">Code</Label>
              <Input
                id="coupon-code"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="SUMMER25"
                maxLength={64}
                className="font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      discount_type: v as CouponInput["discount_type"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="fixed">Fixed ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-value">
                  Value {form.discount_type === "percent" ? "(%)" : "($)"}
                </Label>
                <Input
                  id="coupon-value"
                  type="number"
                  min={1}
                  max={form.discount_type === "percent" ? 100 : undefined}
                  value={form.discount_value || ""}
                  onChange={(e) =>
                    setForm({ ...form, discount_value: Number(e.target.value) })
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Event restriction</Label>
              <Select
                value={form.event_id == null ? "all" : String(form.event_id)}
                onValueChange={(v) =>
                  setForm({ ...form, event_id: v === "all" ? null : Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All events</SelectItem>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Attribute to affiliate</Label>
              <Select
                value={form.partner_tracking_code ?? "none"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    partner_tracking_code: v === "none" ? null : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">No affiliate</SelectItem>
                  {partners.map((p) => (
                    <SelectItem
                      key={p.partner_tracking_code}
                      value={p.partner_tracking_code}
                    >
                      {p.name_hebrew
                        ? `${p.name_hebrew} (${p.partner_tracking_code})`
                        : p.partner_tracking_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Orders redeeming this coupon are credited to the partner —
                unless the order already has its own affiliate.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="coupon-until">Valid until</Label>
                <Input
                  id="coupon-until"
                  type="date"
                  value={form.valid_until ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, valid_until: e.target.value || null })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-max">Max uses</Label>
                <Input
                  id="coupon-max"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={form.max_uses ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_uses: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="coupon-active" className="cursor-pointer">
                Active
              </Label>
              <Switch
                id="coupon-active"
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_active: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete coupon {deleteTarget?.code}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Customers will no longer be able to redeem it. Past orders keep
              their recorded discount. To pause a coupon instead, toggle it
              inactive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
