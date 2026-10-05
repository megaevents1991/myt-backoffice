"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ExternalLink, Loader2, PlusCircle, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/components/page-header";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { SearchInput } from "@/components/search-input";
import { downloadBase64 } from "@/lib/download";
import { EMPTY, fmtInstant } from "@/lib/tours/format";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { useCompany } from "@/contexts/company-context";
import { exportLeads, getLeadsMeta, listLeads, updateLead } from "@/lib/actions/tours-leads-actions";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import { Fact, FactList, LoadError } from "@/components/tours/ui";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import type { ReservationPrefill } from "@/components/tours/reservations/types";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  leadMatches,
  leadStatusLabel,
  readablePath,
  type LeadRow,
  type LeadStatus,
} from "@/components/tours/content/shared";

const ALL = "all";
const NOBODY = "nobody";
/** The owner of a lead who is no longer on the staff list (left the company, deactivated). */
const FORMER_OWNER = "Another teammate";

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

/** A phone number that dials or an e-mail address that writes. */
function ContactLink({ scheme, value }: { scheme: "tel" | "mailto"; value: string }) {
  return (
    <a href={`${scheme}:${value}`} className={cn("text-primary hover:underline", scheme === "tel" && "whitespace-nowrap tabular")}>
      {value}
    </a>
  );
}

