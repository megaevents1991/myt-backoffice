"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ExternalLink, ListChecks, Loader2, MessageCircle, MoreHorizontal, Phone, PlusCircle, RefreshCw, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/page-header";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { SearchInput } from "@/components/search-input";
import { useConfirm } from "@/components/confirm-provider";
import { FOLLOW_UP_TONE } from "@/components/follow-up-widget";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState, useUrlState } from "@/hooks/use-view-state";
import { downloadBase64 } from "@/lib/download";
import { followUpLabel } from "@/lib/reservations/follow-up";
import { EMPTY, fmtDate, fmtInstant, todayIso } from "@/lib/tours/format";
import { bulkUpdateCases, deleteCase, exportCases, listCases, updateCase } from "@/lib/actions/tours-cases-actions";
import { LoadError } from "@/components/tours/ui";
import {
  CASE_TASK_LABELS,
  caseMatches,
  caseName,
  caseTask,
  followUpDue,
  followUpTone,
  isCaseTask,
  sourceLabel,
  waLink,
  type CaseChange,
  type CaseRow,
  type CasesPage,
  type CaseStatus,
} from "@/lib/tours/cases";
import { FollowUpInput, GHOST_FIELD, InRow, NOBODY, RepSelect, StatusSelect, TaskBadge, TypeBadge } from "@/components/tours/cases/case-ui";
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

/**
 * A text cell staff type into: saved when it loses focus (Enter too), Esc puts the old value back.
 * It reads as plain text ("-" when empty) and shows its box and its hint only when reached.
 */
function InlineText({
  value,
  placeholder,
  title,
  className,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  title?: string;
  className?: string;
  onSave: (next: string) => void;
}) {
  return (
    <Input
      key={value ?? ""}
      dir="auto"
      defaultValue={value ?? ""}
      placeholder={EMPTY}
      aria-label={placeholder}
      title={title ?? placeholder}
      className={cn("h-8 px-2", GHOST_FIELD, "placeholder:text-muted-foreground", className)}
      onFocus={(event) => {
        event.currentTarget.placeholder = placeholder;
      }}
      onBlur={(event) => {
        event.currentTarget.placeholder = EMPTY;
        const next = event.target.value.trim();
        if (next !== (value ?? "")) onSave(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = value ?? "";
          event.currentTarget.blur();
        }
      }}
    />
  );
}

const taskOf = (row: CaseRow, statuses: readonly CaseStatus[], today: string) => caseTask(row, statuses, today);

/**
 * /tours/reservations - one table for every lead and every reservation of a
 * tours company: one row per customer, the columns of Alon's road map, edited
 * in the row, opened on its own page.
 */
