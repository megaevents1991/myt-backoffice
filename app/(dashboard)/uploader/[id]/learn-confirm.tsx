"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GraduationCap, Loader2, MapPin, MessageSquareText, TextQuote, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { learnFromEvent, learnPreview } from "@/lib/actions/uploader-actions";
import type { LearnPreview } from "@/lib/uploader/action-types";
import { LEARN_NOTE_MAX, LEARN_NOTE_MIN, type DescriptionPlan, type EditKind, type LearnShowRow, type LiveTicketsPlan, type ShowVerdict } from "@/lib/uploader/edit-changes";
import { actionErrorText } from "../copy";
import {
  BTN_CANCEL,
  BTN_LEARN_CONFIRM,
  CLASSIFY_DONE,
  LEARN_CLEAR_ALL,
  LEARN_CLEARED,
  LEARN_DESC_DONE,
  LEARN_DESC_FAILED,
  LEARN_DESC_PARTIAL,
  LEARN_DESC_REACH,
  LEARN_DESCRIPTION,
  LEARN_DESCRIPTIONS,
  LEARN_DROPPED,
  LEARN_FAILED,
  LEARN_FIELDS_DONE,
  LEARN_FIELDS_PARTIAL,
  LEARN_KIND_DESCRIPTIONS,
  LEARN_KIND_DESCRIPTIONS_HINT,
  LEARN_KIND_LIVE_TICKETS,
  LEARN_KIND_LIVE_TICKETS_HINT,
  LEARN_KIND_EVENT_DESCRIPTION,
  LEARN_KIND_EVENT_DESCRIPTION_HINT,
  LEARN_KIND_PLACE,
  LEARN_KIND_PLACE_HINT,
  LEARN_KIND_SHORT,
  LEARN_KIND_VENUE,
  LEARN_KIND_VENUE_HINT,
  LEARN_LIVE_COUNTS,
  LEARN_LIVE_DONE,
  LEARN_LIVE_NOT_REMEMBERED,
  LEARN_LIVE_PARTIAL,
  LEARN_LIVE_REACH,
  LEARN_LIVE_REMEMBERED,
  LEARN_LIVE_REMEMBERS,
  LEARN_LIVE_REMOVED,
  LEARN_LIVE_ZONE,
  LEARN_MORE,
  LEARN_NOT_CARRIED,
  LEARN_NOT_CARRIED_TITLE,
  LEARN_NOTE_FAILED,
  LEARN_NOTE_HINT,
  LEARN_NOTE_LABEL,
  LEARN_NOTE_PLACEHOLDER,
  LEARN_NOTE_SAVED,
  LEARN_NOTHING,
  LEARN_OPEN_FAILED,
  LEARN_REACH_EVENTS,
  LEARN_READING,
  LEARN_SAVED_NOTHING,
  LEARN_SECTIONS,
  LEARN_SET,
  LEARN_SHOWS_TITLE,
  LEARN_SIBLINGS,
  LEARN_SKIP_TEXT,
  LEARN_TEMPLATE_HINT,
  LEARN_TITLE,
  LEARN_UNZONED,
  LEARN_VENUE_PART_FAILED,
  LEARN_VENUE_UNAVAILABLE,
  LEARN_ZONES,
  NETWORK_TEXT,
  PARTIAL_LEARN_LINE,
  PLACE_FIELD_LABEL,
  showDate,
} from "./board-words";
import { rtl } from "./use-run-board";

// "למדו והחילו" (spec 5.5; Alon round 3, note 2b; second-edit round): a person changed one event in the editor. The dialog
// lists what changed since its last learn (`learnPreview`), one kind per row with a checkbox (on by default):
//  - the HALL - "7 זונים (3 חדשים) · 1 קטגוריה נפסלה (Away Fans Section) · 5 תיאורים · 4 גושים מוחרגים · יחול על 14
//    הופעות" - the venue template learns it and the hall's other shows are rewritten;
//  - the LiveTickets TICKET DESCRIPTIONS cleared or set ("כל התיאורים של LiveTickets נמחקו") - carried to the run's other
//    shows (TixStock descriptions follow the hall template - the first kind);
//  - the LiveTickets ZONES and DELETED CATEGORIES - carried to the shows at the same hall (a zone: on the same map too), and the
//    hall keeps them for the next run;
//  - the EVENT'S DESCRIPTION and its PLACE - carried to the shows at the same hall that started from the same text / place.
// Under them every other show with what it gets and why not (Alon: "לחלק החיל ולחלק לא"), then what changed here that nothing
// carries. Plus an optional note for the AI (a taught rule - it changes no event). "החל" (`learnFromEvent`) applies the ticked
// kinds; the source event itself is not rewritten. It opens at any moment; nothing to carry is an answer. No AI call.
// Mounted once by the board.

