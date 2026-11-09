"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Download } from "lucide-react";
import { DataTable, SortableHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  getClubMemberLog,
  removeClubMember,
  resendClubWelcome,
  restoreClubMember,
  unsubscribeClubMember,
} from "@/lib/actions/club-actions";
import { exportableMembers, israelDateTime, membersCsv } from "@/lib/club/csv";
import type { ClubLogRow, ClubMemberView } from "@/lib/club/types";
import { PUBLIC_SITE_URL } from "@/lib/site";

type Row = ClubMemberView & { name: string };

const LOG_LABEL: Record<string, string> = {
  join: "Joined",
  rejoin: "Joined again (same email)",
  lookup: "Applied by email",
  lookup_miss: "Email not found",
  unsubscribe: "Unsubscribed",
  removed: "Removed by staff",
  restored: "Restored by staff",
};

function downloadCsv(rows: ClubMemberView[]) {
  const blob = new Blob([membersCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mega-club-members-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MembersTab({ members, onChanged }: { members: ClubMemberView[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [log, setLog] = useState<{ member: Row; rows: ClubLogRow[] | null } | null>(null);
  const rows: Row[] = useMemo(
    () => members.map((m) => ({ ...m, name: [m.first_name, m.last_name].filter(Boolean).join(" ") })),
    [members],
  );

  async function act(label: string, run: () => Promise<{ ok: true } | { ok: false; kind: string; message?: string }>) {
    const res = await run();
    if (res.ok) {
      toast({ title: label });
      onChanged();
    } else {
      toast({
        variant: "destructive",
        title: "Did not go through",
        description: res.kind === "site_not_ready" ? "The site does not have the club yet." : res.message ?? res.kind,
      });
    }
  }

  async function openLog(member: Row) {
    setLog({ member, rows: null });
    const res = await getClubMemberLog(member.id);
    setLog({ member, rows: res.ok ? res.rows : [] });
  }

  const columns: ColumnDef<Row>[] = [
    { accessorKey: "member_no", header: ({ column }) => <SortableHeader label="No." column={column} />, cell: ({ row }) => <span className="tabular-nums">{row.original.member_no}</span> },
    {
      accessorKey: "name",
      header: "Name",
      // Names are typed in Hebrew on the site: dir="auto" keeps their own direction inside the LTR table.
      cell: ({ row }) =>
        row.original.name ? (
          <span dir="auto" className="whitespace-nowrap">
            {row.original.name}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "phone", header: "Phone", cell: ({ row }) => <span dir="ltr" className="tabular-nums">{row.original.phone ?? ""}</span> },
    {
      accessorKey: "created_at",
      header: ({ column }) => <SortableHeader label="Joined" column={column} />,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{israelDateTime(row.original.created_at)}</span>,
    },
    {
      accessorKey: "eventName",
      header: "Joined at",
      cell: ({ row }) =>
        row.original.event_id != null ? (
          <a
            dir="auto"
            className="inline-block min-w-[10rem] underline underline-offset-2"
            href={`${PUBLIC_SITE_URL}/order/${row.original.event_id}`}
            target="_blank"
            rel="noreferrer"
          >
            {row.original.eventName ?? `#${row.original.event_id}`}
          </a>
        ) : (
          ""
        ),
    },
    {
      accessorKey: "ordersPaid",
      header: ({ column }) => <SortableHeader label="Orders (Paid / all)" column={column} />,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.ordersPaid} / {row.original.ordersAll}
        </span>
      ),
    },
    {
      accessorKey: "paidRevenueUsd",
      header: ({ column }) => <SortableHeader label="Paid revenue" column={column} />,
      cell: ({ row }) => <span className="tabular-nums">${Math.round(row.original.paidRevenueUsd).toLocaleString("en-US")}</span>,
    },
    {
      accessorKey: "marketing",
      header: "Updates",
      cell: ({ row }) =>
        row.original.marketing === "subscribed" ? <Badge variant="secondary">Subscribed</Badge> : <Badge variant="outline">Unsubscribed</Badge>,
    },
    {
      id: "welcome",
      header: "Welcome mail",
      cell: ({ row }) =>
        row.original.welcome_sent_at ? (
          <span className="text-emerald-700">Sent</span>
        ) : row.original.welcome_error ? (
          <span className="text-red-600" title={row.original.welcome_error}>
            Failed
          </span>
        ) : (
          <span className="text-muted-foreground">Pending</span>
        ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (row.original.status === "active" ? "Active" : <Badge variant="destructive">Removed</Badge>),
    },
    { accessorKey: "coupon_code", header: "Code", cell: ({ row }) => <code className="text-xs">{row.original.coupon_code}</code> },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const m = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for member ${m.member_no}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void openLog(m)}>Consent and activity log</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void act("Welcome mail sent again", () => resendClubWelcome(m.id))}>Resend welcome mail</DropdownMenuItem>
              {m.marketing === "subscribed" && (
                <DropdownMenuItem onSelect={() => void act("Unsubscribed from updates", () => unsubscribeClubMember(m.id))}>
                  Unsubscribe from updates
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {m.status === "active" ? (
                <DropdownMenuItem className="text-red-600" onSelect={() => void act(`Member ${m.member_no} removed - the code no longer works`, () => removeClubMember(m.id))}>
                  Remove member (code stops working)
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void act(`Member ${m.member_no} restored`, () => restoreClubMember(m.id))}>Restore member</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        stateKey="club-members-v1"
        getRowId={(r) => r.id}
        searchColumns={["name", "email", "phone", "coupon_code", "member_no"]}
        searchPlaceholder="Search name, email, phone, code or number…"
        defaultSorting={[{ id: "member_no", desc: true }]}
        rightActions={({ filteredRows }) => {
          // The rows the search leaves, and of them only who may be mailed (the file is for Zoho Campaigns).
          const out = exportableMembers(filteredRows);
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(out)}
              disabled={out.length === 0}
              title="The rows shown, subscribed and active members only"
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV ({out.length} subscribed)
            </Button>
          );
        }}
        emptyState={{ title: "No members yet", description: "People who join MEGA CLUB on the order summary show up here." }}
      />
      <Dialog open={log !== null} onOpenChange={(open) => !open && setLog(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Member {log?.member.member_no} · {log?.member.email}</DialogTitle>
          </DialogHeader>
          {!log?.rows ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : log.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No log rows.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
              {log.rows.map((r) => (
                <li key={r.id} className="rounded-md border p-2">
                  <div className="flex justify-between gap-2">
                    <b>{LOG_LABEL[r.action] ?? r.action}</b>
                    <span className="tabular-nums text-muted-foreground">{israelDateTime(r.at)}</span>
                  </div>
                  {r.consent_text && (
                    <p dir="rtl" className="mt-1">
                      “{r.consent_text}” <span className="text-xs text-muted-foreground">({r.consent_version})</span>
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[r.source, r.ip && `IP ${r.ip}`, r.user_agent].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
