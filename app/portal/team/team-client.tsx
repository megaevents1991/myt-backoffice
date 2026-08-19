"use client";

import { useState } from "react";
import type { OfficeUser } from "@/lib/portal-attribution";
import {
  createOfficeAgent,
  resetOfficeAgentPassword,
  setOfficeAgentActive,
  listOfficeUsers,
} from "@/lib/actions/portal-team-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const ROLE_LABELS: Record<string, string> = {
  office_manager: "מנהל משרד",
  agent: "סוכן",
  affiliate: "משפיען",
};

export function TeamClient({
  initialUsers,
  myId,
}: {
  initialUsers: OfficeUser[];
  myId: string;
}) {
  const { toast } = useToast();
  const [users, setUsers] = useState(initialUsers);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", phone: "" });

  const [resetTarget, setResetTarget] = useState<OfficeUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const refresh = async () => setUsers(await listOfficeUsers());

  const handleAdd = async () => {
    if (!form.email.trim() || form.password.length < 8 || !form.display_name.trim()) {
      toast({ variant: "destructive", title: "פרטים חסרים", description: "אימייל, שם, וסיסמה של 8+ תווים." });
      return;
    }
    setBusy(true);
    const result = await createOfficeAgent({
      email: form.email,
      password: form.password,
      display_name: form.display_name,
      phone: form.phone || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast({ variant: "destructive", title: "הוספת הסוכן נכשלה", description: result.error });
      return;
    }
    toast({ title: "הסוכן נוסף", description: `${form.display_name} יכול להתחבר לפורטל.` });
    setAddOpen(false);
    setForm({ email: "", password: "", display_name: "", phone: "" });
    await refresh();
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    const result = await resetOfficeAgentPassword(resetTarget.id, resetPassword);
    setBusy(false);
    if (!result.ok) {
      toast({ variant: "destructive", title: "איפוס הסיסמה נכשל", description: result.error });
      return;
    }
    toast({ title: "הסיסמה אופסה" });
    setResetTarget(null);
    setResetPassword("");
  };

  const handleToggleActive = async (user: OfficeUser) => {
    setBusy(true);
    const result = await setOfficeAgentActive(user.id, !user.is_active);
    setBusy(false);
    if (!result.ok) {
      toast({ variant: "destructive", title: "העדכון נכשל", description: result.error });
      return;
    }
    await refresh();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>הצוות שלי</CardTitle>
            <CardDescription>
              הסוכנים של המשרד. כל סוכן מקבל לינקים אישיים והמכירות שלו נספרות בנפרד - העמלה נשארת של המשרד.
            </CardDescription>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>הוספת סוכן</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>סוכן חדש במשרד</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input placeholder="שם מלא" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
                <Input placeholder="אימייל" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <Input placeholder="סיסמה (8+ תווים)" dir="ltr" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <Input placeholder="טלפון (לא חובה)" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <DialogFooter>
                <Button onClick={handleAdd} disabled={busy}>הוספה</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם</TableHead>
                <TableHead className="text-right">אימייל</TableHead>
                <TableHead className="text-right">תפקיד</TableHead>
                <TableHead className="text-right">מזהה לינק</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.display_name || "-"}
                    {user.id === myId && <span className="ms-1 text-xs text-muted-foreground">(אני)</span>}
                  </TableCell>
                  <TableCell dir="ltr" className="text-right">{user.email}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role] ?? user.role}</TableCell>
                  <TableCell dir="ltr" className="text-right font-mono text-xs">
                    {user.agent_slug ? `ag-${user.agent_slug}` : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "secondary"}>
                      {user.is_active ? "פעיל" : "מושבת"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 space-x-reverse whitespace-nowrap">
                    {user.role === "agent" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => { setResetTarget(user); setResetPassword(""); }}>
                          איפוס סיסמה
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => handleToggleActive(user)}>
                          {user.is_active ? "השבתה" : "הפעלה"}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>איפוס סיסמה - {resetTarget?.display_name || resetTarget?.email}</DialogTitle>
          </DialogHeader>
          <Input placeholder="סיסמה חדשה (8+ תווים)" dir="ltr" type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
          <DialogFooter>
            <Button onClick={handleReset} disabled={busy || resetPassword.length < 8}>איפוס</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
