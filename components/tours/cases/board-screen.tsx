"use client";

/**
 * /tours/reservations - TODAY | RESERVATIONS | LEADS | ALL (Nir Azulay 19.10; mockup
 * https://claude.ai/artifact/6CXvKBuoCd3np4RiD9GPG1; Alon's TODAY round 21.10 - spec
 * docs/superpowers/specs/2026-10-21-tours-board-round-design.md).
 *
 * - TODAY: every card a rep has to touch, coloured by its reason (todayReason), numbered `#` in the VIEWER'S OWN
 *   order - the default is arrival (the oldest first, the newest lead last), a drag or a typed place keeps it
 *   (lib/tours/board.ts orderBoard / moveInOrder / placeInOrder, saved by saveBoardOrder). Phone, Notes (bold when
 *   written today) and a mail shortcut sit on the row. A manager ticks rows and hands them out in bulk. A "⋯" menu
 *   (card-quick-actions.tsx) works the card from the row - Notes, Booking link, Follow-up - and "Take it" gives an
 *   unassigned card to the viewer (Alon 22.10); the same two sit on a LEADS row.
 * - RESERVATIONS: one row per order (a site booking or one a rep typed, each with its T number); a customer with two
 *   orders shows twice. Live / Past / Cancelled.
 * - LEADS: the cards with no order yet. Open / Closed. Bulk assign for a manager.
 * - ALL: the old table - bulk changes, export.
 * The server already answers only the cards the viewer may see (a manager all, a rep their own + the unassigned).
 * Every row opens its customer, with that card highlighted. TODAY / RESERVATIONS / LEADS share one load (listBoard).
 */
