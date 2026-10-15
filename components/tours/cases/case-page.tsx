"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ExternalLink, Gift, Loader2, MessageCircle, PlusCircle, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-provider";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { EMPTY, fmtDate, fmtDateRange, fmtInstant, todayIso } from "@/lib/tours/format";
import { deleteCase, getCase, updateCase } from "@/lib/actions/tours-cases-actions";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import { Fact, FactList, LoadError, Notice, Section } from "@/components/tours/ui";
import { readablePath } from "@/components/tours/content/shared";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import { ToursReservationsTable } from "@/components/tours/reservations/reservations-table";
import type { ReservationPrefill } from "@/components/tours/reservations/types";
import {
  CASE_SOURCES,
  CASE_SOURCE_LABELS,
  CASE_TASKS,
  CASE_TASK_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  caseName,
  caseTask,
  followUpDue,
  htmlToText,
  siteHref,
  isCaseTask,
  seatBookingOf,
  seatGap,
  sourceLabel,
  waLink,
  type CaseChange,
  type CaseDetail,
  type CaseHistoryItem,
  type CaseSource,
  type CaseType,
} from "@/lib/tours/cases";
import { FollowUpInput, RepSelect, StatusSelect, TaskBadge, TypeBadge } from "@/components/tours/cases/case-ui";
import { BookingCard } from "@/components/tours/cases/booking-card";
import { BookingLinkCard } from "@/components/tours/cases/booking-link-card";

const AUTO = "auto";
/** Fields of a form that the page already shows in its own place. */
const SHOWN_PAYLOAD_KEYS = new Set(["name", "phone", "email", "message", "matched_by", "acceptance", "website"]);
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

const show = (value: unknown): string =>
  value === null || value === undefined || value === "" ? EMPTY : typeof value === "string" ? value : JSON.stringify(value);

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