type Loaded = Extract<LearnPreview, { ok: true }>;
type Phase = { kind: "loading" } | { kind: "ready"; data: Loaded };

/** How many plan lines the dialog prints before "ועוד N". */
const PLAN_LINES_MAX = 6;

const SUPPLIER_NAME: Record<string, string> = { livetickets: "LiveTickets" };

/** The plan as lines: a supplier cleared whole first, then one category each. */
function planLines(plan: DescriptionPlan): ReactNode[] {
  return [
    ...plan.clearAll.map((s) => <span key={`all-${s}`}>{LEARN_CLEAR_ALL(SUPPLIER_NAME[s] ?? s)}</span>),
    ...plan.clear.map((c) => (
      <span key={`clear-${c.supplier}-${c.key}`}>
        <bdi dir="ltr">
          {SUPPLIER_NAME[c.supplier] ?? c.supplier} · {c.category}
        </bdi>
        : {LEARN_CLEARED}
      </span>
    )),
    ...plan.set.map((c) => (
      <span key={`set-${c.supplier}-${c.key}`}>
        <bdi dir="ltr">
          {SUPPLIER_NAME[c.supplier] ?? c.supplier} · {c.category}
        </bdi>
        : {LEARN_SET} - &quot;<bdi>{c.text}</bdi>&quot;
      </span>
    )),
  ];
}

/** The LiveTickets plan as lines: each category given a zone, then each one deleted. */
function livePlanLines(plan: LiveTicketsPlan): ReactNode[] {
  return [
    ...plan.zones.map((z) => (
      <span key={`zone-${z.key}`}>
        <bdi dir="ltr">{z.category}</bdi>: {LEARN_LIVE_ZONE(z.zoneLabel || z.zoneId)}
      </span>
    )),
    ...plan.removed.map((r) => (
      <span key={`removed-${r.key}`}>
        <bdi dir="ltr">{r.category}</bdi>: {LEARN_LIVE_REMOVED}
      </span>
    )),
  ];
}

const KIND_ORDER: EditKind[] = ["venue", "descriptions", "live_tickets", "event_description", "place"];

/** One kind on one show: "✓ כרטיסים (2)", "✓ כרטיסים (1) · נכתב שם ידנית - נשאר", "— תיאור: אולם אחר". */
function verdictText(kind: EditKind, verdict: ShowVerdict): string {
  const name = LEARN_KIND_SHORT[kind];
  if (!verdict.applies) return `— ${name}: ${verdict.reason ? LEARN_SKIP_TEXT(kind, verdict.reason) : ""}`;
  const count = kind === "descriptions" || kind === "live_tickets" ? ` (${verdict.count})` : "";
  return `✓ ${name}${count}${verdict.reason ? ` · ${LEARN_SKIP_TEXT(kind, verdict.reason)}` : ""}`;
}

