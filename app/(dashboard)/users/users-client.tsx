"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PlusCircle,
  MoreHorizontal,
  Pencil,
  KeyRound,
  ChevronsUpDown,
  Check,
  FileText,
  Trash2,
  UserMinus,
} from "lucide-react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneInput } from "@/components/phone-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  createUser,
  updateUser,
  resetUserPassword,
  uploadUserContract,
  getContractDownloadUrl,
  removeUserContract,
  removeFromCompany,
} from "@/lib/actions/user-actions";
import {
  ROLES,
  ADMIN_ROLES,
  COMPANY_MEMBER_ROLES,
  PARTNER_ROLES,
  ROLE_LABELS,
  TOURS_AGENT_ROLE,
  type Role,
  type UserListItem,
  type UserProfile,
} from "@/types/auth.types";
import type { PartnerListItem } from "@/lib/actions/partner-actions";
import { useAuth } from "@/contexts/auth-context";
import { useConfirm } from "@/components/confirm-provider";

type FormState = {
  email: string;
  password: string;
  display_name: string;
  role: Role;
  partner_tracking_code: string;
  phone: string;
};

const emptyForm: FormState = {
  email: "",
  password: "",
  display_name: "",
  role: "editor",
  partner_tracking_code: "",
  phone: "",
};

/** The role id, with its Hebrew name where the id alone is not clear (tours_agent vs agent). */
function roleLabel(role: Role) {
  const label = ROLE_LABELS[role];
  return label ? `${role} · ${label.he}` : role;
}