import { useCallback, useMemo, useRef, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { useAuth } from "@/contexts/auth-context";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";
import { EMPTY, fmtDate, fmtInstant, fmtPrice, todayIso } from "@/lib/tours/format";
import { bulkUpdateCases, listBoard, saveBoardOrder, updateCase } from "@/lib/actions/tours-cases-actions";
import type { ActionResult } from "@/lib/tours/action-kit";
import { Chip, LoadError } from "@/components/tours/ui";
import {
  BOOKING_PHASE_LABELS,
  PAYMENT_ANSWER_LABELS,
  caseMatches,
  caseName,
  isClosedStatus,
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
import { afterSave, canSeeCard, moveInOrder, noteLine, orderBoard, placeInOrder, writtenToday, type BoardViewer } from "@/lib/tours/board";
import {
  BulkAssignSelect,
  CardWhat,
  CardWho,
  InRow,
  KnownLine,
  MailButton,
  PhoneCell,
  StageBar,
  StatusTag,
  TODAY_ROW_CLASSES,
  TodayBadge,
  WhatsAppButton,
} from "@/components/tours/cases/case-ui";
import { CasesScreen } from "@/components/tours/cases/cases-screen";
import { NewCaseDialog } from "@/components/tours/cases/new-case-dialog";
import { StatusesDialog } from "@/components/tours/cases/statuses-dialog";
import { CardActionsMenu, TakeCardButton, type CardActionHost } from "@/components/tours/cases/card-quick-actions";

const TABS = ["today", "reservations", "leads", "all"] as const;
const PHASES: BookingPhase[] = ["active", "past", "cancelled"];
const PHASE_TAB_LABELS: Record<BookingPhase, string> = { active: "Live", past: "Past", cancelled: "Cancelled" };
const LEAD_VIEWS = ["open", "closed"] as const;
type LeadView = (typeof LEAD_VIEWS)[number];
/** TODAY is one page: a card is dragged from place 80 to place 3 in one move. */
const TODAY_PAGE = 500;
const NOBODY_VIEWER: BoardViewer = { id: "", manager: false };

/** The day after today (YYYY-MM-DD): "No answer" calls again tomorrow. */
const tomorrowOf = (today: string): string => new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

interface TodayRow {
  card: CaseRow;
  reason: TodayReason;
  known: KnownFrom | null;
  /** The card's place in the viewer's FULL list (1..N) - kept under a search or "Mine". */
  position: number;
}
interface OrderRow {
  order: BoardOrder;
  card: CaseRow;
}

const selectedOf = (selection: Record<string, boolean>): string[] => Object.keys(selection).filter((id) => selection[id]);

export function BoardScreen() {
  const router = useRouter();
  const run = useActionToast();
  const { toast } = useToast();
  const { user } = useAuth();
  // the company's status list is staff's - a sales agent (tours_agent) works the cards, not the list
  const canEditStatuses = user?.role !== TOURS_AGENT_ROLE;
  const { data, error, loading, reload, setData } = useActionData<BoardPage>(() => listBoard(), []);
  const [q, setQ] = useSessionState<string>("board-q", "");
  const [mine, setMine] = useSessionState<boolean>("board-mine", false);
  const [phase, setPhase] = useSessionState<BookingPhase>("board-phase", "active");
  const [leadView, setLeadView] = useSessionState<LeadView>("board-leads", "open");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingStatuses, setEditingStatuses] = useState(false);
  const [todaySelection, setTodaySelection] = useState<Record<string, boolean>>({});
  const [leadSelection, setLeadSelection] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const today = todayIso();

  const statuses = useMemo(() => data?.statuses ?? [], [data]);
  const reps = useMemo(() => data?.reps ?? [], [data]);
  const repName = useCallback((id: string | null) => (id ? (reps.find((p) => p.id === id)?.name ?? "Another teammate") : ""), [reps]);
  const currentUserId = data?.currentUserId ?? "";
  const viewer = data?.viewer ?? NOBODY_VIEWER;
  // the order as this screen last set it wins over whatever a later quiet reload answers (a save may still be in flight)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const orderIds = useMemo(() => localOrder ?? data?.order ?? [], [localOrder, data]);
  const saveQueue = useRef<{ running: boolean; pending: string[] | null }>({ running: false, pending: null });

  // the search and "Mine" narrow every tab alike
  const cards = useMemo(
    () => (data?.cards ?? []).filter((c) => (!mine || c.assignedTo === currentUserId) && (!q || caseMatches(c, q))),
    [data, mine, currentUserId, q],
  );
  const cardById = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const ordersByCard = useMemo(() => {
    const map = new Map<string, BoardOrder[]>();
    for (const o of data?.orders ?? []) map.set(o.cardId, [...(map.get(o.cardId) ?? []), o]);
    return map;
  }, [data]);

  // TODAY, numbered over the viewer's WHOLE list first (the saved order, then arrival) - the search / "Mine" is applied
  // after, so a card keeps its place while the list is narrowed
  const todayAll = useMemo<TodayRow[]>(() => {
    const waiting = (data?.cards ?? [])
      .map((card) => ({ id: card.id, arrivedAt: card.arrivedAt, card, reason: todayReason(card, statuses, today) }))
      .filter((r): r is typeof r & { reason: TodayReason } => !!r.reason);
    return orderBoard(waiting, orderIds).map(({ row, position }) => ({ card: row.card, reason: row.reason, known: data?.known[row.card.id] ?? null, position }));
  }, [data, statuses, today, orderIds]);
  const fullIds = useMemo(() => todayAll.map((r) => r.card.id), [todayAll]);
  const shownIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const todayRows = useMemo(() => todayAll.filter((r) => shownIds.has(r.card.id)), [todayAll, shownIds]);

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

  // one door for every row action that answers the fresh row (updateCase, markOfferSent, withdrawOffer): the row is
  // patched in place; a card handed to another rep leaves a rep's list - the next click on it would be refused (review 21.10)
  const apply = useCallback(
    async (card: CaseRow, action: () => Promise<ActionResult<CaseRow>>, done: string): Promise<boolean> => {
      setBusy(card.id);
      const result = await run(action, done);
      setBusy(null);
      if (!result.success) return false;
      // over the list as it stands NOW - two rows' actions may overlap, and a memoized list would drop the first one's row
      setData((current) => current && { ...current, cards: afterSave(current.cards, result.data, viewer).cards });
      if (!canSeeCard(result.data, viewer)) toast({ title: `Card handed to ${repName(result.data.assignedTo)}` });
      return true;
    },
    [repName, run, setData, toast, viewer],
  );
  const save = useCallback((card: CaseRow, change: CaseChange, done: string) => apply(card, () => updateCase(card.id, change), done), [apply]);
  // the quick actions' host (22.10): the same patch, and "open the card" = its customer page at that section
  const hostFor = useCallback(
    (card: CaseRow): CardActionHost => ({
      apply: (action, done) => apply(card, action, done),
      openCard: (section) => router.push(`/tours/reservations/${card.id}?focus=${section}`),
    }),
    [apply, router],
  );

  // the viewer's own order: shown at once, saved behind it - ONE save in flight, the newest order replaces anything still
  // waiting (two quick drags never race; an older save can never land after a newer one). A failed save toasts; the screen
  // keeps the order.
  const commitOrder = useCallback(
    (ids: string[]) => {
      setLocalOrder(ids);
      const queue = saveQueue.current;
      queue.pending = ids;
      if (queue.running) return;
      queue.running = true;
      void (async () => {
        while (queue.pending) {
          const next = queue.pending;
          queue.pending = null;
          const result = await saveBoardOrder(next);
          if (!result.success) toast({ variant: "destructive", title: "The order was not saved", description: result.error });
        }
        queue.running = false;
      })();
    },
    [toast],
  );
  const onMove = useCallback((activeId: string, overId: string) => commitOrder(moveInOrder(fullIds, activeId, overId)), [commitOrder, fullIds]);
  const onPlace = useCallback((id: string, place: number) => commitOrder(placeInOrder(fullIds, id, place)), [commitOrder, fullIds]);

  // a manager hands out cards in bulk (Dor 21.10); the server refuses anyone else
  const bulkAssign = useCallback(
    async (selection: Record<string, boolean>, clear: () => void, assignedTo: string | null) => {
      const ids = selectedOf(selection);
      if (ids.length === 0) return;
      setBulkBusy(true);
      const result = await run(
        () => bulkUpdateCases(ids, { assignedTo }),
        (answer) => `${answer.data.updated} ${answer.data.updated === 1 ? "card" : "cards"} handed to ${assignedTo ? repName(assignedTo) : "nobody"}`,
      );
      setBulkBusy(false);
      if (result.success) {
        clear();
        void reload({ quiet: true });
      }
    },
    [reload, repName, run],
  );

  const todayColumns = useMemo<ColumnDef<TodayRow>[]>(
    () => [
      {
        id: "place",
        accessorFn: (r) => r.position,
        header: ({ column }) => <SortableHeader label="#" column={column} />,
        cell: ({ row }) => <PlaceNumber value={row.original.position} onPlace={(place) => onPlace(row.original.card.id, place)} />,
      },
      {
        id: "why",
        accessorFn: (r) => todayRank(r.reason),
        header: ({ column }) => <SortableHeader label="Why" column={column} />,
        cell: ({ row }) => (
          <div className="max-w-[9rem] space-y-1">
            <TodayBadge reason={row.original.reason} followUpDate={row.original.card.followUpDate} today={today} />
            {row.original.reason === "payment" && row.original.card.paymentAnswer && (
              <div className="text-xs text-muted-foreground">{PAYMENT_ANSWER_LABELS[row.original.card.paymentAnswer]}</div>
            )}
          </div>
        ),
      },
      { id: "who", accessorFn: (r) => caseName(r.card), header: "Customer", cell: ({ row }) => <CardWho card={row.original.card} /> },
      { id: "phone", accessorFn: (r) => r.card.phone ?? "", header: "Phone", cell: ({ row }) => <PhoneCell phone={row.original.card.phone} /> },
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
            <CardWhat card={row.original.card}>{row.original.known && <KnownLine known={row.original.known} statuses={statuses} />}</CardWhat>
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
        id: "notes",
        accessorFn: (r) => noteLine(r.card.notes),
        header: "Notes",
        cell: ({ row }) => {
          const line = noteLine(row.original.card.notes);
          if (!line) return <span className="text-muted-foreground">{EMPTY}</span>;
          // a note written today stands out: the rep wrote it this morning and the customer is still on the list
          const fresh = writtenToday(row.original.card.notesAt, today);
          return (
            <div
              dir="auto"
              title={row.original.card.notes ?? undefined}
              className={cn("max-w-[16rem] truncate text-sm", fresh ? "font-semibold text-foreground" : "text-muted-foreground")}
            >
              {fresh && <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-label="Written today" />}
              {line}
            </div>
          );
        },
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
              <TakeCardButton card={card} host={hostFor(card)} currentUserId={currentUserId} busy={working} />
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
                  <MailButton iconOnly email={card.email} />
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
              <CardActionsMenu card={card} host={hostFor(card)} today={today} currentUserId={currentUserId} busy={working} />
            </InRow>
          );
        },
      },
    ],
    [busy, currentUserId, hostFor, onPlace, open, ordersByCard, repName, save, statuses, today],
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
      { id: "phone", accessorFn: (r) => r.card.phone ?? "", header: "Phone", cell: ({ row }) => <PhoneCell phone={row.original.card.phone} /> },
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
      // the card's ACC NUM (the deal's, Alon 22.10) - edited on the folded card, read here
      {
        id: "acc",
        accessorFn: (r) => r.card.accNum ?? "",
        header: "ACC",
        cell: ({ row }) => (
          <span dir="ltr" className="tabular text-sm">
            {row.original.card.accNum ?? EMPTY}
          </span>
        ),
      },
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
      { id: "phone", accessorFn: (c) => c.phone ?? "", header: "Phone", cell: ({ row }) => <PhoneCell phone={row.original.phone} /> },
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
      {
        id: "actions",
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const card = row.original;
          const working = busy === card.id;
          return (
            <InRow className="flex items-center justify-end gap-1">
              {working && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <TakeCardButton card={card} host={hostFor(card)} currentUserId={currentUserId} busy={working} />
              <CardActionsMenu card={card} host={hostFor(card)} today={today} currentUserId={currentUserId} busy={working} />
            </InRow>
          );
        },
      },
    ],
    [busy, currentUserId, hostFor, repName, statuses, today],
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
      <SearchInput value={q} onValueChange={setQ} placeholder="Name, phone, customer number, T-number, tour..." />
      <Button variant={mine ? "default" : "outline"} size="sm" onClick={() => setMine(!mine)} aria-pressed={mine}>
        Mine
      </Button>
    </div>
  );
  const bulkBar = (selection: Record<string, boolean>, clear: () => void) =>
    viewer.manager ? (
      <>
        <BulkAssignSelect reps={reps} disabled={bulkBusy} onAssign={(id) => void bulkAssign(selection, clear, id)} />
        {bulkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
      </>
    ) : undefined;

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
            {canEditStatuses && (
              <Button variant="outline" onClick={() => setEditingStatuses(true)} disabled={!data}>
                <ListChecks className="h-4 w-4" />
                Statuses
              </Button>
            )}
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
              // one page, the viewer's own order first; the key changed with the round so a remembered page size of 50 is forgotten
              defaultPageSize={TODAY_PAGE}
              pageSizeOptions={[TODAY_PAGE]}
              defaultSorting={[{ id: "place", desc: false }]}
              stateKey="tours-board-today-v2"
              rowReorder={{ enabled: !q.trim() && !mine, orderColumnId: "place", onMove }}
              enableRowSelection={viewer.manager}
              rowSelection={todaySelection}
              onRowSelectionChange={setTodaySelection}
              bulkActions={bulkBar(todaySelection, () => setTodaySelection({}))}
              filters={toolbar}
              onRowClick={(r) => open(r.card.id)}
              getRowClassName={(row) => TODAY_ROW_CLASSES[row.original.reason]}
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
              enableRowSelection={viewer.manager}
              rowSelection={leadSelection}
              onRowSelectionChange={setLeadSelection}
              bulkActions={bulkBar(leadSelection, () => setLeadSelection({}))}
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
            onCreated={(id, handedTo) => {
              void reload({ quiet: true });
              // a rep who opened a card for someone else does not see it: say so instead of landing on a refusal
              if (handedTo && !viewer.manager) toast({ title: `Card opened and handed to ${repName(handedTo)}` });
              else router.push(`/tours/reservations/${id}`);
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

/** The card's place in the list: a number that is also a control - click it, type a place, Enter (the homepage board's way). */
function PlaceNumber({ value, onPlace }: { value: number; onPlace: (place: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        className="tabular min-w-[2rem] rounded px-1.5 py-0.5 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Click to type a place"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }
  return (
    <input
      autoFocus
      inputMode="numeric"
      aria-label="Place in the list"
      className="tabular h-7 w-12 rounded border bg-background px-1 text-center text-sm"
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
      onFocus={(event) => event.target.select()}
      onBlur={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          const place = Number(draft);
          if (Number.isInteger(place) && place >= 1 && place !== value) onPlace(place);
          setEditing(false);
        }
        if (event.key === "Escape") setEditing(false);
      }}
    />
  );
}
