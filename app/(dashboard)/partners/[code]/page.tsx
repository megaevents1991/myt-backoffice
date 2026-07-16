"use client";

import type React from "react";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MARKETING_PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  isCustomerRefundPartner,
  type PartnerType,
} from "@/types/partner.types";
import {
  getPartner,
  updatePartner,
  createPartner,
} from "@/lib/actions/partner-actions";

/** Form state — `password` is write-only and never loaded from the server. */
type PartnerForm = {
  partner_tracking_code: string;
  name_hebrew: string;
  email: string;
  password: string;
  commission: string;
  user_discount: string;
  supplier_number: string;
  type: PartnerType;
  is_active: boolean;
};

const EMPTY_FORM: PartnerForm = {
  partner_tracking_code: "",
  name_hebrew: "",
  email: "",
  password: "",
  commission: "10",
  user_discount: "5",
  supplier_number: "",
  type: "affiliate",
  is_active: true,
};

export default function PartnerPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const unwrappedParams = use(params);
  const [form, setForm] = useState<PartnerForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const isNewPartner = unwrappedParams.code === "new";

  useEffect(() => {
    async function fetchPartner() {
      if (isNewPartner) {
        setForm(EMPTY_FORM);
        setLoading(false);
        return;
      }

      try {
        const data = await getPartner(unwrappedParams.code);
        setForm({
          partner_tracking_code: data.partner_tracking_code,
          name_hebrew: data.name_hebrew ?? "",
          email: data.email,
          password: "",
          commission: String(data.commission ?? 0),
          user_discount: String(data.user_discount ?? 0),
          supplier_number: data.supplier_number?.toString() ?? "",
          type: isCustomerRefundPartner(data)
            ? "customer_refund"
            : data.type === "agent"
              ? "agent"
              : "affiliate",
          is_active: data.is_active,
        });
      } catch (error) {
        console.error("Error fetching partner:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load partner details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchPartner();
  }, [unwrappedParams.code, toast, isNewPartner]);

  const setField = <K extends keyof PartnerForm>(name: K, value: PartnerForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setField(e.target.name as keyof PartnerForm, e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setShowSaveConfirm(true);
  };

  const performSave = async () => {
    if (!form) return;
    setShowSaveConfirm(false);
    setSaving(true);
    try {
      const base = {
        name_hebrew: form.name_hebrew,
        email: form.email,
        commission: Number(form.commission),
        user_discount: Number(form.user_discount),
        supplier_number: form.supplier_number ? Number(form.supplier_number) : null,
        type: form.type,
        is_active: form.is_active,
      };

      if (isNewPartner) {
        await createPartner({
          ...base,
          partner_tracking_code: form.partner_tracking_code.trim(),
          password: form.password,
        });
      } else {
        // Only send a password when one was typed — an empty field means "keep".
        await updatePartner(unwrappedParams.code, {
          ...base,
          ...(form.password ? { password: form.password } : {}),
        });
      }

      toast({
        title: "Success",
        description: "Partner has been saved successfully.",
      });
      router.push("/partners");
      router.refresh();
    } catch (error) {
      console.error("Error saving partner:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to save partner. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading partner details...</div>;
  }

  if (!form) {
    return <div>Partner not found</div>;
  }

  // Customer-refund rows are opened automatically per booking, so staff never
  // pick that type by hand — it only appears when editing a row that already is one.
  const typeOptions: PartnerType[] =
    form.type === "customer_refund"
      ? ["customer_refund"]
      : [...MARKETING_PARTNER_TYPES];

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-3xl font-bold tracking-tight ml-4">
          {isNewPartner ? "Create Partner" : `Edit Partner: ${form.email}`}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Partner Information</CardTitle>
            <CardDescription>
              An agent (סוכן) sells on the customer&apos;s behalf and is invoiced via a
              supplier number. An influencer (משפיען) drives traffic with a tracking code
              and coupons.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isNewPartner && (
              <div className="space-y-2">
                <Label htmlFor="partner_tracking_code">Tracking Code</Label>
                <Input
                  id="partner_tracking_code"
                  name="partner_tracking_code"
                  value={form.partner_tracking_code}
                  onChange={handleChange}
                  required
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Partner Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) => setField("type", value as PartnerType)}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((type) => (
                      <SelectItem key={type} value={type}>
                        {PARTNER_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="is_active">Status</Label>
                <div className="flex h-10 items-center gap-3">
                  <Switch
                    id="is_active"
                    checked={form.is_active}
                    onCheckedChange={(checked) => setField("is_active", checked)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {form.is_active
                      ? "Active"
                      : "Inactive — excluded from the monthly report"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name_hebrew">Hebrew Name</Label>
              <Input
                id="name_hebrew"
                name="name_hebrew"
                value={form.name_hebrew}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
              />
              <p className="text-sm text-muted-foreground">
                The monthly activity report is sent to this address.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={handleChange}
                required={isNewPartner}
              />
              <p className="text-sm text-muted-foreground">
                {isNewPartner
                  ? "Set a password for the partner."
                  : "Leave blank to keep the current password."}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="commission">Commission ($ per ticket)</Label>
                <Input
                  id="commission"
                  name="commission"
                  type="number"
                  min="0"
                  step="1"
                  value={form.commission}
                  onChange={handleChange}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Paid per ticket sold, not a percentage.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="user_discount">User Discount ($)</Label>
                <Input
                  id="user_discount"
                  name="user_discount"
                  type="number"
                  min="0"
                  step="1"
                  value={form.user_discount}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier_number">Supplier Number</Label>
                <Input
                  id="supplier_number"
                  name="supplier_number"
                  type="number"
                  min="0"
                  value={form.supplier_number}
                  onChange={handleChange}
                />
                <p className="text-xs text-muted-foreground">
                  Optional — used on the invoice-style monthly report.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Partner"}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={showSaveConfirm}
        onOpenChange={setShowSaveConfirm}
        title={isNewPartner ? "Create this partner?" : "Save changes?"}
        description={
          isNewPartner
            ? "This will create the partner."
            : "This will save your changes to this partner."
        }
        confirmLabel={isNewPartner ? "Create Partner" : "Save Changes"}
        onConfirm={performSave}
      />
    </div>
  );
}
