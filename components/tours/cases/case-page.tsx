"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Armchair,
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Gift,
  GitMerge,
  History as HistoryIcon,
  Loader2,
  MapPinned,
  Megaphone,
  PlusCircle,
  ReceiptText,
  StickyNote,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-provider";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { EMPTY, fmtDate, fmtDateRange, fmtInstant, fmtPrice, todayIso } from "@/lib/tours/format";
import { deleteCase, getCase, holdCaseSeats, updateCase } from "@/lib/actions/tours-cases-actions";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import { Fact, FactList, LoadError, Notice, Section, SectionBand, type SectionTone } from "@/components/tours/ui";
import { readablePath } from "@/components/tours/content/shared";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import { ToursReservationsTable } from "@/components/tours/reservations/reservations-table";
import type { ReservationPrefill } from "@/components/tours/reservations/types";
import type { BookingRow } from "@/components/tours/bookings/shared";
import {
  CASE_SOURCES,
  CASE_SOURCE_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  PAYMENT_ANSWER_LABELS,
  bookingPhase,
  caseName,
  followUpDue,
  htmlToText,
  isClosedStatus,
  payloadText,
  siteHref,
  owedSeatRefs,
  seatBookingOf,
  seatGap,
  sourceLabel,
  statusOf,
  todayReason,
  travelerGroups,
  type CaseChange,
  type CaseDetail,
  type CaseHistoryItem,
  type CaseSource,
  type CaseType,
} from "@/lib/tours/cases";
import { FollowUpInput, PhaseTag, RepSelect, StatusSelect, TodayBadge, TYPE_WASH, TypeBadge, WhatsAppButton, type FuturePick } from "@/components/tours/cases/case-ui";
import { BookingCard, SeatsChip } from "@/components/tours/cases/booking-card";
import { BalanceChip } from "@/components/tours/cases/order-money";
import { BookingLinkCard } from "@/components/tours/cases/booking-link-card";
import { MergeDialog } from "@/components/tours/cases/merge-dialog";
import { MoveCardDialog } from "@/components/tours/cases/customer-dialogs";

/** Fields of a form that the page already shows in its own place. */
const SHOWN_PAYLOAD_KEYS = new Set(["name", "phone", "email", "message", "matched_by", "acceptance", "website", "related_case", "merged", "inquiries", "joined_into"]);
/** The day after today (YYYY-MM-DD): "No answer" calls again tomorrow. */
const tomorrowOf = (today: string): string => new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const UTM_LABELS: Record<string, string> = {
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
  term: "Term",
  content: "Content",
  gclid: "Google click id",
  fbclid: "Facebook click id",
  landing: "Landing page",
  referrer: "Came from",
  at: "Visit",
};
/** The keys that say a campaign brought the visit (the rest - landing, referrer, time - come with any visit). */
const CAMPAIGN_KEYS = ["source", "medium", "campaign", "term", "content", "gclid", "fbclid"];

const show = (value: unknown): string => payloadText(value) || EMPTY;

/** One history line: "status: new → in_progress", "travelers: 3". */
function changeLines(item: CaseHistoryItem): string[] {
  return Object.entries(item.changes)
    .slice(0, 8)
    .map(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value) && ("from" in value || "to" in value)) {
        const v = value as { from?: unknown; to?: unknown };
        return "from" in v ? `${key}: ${show(v.from)} → ${show(v.to)}` : `${key}: ${show(v.to)}`;
      }
      return `${key}: ${show(value)}`;
    });
}

