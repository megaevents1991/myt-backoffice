"use client";

import { useState, useTransition } from "react";
import { Link2, RotateCw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  createAndSendInvites,
  deleteInvite,
  resendInvite,
} from "@/lib/actions/form-invite-actions";
import type { FormInvite, FormLang, FormStatus } from "@/types/form.types";

/** One recipient per line: "Name, email@example.com" or just the address. */
function parseRecipients(raw: string, lang: FormLang) {
  return raw
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\t]+/).map((part) => part.trim());
      const email = parts.find((part) => part.includes("@")) ?? "";
      const name = parts.find((part) => part !== email && part !== "") ?? null;
      return { name, email, lang };
    })
    .filter((recipient) => recipient.email !== "");
}

type Props = {
  formId: number;
  formStatus: FormStatus;
  defaultLang: FormLang;
  initialInvites: FormInvite[];
};

export function InvitesClient({
  formId,
  formStatus,
  defaultLang,
  initialInvites,
}: Props) {
  const { toast } = useToast();
  const [invites, setInvites] = useState(initialInvites);
  const [raw, setRaw] = useState("");
  const [lang, setLang] = useState<FormLang>(defaultLang);
  const [pending, startTransition] = useTransition();

  const isLive = formStatus === "live";
  const parsed = parseRecipients(raw, lang);

  function handleSend() {
    if (parsed.length === 0) {
      toast({ title: "Add at least one email address", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      try {
        const result = await createAndSendInvites(formId, parsed);
        toast({
          title: `Sent ${result.sent} invite${result.sent === 1 ? "" : "s"}`,
          description:
            result.failed.length > 0
              ? `Failed: ${result.failed.map((f) => f.email).join(", ")}`
              : undefined,
          variant: result.failed.length > 0 ? "destructive" : undefined,
        });
        setRaw("");
        window.location.reload();
      } catch (error) {
        toast({
          title: "Could not send",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    });
  }

  function handleResend(invite: FormInvite) {
    startTransition(async () => {
      try {
        await resendInvite(invite.id);
        setInvites((prev) =>
          prev.map((i) =>
            i.id === invite.id
              ? { ...i, sent_at: new Date().toISOString(), send_error: null }
              : i,
          ),
        );
        toast({ title: `Resent to ${invite.recipient_email}` });
      } catch (error) {
        toast({
          title: "Could not resend",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    });
  }

  function handleDelete(invite: FormInvite) {
    startTransition(async () => {
      try {
        await deleteInvite(invite.id, formId);
        setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      } catch {
        toast({ title: "Could not delete the invite", variant: "destructive" });
      }
    });
  }

  async function copyInviteLink(invite: FormInvite) {
    const url = `${window.location.origin}/f/i/${invite.token}?lang=${invite.lang}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Personal link copied", description: url });
  }

  function statusBadge(invite: FormInvite) {
    if (invite.submitted_at) return <Badge>Filled</Badge>;
    if (invite.opened_at) return <Badge variant="secondary">Opened</Badge>;
    if (invite.send_error) return <Badge variant="destructive">Failed</Badge>;
    if (invite.sent_at) return <Badge variant="outline">Sent</Badge>;
    return <Badge variant="outline">Link only</Badge>;
  }

  return (
    <div className="space-y-6">
      {!isLive && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          This form is <strong>{formStatus}</strong>. Set it to <strong>Live</strong> on
          the form page before sending invites.
        </p>
      )}

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            Recipients — one per line, “Name, email@example.com”
          </Label>
          <Textarea
            rows={6}
            dir="ltr"
            placeholder={"Dana Levi, dana@example.com\nyossi@example.com"}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Email language
            </Label>
            <Select value={lang} onValueChange={(next) => setLang(next as FormLang)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="he">עברית</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSend} disabled={pending || !isLive || parsed.length === 0}>
            <Send className="mr-2 h-4 w-4" />
            {pending
              ? "Sending…"
              : `Send ${parsed.length || ""} invite${parsed.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Filled</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No invites yet.
                </TableCell>
              </TableRow>
            )}

            {invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell>
                  <div className="font-medium">{invite.recipient_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {invite.recipient_email ?? "no email"}
                  </div>
                  {invite.send_error && (
                    <div className="text-xs text-destructive">{invite.send_error}</div>
                  )}
                </TableCell>
                <TableCell className="uppercase text-muted-foreground">{invite.lang}</TableCell>
                <TableCell>{statusBadge(invite)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {invite.sent_at ? new Date(invite.sent_at).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {invite.submitted_at
                    ? new Date(invite.submitted_at).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyInviteLink(invite)}
                      aria-label="Copy personal link"
                    >
                      <Link2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending || !invite.recipient_email || !isLive}
                      onClick={() => handleResend(invite)}
                      aria-label="Resend"
                    >
                      <RotateCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      disabled={pending}
                      onClick={() => handleDelete(invite)}
                      aria-label="Delete invite"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
