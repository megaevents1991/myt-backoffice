"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneInput } from "@/components/phone-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  createOfficeManagerForPartner,
  type PartnerTeamMember,
} from "@/lib/actions/partner-actions";

type FormState = {
  display_name: string;
  email: string;
  password: string;
  phone: string;
};

const EMPTY_FORM: FormState = {
  display_name: "",
  email: "",
  password: "",
  phone: "",
};

/**
 * Fully controlled - the caller owns `open` (the partners LIST already tracks
 * "which row's dialog is open" in table-level state, so it drives this
 * directly; CreateOfficeManagerButton below wraps this with its own state for
 * contexts, like the partner VIEW page, that have nowhere else to hold it).
 */
export function CreateOfficeManagerDialog({
  open,
  onOpenChange,
  trackingCode,
  partnerLabel,
  existingManagers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackingCode: string;
  partnerLabel: string;
  /** Shown so adding another manager is a conscious choice, not a surprise. */
  existingManagers: PartnerTeamMember[];
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const reset = () => setForm(EMPTY_FORM);

  const handleSubmit = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email || form.password.length < 8) {
      toast({
        variant: "destructive",
        title: "קלט לא תקין",
        description: "יש להזין אימייל וסיסמה של 8 תווים לפחות.",
      });
      return;
    }
    setSaving(true);
    try {
      const result = await createOfficeManagerForPartner(trackingCode, {
        display_name: form.display_name.trim(),
        email,
        password: form.password,
        phone: form.phone || null,
      });
      if (!result.ok) {
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
        return;
      }
      toast({
        title: "מנהל המשרד נוצר",
        description: `${email} יכול/ה להתחבר לפורטל.`,
      });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (error) {
      console.error("Error creating office manager:", error);
      toast({
        variant: "destructive",
        title: "שגיאה",
        description: "יצירת מנהל המשרד נכשלה. נסו שוב.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>צור מנהל משרד{partnerLabel ? ` - ${partnerLabel}` : ""}</DialogTitle>
          <DialogDescription>
            מנהל משרד רואה את כל פעילות המשרד בפורטל ויכול לנהל את הסוכנים תחתיו.
          </DialogDescription>
        </DialogHeader>

        {existingManagers.length > 0 && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              למשרד הזה כבר יש {existingManagers.length} מנהל{existingManagers.length > 1 ? "ים" : ""} - ניתן להוסיף עוד אחד:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {existingManagers.map((m) => (
                <Badge
                  key={m.id}
                  variant={m.is_active ? "outline" : "secondary"}
                  className="font-normal"
                >
                  {m.display_name || m.email}
                  {!m.is_active && " (מושבת)"}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="om-name">שם מלא</Label>
            <Input
              id="om-name"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="om-email">אימייל</Label>
            <Input
              id="om-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="om-password">סיסמה</Label>
            <PasswordInput
              id="om-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="8+ תווים"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="om-phone">טלפון (אופציונלי)</Label>
            <PhoneInput
              id="om-phone"
              value={form.phone}
              onChange={(phone: string) => setForm({ ...form, phone })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "יוצר..." : "צור מנהל משרד"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Self-contained trigger + dialog for contexts with no pre-existing "which
 * row" state to key off - just the partner VIEW page today. The partners
 * LIST instead drives CreateOfficeManagerDialog directly (see
 * partners-table.tsx), since it already tracks the target row in state.
 */
export function CreateOfficeManagerButton({
  trackingCode,
  partnerLabel,
  existingManagers,
}: {
  trackingCode: string;
  partnerLabel: string;
  existingManagers: PartnerTeamMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 h-4 w-4" />
        צור מנהל משרד
      </Button>
      <CreateOfficeManagerDialog
        open={open}
        onOpenChange={setOpen}
        trackingCode={trackingCode}
        partnerLabel={partnerLabel}
        existingManagers={existingManagers}
        onCreated={() => router.refresh()}
      />
    </>
  );
}
