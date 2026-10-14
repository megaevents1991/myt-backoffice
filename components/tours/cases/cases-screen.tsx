"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ListChecks, Loader2, PlusCircle, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { SearchInput } from "@/components/search-input";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState, useUrlState } from "@/hooks/use-view-state";
import { downloadBase64 } from "@/lib/download";
import { EMPTY, fmtDate, fmtInstant, todayIso } from "@/lib/tours/format";
import { bulkUpdateCases, exportCases, listCases, updateCase } from "@/lib/actions/tours-cases-actions";
import { LoadError } from "@/components/tours/ui";
import {
  CASE_TASK_LABELS,
  caseMatches,
  caseTask,
  followUpDue,
  isCaseTask,
  sourceLabel,
  type CaseChange,
  type CaseRow,
  type CasesPage,
  type CaseStatus,
} from "@/lib/tours/cases";
import { InRow, NOBODY, RepSelect, StatusSelect, TaskBadge, TypeBadge } from "@/components/tours/cases/case-ui";
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

/** A text cell staff type into: saved when it loses focus (Enter too), Esc puts the old value back. */
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
      placeholder={placeholder}
      title={title}
      className={cn("h-8", className)}
      onBlur={(event) => {
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
        cell: ({ row }) => <span className="font-mono text-xs tabular">{row.original.caseNo}</span>,
      },
      { accessorKey: "firstName", header: "First Name", cell: ({ row }) => <div dir="auto" className="whitespace-nowrap">{row.original.firstName || EMPTY}</div> },
      { accessorKey: "lastName", header: "Last Name", cell: ({ row }) => <div dir="auto" className="whitespace-nowrap">{row.original.lastName || EMPTY}</div> },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) =>
          row.original.phone ? (
            <a href={`tel:${row.original.phone}`} className="whitespace-nowrap text-primary tabular hover:underline">
              {row.original.phone}
            </a>
          ) : (
            EMPTY
          ),
      },
      {
        accessorKey: "assignedTo",
        header: "Rep",
        cell: ({ row }) => (
          <InRow>
            <RepSelect
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
            <a href={`mailto:${row.original.email}`} className="text-primary hover:underline">
              {row.original.email}
            </a>
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
        cell: ({ row }) => <div className="whitespace-nowrap">{sourceLabel(row.original.source, row.original.utm)}</div>,
      },
      {
        accessorKey: "followUpDate",
        header: ({ column }) => <SortableHeader label="Follow-up" column={column} />,
        cell: ({ row }) => {
          const due = followUpDue(row.original, statuses, today);
          return (
            <InRow>
              <Input
                type="date"
                dir="ltr"
                aria-label="Follow-up day"
                value={row.original.followUpDate ?? ""}
                disabled={busy === row.original.id}
                className={cn("h-8 w-36", due && "border-destructive font-semibold text-destructive")}
                title={due ? "The follow-up day has come" : undefined}
                onChange={(event) => void save(row.original, { followUpDate: event.target.value || null })}
              />
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
              <span className="block text-xs text-muted-foreground">{row.original.departureCode}</span>
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
    ],
    [busy, currentUserId, reps, save, statuses, today],
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
        description="Every lead and every reservation of the company in one table - one row per customer. A site form opens a lead; a booking on the site (or through a link you sent) turns the same row into a reservation. Edit the notes, ACC NUM, rep, status and follow-up day in the row; open a row for the order, the passengers, the source and the booking link."
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
          getRowClassName={(row) => (followUpDue(row.original, statuses, today) ? "bg-destructive/5" : "")}
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
