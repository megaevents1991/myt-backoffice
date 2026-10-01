"use client";

/**
 * The team of the active tours company: who is assigned, add an existing
 * account by its email, remove one. The rules (what a membership means, why the
 * last one is never removed) live in lib/actions/tours-members-actions.ts.
 */
import { useState, useTransition } from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/components/confirm-provider";
import { useToast } from "@/hooks/use-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { addCompanyMember, removeCompanyMember } from "@/lib/actions/tours-members-actions";
import { Section } from "@/components/tours/ui";
import { COMPANY_ROLE_LABELS, type CompanyMemberRow } from "@/components/tours/content/shared";
import { ROLE_LABELS, type Role } from "@/types/auth.types";

/** The display name of a member's role: ROLE_LABELS first, COMPANY_ROLE_LABELS for the roles it does not name. */
const roleName = (role: string): string => ROLE_LABELS[role as Role]?.en ?? COMPANY_ROLE_LABELS[role] ?? role;

export function CompanyMembers({ initial, companyName }: { initial: CompanyMemberRow[]; companyName: string }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const run = useActionToast();
  const [members, setMembers] = useState(initial);
  const [email, setEmail] = useState("");
  const [keepMegaEvents, setKeepMegaEvents] = useState(false);
  const [isPending, startTransition] = useTransition();

  const add = () => {
    if (!email.trim()) return;
    startTransition(async () => {
      const result = await run(() => addCompanyMember(email, keepMegaEvents));
      if (!result.success) return;
      setMembers(result.data.members);
      setEmail("");
      setKeepMegaEvents(false);
      // the note says what the change means for the account - it comes with the answer
      toast({ title: result.data.note });
    });
  };

  const remove = async (member: CompanyMemberRow) => {
    const ok = await confirm({
      title: `Remove ${member.name} from ${companyName}?`,
      description: "The user will no longer see this company. The account itself and its other company memberships do not change.",
      confirmLabel: "Remove from Company",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await run(() => removeCompanyMember(member.userId), `${member.name} was removed from ${companyName}`);
      if (!result.success) return;
      setMembers(result.data);
    });
  };

  return (
    <Section
      title={`Members (${members.length})`}
      description="Members see this company and work in it. A tours agent sees only the departures board, read-only. The account itself (name, password, role, deactivation) is managed on the Users screen. Superadmins see every company and are not listed here."
    >
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users are assigned to this company yet.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table look="list">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell>
                    <span dir="ltr">{member.email}</span>
                  </TableCell>
                  <TableCell>{roleName(member.role)}</TableCell>
                  <TableCell>
                    <Badge variant={member.isActive ? "outline" : "destructive"}>
                      {member.isActive ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${member.name} from the company`}
                      disabled={isPending}
                      onClick={() => void remove(member)}
                    >
                      <UserMinus />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-3 rounded-md border border-dashed p-3">
        <div>
          <p className="text-sm font-medium">Add an existing user</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Enter the email of a staff user or tours agent who already exists in the system. Create new users on the Users screen first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            dir="ltr"
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            className="max-w-xs"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" size="sm" onClick={add} disabled={isPending || !email.trim()}>
            {isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Add to Company
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={keepMegaEvents}
            onCheckedChange={(checked) => setKeepMegaEvents(checked === true)}
          />
          <span>
            Also keep access to Mega Events
            <span className="block text-muted-foreground">
              A user not yet assigned to any company works in Mega Events today. Without this option they will work
              only in {companyName}. A user already assigned to Mega Events keeps that access either way. This does not
              apply to tours agents: they work only in the company they are assigned to.
            </span>
          </span>
        </label>
      </div>
    </Section>
  );
}