/** A field of the Customer card: saved when it loses focus. */
function CustomerField({
  label,
  value,
  dir = "auto",
  onSave,
}: {
  label: string;
  value: string | null;
  dir?: "auto" | "ltr";
  onSave: (next: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        key={value ?? ""}
        dir={dir}
        defaultValue={value ?? ""}
        className="h-9"
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next !== (value ?? "")) onSave(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

/**
 * The customer's orders (Alon 15.10): one booking is shown whole; two or more fold into rows that
 * say where each stands - Active, Past, Cancelled - with the first active one open.
 */
function Orders({
  bookings,
  caseName: name,
  casePhone,
  owedRefs,
  rows,
  gifts,
  cancellationText,
  cancellationRules,
  withMoney,
  onChanged,
}: {
  bookings: BookingRow[];
  caseName: string;
  casePhone: string | null;
  /** Closed bookings whose travelers are not on the departure (seatGap). */
  owedRefs: ReadonlySet<string>;
  /** One row per order even when there is one (the customer page, Alon 20.10). */
  rows?: boolean;
  /** The departure's gift and the tour's cancellation terms, shown inside each order (Alon 20.10). */
  gifts?: CaseDetail["gifts"];
  cancellationText?: string | null;
  /** The tour's fee rules and the payments log - the customer page (Alon 20.10). */
  cancellationRules?: CaseDetail["cancellationRules"];
  withMoney?: boolean;
  onChanged: () => void;
}) {
  const today = todayIso();
  // a closed booking says whether its travelers hold seats (Alon 18.10: "I do not know if it takes them off")
  const seatsOf = (b: BookingRow) => (b.status === "done" || b.status === "paid" ? (owedRefs.has(b.ref) ? "missing" : "held") : null);
  const card = (b: BookingRow) => (
    <BookingCard
      booking={b}
      caseName={name}
      casePhone={casePhone}
      seats={seatsOf(b)}
      gifts={gifts}
      cancellationText={cancellationText}
      cancellationRules={cancellationRules}
      withMoney={withMoney}
      onChanged={onChanged}
    />
  );
  if (bookings.length === 1 && !rows) return card(bookings[0]);
  const phases = bookings.map((b) => bookingPhase(b, today));
  const openFirst = Math.max(0, phases.indexOf("active"));
  return (
    <div className="space-y-2">
      {bookings.map((b, i) => (
        <Collapsible key={b.id} defaultOpen={i === openFirst} asChild>
          <div className="group rounded-lg border">
            <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 text-start text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:-scale-x-100" />
              <span className="font-mono font-semibold">{b.ref}</span>
              <PhaseTag phase={phases[i]} />
              <span className="tabular text-muted-foreground">
                {b.departureCode ?? EMPTY} · {fmtDate(b.departureStart)}
              </span>
              <span className="text-muted-foreground">{b.adults + b.children} travelers</span>
              {seatsOf(b) && <SeatsChip state={seatsOf(b)!} />}
              {/* what is still owed on it (Alon 20.10: "Balance | -1,605.74$") */}
              {withMoney && b.status !== "cancelled" && b.status !== "failed" && <BalanceChip booking={b} />}
              <span className="ms-auto tabular font-medium">{fmtPrice(b.total, b.currency)}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-3 pb-3">{card(b)}</CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  );
}

/** A section that opens on a click - what a rep needs now and then, out of the way the rest of the time. */
function Fold({
  icon,
  tone,
  title,
  description,
  defaultOpen,
  children,
}: {
  icon: LucideIcon;
  tone: SectionTone;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <section className="group overflow-hidden rounded-lg border bg-card">
        <CollapsibleTrigger className="w-full text-start hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <SectionBand
            icon={icon}
            tone={tone}
            title={title}
            description={description}
            className="border-b-0 group-data-[state=open]:border-b"
            actions={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:-scale-x-100" />}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 p-4">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * One card: its bookings, seats, tour, source, offer and notes. On its own (`/tours/reservations/[id]` before the
 * customers migration) it also shows the customer; `embedded` = inside the customer page (Nir 19.10), where the
 * customer's own block is the page's header and this is one deal of theirs.
 */
/** Where a card opens when a shortcut on its closed row was clicked (customer page, Alon 20.10); `at` re-runs it. */
export interface CardFocus {
  section: "link" | "notes";
  at: number;
}

export function CasePage({ id, embedded, focus, onChanged }: { id: string; embedded?: boolean; focus?: CardFocus | null; onChanged?: () => void }) {
  const router = useRouter();
  const run = useActionToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useActionData<CaseDetail>(() => getCase(id), [id]);
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [travelersOpen, setTravelersOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // set when the dialog opens, so it keeps one prefill while it is open
  const [travelersPrefill, setTravelersPrefill] = useState<ReservationPrefill | null>(null);
  const today = todayIso();
  const loaded = !!data;
  useEffect(() => {
    if (!loaded || !focus) return;
    document.getElementById(`card-${id}-${focus.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loaded, focus, id]);

  if (!data) {
    return (
      <div className="space-y-4">
        {!embedded && <BackLink />}
        {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the card…
          </div>
        )}
      </div>
    );
  }

  const { row, statuses, reps } = data;
  const name = caseName(row) || row.phone || row.email || "Customer";
  const reason = todayReason(row, statuses, today);
  const due = followUpDue(row, statuses, today);
  const notes = notesDraft ?? row.notes ?? "";
  // bookings add, cancellations give back - the net is what the departure counts
  const seatsHeld = data.sales.reduce((sum, s) => sum + s.pax, 0);
  // a settled deal whose travelers hold no seat (closed before closing held them by itself - case #1004)
  const seatBookings = data.bookings.map(seatBookingOf);
  const gap = seatGap(row.status, statuses, seatBookings, data.sales);
  const gapBooking = gap ? data.bookings.find((b) => b.ref === gap.ref) : undefined;
  // each order's chip tells its truth even on a closed case, where the notice above stays quiet
  const owedRefs = owedSeatRefs(statuses, seatBookings, data.sales);
  // every traveler the customer sent, per live order (Alon 15.10: "all the passengers' names")
  const travelers = travelerGroups(data.bookings);
  const bookedTravelers = data.bookings.find((b) => b.status !== "cancelled" && b.status !== "failed");
  const siteLink =
    data.siteUrl && data.pkg
      ? `${data.siteUrl.replace(/\/+$/, "")}${data.pkg.path}${data.departure ? `?product_id=${data.departure.siteId}` : ""}`
      : null;
  const formFields = Object.entries(data.payload).filter(([key]) => !SHOWN_PAYLOAD_KEYS.has(key));
  // the form's page is what the visitor's browser sent: linked only when it stays on our site
  const sourceHref = siteHref(data.siteUrl, row.sourcePath);
  const hasCampaign = CAMPAIGN_KEYS.some((key) => !!row.utm[key]);
  const repName = row.assignedTo ? (reps.find((p) => p.id === row.assignedTo)?.name ?? null) : null;

  const save = async (change: CaseChange): Promise<boolean> => {
    setBusy(true);
    const result = await run(() => updateCase(row.id, change));
    setBusy(false);
    if (result.success) {
      setData((current) => current && { ...current, row: result.data });
      // a deal closed by hand may have put seats on the departure (the toast says so): show them
      if (change.status) void reload({ quiet: true });
      onChanged?.();
    }
    return result.success;
  };
  const saveStatus = (status: string, closeReason?: string, pick?: FuturePick) =>
    void save({ status, closeReason, ...(pick ? { packageId: pick.packageId, season: pick.season } : {}) });

  const addTravelers = (extra: ReservationPrefill = {}) => {
    setTravelersPrefill({
      leadId: row.id,
      customerName: name,
      customerPhone: row.phone,
      customerEmail: row.email,
      siteId: data.departure?.siteId ?? null,
      ...extra,
    });
    setTravelersOpen(true);
  };

  const remove = async () => {
    const agreed = await confirm({
      title: `Delete case #${row.caseNo}?`,
      description: "The case is marked deleted and leaves the table; it stays recoverable. Its seats stay on the departure until you cancel them.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!agreed) return;
    const result = await run(() => deleteCase(row.id), "Card deleted");
    if (result.success) {
      if (embedded) onChanged?.();
      else router.push("/tours/reservations");
    }
  };

  // the card's pieces - laid out whole on its own page, and Alon's way inside the customer page (20.10)
  const customerWrote = (
    <>
            {row.message && (
              <p dir="auto" className="mt-3 whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground">The customer wrote: </span>
                {row.message}
              </p>
            )}
            {/* site forms that joined this card: the customer came back on it (Nir 19.10) */}
            {data.inquiries.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <h3 className="text-sm font-semibold text-violet-800 dark:text-violet-300">Came back on this card ({data.inquiries.length})</h3>
                <ol className="space-y-1.5">
                  {data.inquiries.map((q, i) => (
                    <li
                      key={`${q.at}-${i}`}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm",
                        q.otherSender ? "border-amber-500/50 bg-amber-500/10" : "border-violet-500/25 bg-violet-500/5",
                      )}
                    >
                      <span className="tabular text-xs text-muted-foreground">{fmtInstant(q.at)}</span>
                      <span className="ms-2 text-xs text-muted-foreground">{LEAD_KIND_LABELS[q.kind] ?? q.kind}</span>
                      {q.sentAs && (
                        <span className="ms-2 text-xs text-muted-foreground">
                          Sent as{" "}
                          {[q.sentAs.name, q.sentAs.phone, q.sentAs.email].filter(Boolean).map((part, j) => (
                            <span key={j} dir="auto">
                              {j > 0 && " · "}
                              {part}
                            </span>
                          ))}
                        </span>
                      )}
                      {/* the form joined by the phone alone, which anyone can type (security review 19.10) */}
                      {q.otherSender && (
                        <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          Sent with this customer&apos;s phone but another name or e-mail - check it is them before you act on it.
                        </p>
                      )}
                      {q.message && (
                        <p dir="auto" className="whitespace-pre-wrap break-words">
                          {q.message}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
    </>
  );
  const gapNotice = (
    <>
          {gap && (
            <Notice tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {gap.missing === 1 ? "1 traveler" : `${gap.missing} travelers`} of {gap.owed.length > 1 ? "bookings" : "booking"}{" "}
                  {gap.owed.map((o) => o.ref).join(", ")} {gap.missing === 1 ? "is" : "are"} not on the departure
                  {gap.owed.length === 1 && gapBooking?.departureCode ? ` (${gapBooking.departureCode})` : ""}
                </p>
                <p className="text-xs opacity-90">
                  The deal is closed, but its seats are not held - the departure still sells these places. Closing a booking or the case by hand holds
                  them by itself now; this one was closed before that, so hold them here.
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const result = await run(() => holdCaseSeats(row.id));
                  setBusy(false);
                  if (result.success) void reload({ quiet: true });
                }}
              >
                <PlusCircle className="h-4 w-4" />
                {gap.missing === 1 ? "Hold 1 seat" : `Hold ${gap.missing} seats`}
              </Button>
            </Notice>
          )}

    </>
  );
  const seatsSection = (
    <>
          {/* closed by default (Dor 15.10): the seats count by themselves - a paid or closed booking adds them - so
              the ledger is there for whoever needs it, not in every rep's way */}
          <Collapsible asChild>
            <section className="group overflow-hidden rounded-lg border bg-card">
              <CollapsibleTrigger className="w-full text-start hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <SectionBand
                  icon={Armchair}
                  tone="teal"
                  title="Seats"
                  description={seatsHeld > 0 ? `${seatsHeld} held on the departure` : "none held"}
                  className="border-b-0 group-data-[state=open]:border-b"
                  actions={
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:-scale-x-100" />
                  }
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Travelers this customer holds on a departure - a paid booking, or one closed as Done, adds them by itself; a cancellation gives them
                    back. Add travelers by hand for a phone or office booking.
                  </p>
                  <Button size="sm" onClick={() => addTravelers()}>
                    <PlusCircle className="h-4 w-4" />
                    Add travelers
                  </Button>
                </div>
                <ToursReservationsTable rows={data.sales} onDeleted={() => void reload({ quiet: true })} />
              </CollapsibleContent>
            </section>
          </Collapsible>

    </>
  );
  const historyList = (
    <>
            {data.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing changed yet.</p>
            ) : (
              <ol className="space-y-2">
                {data.history.map((item, i) => (
                  <li key={`${item.at}-${i}`} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="tabular text-xs text-muted-foreground">{fmtInstant(item.at)}</span>
                      <span className="font-medium">{item.action}</span>
                      <span className="text-xs text-muted-foreground">{item.actor ?? "the site"}</span>
                    </div>
                    {changeLines(item).map((line) => (
                      <div key={line} dir="auto" className="break-words text-xs text-muted-foreground">
                        {line}
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
            )}
    </>
  );
  const productSection = (
    <>
          <Section title="Product" icon={MapPinned} tone="violet">
            <FactList>
              <Fact label="Tour">{(data.pkg?.name ?? row.tourName) && <span dir="auto">{data.pkg?.name ?? row.tourName}</span>}</Fact>
              <Fact label="Departure">
                {data.departure && (
                  <span className="tabular">
                    {data.departure.code} · {fmtDateRange(data.departure.startDate, data.departure.endDate)}
                    {!data.departure.isPublished && <span className="text-muted-foreground"> (not on the site)</span>}
                  </span>
                )}
              </Fact>
              {row.season && (
                <Fact label="Season">
                  <span dir="rtl">{row.season}</span>
                </Fact>
              )}
              <Fact label="Travelers">
                {row.travelers > 0 ? (
                  <span>
                    {row.travelers} <span className="text-xs text-muted-foreground">held on the departure</span>
                  </span>
                ) : bookedTravelers && bookedTravelers.adults + bookedTravelers.children > 0 ? (
                  <span className={cn(gap && "text-amber-700 dark:text-amber-300")}>
                    {bookedTravelers.adults + bookedTravelers.children}{" "}
                    <span className="text-xs">{gap ? "on the booking - not on the departure yet" : `on booking ${bookedTravelers.ref}`}</span>
                  </span>
                ) : (
                  EMPTY
                )}
              </Fact>
            </FactList>
            {siteLink && (
              <a href={siteLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Open on the site <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </Section>

    </>
  );
  const sourceFacts = (
    <>
            <FactList>
              <Fact label="Came through">
                <div className="flex items-center gap-2">
                  <span>{sourceLabel(row.source, row.utm)}</span>
                  <Select value={row.source} disabled={busy} onValueChange={(source) => void save({ source: source as CaseSource })}>
                    <SelectTrigger className="h-7 w-28 text-xs" aria-label="Came through">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CASE_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {CASE_SOURCE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Fact>
              <Fact label="Form">{LEAD_KIND_LABELS[row.kind] ?? (row.kind === "manual" ? "Entered by staff" : row.kind)}</Fact>
              <Fact label="Sent from">
                {row.sourcePath &&
                  (sourceHref ? (
                    <a href={sourceHref} target="_blank" rel="noreferrer" dir="auto" className="break-all text-primary hover:underline">
                      {readablePath(row.sourcePath)}
                    </a>
                  ) : (
                    <span dir="auto">{readablePath(row.sourcePath)}</span>
                  ))}
              </Fact>
              {/* Alon 15.10 "does it bring UTM?": yes - and when the visit carried none, the page says so */}
              {!hasCampaign && row.kind !== "manual" && (
                <Fact label="Campaign (UTM)">
                  <span className="text-muted-foreground">None - the visit came without a campaign (direct, organic search or a typed address)</span>
                </Fact>
              )}
              {Object.entries(row.utm).map(([key, value]) => (
                <Fact key={key} label={UTM_LABELS[key] ?? key}>
                  <span dir="auto" className="break-all">
                    {key === "landing" ? readablePath(String(value)) : show(value)}
                  </span>
                </Fact>
              ))}
              <Fact label="Opened">{fmtInstant(row.createdAt)}</Fact>
            </FactList>
            {formFields.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">More from the form ({formFields.length})</summary>
                <FactList className="mt-1 rounded-md border bg-muted/30 px-3">
                  {formFields.map(([key, value]) => (
                    <Fact key={key} label={<span className="font-mono text-xs">{key}</span>}>
                      <span dir="auto" className="break-words">
                        {show(value)}
                      </span>
                    </Fact>
                  ))}
                </FactList>
              </details>
            )}
    </>
  );
  const linkCard = (
    <>
          <BookingLinkCard
            caseId={row.id}
            defaultDepartureId={row.departureId}
            hasSite={!!data.siteUrl}
            whatsappApi={data.whatsappApi}
            offer={data.offer}
            phone={row.phone}
            email={row.email}
            firstName={row.firstName}
            onChanged={() => void reload({ quiet: true })}
          />

    </>
  );
  const notesSection = (
    <>
          <Section title="Notes" description="For the team only - the customer never sees them." icon={StickyNote} tone="warning">
            <Textarea dir="auto" rows={5} maxLength={4000} value={notes} onChange={(e) => setNotesDraft(e.target.value)} placeholder="What was said, what was promised, what to do next." />
            <div className="mt-2 flex justify-end gap-2">
              {notesDraft !== null && notesDraft !== (row.notes ?? "") && (
                <Button variant="ghost" size="sm" onClick={() => setNotesDraft(null)}>
                  Discard
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy || notesDraft === null || notesDraft === (row.notes ?? "")}
                onClick={async () => {
                  if (await save({ notes })) setNotesDraft(null);
                }}
              >
                Save notes
              </Button>
            </div>
          </Section>
    </>
  );
  const cancellationText = data.pkg?.cancellationHtml ? htmlToText(data.pkg.cancellationHtml) : null;

  const cardBody = (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Customer" icon={UserRound} tone="info">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CustomerField label="First name" value={row.firstName} onSave={(firstName) => void save({ firstName })} />
              <CustomerField label="Last name" value={row.lastName} onSave={(lastName) => void save({ lastName })} />
              <CustomerField label="Phone" value={row.phone} dir="ltr" onSave={(phone) => void save({ phone })} />
              <CustomerField label="Email" value={row.email} dir="ltr" onSave={(email) => void save({ email })} />
              <CustomerField label="National id (ת״ז)" value={row.idNumber} dir="ltr" onSave={(idNumber) => void save({ idNumber })} />
              <CustomerField label="ACC NUM" value={row.accNum} dir="ltr" onSave={(accNum) => void save({ accNum })} />
            </div>
            {travelers.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Travelers ({travelers.reduce((sum, g) => sum + g.passengers.length, 0)})
                </h3>
                {travelers.map((group) => (
                  <div key={group.ref} className="space-y-1">
                    {travelers.length > 1 && <p className="font-mono text-xs text-muted-foreground">{group.ref}</p>}
                    <ol className="grid divide-y overflow-hidden rounded-md border sm:grid-cols-2 sm:divide-y-0 sm:[&>li:nth-child(n+3)]:border-t sm:[&>li:nth-child(even)]:border-s">
                      {group.passengers.map((p, i) => (
                        <li key={i} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
                          <span className="tabular text-xs text-muted-foreground">{i + 1}.</span>
                          <span dir="auto" className="font-medium">
                            {group.names[i]}
                          </span>
                          <span className="ms-auto text-xs text-muted-foreground">{p.type === "child" ? "Child" : "Adult"}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
            {customerWrote}
          </Section>

          <Section
            icon={ReceiptText}
            tone="success"
            title={`Order${data.bookings.length > 1 ? `s (${data.bookings.length})` : ""}`}
            description={data.bookings.length ? "What the customer sent from the site." : undefined}
          >
            {data.bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No booking from the site yet.{row.type !== "reservation" ? " Send a booking link and the booking will land here." : ""}
              </p>
            ) : (
              <Orders bookings={data.bookings} caseName={name} casePhone={row.phone} owedRefs={owedRefs} onChanged={() => void reload({ quiet: true })} />
            )}
          </Section>

          {gapNotice}
          {seatsSection}

          {data.pkg?.cancellationHtml && (
            <Section icon={FileText} tone="neutral" title="Cancellation terms" description={`As the tour page shows them (${data.pkg.name}).`}>
              <p dir="rtl" className="whitespace-pre-line text-sm leading-6">
                {htmlToText(data.pkg.cancellationHtml)}
              </p>
            </Section>
          )}

          <Section title="History" icon={HistoryIcon} tone="neutral">
            {historyList}
          </Section>
        </div>

        <div className="space-y-6">
          {productSection}
          <Section title="Gift" icon={Gift} tone="rose">
            {data.gifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{data.departure ? "No gift on this departure." : "Choose a departure to see its gift."}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.gifts.map((g, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Gift className="h-4 w-4 text-primary" />
                    <span dir="auto">{g.label}</span>
                    {g.validUntil && <span className="text-xs text-muted-foreground">until {fmtDate(g.validUntil)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Source" icon={Megaphone} tone="neutral">
            {sourceFacts}
          </Section>

          {linkCard}
          {notesSection}
        </div>
      </div>
  );

  // inside the customer page (Alon 20.10): the orders first on the left, then what is opened now and then; the
  // tour, the booking link and the notes on the right. The person is the page's header, and each order holds its
  // passengers, the departure's gift and the cancellation terms.
  const embeddedBody = (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {(row.message || data.inquiries.length > 0) && (
          <Section title="What the customer wrote" icon={Users} tone="info">
            {customerWrote}
          </Section>
        )}
        <Section
          icon={ReceiptText}
          tone="success"
          title={`Orders (${data.bookings.length})`}
          description={data.bookings.length ? "What the customer sent from the site." : undefined}
        >
          {data.bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No booking from the site yet.{row.type !== "reservation" ? " Send a booking link and the booking will land here." : ""}
            </p>
          ) : (
            <Orders
              rows
              bookings={data.bookings}
              caseName={name}
              casePhone={row.phone}
              owedRefs={owedRefs}
              gifts={data.gifts}
              cancellationText={cancellationText}
              cancellationRules={data.cancellationRules}
              withMoney
              onChanged={() => void reload({ quiet: true })}
            />
          )}
        </Section>
        {gapNotice}
        {seatsSection}
        <Fold icon={HistoryIcon} tone="neutral" title="Card activity" description={data.history.length ? `${data.history.length} changes` : "Nothing changed yet"}>
          {historyList}
        </Fold>
        <Fold icon={Megaphone} tone="neutral" title="Source" description={sourceLabel(row.source, row.utm)}>
          {sourceFacts}
        </Fold>
      </div>
      <div className="space-y-4">
        {productSection}
        <div id={`card-${row.id}-link`} className="scroll-mt-24">
          {linkCard}
        </div>
        <div id={`card-${row.id}-notes`} className="scroll-mt-24">
          {notesSection}
        </div>
      </div>
    </div>
  );
  const dialogs = (
    <>
      <ReservationDialog
        open={travelersOpen}
        onOpenChange={setTravelersOpen}
        prefill={travelersPrefill ?? undefined}
        onCreated={() => void reload({ quiet: true })}
      />
      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        caseId={row.id}
        caseNo={row.caseNo}
        statuses={statuses}
        onMerged={(keptId) => {
          if (embedded) return onChanged?.();
          return keptId === row.id ? void reload() : router.push(`/tours/reservations/${keptId}`);
        }}
      />
      {moveOpen && (
        <MoveCardDialog
          cardId={row.id}
          caseNo={row.caseNo}
          currentCustomerId={row.customerId}
          onCancel={() => setMoveOpen(false)}
          onMoved={(customerId) => {
            setMoveOpen(false);
            router.push(`/tours/customers/${customerId}?card=${row.id}`);
          }}
        />
      )}
    </>
  );

  // one click for what a rep does all day (Nir 19.10): no answer -> call again tomorrow; the customer came back
  const quickActions = !isClosedStatus(row.status, statuses) && (
    <>
      {row.paymentAnswer === "paid" && (
        <Button size="sm" disabled={busy} onClick={() => void save({ status: "paid" })} title={PAYMENT_ANSWER_LABELS[row.paymentAnswer]}>
          Confirm → <span dir="rtl">{statusOf("paid", statuses)?.label ?? "Paid"}</span>
        </Button>
      )}
      {["new", "no_answer", "returned", "offer_sent", "future"].includes(row.status) && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ status: "no_answer", followUpDate: tomorrowOf(today) })}>
          No answer · call tomorrow
        </Button>
      )}
      {["no_answer", "offer_sent", "future"].includes(row.status) && statusOf("returned", statuses) && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ status: "returned", followUpDate: today })}>
          The customer came back
        </Button>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-5">
        {/* the card's controls: where the deal stands, whose it is, when to call */}
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid w-full gap-1 text-sm sm:w-48">
              <span className="text-xs text-muted-foreground">Status</span>
              <StatusSelect
                value={row.status}
                statuses={statuses}
                disabled={busy}
                future={{ packageId: row.packageId, season: row.season }}
                onChange={saveStatus}
                className="w-full justify-start border border-input px-2"
              />
            </label>
            <label className="grid w-full gap-1 text-sm sm:w-40">
              <span className="text-xs text-muted-foreground">Rep</span>
              <RepSelect value={row.assignedTo} reps={reps} currentUserId={data.currentUserId} disabled={busy} onChange={(assignedTo) => void save({ assignedTo })} className="w-full" />
            </label>
            <label className="grid w-full gap-1 text-sm sm:w-56">
              <span className="text-xs text-muted-foreground">Follow-up day</span>
              <div className="flex items-center gap-1">
                <FollowUpInput value={row.followUpDate} due={due} className="h-9 w-full" onSave={(followUpDate) => void save({ followUpDate })} />
                {row.followUpDate && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ followUpDate: null })}>
                    Clear
                  </Button>
                )}
              </div>
            </label>
            <div className="ms-auto flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setMoveOpen(true)} title="This deal is another person's (a relative booked from their own phone)">
                <UserRound className="h-4 w-4" />
                Move to another customer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMergeOpen(true)} title="Two cards of one deal - join them">
                <GitMerge className="h-4 w-4" />
                Merge with another card
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TodayBadge reason={reason} followUpDate={row.followUpDate} today={today} />
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {quickActions}
          </div>
          {row.paymentAnswer === "paid" && (
            <Notice tone="info">
              {PAYMENT_ANSWER_LABELS.paid} on booking {row.bookingRef} - CreditGuard confirmed the amount and the seats are held. Confirm{" "}
              <span dir="rtl">&quot;{statusOf("paid", statuses)?.label ?? "Paid"}&quot;</span> when you have seen it.
            </Notice>
          )}
          {row.paymentAnswer === "review" && (
            <Notice tone="warning">
              {PAYMENT_ANSWER_LABELS.review} on booking {row.bookingRef}: the charge had another amount. Check it in CreditGuard and set the booking
              &quot;Paid&quot; below when it is right - that confirms the card too.
            </Notice>
          )}
          {row.paymentAnswer === "failed" && (
            <Notice tone="warning">
              {PAYMENT_ANSWER_LABELS.failed} on booking {row.bookingRef}. Call the customer: they may pay again, by phone or with a new link.
            </Notice>
          )}
          {row.closeReason && isClosedStatus(row.status, statuses) && (
            <p dir="auto" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">Closed because: </span>
              {row.closeReason}
            </p>
          )}
          {data.known && (
            <Notice tone="info">
              Known customer: card #{data.known.caseNo}
              {data.known.tourName && (
                <>
                  {" "}
                  (<span dir="auto">{data.known.tourName}</span>)
                </>
              )}{" "}
              was <span dir="rtl">&quot;{statusOf(data.known.status, statuses)?.label ?? data.known.status}&quot;</span>
              {data.known.closeReason && (
                <>
                  {" "}
                  - <span dir="auto">{data.known.closeReason}</span>
                </>
              )}{" "}
              ({fmtDate(data.known.createdAt.slice(0, 10))}). It is in the History below.
            </Notice>
          )}
          {data.payload.matched_by === "contact" && (
            <Notice tone="warning">
              A site booking was attached to this card because its phone or e-mail matches. Check the booking&apos;s own customer below before you call.
            </Notice>
          )}
        </div>
        {embeddedBody}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      {/* the header takes the case type's hue: a booked customer, a lead and a future interest read apart at once */}
      <div className={cn("space-y-4 rounded-lg border bg-card p-4", TYPE_WASH[row.type])}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
            <span className="me-2 font-mono text-lg text-muted-foreground">#{row.caseNo}</span>
            {name}
          </h1>
          <TypeBadge type={row.type} />
          <TodayBadge reason={reason} followUpDate={row.followUpDate} today={today} />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <WhatsAppButton phone={row.phone} message={`היי ${row.firstName ?? ""}`.trim()} />
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)} title="One customer with two cases - join them">
              <GitMerge className="h-4 w-4" />
              Link to another case
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Status</span>
            <StatusSelect
              value={row.status}
              statuses={statuses}
              disabled={busy}
              future={{ packageId: row.packageId, season: row.season }}
              onChange={saveStatus}
              className="w-full justify-start border border-input px-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Rep</span>
            <RepSelect value={row.assignedTo} reps={reps} currentUserId={data.currentUserId} disabled={busy} onChange={(assignedTo) => void save({ assignedTo })} className="w-full" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Type</span>
            <Select value={row.type} disabled={busy} onValueChange={(type) => void save({ type: type as CaseType })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CASE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Follow-up day</span>
            <div className="flex items-center gap-1">
              <FollowUpInput value={row.followUpDate} due={due} className="h-9 w-full" onSave={(followUpDate) => void save({ followUpDate })} />
              {row.followUpDate && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ followUpDate: null })}>
                  Clear
                </Button>
              )}
            </div>
          </label>
        </div>
        {row.closeReason && isClosedStatus(row.status, statuses) && (
          <p dir="auto" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">Closed because: </span>
            {row.closeReason}
          </p>
        )}
        {data.payload.matched_by === "contact" && (
          <Notice tone="warning">
            A site booking was attached to this case because its phone or e-mail matches the case. Check the booking&apos;s own customer below before you call.
          </Notice>
        )}
        {data.relatedCase && (
          <Notice tone="info" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <GitMerge className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              Same customer as case{" "}
              <Link href={`/tours/reservations/${data.relatedCase.id}`} className="font-semibold underline underline-offset-4">
                #{data.relatedCase.caseNo}
              </Link>{" "}
              (same phone or e-mail{repName ? `, given to ${repName}` : ""}). The booking came without the link, so it opened its own case - merge
              them to keep one customer in one place.
            </p>
            <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
              <GitMerge className="h-4 w-4" />
              Merge the two
            </Button>
          </Notice>
        )}
      </div>

      {cardBody}
      {dialogs}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/tours/reservations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
      Reservations
    </Link>
  );
}
