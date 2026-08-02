"use client";

import type React from "react";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Trash2 } from "lucide-react";
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
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneInput } from "@/components/phone-input";
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
  COMMISSION_TYPES,
  COMMISSION_TYPE_LABELS,
  MARKETING_PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  type CommissionType,
} from "@/types/partner.types";
import {
  getPartnerAccount,
  createPartnerAccount,
  updatePartnerAccount,
  type MarketingPartnerType,
} from "@/lib/actions/partner-account-actions";
import {
  uploadUserContract,
  getContractDownloadUrl,
  removeUserContract,
} from "@/lib/actions/user-actions";

/** Numbers are held as strings so a half-typed field doesn't become NaN. */
type FormState = {
  partner_tracking_code: string;
  name: string;
  email: string;
  phone: string;
  type: MarketingPartnerType;
  password: string;
  commission: string;
  commission_type: CommissionType;
  credit_per_ticket: string;
  voucher_payment_allowed: boolean;
  user_discount: string;
  supplier_number: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  partner_tracking_code: "",
  name: "",
  email: "",
  phone: "",
  type: "affiliate",
  password: "",
  commission: "10",
  commission_type: "fixed_per_ticket",
  credit_per_ticket: "0",
  voucher_payment_allowed: false,
  user_discount: "5",
  supplier_number: "",
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
  const [form, setForm] = useState<FormState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [contractUrl, setContractUrl] = useState<string | null>(null);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const isNewPartner = unwrappedParams.code === "new";

  useEffect(() => {
    async function load() {
      if (isNewPartner) {
        setForm(EMPTY_FORM);
        setLoading(false);
        return;
      }
      try {
        const account = await getPartnerAccount(unwrappedParams.code);
        if (!account) {
          toast({
            variant: "destructive",
            title: "Not found",
            description: "This partner no longer exists.",
          });
          return;
        }
        if (account.is_customer_refund) {
          setBlocked(true);
          return;
        }
        setForm({
          partner_tracking_code: account.partner_tracking_code,
          name: account.name,
          email: account.email,
          phone: account.phone ?? "",
          type: account.type,
          password: "",
          commission: String(account.commission ?? 0),
          commission_type: account.commission_type,
          credit_per_ticket: String(account.credit_per_ticket ?? 0),
          voucher_payment_allowed: account.voucher_payment_allowed,
          user_discount: String(account.user_discount ?? 0),
          supplier_number: account.supplier_number?.toString() ?? "",
          is_active: account.is_active,
        });
        setUserId(account.user_id);
        setContractUrl(account.contract_url);
      } catch (error) {
        console.error("Error loading partner:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load this partner. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [unwrappedParams.code, toast, isNewPartner]);

  const setField = <K extends keyof FormState>(name: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setField(e.target.name as keyof FormState, e.target.value);
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
      const payload = {
        partner_tracking_code: form.partner_tracking_code.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
        type: form.type,
        password: form.password || null,
        commission: Number(form.commission),
        commission_type: form.commission_type,
        credit_per_ticket: Number(form.credit_per_ticket),
        voucher_payment_allowed: form.voucher_payment_allowed,
        user_discount: Number(form.user_discount),
        supplier_number: form.supplier_number ? Number(form.supplier_number) : null,
        is_active: form.is_active,
      };

      const result = isNewPartner
        ? await createPartnerAccount(payload)
        : await updatePartnerAccount(unwrappedParams.code, payload);

      if (!result.ok) {
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }

      // The agreement is stored against the login, so it can only be uploaded
      // once that exists. Non-fatal: the account is saved either way.
      if (contractFile) {
        if (!result.user_id) {
          toast({
            variant: "destructive",
            title: "Agreement not uploaded",
            description:
              "This partner has no login yet. Set a password to create one, then upload the agreement.",
          });
        } else {
          const data = new FormData();
          data.set("file", contractFile);
          const upload = await uploadUserContract(result.user_id, data);
          if (!upload.ok) {
            toast({
              variant: "destructive",
              title: "Agreement not uploaded",
              description: upload.error,
            });
          }
        }
      }

      toast({
        title: "Saved",
        description: result.user_id
          ? "Partner and portal login saved."
          : "Partner saved. Set a password to give them a portal login.",
      });
      router.push("/partners");
      router.refresh();
    } catch (error) {
      console.error("Error saving partner:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadContract = async () => {
    if (!userId) return;
    const result = await getContractDownloadUrl(userId);
    if (result.ok) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else {
      toast({ variant: "destructive", title: "Error", description: result.error });
    }
  };

  const handleRemoveContract = async () => {
    if (!userId) return;
    const result = await removeUserContract(userId);
    if (result.ok) {
      setContractUrl(null);
      toast({ title: "Agreement removed" });
    } else {
      toast({ variant: "destructive", title: "Error", description: result.error });
    }
  };

  if (loading) return <div>Loading partner details...</div>;

  if (blocked) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push("/partners")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Not a partner record</CardTitle>
            <CardDescription>
              This is an automatic customer-refund record, opened by the booking system
              for a single customer. It has no commercial terms and no portal login, so
              there is nothing to edit here.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!form) return <div>Partner not found</div>;

  const isPercent = form.commission_type === "percent_of_sale";

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="ml-4 text-3xl font-bold tracking-tight">
          {isNewPartner ? "Create Partner" : `Edit Partner: ${form.name || form.email}`}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Partner &amp; login</CardTitle>
            <CardDescription>
              Saving creates both the partner and its portal login. An agent (סוכן) sells
              on the customer&apos;s behalf and is invoiced; an influencer (משפיען) drives
              traffic with a tracking code and coupons.
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
                <p className="text-xs text-muted-foreground">
                  Identifies the partner in booking links and coupons. Cannot be changed
                  later.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Partner Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setField("type", value as MarketingPartnerType)
                  }
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETING_PARTNER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {PARTNER_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Also becomes the portal role.
                </p>
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
                      : "Inactive — no portal access, no monthly report"}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Partner Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <PhoneInput
                  id="phone"
                  value={form.phone}
                  onChange={(phone: string) => setField("phone", phone)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  disabled={!isNewPartner && !!userId}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {!isNewPartner && userId
                    ? "The portal login is tied to this address, so it can't be changed here."
                    : "Used for the portal login and the monthly report."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={handleChange}
                  required={isNewPartner}
                />
                <p className="text-xs text-muted-foreground">
                  {isNewPartner
                    ? "8+ characters. Give it to the partner — it is not shown again."
                    : userId
                      ? "Leave blank to keep the current password."
                      : "No portal login yet. Set a password to create one."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commercial terms</CardTitle>
            <CardDescription>
              What this partner earns, and what their followers get.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="commission_type">Commission Basis</Label>
                <Select
                  value={form.commission_type}
                  onValueChange={(value) =>
                    setField("commission_type", value as CommissionType)
                  }
                >
                  <SelectTrigger id="commission_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMISSION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {COMMISSION_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="commission">
                  {isPercent ? "Commission (%)" : "Commission ($ per ticket)"}
                </Label>
                <Input
                  id="commission"
                  name="commission"
                  type="number"
                  min="0"
                  max={isPercent ? 100 : undefined}
                  step="1"
                  value={form.commission}
                  onChange={handleChange}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {isPercent
                    ? "Percent of the package price the customer paid."
                    : "Paid for every ticket on a paid reservation."}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="user_discount">Follower Discount ($)</Label>
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
                <p className="text-xs text-muted-foreground">
                  Taken off the price for customers arriving through this partner.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="credit_per_ticket">Site Credit ($ per ticket)</Label>
                <Input
                  id="credit_per_ticket"
                  name="credit_per_ticket"
                  type="number"
                  min="0"
                  step="1"
                  value={form.credit_per_ticket}
                  onChange={handleChange}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Accrues per ticket on paid reservations, on top of the commission. The
                  partner converts the balance into a one-time coupon. 0 = not on this
                  agreement.
                </p>
              </div>
              {/* Only an agent books on a customer's behalf, so only they can
                  settle one. An influencer just shares a link. */}
              {form.type === "agent" && (
                <div className="space-y-2">
                  <Label htmlFor="voucher_payment_allowed">Voucher Payment</Label>
                  <div className="flex h-10 items-center gap-3">
                    <Switch
                      id="voucher_payment_allowed"
                      checked={form.voucher_payment_allowed}
                      onCheckedChange={(checked) =>
                        setField("voucher_payment_allowed", checked)
                      }
                    />
                    <span className="text-sm text-muted-foreground">
                      {form.voucher_payment_allowed
                        ? "May settle a booking with a voucher"
                        : "Card only"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Per their agreement. Off means they pay by card — their own or
                    the customer&apos;s.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="supplier_number">Company Number (ח.פ)</Label>
                <Input
                  id="supplier_number"
                  name="supplier_number"
                  type="number"
                  min="0"
                  value={form.supplier_number}
                  onChange={handleChange}
                />
                <p className="text-xs text-muted-foreground">
                  Optional — printed on the monthly invoice-style report.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cooperation agreement</CardTitle>
            <CardDescription>
              PDF, Word or image, up to 10MB. Stored privately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {contractUrl && !contractFile && (
              <div className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-primary"
                  onClick={handleDownloadContract}
                >
                  Agreement on file — download
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={handleRemoveContract}
                  aria-label="Remove agreement"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <Input
              id="contract"
              type="file"
              accept=".pdf,.doc,.docx,image/png,image/jpeg"
              onChange={(e) => setContractFile(e.target.files?.[0] ?? null)}
            />
            {contractUrl && contractFile && (
              <p className="text-xs text-muted-foreground">
                The new file replaces the current agreement on save.
              </p>
            )}
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
            ? "This creates the partner and a portal login they can sign in with."
            : "This saves the partner and keeps its portal login in step."
        }
        confirmLabel={isNewPartner ? "Create Partner" : "Save Changes"}
        onConfirm={performSave}
      />
    </div>
  );
}
