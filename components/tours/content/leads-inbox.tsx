"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ExternalLink, Loader2, PlusCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/components/page-header";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { downloadBase64 } from "@/lib/download";
import { fmtInstant } from "@/lib/tours/format";
import { useToast } from "@/hooks/use-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { useCompany } from "@/contexts/company-context";
import { exportLeads, getLeadsMeta, listLeads, updateLead } from "@/lib/actions/tours-leads-actions";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import type { ReservationPrefill } from "@/components/tours/reservations/types";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  leadStatusLabel,
  type LeadRow,
  type LeadsMeta,
  type LeadStatus,
} from "@/components/tours/content/shared";

const ALL = "all";
const NOBODY = "nobody";

const kindLabel = (kind: string) => LEAD_KIND_LABELS[kind] ?? kind;

const STATUS_VARIANT: Record<LeadStatus, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  in_progress: "secondary",
  done: "outline",
  spam: "destructive",
};

const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={STATUS_VARIANT[status as LeadStatus] ?? "outline"}>{leadStatusLabel(status)}</Badge>
);

const display = (value: unknown): string =>
  value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);

/** A site path as people read it: Hebrew slugs decoded. */
function readablePath(path: string | null): string {
  if (!path) return "";
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The departure a lead was sent from: the site's ?product_id= on its page. */
function siteIdOf(path: string | null): number | null {
  const query = (path ?? "").split("?")[1];
  if (!query) return null;
  const id = Number(new URLSearchParams(query).get("product_id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * /tours/leads - everything the site's forms sent, on the shared DataTable:
 * a view per status, read a lead, set its status, hand it to a teammate,
 * turn it into a reservation, export.
 */
export function LeadsInbox() {
  const { toast } = useToast();
  const { active } = useCompany();
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [view, setView] = useSessionState<string>("leads-view", ALL);
  const [kind, setKind] = useSessionState<string>("leads-kind", ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reserving, setReserving] = useState<ReservationPrefill | undefined>(undefined);

  const fail = useCallback(
    (description: string) => toast({ variant: "destructive", title: "Error", description }),
    [toast],
  );

  const load = useCallback(async () => {
    const [list, info] = await Promise.all([listLeads(), getLeadsMeta()]);
    if (list.success) {
      setRows(list.data.rows);
      setTruncated(list.data.truncated);
    } else {
      setRows((current) => current ?? []);
      fail(list.error);
    }
    if (info.success) setMeta(info.data);
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const assigneeName = useCallback(
    (id: string | null) => (id ? (meta?.assignees.find((p) => p.id === id)?.name ?? "") : ""),
    [meta],
  );

  const replace = (lead: LeadRow) => setRows((current) => current?.map((r) => (r.id === lead.id ? lead : r)) ?? null);

  const change = async (lead: LeadRow, patch: { status?: string; assignedTo?: string | null }) => {
    setBusyId(lead.id);
    const result = await updateLead(lead.id, patch);
    setBusyId(null);
    if (!result.success) return fail(result.error);
    replace(result.data);
  };

  const runExport = async () => {
    setExporting(true);
    const result = await exportLeads({ status: view === ALL ? "" : view, kind: kind === ALL ? "" : kind });
    setExporting(false);
    if (!result.success) return fail(result.error);
    downloadBase64(result.data.base64, result.data.fileName);
    toast({ title: "Export ready", description: `${result.data.rows} leads` });
  };

  const columns = useMemo<ColumnDef<LeadRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader label="Date" column={column} />,
        cell: ({ row }) => <div className="whitespace-nowrap tabular">{fmtInstant(row.original.createdAt)}</div>,
      },
      { accessorKey: "kind", header: "Type", cell: ({ row }) => <div className="whitespace-nowrap">{kindLabel(row.original.kind)}</div> },
      { accessorKey: "name", header: "Name", cell: ({ row }) => <div dir="auto">{row.original.name || "-"}</div> },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) =>
          row.original.phone ? (
            <a
              href={`tel:${row.original.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="whitespace-nowrap tabular text-primary hover:underline"
            >
              {row.original.phone}
            </a>
          ) : (
            "-"
          ),
      },
      { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || "-" },
      {
        accessorKey: "message",
        header: "Message",
        cell: ({ row }) => (
          <div dir="auto" className="max-w-[18rem] truncate text-muted-foreground" title={row.original.message ?? undefined}>
            {row.original.message || ""}
          </div>
        ),
      },
      {
        accessorKey: "sourcePath",
        header: "Source Page",
        cell: ({ row }) => (
          <div dir="auto" className="max-w-[14rem] truncate text-muted-foreground" title={readablePath(row.original.sourcePath)}>
            {readablePath(row.original.sourcePath)}
          </div>
        ),
      },
      { accessorKey: "assignedTo", header: "Assigned To", cell: ({ row }) => assigneeName(row.original.assignedTo) || "-" },
      { accessorKey: "status", header: ({ column }) => <SortableHeader label="Status" column={column} />, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [assigneeName],
  );

  const all = rows ?? [];
  const ofKind = kind === ALL ? all : all.filter((r) => r.kind === kind);
  const shown = view === ALL ? ofKind : ofKind.filter((r) => r.status === view);
  const open = openId ? all.find((r) => r.id === openId) : undefined;
  const siteUrl = active?.siteUrl?.replace(/\/$/, "") ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Every form sent from the website: lead form, contact, cancellation request, newsletter and advisor request. Open a lead to set its status, assign it to a teammate or turn it into a reservation."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={runExport} disabled={exporting || all.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export to Excel
            </Button>
          </>
        }
      />

      {rows === null ? (
        <DataTableSkeleton rows={12} label="Loading leads" />
      ) : (
        <DataTable
          columns={columns}
          data={shown}
          searchColumns={["name", "phone", "email", "message", "sourcePath"]}
          searchPlaceholder="Search by name, phone, email, message or page..."
          defaultPageSize={50}
          pageSizeOptions={[10, 25, 50, 100]}
          dense
          getRowId={(row) => row.id}
          defaultSorting={[{ id: "createdAt", desc: true }]}
          views={[
            { id: ALL, label: "All", count: ofKind.length },
            ...LEAD_STATUSES.map((status) => ({
              id: status,
              label: LEAD_STATUS_LABELS[status],
              count: ofKind.filter((r) => r.status === status).length,
            })),
          ]}
          activeView={view}
          onViewChange={setView}
          filters={
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-9 w-48" aria-label="Lead type">
                <SelectValue>{kind === ALL ? "All types" : kindLabel(kind)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {(meta?.kinds ?? Object.keys(LEAD_KIND_LABELS)).map((k) => (
                  <SelectItem key={k} value={k}>
                    {kindLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          onRowClick={(row) => setOpenId(row.id)}
          stateKey="tours-leads"
          emptyState={{
            title: all.length === 0 ? "No leads yet" : "No leads in this view",
            description:
              all.length === 0
                ? "Every form sent from the website (lead form, contact, cancellation request, newsletter, advisor request) appears here."
                : "Choose another status or type, or clear the search.",
          }}
        />
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the newest 5,000 leads. Export to Excel reads all of them.
        </p>
      )}

      <Sheet open={!!open} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <div className="space-y-5 pt-6">
              <SheetHeader className="pe-6 text-start">
                <SheetTitle dir="auto">{open.name || open.phone || open.email || "Lead"}</SheetTitle>
                <SheetDescription>
                  {kindLabel(open.kind)} · {fmtInstant(open.createdAt)}
                </SheetDescription>
              </SheetHeader>

              <Button
                className="w-full"
                onClick={() =>
                  setReserving({
                    leadId: open.id,
                    customerName: open.name,
                    customerPhone: open.phone,
                    customerEmail: open.email,
                    note: open.message,
                    siteId: siteIdOf(open.sourcePath),
                  })
                }
              >
                <PlusCircle className="h-4 w-4" />
                Create Reservation
              </Button>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select
                    value={open.status}
                    disabled={busyId === open.id}
                    onValueChange={(status) => void change(open, { status })}
                  >
                    <SelectTrigger aria-label="Lead status">
                      <SelectValue>{leadStatusLabel(open.status)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {LEAD_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Assigned To</Label>
                  <Select
                    value={open.assignedTo ?? NOBODY}
                    disabled={busyId === open.id || !meta}
                    onValueChange={(id) => void change(open, { assignedTo: id === NOBODY ? null : id })}
                  >
                    <SelectTrigger aria-label="Lead owner">
                      <SelectValue>{assigneeName(open.assignedTo) || "Unassigned"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOBODY}>Unassigned</SelectItem>
                      {(meta?.assignees ?? []).map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.name}
                          {person.id === meta?.currentUserId ? " (me)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <dl className="space-y-3 text-sm">
                <DetailRow label="Name">{open.name && <span dir="auto">{open.name}</span>}</DetailRow>
                <DetailRow label="Phone">
                  {open.phone && (
                    <a href={`tel:${open.phone}`} className="tabular text-primary hover:underline">
                      {open.phone}
                    </a>
                  )}
                </DetailRow>
                <DetailRow label="Email">
                  {open.email && (
                    <a href={`mailto:${open.email}`} className="text-primary hover:underline">
                      {open.email}
                    </a>
                  )}
                </DetailRow>
                <DetailRow label="Source Page">
                  {open.sourcePath &&
                    (siteUrl ? (
                      <a
                        href={`${siteUrl}${open.sourcePath}`}
                        target="_blank"
                        rel="noreferrer"
                        dir="auto"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {readablePath(open.sourcePath)}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span dir="auto">{readablePath(open.sourcePath)}</span>
                    ))}
                </DetailRow>
                <DetailRow label="Message">
                  {open.message && (
                    <p dir="auto" className="whitespace-pre-wrap break-words">
                      {open.message}
                    </p>
                  )}
                </DetailRow>
              </dl>

              <KeyValues title="More from the form" values={open.payload} empty="The form sent nothing else." />
              <KeyValues title="Campaign (UTM)" values={open.utm} empty="No campaign data." />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ReservationDialog
        open={!!reserving}
        onOpenChange={(next) => !next && setReserving(undefined)}
        prefill={reserving}
        onCreated={() => {
          // The server marked the lead done; show it without a reload.
          const leadId = reserving?.leadId;
          setRows((current) =>
            current?.map((r) => (r.id === leadId && r.status !== "spam" ? { ...r, status: "done" } : r)) ?? null,
          );
        }}
      />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">Not given</span>}</dd>
    </div>
  );
}

function KeyValues({ title, values, empty }: { title: string; values: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(values);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[130px_1fr] gap-2">
              <dt className="truncate font-mono text-xs text-muted-foreground" title={key}>
                {key}
              </dt>
              <dd className="min-w-0 break-words" dir="auto">
                {display(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