/** Every other show of the run with what the ticked kinds do there, and why not. */
function ShowList({ shows, active }: { shows: LearnShowRow[]; active: Set<EditKind> }) {
  const rows = shows.flatMap((show) => {
    const kinds = KIND_ORDER.filter((kind) => active.has(kind) && show.verdicts[kind]);
    return kinds.length > 0 ? [{ show, kinds }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[13px] font-semibold">{LEARN_SHOWS_TITLE}</p>
      <ul className="scrollbar-rail max-h-48 divide-y overflow-y-auto rounded-md border text-xs">
        {rows.map(({ show, kinds }) => (
          <li key={show.itemId} className="space-y-0.5 px-3 py-1.5">
            <p className="font-medium">
              <bdi dir="ltr">{showDate(show.date)}</bdi> · <bdi dir="ltr">{show.venue || show.city}</bdi>
            </p>
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {kinds.map((kind) => {
                const verdict = show.verdicts[kind] as ShowVerdict;
                return (
                  <li key={kind} className={verdict.applies ? "text-success" : "text-muted-foreground"}>
                    {verdictText(kind, verdict)}
                  </li>
                );
              })}
            </ul>
            {active.has("live_tickets") && show.verdicts.live_tickets?.applies === true && show.unzoned.length > 0 && (
              <p className="text-warning">
                {LEARN_UNZONED} <bdi dir="ltr">{show.unzoned.join(", ")}</bdi>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LearnConfirm({
  itemId,
  open,
  onClose,
  onDone,
}: {
  /** The item whose event was changed by hand; null while closed. */
  itemId: string | null;
  open: boolean;
  onClose: () => void;
  /** After a saved "החל" (its toast already shown): the board closes the dialog and reads the run again. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [venueOn, setVenueOn] = useState(true);
  const [descriptionsOn, setDescriptionsOn] = useState(true);
  const [liveTicketsOn, setLiveTicketsOn] = useState(true);
  const [eventDescriptionOn, setEventDescriptionOn] = useState(true);
  const [placeOn, setPlaceOn] = useState(true);
  const [note, setNote] = useState("");
  const seq = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const target = open ? itemId : null;
  // A (re)opening starts on the wait, every kind ticked and no note, in the same render - never a frame of the previous
  // event's summary. Closing keeps the summary, so the dialog closes with what it showed.
  const [requested, setRequested] = useState<string | null>(null);
  if (target !== requested) {
    setRequested(target);
    if (target !== null) {
      setPhase({ kind: "loading" });
      setVenueOn(true);
      setDescriptionsOn(true);
      setLiveTicketsOn(true);
      setEventDescriptionOn(true);
      setPlaceOn(true);
      setNote("");
    }
  }

  useEffect(() => {
    if (target === null) return;
    const id = ++seq.current;
    const fail = (description: ReactNode) => {
      toast({ variant: "destructive", title: LEARN_OPEN_FAILED, description: rtl(description) });
      closeRef.current();
    };
    learnPreview(target)
      .then((r) => {
        if (id !== seq.current) return;
        if (!r.ok) return fail(actionErrorText(r.kind));
        setPhase({ kind: "ready", data: r });
      })
      .catch(() => {
        if (id === seq.current) fail(NETWORK_TEXT);
      });
    return () => {
      seq.current += 1;
    };
  }, [target, toast]);

  const data = phase.kind === "ready" ? phase.data : null;
  const venue = data?.venue ?? null;
  const descriptions = data?.descriptions ?? null;
  const applyVenue = venueOn && venue?.ok === true;
  const applyDescriptions = descriptionsOn && descriptions !== null;
  const liveTickets = data?.liveTickets ?? null;
  const eventDescription = data?.eventDescription ?? null;
  const place = data?.place ?? null;
  // A kind no show would take stays unticked and pending: applying it would read as if it went somewhere. Its reasons still show.
  const someShowTakes = (kind: EditKind): boolean => (data?.shows ?? []).some((show) => show.verdicts[kind]?.applies === true || show.verdicts[kind]?.reason === "already");
  const eventDescriptionFits = someShowTakes("event_description");
  const placeFits = someShowTakes("place");
  // no other show holds it, but the hall keeps a deleted category for the next run: that still goes somewhere
  const liveTicketsFits = someShowTakes("live_tickets") || (liveTickets?.remembers === true && liveTickets.plan.removed.length > 0);
  const applyLiveTickets = liveTicketsOn && liveTickets !== null && liveTicketsFits;
  const applyEventDescription = eventDescriptionOn && eventDescription !== null && eventDescriptionFits;
  const applyPlace = placeOn && place !== null && placeFits;
  const shown = new Set<EditKind>([
    ...(applyVenue ? (["venue"] as const) : []),
    ...(applyDescriptions ? (["descriptions"] as const) : []),
    ...(liveTicketsOn && liveTickets !== null ? (["live_tickets"] as const) : []),
    ...(eventDescriptionOn && eventDescription !== null ? (["event_description"] as const) : []),
    ...(placeOn && place !== null ? (["place"] as const) : []),
  ]);
  const anotherWording = eventDescription !== null && (data?.shows ?? []).some((show) => show.verdicts.event_description?.reason === "different");
  const trimmed = note.trim();
  const noteOk = trimmed === "" || (trimmed.length >= LEARN_NOTE_MIN && trimmed.length <= LEARN_NOTE_MAX);
  const canApply = data !== null && noteOk && (applyVenue || applyDescriptions || applyLiveTickets || applyEventDescription || applyPlace || trimmed !== "");

  async function apply() {
    if (!canApply || target === null || saving) return;
    setSaving(true);
    try {
      const r = await learnFromEvent(target, {
        venue: applyVenue,
        descriptions: applyDescriptions,
        liveTickets: applyLiveTickets,
        eventDescription: applyEventDescription,
        place: applyPlace,
        note: trimmed === "" ? null : trimmed,
      });
      if (!r.ok) {
        // refused before anything was written
        toast({
          variant: "destructive",
          title: LEARN_FAILED,
          description: rtl(
            <>
              <p>{actionErrorText(r.kind)}</p>
              {r.message && (
                <p dir="ltr" className="mt-1 text-xs opacity-80">
                  {r.message}
                </p>
              )}
            </>,
          ),
        });
        return;
      }
      // Each part reports on its own (one part's failure never hides what the others saved), and the board always
      // reads the run again - a part that did not finish stays pending on the card, so "החל" again finishes it.
      const titles: string[] = [];
      const lines: string[] = [];
      if (r.venue?.ok) {
        titles.push(CLASSIFY_DONE(r.venue, false));
        if (r.venue.reached < r.venue.total) lines.push(PARTIAL_LEARN_LINE(r.venue.total - r.venue.reached));
      } else if (r.venue) {
        lines.push(`${LEARN_VENUE_PART_FAILED}: ${actionErrorText(r.venue.kind)}${r.venue.message ? ` (${r.venue.message})` : ""}`);
      }
      if (r.descriptions) {
        titles.push(LEARN_DESC_DONE(r.descriptions.tickets, r.descriptions.events));
        if (r.descriptions.cut > 0) lines.push(LEARN_DESC_PARTIAL(r.descriptions.cut));
        if (r.descriptions.failed > 0) lines.push(LEARN_DESC_FAILED(r.descriptions.failed));
      }
      if (r.liveTickets) {
        if (r.liveTickets.events > 0) {
          titles.push(LEARN_LIVE_DONE(r.liveTickets.events));
          lines.push(LEARN_LIVE_COUNTS(r.liveTickets.zoned, r.liveTickets.removed));
        }
        if (r.liveTickets.remembered === "saved") lines.push(LEARN_LIVE_REMEMBERED);
        if (r.liveTickets.remembered === "failed") lines.push(LEARN_LIVE_NOT_REMEMBERED);
        if (r.liveTickets.cut > 0) lines.push(LEARN_LIVE_PARTIAL(r.liveTickets.cut));
        if (r.liveTickets.failed > 0) lines.push(LEARN_DESC_FAILED(r.liveTickets.failed));
      }
      if (r.fields) {
        if (r.fields.events > 0) titles.push(LEARN_FIELDS_DONE(r.fields.events, applyEventDescription, applyPlace));
        if (r.fields.cut > 0) lines.push(LEARN_FIELDS_PARTIAL(r.fields.cut));
        if (r.fields.failed > 0) lines.push(LEARN_DESC_FAILED(r.fields.failed));
      }
      if (r.note === "saved") lines.push(LEARN_NOTE_SAVED);
      if (r.note === "failed") lines.push(LEARN_NOTE_FAILED);
      const liveTicketsFailed = (r.liveTickets?.failed ?? 0) > 0 || r.liveTickets?.remembered === "failed";
      const anyFailed = (r.fields?.failed ?? 0) > 0 || (r.descriptions?.failed ?? 0) > 0 || liveTicketsFailed;
      toast({
        title: titles.length > 0 ? titles.join(" · ") : anyFailed ? LEARN_FAILED : LEARN_SAVED_NOTHING,
        description: lines.length > 0 ? rtl(lines.map((line) => <p key={line}>{line}</p>)) : undefined,
        ...(r.note === "failed" || anyFailed || (r.venue !== null && !r.venue.ok) ? { variant: "destructive" as const } : {}),
      });
      await onDone();
    } catch {
      toast({ variant: "destructive", title: LEARN_FAILED, description: rtl(NETWORK_TEXT) });
    } finally {
      setSaving(false);
    }
  }

  const lines = descriptions ? planLines(descriptions.plan) : [];
  const liveLines = liveTickets ? livePlanLines(liveTickets.plan) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent dir="rtl" className="scrollbar-rail max-h-[90svh] max-w-lg overflow-y-auto [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{LEARN_TITLE}</DialogTitle>
          <DialogDescription>{LEARN_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        {phase.kind === "loading" || !data ? (
          <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {LEARN_READING}
          </p>
        ) : (
          <div className="space-y-3">
            {venue === null && descriptions === null && liveTickets === null && eventDescription === null && place === null && <p className="rounded-md border bg-muted/40 px-3 py-2.5 text-[13px]">{LEARN_NOTHING}</p>}

            {venue !== null && (
              <div className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
                <Checkbox
                  id="learn-venue"
                  checked={applyVenue}
                  disabled={!venue.ok || saving}
                  onCheckedChange={(v) => setVenueOn(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-relaxed">
                  <Label htmlFor="learn-venue" className="flex items-center gap-1.5 font-semibold">
                    <GraduationCap aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {LEARN_KIND_VENUE}
                  </Label>
                  {venue.ok ? (
                    <p>
                      {LEARN_ZONES(venue.learned.zones, venue.learned.newZones)}
                      {" · "}
                      {LEARN_DROPPED(venue.learned.dropped.length)}
                      {venue.learned.dropped.length > 0 && (
                        <>
                          {" ("}
                          <bdi dir="ltr">{venue.learned.dropped.join(", ")}</bdi>
                          {")"}
                        </>
                      )}
                      {" · "}
                      {LEARN_DESCRIPTIONS(venue.learned.descriptions)}
                      {" · "}
                      {LEARN_SECTIONS(venue.learned.sections)}
                      {" · "}
                      <span className="font-medium">{LEARN_SIBLINGS(venue.siblings)}</span>
                    </p>
                  ) : (
                    <p className="text-warning">
                      {actionErrorText(venue.kind)}. {LEARN_VENUE_UNAVAILABLE}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{LEARN_KIND_VENUE_HINT}</p>
                </div>
              </div>
            )}

            {descriptions !== null && (
              <div className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
                <Checkbox
                  id="learn-descriptions"
                  checked={applyDescriptions}
                  disabled={saving}
                  onCheckedChange={(v) => setDescriptionsOn(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-relaxed">
                  <Label htmlFor="learn-descriptions" className="flex items-center gap-1.5 font-semibold">
                    <Ticket aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {LEARN_KIND_DESCRIPTIONS}
                  </Label>
                  <ul className="space-y-0.5">
                    {lines.slice(0, PLAN_LINES_MAX).map((line, i) => (
                      <li key={i} className="break-words">
                        {line}
                      </li>
                    ))}
                    {lines.length > PLAN_LINES_MAX && <li className="text-muted-foreground">{LEARN_MORE(lines.length - PLAN_LINES_MAX)}</li>}
                  </ul>
                  <p className="font-medium">{LEARN_DESC_REACH(descriptions.tickets, descriptions.events)}</p>
                  <p className="text-xs text-muted-foreground">{LEARN_KIND_DESCRIPTIONS_HINT}</p>
                </div>
              </div>
            )}

            {liveTickets !== null && (
              <div className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
                <Checkbox
                  id="learn-live-tickets"
                  checked={applyLiveTickets}
                  disabled={saving || !liveTicketsFits}
                  onCheckedChange={(v) => setLiveTicketsOn(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-relaxed">
                  <Label htmlFor="learn-live-tickets" className="flex items-center gap-1.5 font-semibold">
                    <Ticket aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {LEARN_KIND_LIVE_TICKETS}
                  </Label>
                  <ul className="space-y-0.5">
                    {liveLines.slice(0, PLAN_LINES_MAX).map((line, i) => (
                      <li key={i} className="break-words">
                        {line}
                      </li>
                    ))}
                    {liveLines.length > PLAN_LINES_MAX && <li className="text-muted-foreground">{LEARN_MORE(liveLines.length - PLAN_LINES_MAX)}</li>}
                  </ul>
                  <p className="font-medium">{LEARN_LIVE_REACH(liveTickets.tickets, liveTickets.events)}</p>
                  {liveTickets.remembers && liveTickets.plan.removed.length > 0 && <p className="text-xs">{LEARN_LIVE_REMEMBERS}</p>}
                  <p className="text-xs text-muted-foreground">{LEARN_KIND_LIVE_TICKETS_HINT}</p>
                </div>
              </div>
            )}

            {eventDescription !== null && (
              <div className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
                <Checkbox
                  id="learn-event-description"
                  checked={applyEventDescription}
                  disabled={saving || !eventDescriptionFits}
                  onCheckedChange={(v) => setEventDescriptionOn(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-relaxed">
                  <Label htmlFor="learn-event-description" className="flex items-center gap-1.5 font-semibold">
                    <TextQuote aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {LEARN_KIND_EVENT_DESCRIPTION}
                  </Label>
                  <p className="break-words">
                    <bdi>{eventDescription.to}</bdi>
                  </p>
                  <p className="font-medium">{LEARN_REACH_EVENTS(eventDescription.events)}</p>
                  <p className="text-xs text-muted-foreground">{LEARN_KIND_EVENT_DESCRIPTION_HINT}</p>
                  {anotherWording && <p className="text-xs text-muted-foreground">{LEARN_TEMPLATE_HINT}</p>}
                </div>
              </div>
            )}

            {place !== null && (
              <div className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
                <Checkbox id="learn-place" checked={applyPlace} disabled={saving || !placeFits} onCheckedChange={(v) => setPlaceOn(v === true)} className="mt-0.5" />
                <div className="min-w-0 flex-1 space-y-1 text-[13px] leading-relaxed">
                  <Label htmlFor="learn-place" className="flex items-center gap-1.5 font-semibold">
                    <MapPin aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {LEARN_KIND_PLACE}
                  </Label>
                  <p className="break-words">
                    {place.fields.map((field) => PLACE_FIELD_LABEL[field]).join(" · ")}
                    {place.fields.includes("location") && place.to && (
                      <>
                        {": "}
                        <bdi>{place.to}</bdi>
                      </>
                    )}
                  </p>
                  <p className="font-medium">{LEARN_REACH_EVENTS(place.events)}</p>
                  <p className="text-xs text-muted-foreground">{LEARN_KIND_PLACE_HINT}</p>
                </div>
              </div>
            )}

            <ShowList shows={data.shows} active={shown} />

            {data.notCarried.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">{LEARN_NOT_CARRIED_TITLE}</p>
                <ul className="list-inside list-disc">
                  {data.notCarried.map((key) => (
                    <li key={key}>{LEARN_NOT_CARRIED[key]}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="learn-note" className="flex items-center gap-1.5 text-[13px] font-semibold">
                <MessageSquareText aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                {LEARN_NOTE_LABEL}
              </Label>
              <Textarea
                id="learn-note"
                value={note}
                maxLength={LEARN_NOTE_MAX}
                disabled={saving}
                onChange={(e) => setNote(e.target.value)}
                placeholder={LEARN_NOTE_PLACEHOLDER}
                aria-describedby="learn-note-hint"
                className="min-h-16 text-[13px]"
              />
              <p id="learn-note-hint" className="text-xs text-muted-foreground">
                {LEARN_NOTE_HINT}
              </p>
            </div>

          </div>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {BTN_CANCEL}
          </Button>
          <Button type="button" disabled={!canApply || saving} onClick={() => void apply()}>
            {saving && <Loader2 aria-hidden className="animate-spin" />}
            {BTN_LEARN_CONFIRM}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
