"use client";

/**
 * /tours/reservations - TODAY | RESERVATIONS | LEADS | ALL (Nir Azulay 19.10; mockup
 * https://claude.ai/artifact/6CXvKBuoCd3np4RiD9GPG1).
 *
 * - TODAY: every card a rep has to touch, with the reason (todayReason), in Nir's order - it replaces the TASK column.
 * - RESERVATIONS: one row per order (a site booking or one a rep typed, each with its T number); a customer with two
 *   orders shows twice. Live / Past / Cancelled.
 * - LEADS: the cards with no order yet. Open / Closed.
 * - ALL: the old table - bulk changes, export.
 * Every row opens its customer, with that card open. TODAY / RESERVATIONS / LEADS share one load (listBoard).
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, ListChecks, Loader2, PlusCircle, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { UrlTabs } from "@/components/url-tabs";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { SearchInput } from "@/components/search-input";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { EMPTY, fmtDate, fmtInstant, fmtPrice, todayIso } from "@/lib/tours/format";
import { listBoard, updateCase } from "@/lib/actions/tours-cases-actions";
import { Chip, LoadError } from "@/components/tours/ui";
import {
  BOOKING_PHASE_LABELS,
  PAYMENT_ANSWER_LABELS,
  caseMatches,
  caseName,
  isClosedStatus,
  knownFrom,
  sourceLabel,
  statusOf,
  todayRank,
  todayReason,
  type BoardOrder,
  type BoardPage,
  type BookingPhase,
  type CaseChange,
  type CaseRow,
  type KnownFrom,
  type TodayReason,
} from "@/lib/tours/cases";
import { CardWhat, CardWho, InRow, StageBar, StatusTag, TodayBadge, WhatsAppButton } from "@/components/tours/cases/case-ui";
import { CasesScreen } from "@/components/tours/cases/cases-screen";
import { NewCaseDialog } from "@/components/tours/cases/new-case-dialog";
import { StatusesDialog } from "@/components/tours/cases/statuses-dialog";

const TABS = ["today", "reservations", "leads", "all"] as const;
const PHASES: BookingPhase[] = ["active", "past", "cancelled"];
const PHASE_TAB_LABELS: Record<BookingPhase, string> = { active: "Live", past: "Past", cancelled: "Cancelled" };
const LEAD_VIEWS = ["open", "closed"] as const;
type LeadView = (typeof LEAD_VIEWS)[number];

/** The day after today (YYYY-MM-DD): "No answer" calls again tomorrow. */
const tomorrowOf = (today: string): string => new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

interface TodayRow {
  card: CaseRow;
  reason: TodayReason;
  known: KnownFrom | null;
}
interface OrderRow {
  order: BoardOrder;
  card: CaseRow;
}