/** Company scope: the role in plain English ("Tours agent", "Editor"). */
function companyRoleLabel(role: Role) {
  return ROLE_LABELS[role]?.en ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/** The role shown in the row: the role in the active company in company scope, else the account role. */
const roleHere = (user: UserListItem) => user.membership?.role ?? user.role;

function roleBadgeVariant(role: Role) {
  if (role === "superadmin") return "destructive" as const;
  if (role === "admin") return "default" as const;
  if (role === "editor") return "secondary" as const;
  return "outline" as const;
}

function partnerLabel(p: PartnerListItem) {
  return p.name_hebrew
    ? `${p.name_hebrew} (${p.partner_tracking_code})`
    : p.partner_tracking_code;
}

function PartnerCombobox({
  value,
  onChange,
  partners,
  clearable = false,
}: {
  value: string;
  onChange: (code: string) => void;
  partners: PartnerListItem[];
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = partners.find((p) => p.partner_tracking_code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? partnerLabel(selected) : "Select a partner"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="חפש לפי שם או קוד..." />
          <CommandList>
            <CommandEmpty>No partner found</CommandEmpty>
            <CommandGroup>
              {clearable && value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    setOpen(false);
                    onChange("");
                  }}
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  - No partner -
                </CommandItem>
              )}
              {partners.map((p) => (
                <CommandItem
                  key={p.partner_tracking_code}
                  value={`${p.partner_tracking_code} ${p.name_hebrew ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    onChange(p.partner_tracking_code);
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${
                      value === p.partner_tracking_code ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {partnerLabel(p)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function UsersClient({
  users,
  partners,
  scope = "events",
  companyName,
}: {
  users: UserListItem[];
  partners: PartnerListItem[];
  /**
   * "company": the people of the active company, for any company but Mega
   * Events (lib/actions/user-actions.ts holds the rules). No partner link, no
   * contract, no agent portal there.
   */
  scope?: "events" | "company";
  companyName?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const [isPending, startTransition] = useTransition();
  const inCompany = scope === "company";

  const isSuper = me?.role === "superadmin";
  // Admins cannot assign or touch admin/superadmin/office_manager accounts -
  // appointing office managers is superadmin-only (server-enforced too).
  const assignableRoles = ROLES.filter((r) =>
    isSuper ? true : !ADMIN_ROLES.includes(r) && r !== "office_manager",
  );
  const canManageRow = (target: UserProfile) =>
    isSuper ||
    (!ADMIN_ROLES.includes(target.role) && target.role !== "office_manager");
  // Company scope: the roles of a company (admin by a superadmin only); the
  // hierarchy reads the role here too, and a person who also works in another
  // company is edited only by a superadmin. The server enforces all of it.
  const roleOptions = inCompany
    ? COMPANY_MEMBER_ROLES.filter((r) => isSuper || r !== "admin")
    : assignableRoles;
  const canManageMember = (target: UserListItem) =>
    canManageRow(target) && (isSuper || !ADMIN_ROLES.includes(roleHere(target)));
  const canEditMember = (target: UserListItem) =>
    canManageMember(target) && (isSuper || target.membership?.onlyHere === true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [contractFile, setContractFile] = useState<File | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  // Company scope, editing as a company admin: a tours agent stays a tours
  // agent and staff stays staff - crossing that line is a superadmin's call.
  const editRoleOptions =
    inCompany && editing && !isSuper
      ? roleOptions.filter(
          (r) => (r === TOURS_AGENT_ROLE) === (roleHere(editing) === TOURS_AGENT_ROLE),
        )
      : roleOptions;

  const needsPartner = PARTNER_ROLES.includes(form.role);
  // A tours_agent belongs to a tours company, not to a Mega Events partner: no partner link at all.
  const isToursAgent = form.role === TOURS_AGENT_ROLE;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setContractFile(null);
    setFormOpen(true);
  };

  const openEdit = (user: UserListItem) => {
    setEditing(user);
    setContractFile(null);
    setForm({
      email: user.email,
      password: "",
      display_name: user.display_name ?? "",
      role: roleHere(user),
      partner_tracking_code: user.partner_tracking_code ?? "",
      phone: user.phone ?? "",
    });
    setFormOpen(true);
  };

  const openReset = (user: UserProfile) => {
    setResetTarget(user);
    setResetPassword("");
    setResetOpen(true);
  };

  const handleSubmit = () => {
    const email = form.email.trim().toLowerCase();
    if (needsPartner && !form.partner_tracking_code) {
      toast({
        variant: "destructive",
        title: "Partner required",
        description: "Agent/affiliate users need a linked partner.",
      });
      return;
    }

    if (!editing) {
      // Company scope: an email that already has an account is added without
      // a password - the server checks the password of a new account.
      if (!email || (!inCompany && form.password.length < 8)) {
        toast({
          variant: "destructive",
          title: "Invalid input",
          description: inCompany
            ? "An email is required."
            : "Email and a password of 8+ characters are required.",
        });
        return;
      }
    }

    if (form.phone && !isValidPhoneNumber(form.phone)) {
      toast({
        variant: "destructive",
        title: "Invalid phone number",
        description: "Check the country and number - or leave the field empty.",
      });
      return;
    }

    // Partner roles REQUIRE a partner link; staff roles may carry one too -
    // it lights up "מצב סוכן" in the sidebar (dual-role: admin + own portal).
    const partnerCode = isToursAgent ? null : form.partner_tracking_code || null;

    startTransition(async () => {
      let targetId: string | null;
      let saveError: string | null = null;
      // Company scope: set when the email already had an account and was added.
      let addedNote: string | undefined;
      if (editing) {
        const result = await updateUser(editing.id, {
          display_name: form.display_name || null,
          role: form.role,
          partner_tracking_code: partnerCode,
          phone: form.phone || null,
        });
        targetId = editing.id;
        if (!result.ok) saveError = result.error;
      } else {
        const result = await createUser({
          email,
          password: form.password,
          display_name: form.display_name,
          role: form.role,
          partner_tracking_code: partnerCode,
          phone: form.phone || null,
        });
        targetId = result.ok ? result.id : null;
        if (!result.ok) saveError = result.error;
        else addedNote = result.note;
      }

      if (saveError) {
        toast({
          variant: "destructive",
          title: "Error",
          description: saveError,
        });
        return;
      }

      // Contract uploads AFTER the profile save - the user exists either way,
      // so a failed upload only warns instead of failing the whole create.
      if (contractFile && targetId && PARTNER_ROLES.includes(form.role)) {
        const fd = new FormData();
        fd.set("file", contractFile);
        const upload = await uploadUserContract(targetId, fd);
        if (!upload.ok) {
          toast({
            variant: "destructive",
            title: editing ? "Saved, but contract upload failed" : "User created, but contract upload failed",
            description: `${upload.error} - open Edit and attach it again.`,
          });
          setFormOpen(false);
          router.refresh();
          return;
        }
      }

      toast({
        title: editing ? "User updated" : addedNote ? "User added" : "User created",
        description: editing
          ? `${form.email} saved.`
          : (addedNote ?? `${email} can now sign in.`),
      });
      setFormOpen(false);
      router.refresh();
    });
  };

  const handleDownloadContract = (user: UserProfile) => {
    startTransition(async () => {
      const result = await getContractDownloadUrl(user.id);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  };

  const handleRemoveContract = () => {
    if (!editing) return;
    startTransition(async () => {
      const result = await removeUserContract(editing.id);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Error", description: result.error });
        return;
      }
      setEditing({ ...editing, contract_url: null });
      toast({ title: "Contract removed", description: editing.email });
      router.refresh();
    });
  };

  const handleToggleActive = (user: UserProfile, isActive: boolean) => {
    startTransition(async () => {
      const result = await updateUser(user.id, { is_active: isActive });
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Error",
          description: result.error,
        });
        return;
      }
      router.refresh();
    });
  };

  const handleRemoveFromCompany = async (user: UserListItem) => {
    const ok = await confirm({
      title: `Remove ${user.display_name || user.email} from ${companyName}?`,
      description:
        "They will no longer see this company. The account itself and its other companies do not change.",
      confirmLabel: "Remove from company",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await removeFromCompany(user.id);
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Error",
          description: result.error,
        });
        return;
      }
      toast({
        title: "Removed from company",
        description: `${user.email} no longer works in ${companyName}.`,
      });
      router.refresh();
    });
  };

  const handleResetPassword = () => {
    if (!resetTarget) return;
    if (resetPassword.length < 8) {
      toast({
        variant: "destructive",
        title: "Invalid password",
        description: "Password must be 8+ characters.",
      });
      return;
    }
    startTransition(async () => {
      const result = await resetUserPassword(resetTarget.id, resetPassword);
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Error",
          description: result.error,
        });
        return;
      }
      toast({
        title: "Password reset",
        description: `New password set for ${resetTarget.email}.`,
      });
      setResetOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            {inCompany
              ? `The people of ${companyName}: who works in this company and their role here. Superadmins see every company and are not listed.`
              : "Manage backoffice staff and partner-linked accounts."}
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add user
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Role</TableHead>
              {!inCompany && <TableHead>Partner</TableHead>}
              <TableHead>Active</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={inCompany ? 6 : 7} className="text-center text-muted-foreground">
                  {inCompany ? `No one works in ${companyName} yet.` : "No users yet."}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.display_name || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={roleBadgeVariant(roleHere(user))}>
                      {inCompany ? companyRoleLabel(roleHere(user)) : roleLabel(user.role)}
                    </Badge>
                  </TableCell>
                  {!inCompany && <TableCell>{user.partner_tracking_code || "-"}</TableCell>}
                  <TableCell>
                    <Switch
                      checked={user.is_active}
                      disabled={
                        isPending ||
                        !canManageRow(user) ||
                        user.id === me?.id ||
                        // Company scope: only people who work in this company only are switched off here.
                        (inCompany && !(canManageMember(user) && user.membership?.onlyHere))
                      }
                      title={
                        inCompany && !user.membership?.onlyHere
                          ? "Also works in another company - use Remove from company"
                          : undefined
                      }
                      onCheckedChange={(checked) => handleToggleActive(user, checked)}
                      aria-label={`Toggle ${user.email}`}
                    />
                  </TableCell>
                  <TableCell>
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {(inCompany ? canManageMember(user) : canManageRow(user)) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Actions for ${user.email}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(!inCompany || canEditMember(user)) && (
                            <DropdownMenuItem onClick={() => openEdit(user)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              <span>Edit</span>
                            </DropdownMenuItem>
                          )}
                          {(!inCompany || canEditMember(user)) && (
                            <DropdownMenuItem onClick={() => openReset(user)}>
                              <KeyRound className="h-4 w-4 mr-2" />
                              <span>Reset password</span>
                            </DropdownMenuItem>
                          )}
                          {!inCompany && user.contract_url && (
                            <DropdownMenuItem onClick={() => handleDownloadContract(user)}>
                              <FileText className="h-4 w-4 mr-2" />
                              <span>Download contract</span>
                            </DropdownMenuItem>
                          )}
                          {inCompany && user.id !== me?.id && (
                            <DropdownMenuItem
                              onClick={() => void handleRemoveFromCompany(user)}
                              className="text-destructive focus:text-destructive"
                            >
                              <UserMinus className="h-4 w-4 mr-2" />
                              <span>Remove from company</span>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.email}` : "Add user"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@example.com"
              />
              {inCompany && !editing && (
                <p className="text-xs text-muted-foreground">
                  If this email already has an account, it is added to {companyName} with
                  no new account and no password.
                </p>
              )}
            </div>

            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="user-password">
                  {inCompany ? "Temporary password (new accounts)" : "Temporary password"}
                </Label>
                <PasswordInput
                  id="user-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="8+ characters"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="user-display-name">Display name</Label>
              <Input
                id="user-display-name"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => {
                  // The partner link survives role changes - staff roles keep
                  // it as an optional dual-role link.
                  setForm({ ...form, role: v as Role });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editRoleOptions.map((role) => (
                    <SelectItem key={role} value={role}>
                      {inCompany ? companyRoleLabel(role) : roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {inCompany ? (
              isToursAgent && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  A tours agent sells for {companyName}: they see only its departures board,
                  read-only.
                </p>
              )
            ) : isToursAgent ? (
              <p dir="rtl" className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                סוכן טיולים הוא סוכן מכירות של חברת טיולים (מגה תיירות), לא שותף של מגה איבנטס, ולכן אין לו קישור
                לשותף. הוא רואה רק את לוח היציאות של החברה שלו, לצפייה בלבד. אחרי היצירה עוברים לחברת הטיולים בבורר
                החברות ומוסיפים אותו ב-Users עם אותו אימייל. עד השיוך הוא לא רואה כלום.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label>{needsPartner ? "Partner" : "Partner (optional - dual-role)"}</Label>
                <PartnerCombobox
                  value={form.partner_tracking_code}
                  onChange={(code) =>
                    setForm({ ...form, partner_tracking_code: code })
                  }
                  partners={partners}
                  clearable={!needsPartner}
                />
                {!needsPartner && (
                  <p className="text-xs text-muted-foreground">
                    קישור שותף למשתמש צוות מדליק לו את &quot;מצב סוכן&quot; בתפריט -
                    הדשבורד נשאר, והפורטל נפתח כהשותף המקושר.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="user-phone">Phone</Label>
              <PhoneInput
                id="user-phone"
                value={form.phone}
                onChange={(phone) => setForm({ ...form, phone })}
              />
            </div>

            {!inCompany && needsPartner && (
              <div className="space-y-1.5">
                <Label htmlFor="user-contract">Contract (PDF/DOC/image, max 10MB)</Label>
                {editing?.contract_url && !contractFile && (
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-primary"
                      onClick={() => handleDownloadContract(editing)}
                    >
                      Contract on file - download
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={handleRemoveContract}
                      disabled={isPending}
                      aria-label="Remove contract"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <Input
                  id="user-contract"
                  type="file"
                  accept=".pdf,.doc,.docx,image/png,image/jpeg"
                  onChange={(e) => setContractFile(e.target.files?.[0] ?? null)}
                />
                {editing?.contract_url && contractFile && (
                  <p className="text-xs text-muted-foreground">
                    New file replaces the current contract on save.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? "Saving..." : editing ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password{resetTarget ? ` - ${resetTarget.email}` : ""}</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordInput
              id="reset-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="8+ characters"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={isPending}>
              {isPending ? "Saving..." : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
