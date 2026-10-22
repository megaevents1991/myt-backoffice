"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ExternalLink, ListChecks, Loader2, MessageCircle, MoreHorizontal, Phone, PlusCircle, RefreshCw, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/page-header";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { SearchInput } from "@/components/search-input";
import { useConfirm } from "@/components/confirm-provider";
import { FOLLOW_UP_TONE } from "@/components/follow-up-widget";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useToast } from "@/hooks/use-toast";
import { useSessionState, useUrlState } from "@/hooks/use-view-state";
import { downloadBase64 } from "@/lib/download";
import { followUpLabel } from "@/lib/reservations/follow-up";
import { fmtInstant, todayIso } from "@/lib/tours/format";
import { bulkUpdateCases, deleteCase, exportCases, listCases, updateCase } from "@/lib/actions/tours-cases-actions";
import { afterSave } from "@/lib/tours/board";
import { Chip, LoadError } from "@/components/tours/ui";
import {
  TODAY_REASON_LABELS,
  caseMatches,
  caseName,
  followUpDue,
  followUpTone,
  needsCloseReason,
  sourceLabel,
  todayReason,
  waLink,
  type CaseChange,
  type CaseRow,
  type CasesPage,
  type CaseStatus,
} from "@/lib/tours/cases";
import {
  CardWhat,
  BulkAssignSelect,
  CardWho,
  CloseReasonDialog,
  FollowUpInput,
  InRow,
  NOBODY,
  PhoneCell,
  RepSelect,
  StageBar,
  StatusSelect,
  TodayBadge,
  TypeBadge,
  WhatsAppButton,
} from "@/components/tours/cases/case-ui";
import { NewCaseDialog } from "@/components/tours/cases/new-case-dialog";
import { StatusesDialog } from "@/components/tours/cases/statuses-dialog";