/** /tours/reservations/[id] - one customer: the case, its bookings, seats, tour, source and booking link. */
export function CasePage({ id }: { id: string }) {
  const router = useRouter();
  const run = useActionToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useActionData<CaseDetail>(() => getCase(id), [id]);
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [travelersOpen, setTravelersOpen] = useState(false);
  // set when the dialog opens, so it keeps one prefill while it is open
  const [travelersPrefill, setTravelersPrefill] = useState<ReservationPrefill | null>(null);
  const today = todayIso();

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the case…
          </div>
        )}
      </div>
    );
  }

  const { row, statuses, reps } = data;
  const name = caseName(row) || row.phone || row.email || "Customer";
  const task = caseTask(row, statuses, today);
  const due = followUpDue(row, statuses, today);
  const notes = notesDraft ?? row.notes ?? "";
  const whatsapp = waLink(row.phone, `היי ${row.firstName ?? ""}`.trim());
  // bookings add, cancellations give back - the net is what the departure counts
  const seatsHeld = data.sales.reduce((sum, s) => sum + s.pax, 0);
  // a settled deal whose travelers hold no seat: a request closed by phone adds none by itself (case #1004)
  const gap = seatGap(row.status, statuses, data.bookings.map(seatBookingOf), data.sales);
  const gapBooking = gap ? data.bookings.find((b) => b.ref === gap.ref) : undefined;
  const siteLink =
    data.siteUrl && data.pkg
      ? `${data.siteUrl.replace(/\/+$/, "")}${data.pkg.path}${data.departure ? `?product_id=${data.departure.siteId}` : ""}`
      : null;
  const formFields = Object.entries(data.payload).filter(([key]) => !SHOWN_PAYLOAD_KEYS.has(key));
  // the form's page is what the visitor's browser sent: linked only when it stays on our site
  const sourceHref = siteHref(data.siteUrl, row.sourcePath);

  const save = async (change: CaseChange): Promise<boolean> => {
    setBusy(true);
    const result = await run(() => updateCase(row.id, change));
    setBusy(false);
    if (result.success) setData((current) => current && { ...current, row: result.data });
    return result.success;
  };

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
    const result = await run(() => deleteCase(row.id), "Case deleted");
    if (result.success) router.push("/tours/reservations");
  };

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
            <span className="me-2 font-mono text-lg text-muted-foreground">#{row.caseNo}</span>
            {name}
          </h1>
          <TypeBadge type={row.type} />
          <TaskBadge task={task} overridden={isCaseTask(row.taskOverride)} />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="ms-auto flex items-center gap-2">
            {whatsapp && (
              <Button variant="outline" size="sm" asChild>
                <a href={whatsapp} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Status</span>
            <StatusSelect value={row.status} statuses={statuses} disabled={busy} onChange={(status) => void save({ status })} className="w-full justify-start border border-input px-2" />
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
            <span className="text-xs text-muted-foreground">Task</span>
            <Select
              value={isCaseTask(row.taskOverride) ? row.taskOverride : AUTO}
              disabled={busy}
              onValueChange={(value) => void save({ taskOverride: value === AUTO ? null : value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Automatic{!isCaseTask(row.taskOverride) && task ? ` (${CASE_TASK_LABELS[task]})` : ""}</SelectItem>
                {CASE_TASKS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CASE_TASK_LABELS[t]}
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
        {data.payload.matched_by === "contact" && (
          <Notice tone="warning">
            A site booking was attached to this case because its phone or e-mail matches the case. Check the booking&apos;s own customer below before you call.
          </Notice>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Customer">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CustomerField label="First name" value={row.firstName} onSave={(firstName) => void save({ firstName })} />
              <CustomerField label="Last name" value={row.lastName} onSave={(lastName) => void save({ lastName })} />
              <CustomerField label="Phone" value={row.phone} dir="ltr" onSave={(phone) => void save({ phone })} />
              <CustomerField label="Email" value={row.email} dir="ltr" onSave={(email) => void save({ email })} />
              <CustomerField label="National id (ת״ז)" value={row.idNumber} dir="ltr" onSave={(idNumber) => void save({ idNumber })} />
              <CustomerField label="ACC NUM" value={row.accNum} dir="ltr" onSave={(accNum) => void save({ accNum })} />
            </div>
            {row.message && (
              <p dir="auto" className="mt-3 whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground">The customer wrote: </span>
                {row.message}
              </p>
            )}
          </Section>

          <Section
            title={`Order${data.bookings.length > 1 ? `s (${data.bookings.length})` : ""}`}
            description={data.bookings.length ? "What the customer sent from the site." : undefined}
          >
            {data.bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No booking from the site yet.{row.type !== "reservation" ? " Send a booking link and the booking will land here." : ""}
              </p>
            ) : (
              <div className="space-y-4">
                {data.bookings.map((b) => (
                  <BookingCard key={b.id} booking={b} caseName={name} casePhone={row.phone} onChanged={() => void reload({ quiet: true })} />
                ))}
              </div>
            )}
          </Section>

          {gap && (
            <Notice tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {gap.missing === 1 ? "1 traveler" : `${gap.missing} travelers`} of booking {gap.ref}{" "}
                  {gap.missing === 1 ? "is" : "are"} not on the departure
                  {gapBooking?.departureCode ? ` (${gapBooking.departureCode})` : ""}
                </p>
                <p className="text-xs opacity-90">
                  The deal is closed, but its seats were never held - the departure still sells these places. Only a card payment adds seats by
                  itself; a booking closed by phone needs them added here.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  addTravelers({
                    departureId: gap.departureId,
                    siteId: gapBooking?.siteId ?? null,
                    travelers: gap.missing,
                    note: `Online booking ${gap.ref}`,
                  })
                }
              >
                <PlusCircle className="h-4 w-4" />
                {gap.missing === 1 ? "Hold 1 seat" : `Hold ${gap.missing} seats`}
              </Button>
            </Notice>
          )}

          {/* closed by default (Dor 15.10): the seats count by themselves - a paid booking adds them - so the
              ledger is there for whoever needs it, not in every rep's way */}
          <Collapsible asChild>
            <section className="group rounded-lg border bg-card">
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg p-4 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:-scale-x-100" />
                <h2 className="font-display text-base font-semibold">Seats</h2>
                <span className="text-sm text-muted-foreground">{seatsHeld > 0 ? `${seatsHeld} held on the departure` : "none held"}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 px-4 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Travelers this customer holds on a departure - a paid booking adds them by itself, a cancellation gives them back. Add travelers by
                    hand for a phone or office booking.
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

          {data.pkg?.cancellationHtml && (
            <Section title="Cancellation terms" description={`As the tour page shows them (${data.pkg.name}).`}>
              <p dir="rtl" className="whitespace-pre-line text-sm leading-6">
                {htmlToText(data.pkg.cancellationHtml)}
              </p>
            </Section>
          )}

          <Section title="History">
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
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Product">
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
              <Fact label="Travelers">{row.travelers || EMPTY}</Fact>
            </FactList>
            {siteLink && (
              <a href={siteLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Open on the site <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </Section>

          <Section title="Gift">
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

          <Section title="Source">
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
          </Section>

          <BookingLinkCard
            caseId={row.id}
            defaultDepartureId={row.departureId}
            linkSentAt={data.linkSentAt}
            hasSite={!!data.siteUrl}
            onSent={() => void reload({ quiet: true })}
          />

          <Section title="Notes" description="For the team only - the customer never sees them.">
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
        </div>
      </div>

      <ReservationDialog
        open={travelersOpen}
        onOpenChange={setTravelersOpen}
        prefill={travelersPrefill ?? undefined}
        onCreated={() => void reload({ quiet: true })}
      />
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
