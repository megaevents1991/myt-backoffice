"use client";

/**
 * The team of the active tours company: who is assigned, add an existing
 * account by its email, remove one. The rules (what a membership means, why the
 * last one is never removed) live in lib/actions/tours-members-actions.ts.
 */
import { useState, useTransition } from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "react-hot-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/components/confirm-provider";
import { addCompanyMember, removeCompanyMember } from "@/lib/actions/tours-members-actions";
import { Section } from "@/components/tours/content/fields";
import { COMPANY_ROLE_LABELS, type CompanyMemberRow } from "@/components/tours/content/shared";
import { ROLE_LABELS, type Role } from "@/types/auth.types";

/** The Hebrew name of a member's role; roles added after COMPANY_ROLE_LABELS (tours_agent) come from ROLE_LABELS. */
const roleName = (role: string): string => COMPANY_ROLE_LABELS[role] ?? ROLE_LABELS[role as Role]?.he ?? role;

export function CompanyMembers({ initial, companyName }: { initial: CompanyMemberRow[]; companyName: string }) {
  const confirm = useConfirm();
  const [members, setMembers] = useState(initial);
  const [email, setEmail] = useState("");
  const [keepMegaEvents, setKeepMegaEvents] = useState(false);
  const [isPending, startTransition] = useTransition();

  const add = () => {
    if (!email.trim()) return;
    startTransition(async () => {
      const result = await addCompanyMember(email, keepMegaEvents);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setMembers(result.data.members);
      setEmail("");
      setKeepMegaEvents(false);
      toast.success(result.data.note);
    });
  };

  const remove = async (member: CompanyMemberRow) => {
    const ok = await confirm({
      title: `להסיר את ${member.name} מ-${companyName}?`,
      description: "המשתמש לא יראה יותר את החברה הזו. החשבון עצמו והשיוך שלו לחברות אחרות לא משתנים.",
      confirmLabel: "הסרה מהחברה",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await removeCompanyMember(member.userId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setMembers(result.data);
      toast.success(`${member.name} הוסר/ה מ-${companyName}`);
    });
  };

  return (
    <Section
      title={`חברי הצוות בחברה (${members.length})`}
      description="מי שמשויך לחברה רואה אותה ועובד בה. סוכן טיולים רואה רק את לוח היציאות, לצפייה בלבד. את החשבון עצמו (שם, סיסמה, תפקיד, השבתה) מנהלים במסך המשתמשים. מנהלי-על רואים כל חברה ואינם מופיעים כאן."
    >
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">עוד לא שויכו משתמשים לחברה הזו.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table look="list">
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>אימייל</TableHead>
                <TableHead>תפקיד בחברה</TableHead>
                <TableHead>מצב</TableHead>
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
                      {member.isActive ? "פעיל" : "מושבת"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`הסרת ${member.name} מהחברה`}
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
          <p className="text-sm font-medium">שיוך משתמש קיים</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            מזינים את האימייל של משתמש צוות או של סוכן טיולים שכבר קיים במערכת. משתמש חדש יוצרים קודם במסך המשתמשים.
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
            שיוך לחברה
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={keepMegaEvents}
            onCheckedChange={(checked) => setKeepMegaEvents(checked === true)}
          />
          <span>
            להשאיר לו גישה גם למגה איבנטס
            <span className="block text-muted-foreground">
              משתמש שעוד לא שויך לאף חברה עובד היום במגה איבנטס. בלי הסימון הוא יעבוד רק ב-{companyName}. למשתמש
              שכבר משויך למגה איבנטס השיוך הקיים נשאר בכל מקרה. לסוכן טיולים הסימון לא חל: הוא עובד רק בחברה
              שאליה שויך.
            </span>
          </span>
        </label>
      </div>
    </Section>
  );
}