/** The tour a lead was sent from, read from the address of its page on the site: /package/<tour>/ -> "tour". */
function tourOf(path: string | null): string {
  const match = /^\/package\/([^/?#]+)/.exec(path ?? "");
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).replace(/-/g, " ");
  } catch {
    return match[1].replace(/-/g, " ");
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
 * turn it into a reservation, export what the screen shows.
 */
export function LeadsInbox() {
  const run = useActionToast();
  const { active } = useCompany();
  const { data, error, loading, reload, setData } = useActionData(() => listLeads(), []);
  const { data: meta, reload: reloadMeta } = useActionData(() => getLeadsMeta(), []);
  const [view, setView] = useSessionState<string>("leads-view", ALL);
  const [kind, setKind] = useSessionState<string>("leads-kind", ALL);
  // The search lives here, not in the table, so the export reads the same rows.
  const [q, setQ] = useSessionState<string>("leads-q", "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reserving, setReserving] = useState<ReservationPrefill | undefined>(undefined);

  const refresh = () => {
    void reload();
    void reloadMeta();
  };

  /** The owner's name; "" when nobody owns the lead (or the staff list is not in yet). */
  const ownerName = useCallback(
    (id: string | null) => (id && meta ? (meta.assignees.find((p) => p.id === id)?.name ?? FORMER_OWNER) : ""),
    [meta],
  );

  const patchRows = (patch: (row: LeadRow) => LeadRow) =>
    setData((current) => current && { ...current, rows: current.rows.map(patch) });

  const change = async (lead: LeadRow, patch: { status?: string; assignedTo?: string | null }) => {
    setBusyId(lead.id);
    const result = await run(() => updateLead(lead.id, patch));
    setBusyId(null);
    if (result.success) patchRows((r) => (r.id === lead.id ? result.data : r));
  };

  const runExport = async () => {
    setExporting(true);
    const result = await run(
      () => exportLeads({ status: view === ALL ? "" : view, kind: kind === ALL ? "" : kind, q }),
      (answer) => `Export ready: ${answer.data.rows} leads`,
    );
    setExporting(false);
    if (result.success) downloadBase64(result.data.base64, result.data.fileName);
  };

  const columns = useMemo<ColumnDef<LeadRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader label="Date" column={column} />,
        cell: ({ row }) => <div className="whitespace-nowrap tabular">{fmtInstant(row.original.createdAt)}</div>,
      },
      { accessorKey: "kind", header: "Type", cell: ({ row }) => <div className="whitespace-nowrap">{kindLabel(row.original.kind)}</div> },
      { accessorKey: "name", header: "Name", cell: ({ row }) => <div dir="auto">{row.original.name || EMPTY}</div> },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => (row.original.phone ? <ContactLink scheme="tel" value={row.original.phone} /> : EMPTY),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (row.original.email ? <ContactLink scheme="mailto" value={row.original.email} /> : EMPTY),
      },
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
        // the tour the visitor was looking at when they wrote: the form sits on the tour's page
        id: "tour",
        accessorFn: (row) => tourOf(row.sourcePath),
        header: "Tour",
        cell: ({ row }) => (
          <div dir="auto" className="max-w-[12rem] truncate" title={tourOf(row.original.sourcePath) || undefined}>
            {tourOf(row.original.sourcePath) || EMPTY}
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
      { accessorKey: "assignedTo", header: "Assigned To", cell: ({ row }) => ownerName(row.original.assignedTo) || EMPTY },
      { accessorKey: "status", header: ({ column }) => <SortableHeader label="Status" column={column} />, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [ownerName],
  );

  const all = useMemo(() => data?.rows ?? [], [data]);
  const ofKind = useMemo(() => (kind === ALL ? all : all.filter((r) => r.kind === kind)), [all, kind]);
  const searched = useMemo(() => (q ? ofKind.filter((r) => leadMatches(r, q)) : ofKind), [ofKind, q]);
  const shown = view === ALL ? searched : searched.filter((r) => r.status === view);
  const open = openId ? all.find((r) => r.id === openId) : undefined;
  const siteUrl = active?.siteUrl?.replace(/\/$/, "") ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Every form sent from the website: lead form, contact, cancellation request, newsletter and advisor request. Open a lead to set its status, assign it to a teammate or turn it into a reservation."
        actions={
          <>
            <Button variant="outline" onClick={refresh}>
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

      {error && !loading && <LoadError message={error} onRetry={refresh} />}
      {data ? (
        <DataTable
          columns={columns}
          data={shown}
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
            <>
              <SearchInput value={q} onValueChange={setQ} placeholder="Search by name, phone, email, message or page..." />
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
            </>
          }
          onRowClick={(row) => setOpenId(row.id)}
          stateKey="tours-leads-inbox"
          emptyState={{
            title: all.length === 0 ? "No leads yet" : "No leads in this view",
            description:
              all.length === 0
                ? "Every form sent from the website (lead form, contact, cancellation request, newsletter, advisor request) appears here."
                : "Choose another status or type, or clear the search.",
          }}
        />
      ) : (
        loading && <DataTableSkeleton rows={12} label="Loading leads" />
      )}
      {data?.truncated && (
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
                      <SelectValue>{ownerName(open.assignedTo) || "Unassigned"}</SelectValue>
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

              <FactList>
                <Fact label="Name">{open.name && <span dir="auto">{open.name}</span>}</Fact>
                <Fact label="Phone">{open.phone && <ContactLink scheme="tel" value={open.phone} />}</Fact>
                <Fact label="Email">{open.email && <ContactLink scheme="mailto" value={open.email} />}</Fact>
                <Fact label="Source Page">
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
                </Fact>
                <Fact label="Message">
                  {open.message && (
                    <p dir="auto" className="whitespace-pre-wrap break-words">
                      {open.message}
                    </p>
                  )}
                </Fact>
              </FactList>

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
          patchRows((r) => (r.id === leadId && r.status !== "spam" ? { ...r, status: "done" } : r));
        }}
      />
    </div>
  );
}

/** The raw fields a form sent besides the usual ones, key by key. */
function KeyValues({ title, values, empty }: { title: string; values: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(values);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <FactList className="rounded-md border bg-muted/30 px-3">
          {entries.map(([key, value]) => {
            const text = display(value);
            return (
              <Fact
                key={key}
                label={
                  <span className="font-mono text-xs" title={key}>
                    {key}
                  </span>
                }
              >
                {text && <span dir="auto">{text}</span>}
              </Fact>
            );
          })}
        </FactList>
      )}
    </div>
  );
}