export function CasesScreen() {
  const router = useRouter();
  const run = useActionToast();
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
      if (result.success) setData((current) => current && { ...current, rows: current.rows.map((r) => (r.id === row.id ? result.data : r)) });
    },
    [run, setData],
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

  const bulk = async (change: { status?: string; assignedTo?: string | null }) => {
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
      {
        accessorKey: "caseNo",
        header: ({ column }) => <SortableHeader label="ID" column={column} />,
        cell: ({ row }) => <span className="font-mono text-xs tabular text-muted-foreground">{row.original.caseNo}</span>,
      },
      {
        accessorKey: "firstName",
        header: "First Name",
        cell: ({ row }) => (
          <div dir="auto" className="whitespace-nowrap font-medium">
            {row.original.firstName || EMPTY}
          </div>
        ),
      },
      {
        accessorKey: "lastName",
        header: "Last Name",
        cell: ({ row }) => (
          <div dir="auto" className="whitespace-nowrap font-medium">
            {row.original.lastName || EMPTY}
          </div>
        ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        // one line, left-to-right, no link colour: the row's WhatsApp / call buttons are the actions
        cell: ({ row }) => (
          <div dir="ltr" className="whitespace-nowrap text-start tabular">
            {row.original.phone || EMPTY}
          </div>
        ),
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
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) =>
          row.original.email ? (
            <InRow>
              <a
                href={`mailto:${row.original.email}`}
                dir="ltr"
                title={row.original.email}
                className="block max-w-[14rem] truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {row.original.email}
              </a>
            </InRow>
          ) : (
            EMPTY
          ),
      },
      {
        accessorKey: "accNum",
        header: "ACC NUM",
        cell: ({ row }) => (
          <InRow>
            <InlineText value={row.original.accNum} placeholder="TBD" className="min-w-[9ch]" onSave={(accNum) => void save(row.original, { accNum })} />
          </InRow>
        ),
      },
      {
        accessorKey: "notes",
        header: "Notes",
        cell: ({ row }) => (
          <InRow>
            <InlineText
              value={row.original.notes}
              placeholder="Add a note"
              title={row.original.notes ?? undefined}
              className="min-w-[16ch]"
              onSave={(notes) => void save(row.original, { notes })}
            />
          </InRow>
        ),
      },
      {
        accessorKey: "tourName",
        header: ({ column }) => <SortableHeader label="Product" column={column} />,
        cell: ({ row }) => (
          <div dir="auto" className="max-w-[14rem] truncate" title={row.original.tourName ?? undefined}>
            {row.original.tourName || EMPTY}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader label="Status" column={column} />,
        cell: ({ row }) => (
          <InRow>
            <StatusSelect
              value={row.original.status}
              statuses={statuses}
              disabled={busy === row.original.id}
              onChange={(status) => void save(row.original, { status })}
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
        accessorKey: "followUpDate",
        header: ({ column }) => <SortableHeader label="Follow-up" column={column} />,
        // the Mega Events reservations' look: the day, and under it how it stands (late / today / ahead)
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
        accessorKey: "departureDate",
        header: ({ column }) => <SortableHeader label="Departure" column={column} />,
        cell: ({ row }) =>
          row.original.departureDate ? (
            <div className="whitespace-nowrap tabular">
              {fmtDate(row.original.departureDate)}
              <span className="block text-xs text-muted-foreground">
                {row.original.departureCode}
                {row.original.travelers > 0 && ` · ${row.original.travelers} seats`}
              </span>
            </div>
          ) : (
            EMPTY
          ),
      },
      { accessorKey: "type", header: ({ column }) => <SortableHeader label="Type" column={column} />, cell: ({ row }) => <TypeBadge type={row.original.type} /> },
      {
        id: "task",
        accessorFn: (row) => {
          const task = taskOf(row, statuses, today);
          return task ? CASE_TASK_LABELS[task] : "";
        },
        header: ({ column }) => <SortableHeader label="Task" column={column} />,
        cell: ({ row }) => <TaskBadge task={taskOf(row.original, statuses, today)} overridden={isCaseTask(row.original.taskOverride)} />,
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader label="Created" column={column} />,
        cell: ({ row }) => <div className="whitespace-nowrap tabular text-muted-foreground">{fmtInstant(row.original.createdAt)}</div>,
      },
      {
        // id "actions" = pinned to the table's trailing edge (DataTable), like the Events table
        id: "actions",
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const r = row.original;
          const whatsapp = waLink(r.phone, `היי ${r.firstName ?? ""}`.trim());
          const label = caseName(r) || `#${r.caseNo}`;
          return (
            <InRow className="flex items-center justify-end gap-0.5">
              {whatsapp ? (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-success hover:text-success" asChild>
                  <a href={whatsapp} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${label}`} title="WhatsApp">
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </Button>
              ) : (
                <span className="h-8 w-8" aria-hidden />
              )}
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
      <PageHeader
        title="Reservations"
        description="Every lead and every reservation in one table - one row per customer. Edit a field in place; open a row for the order, the seats and the booking link."
        actions={
          <>
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={runExport} disabled={exporting || shown.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
            <Button variant="outline" onClick={() => setEditingStatuses(true)} disabled={!data}>
              <ListChecks className="h-4 w-4" />
              Statuses
            </Button>
            <Button onClick={() => setAdding(true)} disabled={!data}>
              <PlusCircle className="h-4 w-4" />
              New
            </Button>
          </>
        }
      />

      {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
      {data ? (
        <DataTable
          columns={columns}
          data={shown}
          dense
          defaultPageSize={50}
          pageSizeOptions={[25, 50, 100]}
          getRowId={(row) => row.id}
          defaultSorting={[{ id: "caseNo", desc: true }]}
          enableRowSelection
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          bulkActions={
            <>
              <Select disabled={bulkBusy} onValueChange={(status) => void bulk({ status })}>
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
              <Select disabled={bulkBusy} onValueChange={(id) => void bulk({ assignedTo: id === NOBODY ? null : id })}>
                <SelectTrigger className="h-8 w-40 text-foreground" aria-label="Set rep">
                  <SelectValue placeholder="Set rep…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOBODY}>Unassigned</SelectItem>
                  {reps.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            onCreated={(id) => {
              void reload({ quiet: true });
              router.push(`/tours/reservations/${id}`);
            }}
          />
          <StatusesDialog
            open={editingStatuses}
            onOpenChange={setEditingStatuses}
            statuses={statuses}
            onSaved={(next) => setData((current) => current && { ...current, statuses: next })}
          />
        </>
      )}
    </div>
  );
}