export function BoardScreen() {
  const router = useRouter();
  const run = useActionToast();
  const { data, error, loading, reload, setData } = useActionData<BoardPage>(() => listBoard(), []);
  const [q, setQ] = useSessionState<string>("board-q", "");
  const [mine, setMine] = useSessionState<boolean>("board-mine", false);
  const [phase, setPhase] = useSessionState<BookingPhase>("board-phase", "active");
  const [leadView, setLeadView] = useSessionState<LeadView>("board-leads", "open");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingStatuses, setEditingStatuses] = useState(false);
  const today = todayIso();

  const statuses = useMemo(() => data?.statuses ?? [], [data]);
  const reps = useMemo(() => data?.reps ?? [], [data]);
  const repName = useCallback((id: string | null) => (id ? (reps.find((p) => p.id === id)?.name ?? "Another teammate") : ""), [reps]);
  const currentUserId = data?.currentUserId ?? "";

  // the search and "Mine" narrow every tab alike
  const cards = useMemo(
    () => (data?.cards ?? []).filter((c) => (!mine || c.assignedTo === currentUserId) && (!q || caseMatches(c, q))),
    [data, mine, currentUserId, q],
  );
  const cardById = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const byCustomer = useMemo(() => {
    const map = new Map<string, CaseRow[]>();
    for (const c of data?.cards ?? []) if (c.customerId) map.set(c.customerId, [...(map.get(c.customerId) ?? []), c]);
    return map;
  }, [data]);
  const ordersByCard = useMemo(() => {
    const map = new Map<string, BoardOrder[]>();
    for (const o of data?.orders ?? []) map.set(o.cardId, [...(map.get(o.cardId) ?? []), o]);
    return map;
  }, [data]);

  const todayRows = useMemo<TodayRow[]>(
    () =>
      cards
        .map((card) => {
          const reason = todayReason(card, statuses, today);
          if (!reason) return null;
          const history = (card.customerId ? byCustomer.get(card.customerId) : null) ?? [];
          return { card, reason, known: knownFrom(card, history, statuses) };
        })
        .filter((r): r is TodayRow => !!r)
        .sort(
          (a, b) =>
            todayRank(a.reason) - todayRank(b.reason) ||
            (a.card.followUpDate ?? "").localeCompare(b.card.followUpDate ?? "") ||
            a.card.createdAt.localeCompare(b.card.createdAt),
        ),
    [cards, statuses, today, byCustomer],
  );
  const shownIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const orderRows = useMemo<OrderRow[]>(() => {
    const ref = q.trim().toUpperCase();
    return (data?.orders ?? [])
      .map((order) => ({ order, card: cardById.get(order.cardId) }))
      .filter((r): r is OrderRow => !!r.card && !r.card.toFile && (shownIds.has(r.card.id) || (!!ref && r.order.ref === ref)));
  }, [data, cardById, shownIds, q]);
  const phaseCount = (p: BookingPhase) => orderRows.filter((r) => r.order.phase === p).length;
  const isLead = useCallback((c: CaseRow) => !c.toFile && !ordersByCard.get(c.id)?.length, [ordersByCard]);
  const leadRows = useMemo(
    () => cards.filter((c) => isLead(c) && (leadView === "closed") === isClosedStatus(c.status, statuses)),
    [cards, isLead, leadView, statuses],
  );
  const leadCount = (v: LeadView) => cards.filter((c) => isLead(c) && (v === "closed") === isClosedStatus(c.status, statuses)).length;

  const open = useCallback((cardId: string) => router.push(`/tours/reservations/${cardId}`), [router]);

  const save = useCallback(
    async (card: CaseRow, change: CaseChange, done: string) => {
      setBusy(card.id);
      const result = await run(() => updateCase(card.id, change), done);
      setBusy(null);
      if (result.success) setData((current) => current && { ...current, cards: current.cards.map((c) => (c.id === card.id ? result.data : c)) });
    },
    [run, setData],
  );

  const todayColumns = useMemo<ColumnDef<TodayRow>[]>(
    () => [
      {
        id: "why",
        accessorFn: (r) => todayRank(r.reason),
        header: ({ column }) => <SortableHeader label="Why" column={column} />,
        cell: ({ row }) => (
          <div className="space-y-1">
            <TodayBadge reason={row.original.reason} followUpDate={row.original.card.followUpDate} today={today} />
            {row.original.reason === "payment" && row.original.card.paymentAnswer && (
              <div className="text-xs text-muted-foreground">{PAYMENT_ANSWER_LABELS[row.original.card.paymentAnswer]}</div>
            )}
            {row.original.known && (
              <div className="max-w-[16rem] text-xs font-medium text-violet-700 dark:text-violet-300">
                Known customer · was <span dir="rtl">{statusOf(row.original.known.status, statuses)?.label ?? row.original.known.status}</span>
                {row.original.known.closeReason && (
                  <>
                    {" "}
                    · <span dir="auto">{row.original.known.closeReason}</span>
                  </>
                )}
              </div>
            )}
          </div>
        ),
      },
      { id: "who", accessorFn: (r) => caseName(r.card), header: "Customer", cell: ({ row }) => <CardWho card={row.original.card} /> },
      {
        id: "what",
        accessorFn: (r) => r.card.tourName ?? "",
        header: "Card",
        cell: ({ row }) =>
          row.original.reason === "file" ? (
            <div className="text-sm">
              <div className="font-medium">An inquiry with no tour</div>
              <div dir="auto" className="max-w-[18rem] truncate text-xs text-muted-foreground">
                {row.original.card.message ?? "No message"}
              </div>
            </div>
          ) : (
            <CardWhat card={row.original.card} />
          ),
      },
      {
        id: "status",
        accessorFn: (r) => r.card.status,
        header: "Status",
        cell: ({ row }) => (
          <div className="space-y-1">
            <StatusTag status={row.original.card.status} statuses={statuses} />
            <StageBar status={row.original.card.status} hasOrder={!!ordersByCard.get(row.original.card.id)?.length} statuses={statuses} className="flex" />
          </div>
        ),
      },
      {
        id: "followUp",
        accessorFn: (r) => r.card.followUpDate ?? "",
        header: ({ column }) => <SortableHeader label="Follow-up" column={column} />,
        cell: ({ row }) => <span className="tabular text-sm">{row.original.card.followUpDate ? fmtDate(row.original.card.followUpDate) : EMPTY}</span>,
      },
      {
        id: "rep",
        accessorFn: (r) => repName(r.card.assignedTo),
        header: "Rep",
        cell: ({ row }) => <span className="text-sm">{repName(row.original.card.assignedTo) || <span className="text-muted-foreground">Unassigned</span>}</span>,
      },
      {
        id: "actions",
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const { card, reason } = row.original;
          const working = busy === card.id;
          return (
            <InRow className="flex items-center justify-end gap-1">
              {working && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {reason === "file" ? (
                <Button size="sm" onClick={() => open(card.id)}>
                  File it
                </Button>
              ) : reason === "payment" && card.paymentAnswer === "paid" ? (
                <Button size="sm" disabled={working} onClick={() => void save(card, { status: "paid" }, "Confirmed as paid")}>
                  Confirm → <span dir="rtl">{statusOf("paid", statuses)?.label ?? "Paid"}</span>
                </Button>
              ) : reason === "payment" ? (
                // a failed charge or one to check is not confirmed from the list: the booking says what happened
                <Button size="sm" variant="outline" onClick={() => open(card.id)}>
                  Check the booking
                </Button>
              ) : (
                <>
                  <WhatsAppButton iconOnly phone={card.phone} message={`היי ${card.firstName ?? ""}`.trim()} />
                  {["new", "no_answer", "returned", "offer_sent", "future"].includes(card.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={working}
                      onClick={() => void save(card, { status: "no_answer", followUpDate: tomorrowOf(today) }, "No answer - back on TODAY tomorrow")}
                    >
                      No answer
                    </Button>
                  )}
                </>
              )}
            </InRow>
          );
        },
      },
    ],
    [busy, open, ordersByCard, repName, save, statuses, today],
  );

  const orderColumns = useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        id: "ref",
        accessorFn: (r) => r.order.ref,
        header: ({ column }) => <SortableHeader label="Order" column={column} />,
        cell: ({ row }) => (
          <div>
            <span className="font-mono text-sm font-semibold">{row.original.order.ref}</span>
            <div className="text-[11px] text-muted-foreground">{row.original.order.source === "staff" ? "Typed by a rep" : "From the site"}</div>
          </div>
        ),
      },
      { id: "who", accessorFn: (r) => caseName(r.card), header: "Customer", cell: ({ row }) => <CardWho card={row.original.card} /> },
      { id: "tour", accessorFn: (r) => r.card.tourName ?? "", header: "Tour", cell: ({ row }) => <span dir="auto">{row.original.card.tourName ?? EMPTY}</span> },
      {
        id: "departure",
        accessorFn: (r) => r.order.departureDate ?? "",
        header: ({ column }) => <SortableHeader label="Departure" column={column} />,
        cell: ({ row }) => (
          <div className="tabular whitespace-nowrap">
            {row.original.order.departureDate ? fmtDate(row.original.order.departureDate) : EMPTY}
            <div className="text-xs text-muted-foreground">{row.original.order.departureCode ?? ""}</div>
          </div>
        ),
      },
      { id: "travelers", accessorFn: (r) => r.order.travelers, header: "Travelers", cell: ({ row }) => <span className="tabular">{row.original.order.travelers}</span> },
      {
        id: "status",
        accessorFn: (r) => r.card.status,
        header: "Status",
        cell: ({ row }) =>
          row.original.order.phase === "cancelled" ? (
            <Chip tone="error">{row.original.order.status === "failed" ? "Payment failed" : "Cancelled"}</Chip>
          ) : (
            <div className="space-y-1">
              <StatusTag status={row.original.card.status} statuses={statuses} />
              {row.original.card.paymentAnswer && <div className="text-xs text-muted-foreground">{PAYMENT_ANSWER_LABELS[row.original.card.paymentAnswer]}</div>}
            </div>
          ),
      },
      {
        id: "seats",
        accessorFn: (r) => r.order.seats ?? "",
        header: "Seats",
        cell: ({ row }) =>
          row.original.order.seats === "held" ? (
            <Chip tone="success">Seats held</Chip>
          ) : row.original.order.seats === "missing" ? (
            <Chip tone="warning">No seats</Chip>
          ) : (
            <span className="text-muted-foreground">{EMPTY}</span>
          ),
      },
      {
        id: "amount",
        accessorFn: (r) => r.order.total ?? 0,
        header: ({ column }) => <SortableHeader label="Amount" column={column} />,
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap">
            {row.original.order.total !== null && row.original.order.currency ? fmtPrice(row.original.order.total, row.original.order.currency) : EMPTY}
          </span>
        ),
      },
      { id: "rep", accessorFn: (r) => repName(r.card.assignedTo), header: "Rep", cell: ({ row }) => <span className="text-sm">{repName(row.original.card.assignedTo) || EMPTY}</span> },
    ],
    [repName, statuses],
  );

  const leadColumns = useMemo<ColumnDef<CaseRow>[]>(
    () => [
      { id: "who", accessorFn: (c) => caseName(c), header: "Customer", cell: ({ row }) => <CardWho card={row.original} /> },
      { id: "what", accessorFn: (c) => c.tourName ?? "", header: "Tour", cell: ({ row }) => <CardWhat card={row.original} /> },
      {
        id: "status",
        accessorFn: (c) => c.status,
        header: ({ column }) => <SortableHeader label="Status" column={column} />,
        cell: ({ row }) => (
          <div className="space-y-1">
            <StatusTag status={row.original.status} statuses={statuses} />
            {row.original.closeReason && (
              <div dir="auto" className="max-w-[14rem] truncate text-xs text-muted-foreground" title={row.original.closeReason}>
                {row.original.closeReason}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "today",
        accessorFn: (c) => {
          const reason = todayReason(c, statuses, today);
          return reason ? todayRank(reason) : 99;
        },
        header: ({ column }) => <SortableHeader label="Today" column={column} />,
        cell: ({ row }) => <TodayBadge reason={todayReason(row.original, statuses, today)} followUpDate={row.original.followUpDate} today={today} />,
      },
      {
        id: "followUp",
        accessorFn: (c) => c.followUpDate ?? "",
        header: ({ column }) => <SortableHeader label="Follow-up" column={column} />,
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular text-sm",
              row.original.followUpDate && row.original.followUpDate < today && !isClosedStatus(row.original.status, statuses) && "font-semibold text-destructive",
            )}
          >
            {row.original.followUpDate ? fmtDate(row.original.followUpDate) : EMPTY}
          </span>
        ),
      },
      {
        id: "source",
        accessorFn: (c) => sourceLabel(c.source, c.utm),
        header: "Source",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{sourceLabel(row.original.source, row.original.utm)}</span>,
      },
      { id: "rep", accessorFn: (c) => repName(c.assignedTo), header: "Rep", cell: ({ row }) => <span className="text-sm">{repName(row.original.assignedTo) || EMPTY}</span> },
      {
        id: "created",
        accessorFn: (c) => c.createdAt,
        header: ({ column }) => <SortableHeader label="Since" column={column} />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap text-sm text-muted-foreground">{fmtInstant(row.original.createdAt)}</span>,
      },
    ],
    [repName, statuses, today],
  );

  const segment = <T extends string>(value: T, onChange: (next: T) => void, options: { id: T; label: string; count: number }[]) => (
    <div className="inline-flex overflow-hidden rounded-md border" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "border-s px-3 py-1.5 text-sm first:border-s-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            value === o.id ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label} <span className="tabular text-xs">({o.count})</span>
        </button>
      ))}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={q} onValueChange={setQ} placeholder="Name, phone, C-number, T-number, tour..." />
      <Button variant={mine ? "default" : "outline"} size="sm" onClick={() => setMine(!mine)} aria-pressed={mine}>
        Mine
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservations"
        description="Customers and their deals: what waits today, every order, every lead. A row opens its customer."
        actions={
          <>
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
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

      <UrlTabs defaultValue="today" values={TABS} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="today" className="gap-2 font-semibold tracking-wide">
            <CalendarClock className="h-4 w-4" />
            TODAY {data && <CountPill count={todayRows.length} urgent />}
          </TabsTrigger>
          <TabsTrigger value="reservations" className="gap-2 font-semibold tracking-wide">
            RESERVATIONS {data && <CountPill count={phaseCount("active")} />}
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-2 font-semibold tracking-wide">
            LEADS {data && <CountPill count={leadCount("open")} />}
          </TabsTrigger>
          <TabsTrigger value="all" className="font-semibold tracking-wide">
            ALL
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-3">
          {data ? (
            <DataTable
              columns={todayColumns}
              data={todayRows}
              dense
              grid
              getRowId={(r) => r.card.id}
              defaultPageSize={50}
              pageSizeOptions={[25, 50, 100]}
              filters={toolbar}
              onRowClick={(r) => open(r.card.id)}
              getRowClassName={(row) => (row.original.reason === "late" ? "bg-destructive/5" : row.original.reason === "returned" ? "bg-violet-500/5" : "")}
              stateKey="tours-board-today"
              emptyState={{ title: "Nothing waits for you today", description: "New cards, customers who came back and calls due show up here by themselves." }}
            />
          ) : (
            loading && <DataTableSkeleton rows={10} label="Loading today" />
          )}
        </TabsContent>

        <TabsContent value="reservations" className="space-y-3">
          {data ? (
            <DataTable
              columns={orderColumns}
              data={orderRows.filter((r) => r.order.phase === phase)}
              dense
              grid
              getRowId={(r) => `${r.order.cardId}:${r.order.ref}`}
              defaultPageSize={50}
              pageSizeOptions={[25, 50, 100]}
              defaultSorting={[{ id: "departure", desc: phase !== "active" }]}
              filters={
                <>
                  {segment(
                    phase,
                    setPhase,
                    PHASES.map((p) => ({ id: p, label: PHASE_TAB_LABELS[p], count: phaseCount(p) })),
                  )}
                  {toolbar}
                </>
              }
              onRowClick={(r) => open(r.card.id)}
              stateKey="tours-board-orders"
              emptyState={{
                title: `No ${BOOKING_PHASE_LABELS[phase].toLowerCase()} orders`,
                description: "Every order - a booking from the site or one a rep typed - is a row here, with its T number.",
              }}
            />
          ) : (
            loading && <DataTableSkeleton rows={10} label="Loading the orders" />
          )}
        </TabsContent>

        <TabsContent value="leads" className="space-y-3">
          {data ? (
            <DataTable
              columns={leadColumns}
              data={leadRows}
              dense
              grid
              getRowId={(c) => c.id}
              defaultPageSize={50}
              pageSizeOptions={[25, 50, 100]}
              defaultSorting={[{ id: "created", desc: true }]}
              filters={
                <>
                  {segment(leadView, setLeadView, [
                    { id: "open", label: "Open", count: leadCount("open") },
                    { id: "closed", label: "Closed", count: leadCount("closed") },
                  ])}
                  {toolbar}
                </>
              }
              onRowClick={(c) => open(c.id)}
              stateKey="tours-board-leads"
              emptyState={{ title: "No leads here", description: "A card with no order is a lead. When an order comes in, the same card moves to RESERVATIONS." }}
            />
          ) : (
            loading && <DataTableSkeleton rows={10} label="Loading the leads" />
          )}
        </TabsContent>

        <TabsContent value="all">
          <CasesScreen embedded />
        </TabsContent>
      </UrlTabs>

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

/** A tab's count: TODAY's is red while anything waits. */
function CountPill({ count, urgent }: { count: number; urgent?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
        urgent && count > 0 ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {count}
    </span>
  );
}