const VIEWS = ["all", "reservations", "leads", "potential", "mine", "follow_up", "unassigned"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = {
  all: "All",
  reservations: "Reservations",
  leads: "Leads",
  potential: "Potential",
  mine: "Mine",
  follow_up: "Follow-up due",
  unassigned: "Unassigned",
};
const ALL = "all";

const reasonOf = (row: CaseRow, statuses: readonly CaseStatus[], today: string) => todayReason(row, statuses, today);

/**
 * Every card of a tours company in one table - the ALL tab of /tours/reservations (Nir 19.10): bulk changes, export,
 * the columns of Alon's road map edited in the row. A row opens its customer with that card open. `embedded` = inside
 * the board, which owns the page title.
 */
export function CasesScreen({ embedded }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const run = useActionToast();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useActionData<CasesPage>(() => listCases(), []);
  const [view, setView] = useUrlState<View>("view", "all", VIEWS);
  const [q, setQ] = useSessionState<string>("cases-q", "");
  const [statusFilter, setStatusFilter] = useSessionState<string>("cases-status", ALL);
  const [repFilter, setRepFilter] = useSessionState<string>("cases-rep", ALL);
  const [productFilter, setProductFilter] = useSessionState<string>("cases-product", ALL);
  const [sourceFilter, setSourceFilter] = useSessionState<string>("cases-source", ALL);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // a closing status picked in the bulk bar waits here for its reason
  const [bulkClosing, setBulkClosing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingStatuses, setEditingStatuses] = useState(false);
  const today = todayIso();

  const statuses = useMemo(() => data?.statuses ?? [], [data]);
  const reps = useMemo(() => data?.reps ?? [], [data]);
  const currentUserId = data?.currentUserId ?? "";
  const all = useMemo(() => data?.rows ?? [], [data]);

  const save = useCallback(
    async (row: CaseRow, change: CaseChange) => {
      setBusy(row.id);
      const result = await run(() => updateCase(row.id, change));
      setBusy(null);
      if (!result.success || !data) return;
      // a card handed to another rep leaves a rep's list (review 21.10)
      const next = afterSave(data.rows, result.data, data.viewer);
      setData((current) => current && { ...current, rows: next.cards });
      if (next.handedTo) toast({ title: `Card handed to ${reps.find((p) => p.id === next.handedTo)?.name ?? "another rep"}` });
    },
    [data, reps, run, setData, toast],
  );

  // the same delete as the case page: soft, and the server refuses a case with money on it
  const remove = useCallback(
    async (row: CaseRow) => {
      const agreed = await confirm({
        title: `Delete case #${row.caseNo}?`,
        description: "The case is marked deleted and leaves the table; it stays recoverable. Its seats stay on the departure until you cancel them.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!agreed) return;
      setBusy(row.id);
      const result = await run(() => deleteCase(row.id), "Case deleted");
      setBusy(null);
      if (result.success) setData((current) => current && { ...current, rows: current.rows.filter((r) => r.id !== row.id) });
    },
    [confirm, run, setData],
  );

  const products = useMemo(() => [...new Set(all.map((r) => r.tourName).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "he")), [all]);
  const sources = useMemo(() => [...new Set(all.map((r) => sourceLabel(r.source, r.utm)))].sort(), [all]);

  // search + filters first; the views count what is left
  const filtered = useMemo(
    () =>
      all.filter(
        (r) =>
          (statusFilter === ALL || r.status === statusFilter) &&
          (repFilter === ALL || (repFilter === NOBODY ? !r.assignedTo : r.assignedTo === repFilter)) &&
          (productFilter === ALL || r.tourName === productFilter) &&
          (sourceFilter === ALL || sourceLabel(r.source, r.utm) === sourceFilter) &&
          (!q || caseMatches(r, q)),
      ),
    [all, statusFilter, repFilter, productFilter, sourceFilter, q],
  );
  const inView = useCallback(
    (r: CaseRow, v: View): boolean => {
      switch (v) {
        case "reservations":
          return r.type === "reservation";
        case "leads":
          return r.type === "lead";
        case "potential":
          return r.type === "potential";
        case "mine":
          return r.assignedTo === currentUserId;
        case "follow_up":
          return followUpDue(r, statuses, today);
        case "unassigned":
          return !r.assignedTo;
        default:
          return true;
      }
    },
    [currentUserId, statuses, today],
  );
  const shown = useMemo(() => filtered.filter((r) => inView(r, view)), [filtered, inView, view]);
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  const bulk = async (change: { status?: string; assignedTo?: string | null; closeReason?: string }) => {
    setBulkBusy(true);
    const result = await run(() => bulkUpdateCases(selectedIds, change), (answer) => `${answer.data.updated} updated`);
    setBulkBusy(false);
    if (result.success) {
      setSelection({});
      await reload({ quiet: true });
    }
  };

  const runExport = async () => {
    setExporting(true);
    const result = await run(() => exportCases(shown.map((r) => r.id)), (answer) => `Export ready: ${answer.data.rows} rows`);
    setExporting(false);
    if (result.success) downloadBase64(result.data.base64, result.data.fileName);
  };

  const columns = useMemo<ColumnDef<CaseRow>[]>(
    () => [
      // the board's format (Alon 20.10: "ALL is still the old format"): who, what, where it stands - the person's own
      // fields live on the customer page now; the export still carries every column
      { accessorKey: "type", header: ({ column }) => <SortableHeader label="Type" column={column} />, cell: ({ row }) => <TypeBadge type={row.original.type} /> },
      {
        id: "who",
        accessorFn: (row) => caseName(row),
        header: ({ column }) => <SortableHeader label="Customer" column={column} />,
        cell: ({ row }) => (
          <CardWho card={row.original}>
            {/* a booking that came without the link from a known customer: same rep, offered for a merge */}
            {row.original.relatedCaseNo && (
              <Chip tone="info" className="ms-1.5" title={`Same phone or e-mail as case #${row.original.relatedCaseNo} - open the case to merge them`}>
                ↔ #{row.original.relatedCaseNo}
              </Chip>
            )}
          </CardWho>
        ),
      },
      { id: "phone", accessorFn: (row) => row.phone ?? "", header: "Phone", cell: ({ row }) => <PhoneCell phone={row.original.phone} /> },
      {
        id: "what",
        accessorFn: (row) => row.departureDate ?? row.tourName ?? "",
        header: ({ column }) => <SortableHeader label="Tour" column={column} />,
        cell: ({ row }) => {
          const { travelers, seatsMissing } = row.original;
          return (
            <CardWhat card={row.original}>
              {/* a closed booking whose travelers hold no seat (seatGap) - the departure still sells them */}
              {seatsMissing > 0 ? (
                <Chip tone="warning" className="mt-0.5" title="A closed booking's travelers hold no seat on the departure - open the card and hold them.">
                  {travelers > 0 ? `${seatsMissing} without a seat` : "No seats"}
                </Chip>
              ) : travelers > 0 ? (
                <span className="text-xs text-muted-foreground">{travelers} seats</span>
              ) : null}
            </CardWhat>
          );
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader label="Status" column={column} />,
        cell: ({ row }) => (
          <InRow className="space-y-1">
            <StatusSelect
              value={row.original.status}
              statuses={statuses}
              disabled={busy === row.original.id}
              title={row.original.closeReason ? `Closed because: ${row.original.closeReason}` : undefined}
              future={{ packageId: row.original.packageId, season: row.original.season }}
              deposit={{ departureDate: row.original.departureDate, followUpDate: row.original.followUpDate }}
              onChange={(status, closeReason, pick, followUpDate) =>
                void save(row.original, { status, closeReason, ...(pick ? { packageId: pick.packageId, season: pick.season } : {}), ...(followUpDate ? { followUpDate } : {}) })
              }
            />
            <StageBar status={row.original.status} hasOrder={!!row.original.bookingRef || row.original.travelers > 0} statuses={statuses} className="flex" />
          </InRow>
        ),
      },
      {
        id: "today",
        accessorFn: (row) => {
          const reason = reasonOf(row, statuses, today);
          return reason ? TODAY_REASON_LABELS[reason] : "";
        },
        header: ({ column }) => <SortableHeader label="Today" column={column} />,
        cell: ({ row }) => <TodayBadge reason={reasonOf(row.original, statuses, today)} followUpDate={row.original.followUpDate} today={today} />,
      },
      {
        accessorKey: "followUpDate",
        header: ({ column }) => <SortableHeader label="Follow-up" column={column} />,
        // the day, and under it how it stands (late / today / ahead)
        cell: ({ row }) => {
          const due = followUpDue(row.original, statuses, today);
          const tone = followUpTone(row.original, statuses, today);
          return (
            <InRow className="flex flex-col items-start gap-0.5">
              <FollowUpInput ghost value={row.original.followUpDate} due={due} onSave={(followUpDate) => void save(row.original, { followUpDate })} />
              {tone && (
                <span className={cn("ms-2 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-semibold", FOLLOW_UP_TONE[tone])}>
                  {followUpLabel(row.original.followUpDate, today, "en")}
                </span>
              )}
            </InRow>
          );
        },
      },
      {
        accessorKey: "assignedTo",
        header: "Rep",
        cell: ({ row }) => (
          <InRow>
            <RepSelect
              ghost
              value={row.original.assignedTo}
              reps={reps}
              currentUserId={currentUserId}
              disabled={busy === row.original.id}
              onChange={(assignedTo) => void save(row.original, { assignedTo })}
            />
          </InRow>
        ),
      },
      {
        id: "source",
        accessorFn: (row) => sourceLabel(row.source, row.utm),
        header: "Source",
        cell: ({ row }) => <div className="whitespace-nowrap text-muted-foreground">{sourceLabel(row.original.source, row.original.utm)}</div>,
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader label="Since" column={column} />,
        cell: ({ row }) => <div className="whitespace-nowrap tabular text-muted-foreground">{fmtInstant(row.original.createdAt)}</div>,
      },
      {
        // id "actions" = pinned to the table's trailing edge (DataTable), like the Events table
        id: "actions",
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const r = row.original;
          const hello = `היי ${r.firstName ?? ""}`.trim();
          // WhatsApp Web stays in the menu; the icon opens the rep's own app (no browser tab - Alon 15.10)
          const whatsappWeb = waLink(r.phone, hello);
          const label = caseName(r) || `#${r.caseNo}`;
          return (
            <InRow className="flex items-center justify-end gap-0.5">
              {whatsappWeb ? <WhatsAppButton iconOnly phone={r.phone} message={hello} /> : <span className="h-8 w-8" aria-hidden />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${label}`} disabled={busy === r.id}>
                    {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => router.push(`/tours/reservations/${r.id}`)}>
                    <ExternalLink className="h-4 w-4" />
                    Open case
                  </DropdownMenuItem>
                  {r.phone && (
                    <DropdownMenuItem asChild>
                      <a href={`tel:${r.phone}`}>
                        <Phone className="h-4 w-4" />
                        Call {r.phone}
                      </a>
                    </DropdownMenuItem>
                  )}
                  {whatsappWeb && (
                    <DropdownMenuItem asChild>
                      <a href={whatsappWeb} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp Web
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove(r)}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </InRow>
          );
        },
      },
    ],
    [busy, currentUserId, remove, reps, router, save, statuses, today],
  );

  const filterSelect = (value: string, onChange: (v: string) => void, label: string, options: { value: string; label: string }[], width = "w-40") => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9", width)} aria-label={label}>
        <SelectValue>{value === ALL ? `All ${label.toLowerCase()}` : (options.find((o) => o.value === value)?.label ?? value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      {(() => {
        const actions = (
          <>
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={runExport} disabled={exporting || shown.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
            {/* inside the board its own header has Statuses and New */}
            {!embedded && (
              <>
                <Button variant="outline" onClick={() => setEditingStatuses(true)} disabled={!data}>
                  <ListChecks className="h-4 w-4" />
                  Statuses
                </Button>
                <Button onClick={() => setAdding(true)} disabled={!data}>
                  <PlusCircle className="h-4 w-4" />
                  New
                </Button>
              </>
            )}
          </>
        );
        return embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Every card in one table - change many at once, or export.</p>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </div>
        ) : (
          <PageHeader
            title="Reservations"
            description="Every lead and every reservation in one table. Edit a field in place; open a row for its customer."
            actions={actions}
          />
        );
      })()}

      {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
      {data ? (
        <DataTable
          columns={columns}
          data={shown}
          dense
          // a line between every field, like the tours sheets (Alon 18.10: the plain rows made him dizzy)
          grid
          defaultPageSize={50}
          pageSizeOptions={[25, 50, 100]}
          getRowId={(row) => row.id}
          defaultSorting={[{ id: "createdAt", desc: true }]}
          enableRowSelection
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          bulkActions={
            <>
              <Select
                disabled={bulkBusy}
                value=""
                onValueChange={(status) => (needsCloseReason(status, statuses) ? setBulkClosing(status) : void bulk({ status }))}
              >
                <SelectTrigger className="h-8 w-40 text-foreground" aria-label="Set status">
                  <SelectValue placeholder="Set status…" />
                </SelectTrigger>
                <SelectContent>
                  {statuses
                    .filter((s) => s.isActive)
                    .map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {/* handing out cards in bulk is the manager's (Dor 21.10) */}
              {data?.viewer.manager && <BulkAssignSelect reps={reps} disabled={bulkBusy} onAssign={(id) => void bulk({ assignedTo: id })} />}
              {bulkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            </>
          }
          views={VIEWS.map((v) => ({ id: v, label: VIEW_LABELS[v], count: filtered.filter((r) => inView(r, v)).length }))}
          activeView={view}
          onViewChange={(id) => setView(id as View)}
          filters={
            <>
              <SearchInput value={q} onValueChange={setQ} placeholder="Search by name, phone, email, ID, national id, ACC, booking or tour..." />
              {filterSelect(statusFilter, setStatusFilter, "Statuses", statuses.map((s) => ({ value: s.key, label: s.label })))}
              {filterSelect(repFilter, setRepFilter, "Reps", [{ value: NOBODY, label: "Unassigned" }, ...reps.map((p) => ({ value: p.id, label: p.name }))])}
              {filterSelect(productFilter, setProductFilter, "Products", products.map((p) => ({ value: p, label: p })), "w-52")}
              {filterSelect(sourceFilter, setSourceFilter, "Sources", sources.map((s) => ({ value: s, label: s })))}
            </>
          }
          onRowClick={(row) => router.push(`/tours/reservations/${row.id}`)}
          // like the Mega Events reservations: a customer waiting for a call today stands out, a late one more
          getRowClassName={(row) => {
            const tone = followUpTone(row.original, statuses, today);
            return tone === "overdue" ? "bg-destructive/5" : tone === "today" ? "bg-warning-muted/50" : "";
          }}
          stateKey="tours-cases"
          emptyState={{
            title: all.length === 0 ? "No leads or reservations yet" : "Nothing in this view",
            description:
              all.length === 0
                ? "Every form sent from the site and every booking lands here. Add a call or a walk-in with New."
                : "Choose another view, clear a filter or the search.",
          }}
        />
      ) : (
        loading && <DataTableSkeleton rows={12} label="Loading reservations" />
      )}
      {data?.truncated && <p className="text-xs text-muted-foreground">Showing the newest 5,000 cases.</p>}

      {data && (
        <>
          <NewCaseDialog
            open={adding}
            onOpenChange={setAdding}
            reps={reps}
            currentUserId={currentUserId}
            onCreated={(id, handedTo) => {
              void reload({ quiet: true });
              // a rep who opened a card for someone else does not see it: say so instead of landing on a refusal
              if (handedTo && !data?.viewer.manager) toast({ title: `Card opened and handed to ${reps.find((p) => p.id === handedTo)?.name ?? "another rep"}` });
              else router.push(`/tours/reservations/${id}`);
            }}
          />
          <StatusesDialog
            open={editingStatuses}
            onOpenChange={setEditingStatuses}
            statuses={statuses}
            onSaved={(next) => setData((current) => current && { ...current, statuses: next })}
          />
          <CloseReasonDialog
            status={bulkClosing}
            statuses={statuses}
            count={selectedIds.length}
            onCancel={() => setBulkClosing(null)}
            onConfirm={(closeReason) => {
              const status = bulkClosing;
              setBulkClosing(null);
              if (status) void bulk({ status, closeReason });
            }}
          />
        </>
      )}
    </div>
  );
}
