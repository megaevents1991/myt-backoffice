"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Mail,
  MapPinned,
  MessageCircle,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  TriangleAlert,
  Undo2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useConfirm } from "@/components/confirm-provider";
import { useToast } from "@/hooks/use-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtDate, fmtInstant, fmtPrice, todayIso } from "@/lib/tours/format";
import { listLinkDepartures, markOfferSent, prepareOffer, quoteLink, restoreOffer, withdrawOffer } from "@/lib/actions/tours-cases-actions";
import {
  LINK_ROOMS_MAX,
  OFFERS_MAX,
  OFFER_CHANNEL_LABELS,
  linkMessage,
  liveOffers,
  offerSent,
  offersMessage,
  otherTour,
  waLink,
  whatsappAppLink,
  type CaseOffer,
  type LinkDeparture,
  type LinkQuote,
  type OfferChannel,
} from "@/lib/tours/cases";
import { Ltr, Notice, Section } from "@/components/tours/ui";

/** A day `n` days from today, as YYYY-MM-DD (the date box's value). */
function inDays(n: number): string {
  const [y, m, d] = todayIso().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// "Today" too (Alon 10.11): an offer the rep will chase this very afternoon
const QUICK_DAYS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In a week", days: 7 },
];
const QUOTE_DELAY_MS = 350;
/** The rep stops counting rooms for this long before the PDF is printed. */
const PDF_DELAY_MS = 1200;

const roomsOf = (counts: Record<string, number>, d: LinkDeparture | undefined) =>
  d ? d.rooms.flatMap((r) => Array<string>(counts[r.key] ?? 0).fill(r.key)) : [];
const countsOf = (rooms: readonly string[]) => rooms.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

export interface SendProps {
  /** What goes out: one offer's message, or the card's offers in one (offersMessage). */
  message: string;
  /** What "Copy link" copies - the link(s) alone. */
  copyText: string;
  /** The mail's subject. */
  subject?: string;
  phone: string | null;
  email: string | null;
  busy: boolean;
  onSent: (via: OfferChannel) => void;
}

/** The ways to send a message. A click on WhatsApp or e-mail records it as sent (markOfferSent) - copying does not. */
export function SendButtons({ message, copyText, subject = "קישור להזמנה", phone, email, busy, onSent }: SendProps) {
  const { toast } = useToast();
  const app = whatsappAppLink(phone, message);
  const web = waLink(phone, message);
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      toast({ title: "Link copied", description: "Copying does not count as sending - send it on WhatsApp or by e-mail." });
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Select the link and copy it by hand." });
    }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {app ? (
          <Button size="sm" asChild disabled={busy}>
            {/* the rep's WhatsApp app, on this chat, the message typed in - no browser tab */}
            <a href={app} onClick={() => onSent("whatsapp")} title="Opens WhatsApp on this computer">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
          </Button>
        ) : (
          <Button size="sm" disabled>
            <MessageCircle className="h-4 w-4" />
            No phone
          </Button>
        )}
        {mailto ? (
          <Button size="sm" variant="outline" asChild disabled={busy}>
            <a href={mailto} onClick={() => onSent("email")}>
              <Mail className="h-4 w-4" />
              E-mail
            </a>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            <Mail className="h-4 w-4" />
            No e-mail
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {web && (
          <a
            href={web}
            target="_blank"
            rel="noreferrer"
            onClick={() => onSent("whatsapp")}
            className="inline-flex min-h-6 items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            WhatsApp Web
          </a>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-6 items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Copy className="h-3 w-3" />
          Copy link
        </button>
      </div>
    </div>
  );
}

function SendAgain(props: SendProps) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={props.busy}>
        <Send className="h-4 w-4" />
        Send again
      </Button>
    );
  }
  return (
    <div className="w-full">
      <SendButtons {...props} />
    </div>
  );
}

/** "Another tour than the card's" (Alon 10.11: "תזכורת אם המסלול שונה") - on the offer, wherever the card shows it. */
function OtherTourNote({ offerTour, cardTour }: { offerTour: string | null; cardTour: string | null | undefined }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-warning-muted px-2 py-1 text-xs font-medium text-warning">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span dir="auto">
        Another tour than the card&apos;s{cardTour ? ` (${cardTour})` : ""}: this offer is {offerTour ?? "another tour"}.
      </span>
    </p>
  );
}

export interface OfferSummaryProps {
  offer: CaseOffer;
  /** "Option 2" when the card holds more than one. */
  label?: string;
  /** The card's own tour - an offer of another one says so. */
  cardPackageId?: string | null;
  cardTourName?: string | null;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  busy: boolean;
  onSent: (via: OfferChannel) => void;
  onEdit?: () => void;
  onWithdraw: () => void;
  /** A cancelled offer back on the card (its booking fell through). */
  onRestore?: () => void;
}

/** The state of an offer, in a word and a colour. */
function OfferState({ offer }: { offer: CaseOffer }) {
  const [text, tone] = offer.bookingRef
    ? [`Booked · ${offer.bookingRef}`, "bg-success-muted text-success"]
    : offer.cancelledAt
      ? ["Cancelled", "bg-muted text-muted-foreground"]
      : offerSent(offer)
        ? ["Sent", "bg-info-muted text-info"]
        : ["Not sent", "bg-warning-muted text-warning"];
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>{text}</span>;
}

/** One offer on the case: what was prepared, whether and how it was sent - with Send / Edit and resend / Withdraw. */
export function OfferSummary(props: OfferSummaryProps) {
  const { offer, label, cardPackageId, cardTourName, phone, email, firstName, busy, onSent, onEdit, onWithdraw, onRestore } = props;
  const sent = offerSent(offer);
  const dead = !!offer.cancelledAt && !offer.bookingRef;
  const send: SendProps = {
    message: linkMessage(firstName, offer.tourName, offer.url, offer.itineraryUrl),
    copyText: offer.url,
    phone,
    email,
    busy,
    onSent,
  };
  return (
    <div className={cn("space-y-3 rounded-lg border bg-card p-3 shadow-sm", dead && "opacity-70")}>
      <div className="space-y-1 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("min-w-0 font-semibold", dead && "line-through decoration-muted-foreground/60")} dir="auto">
            {label && <span className="me-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>}
            {offer.tourName ?? "Tour"}
          </p>
          <OfferState offer={offer} />
        </div>
        <p className="text-xs text-muted-foreground">
          <Ltr>{offer.departureCode}</Ltr> · {fmtDate(offer.startDate)}
        </p>
        <p className="text-muted-foreground" dir="auto">
          {offer.roomTitles.join(" + ") || offer.rooms.join(", ")}
        </p>
        {offer.total != null && (
          <p className="tabular">
            <span className="text-muted-foreground">On the site: </span>
            <strong>{fmtPrice(offer.total, offer.currency)}</strong>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Follow-up {offer.followUpDate ? fmtDate(offer.followUpDate) : "-"} · prepared {fmtInstant(offer.createdAt)}
        </p>
        {otherTour(offer, cardPackageId) && <OtherTourNote offerTour={offer.tourName} cardTour={cardTourName} />}
        {/* the itinerary goes with the link, on its own line of the message (Alon 10.11) */}
        {offer.itineraryUrl ? (
          <a
            href={offer.itineraryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <FileText className="h-3 w-3" />
            Itinerary PDF (in the message)
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">No itinerary PDF in this offer.</p>
        )}
        {offer.bookingRef && <p className="text-xs font-medium text-success">The customer booked through it: {offer.bookingRef}</p>}
        {dead && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Ban className="h-3.5 w-3.5" />
            Another offer of this card was booked first ({fmtInstant(offer.cancelledAt!)}).
          </p>
        )}
      </div>
      {dead || offer.bookingRef ? null : sent ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" />
          Sent on {OFFER_CHANNEL_LABELS[offer.sentVia!]} · {fmtInstant(offer.sentAt!)}
        </p>
      ) : (
        <>
          <Notice tone="warning" className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Not sent yet - send it on WhatsApp or by e-mail. Until then the case is not &quot;Offer sent&quot;.</span>
          </Notice>
          <SendButtons {...send} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {sent && !dead && !offer.bookingRef && <SendAgain {...send} />}
        {dead && onRestore && (
          <Button size="sm" variant="outline" onClick={onRestore} disabled={busy} title="The booking that cancelled it fell through: put the offer back on the card">
            <RotateCcw className="h-4 w-4" />
            Restore
          </Button>
        )}
        {onEdit && !dead && !offer.bookingRef && (
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <Pencil className="h-4 w-4" />
            Edit and resend
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onWithdraw} disabled={busy}>
          <Undo2 className="h-4 w-4" />
          {dead ? "Remove" : "Withdraw"}
        </Button>
      </div>
    </div>
  );
}

export interface OffersListProps {
  offers: CaseOffer[];
  cardPackageId?: string | null;
  cardTourName?: string | null;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  busy: boolean;
  /** `ids` = the offers that went out. */
  onSent: (via: OfferChannel, ids: string[]) => void;
  onEdit?: (offer: CaseOffer) => void;
  onWithdraw: (offer: CaseOffer) => void;
  onRestore?: (offer: CaseOffer) => void;
  /** Another option on the card - shown while it holds fewer than OFFERS_MAX and none was booked. */
  onAdd?: () => void;
}

/**
 * Every offer of the card (Alon 10.11: "לקוח מבקש שלושה מסלולים... הלינק הראשון שנרשם מבטל את האחרים אוטומטית"): each
 * with its own sending, the ones not sent yet in ONE message as well, and a way to add another option. Shared with the
 * folded card's popover and the board row's dialog (card-quick-actions.tsx).
 */
export function OffersList({ offers, cardPackageId, cardTourName, phone, email, firstName, busy, onSent, onEdit, onWithdraw, onRestore, onAdd }: OffersListProps) {
  const standing = liveOffers(offers);
  const booked = offers.some((o) => o.bookingRef);
  const unsent = standing.filter((o) => !offerSent(o) && !o.bookingRef);
  const many = offers.length > 1;
  return (
    <div className="space-y-3">
      {many && !booked && (
        <p className="text-xs text-muted-foreground">
          {standing.length} offers on this card, one link - the first the customer books cancels the others by itself.
        </p>
      )}
      {offers.map((offer, i) => (
        <OfferSummary
          key={offer.id}
          offer={offer}
          label={many ? `Option ${i + 1}` : undefined}
          cardPackageId={cardPackageId}
          cardTourName={cardTourName}
          phone={phone}
          email={email}
          firstName={firstName}
          busy={busy}
          onSent={(via) => onSent(via, [offer.id])}
          onEdit={onEdit ? () => onEdit(offer) : undefined}
          onWithdraw={() => onWithdraw(offer)}
          onRestore={onRestore ? () => onRestore(offer) : undefined}
        />
      ))}
      {unsent.length > 1 && !booked && (
        <div className="space-y-2 rounded-lg border border-info/30 bg-info-muted/60 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Send className="h-4 w-4 text-info" />
            Send the {unsent.length} together - one message, every link
          </p>
          <SendButtons
            message={offersMessage(firstName, unsent)}
            copyText={unsent.map((o) => o.url).join("\n")}
            subject="הצעות להזמנה"
            phone={phone}
            email={email}
            busy={busy}
            onSent={(via) => onSent(
              via,
              unsent.map((o) => o.id),
            )}
          />
        </div>
      )}
      {onAdd && !booked && standing.length < OFFERS_MAX && (
        <Button size="sm" variant="outline" className="w-full border-dashed" onClick={onAdd} disabled={busy}>
          <Plus className="h-4 w-4" />
          Add another option ({standing.length}/{OFFERS_MAX})
        </Button>
      )}
    </div>
  );
}

/** A numbered step of the builder - the order the rep works in (Alon 10.11: the window read as one grey block). */
function Step({ n, title, aside, children }: { n: number; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-forest text-xs font-bold text-brand-mint" aria-hidden>
          {n}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <span className="ms-auto text-xs text-muted-foreground">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * "Booking link" on the case page - an OFFER (Alon 18.10). Pick a priced date (searchable by tour, code or
 * date), the customer's rooms - each with the site's price and the total, discounts included - and the day
 * to follow up; "Prepare offer" keeps it on the case, and it counts as sent only through WhatsApp or e-mail,
 * which moves the case to "Offer sent". The offer stays visible with Edit and resend / Withdraw. Nothing
 * loads until the builder opens. A board row opens it in a window (`bare`, `startBuilding` - Alon 29.10: the booking
 * link was the one field a row could not finish).
 *
 * Alon 10.11: a card holds up to OFFERS_MAX offers that share its link (the first booked cancels the others - the
 * database does it), an offer of another tour than the card's says so, and the builder reads as steps - tour and
 * date, rooms with their prices in a column of their own, the total on a dark band, the follow-up.
 */
export function BookingLinkCard({
  caseId,
  defaultDepartureId,
  hasSite,
  whatsappApi,
  offers,
  cardPackageId = null,
  cardTourName = null,
  phone,
  email,
  firstName,
  onChanged,
  startBuilding = false,
  startWith,
  bare = false,
}: {
  caseId: string;
  defaultDepartureId: string | null;
  hasSite: boolean;
  /** The company's own WhatsApp number is connected (Cloud API): the offer can go out from it. */
  whatsappApi: boolean;
  offers: CaseOffer[];
  /** The card's own tour: an offer of another one is flagged, in the builder and on the offer. */
  cardPackageId?: string | null;
  cardTourName?: string | null;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  onChanged: () => void;
  /** Open straight into the builder (a board row's window). */
  startBuilding?: boolean;
  /** Which offer the window opens on: an offer's id, "new" for another option; none = the card's offer, else a new one. */
  startWith?: string;
  /** No section chrome: the window around it already says what it is. */
  bare?: boolean;
}) {
  const run = useActionToast();
  const confirm = useConfirm();
  /** null = the offers as they stand; "new" = another option; an offer's id = rewriting it. */
  const [editing, setEditing] = useState<string | null>(null);
  const building = editing !== null;
  const [departures, setDepartures] = useState<LinkDeparture[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [departureId, setDepartureId] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [followUp, setFollowUp] = useState("");
  const [quote, setQuote] = useState<LinkQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const quoteSeq = useRef(0);
  // the itinerary PDF of the date + rooms on screen, printed while the rep still picks (Alon 10.11)
  const [pdf, setPdf] = useState<{ key: string; state: "printing" | "ready" | "failed"; url?: string; error?: string } | null>(null);
  const pdfJobs = useRef(new Map<string, Promise<void>>());

  const chosen = useMemo(() => departures?.find((d) => d.id === departureId), [departures, departureId]);
  const rooms = roomsOf(counts, chosen);
  const roomsKey = rooms.join(",");
  const total = rooms.length;
  const today = todayIso();
  const followUpOk = /^\d{4}-\d{2}-\d{2}$/.test(followUp) && followUp >= today;
  const ready = !!chosen && total > 0 && followUpOk;
  const standing = liveOffers(offers);

  // the site's own price for the choice, as the rep changes it
  useEffect(() => {
    if (!chosen || roomsKey === "") {
      setQuote(null);
      setQuoting(false);
      return;
    }
    const mine = ++quoteSeq.current;
    setQuoting(true);
    const timer = setTimeout(async () => {
      const answer = await quoteLink({ departureId: chosen.id, rooms: roomsKey.split(",") });
      if (mine !== quoteSeq.current) return;
      setQuoting(false);
      setQuote(answer.success ? answer.data : null);
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [chosen, roomsKey]);

  const pdfKey = chosen && roomsKey ? `${chosen.id}|${[...rooms].sort().join(",")}` : "";
  // a route, not an action: a print must not hold the room quotes (actions of one tab run one at a time)
  const printPdf = useCallback((departureId: string, key: string, picked: string[]) => {
    const running = pdfJobs.current.get(key);
    if (running) return running;
    const job = (async () => {
      setPdf((current) => (current?.key === key && current.state === "ready" ? current : { key, state: "printing" }));
      try {
        const answer = await fetch("/api/tours/itinerary-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ departureId, rooms: picked }),
        });
        const body = (await answer.json().catch(() => ({}))) as { url?: string; error?: string };
        setPdf((current) =>
          current?.key !== key ? current : body.url ? { key, state: "ready", url: body.url } : { key, state: "failed", error: body.error ?? "The PDF could not be made." },
        );
      } catch {
        setPdf((current) => (current?.key !== key ? current : { key, state: "failed", error: "The PDF could not be made." }));
      } finally {
        pdfJobs.current.delete(key);
      }
    })();
    pdfJobs.current.set(key, job);
    return job;
  }, []);
  useEffect(() => {
    if (!building || !chosen || !pdfKey) {
      setPdf(null);
      return;
    }
    const picked = roomsKey.split(",");
    // the rep is still counting rooms: print once they pause
    const timer = setTimeout(() => void printPdf(chosen.id, pdfKey, picked), PDF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [building, chosen, pdfKey, roomsKey, printPdf]);

  /** Opens the builder: on an offer to rewrite it, or empty for another option. */
  const open = async (from: CaseOffer | null) => {
    setEditing(from ? from.id : "new");
    setLoading(true);
    const answer = await run(() => listLinkDepartures());
    setLoading(false);
    if (!answer.success) {
      setEditing(null);
      return;
    }
    setDepartures(answer.data);
    // the first offer starts on the card's own date; another option starts on the picker (it is usually another tour)
    const startId = from?.departureId ?? (standing.length ? null : defaultDepartureId);
    const start = answer.data.find((d) => d.id === startId) ?? null;
    setDepartureId(start?.id ?? "");
    if (from && start) setCounts(countsOf(from.rooms.filter((k) => start.rooms.some((r) => r.key === k))));
    else setCounts(start?.rooms.some((r) => r.key === "double_room") ? { double_room: 1 } : {});
    setFollowUp(from?.followUpDate && from.followUpDate >= today ? from.followUpDate : "");
    if (!start && answer.data.length) setPickerOpen(true);
  };

  // once, when the window opens - a later render (the fresh offer after a save) must not reopen the builder
  const started = useRef(false);
  useEffect(() => {
    if (!startBuilding || started.current || !hasSite) return;
    started.current = true;
    // "new" = another option; an offer's id = rewrite it; none = the card's offers as they stand, or a first one
    if (startWith === "new" || (!startWith && offers.length === 0)) {
      void open(null);
      return;
    }
    const from = offers.find((o) => o.id === startWith);
    if (from && !from.cancelledAt && !from.bookingRef) void open(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);

  const bump = (key: string, by: 1 | -1) =>
    setCounts((current) => {
      if (by > 0 && total >= LINK_ROOMS_MAX) return current;
      return { ...current, [key]: Math.max(0, (current[key] ?? 0) + by) };
    });

  const prepare = async (sendWhatsApp: boolean) => {
    if (!chosen || !ready) return;
    setBusy(true);
    // the offer only LOOKS the PDF up (no Chromium inside an action): a print still running for this choice lands
    // first, and a choice the timer has not printed yet is printed now, through the route (review 10.11)
    const printed = pdf?.key === pdfKey && pdf.state === "ready";
    const job = pdfJobs.current.get(pdfKey) ?? (printed || !pdfKey ? undefined : printPdf(chosen.id, pdfKey, roomsKey.split(",")));
    if (job) await job;
    const answer = await run(
      () => prepareOffer(caseId, { departureId: chosen.id, rooms, followUpDate: followUp, sendWhatsApp, offerId: editing === "new" ? null : editing }),
      sendWhatsApp ? "Offer sent" : "Offer ready - now send it",
    );
    setBusy(false);
    if (!answer.success) return;
    setEditing(null);
    onChanged();
  };

  // the link itself opens WhatsApp / the mail app; this records that it went out
  const sent = (via: OfferChannel, ids: string[]) => {
    void (async () => {
      setBusy(true);
      const answer = await run(() => markOfferSent(caseId, via, ids), 'Recorded as sent - the case is "Offer sent"');
      setBusy(false);
      if (answer.success) onChanged();
    })();
  };

  const withdraw = async (offer: CaseOffer) => {
    const others = offers.length > 1;
    const agreed = await confirm({
      title: offer.cancelledAt ? "Remove the cancelled offer?" : "Withdraw the offer?",
      description: others
        ? "It leaves the card. The other offers stay, with the same link."
        : "It leaves the case, and its link no longer lands bookings here (a booking through it is matched by phone like any other). The status stays as it is.",
      confirmLabel: offer.cancelledAt ? "Remove" : "Withdraw",
      destructive: true,
    });
    if (!agreed) return;
    setBusy(true);
    const answer = await run(() => withdrawOffer(caseId, offer.id), offer.cancelledAt ? "Offer removed" : "Offer withdrawn");
    setBusy(false);
    if (answer.success) onChanged();
  };

  const restore = async (offer: CaseOffer) => {
    setBusy(true);
    const answer = await run(() => restoreOffer(caseId, offer.id), "Offer restored");
    setBusy(false);
    if (answer.success) onChanged();
  };

  const priceOf = (key: string) => quote?.lines.find((l) => l.key === key);
  const otherTourChosen = !!chosen && otherTour({ packageId: chosen.packageId }, cardPackageId);

  const body = (
    <>
      {!hasSite ? (
        <p className="text-sm text-muted-foreground">The company has no site address yet - set it in the company settings.</p>
      ) : !building ? (
        offers.length ? (
          <OffersList
            offers={offers}
            cardPackageId={cardPackageId}
            cardTourName={cardTourName}
            phone={phone}
            email={email}
            firstName={firstName}
            busy={busy}
            onSent={sent}
            onEdit={(offer) => void open(offer)}
            onWithdraw={(offer) => void withdraw(offer)}
            onRestore={(offer) => void restore(offer)}
            onAdd={() => void open(null)}
          />
        ) : (
          <Button variant="outline" className="w-full" onClick={() => void open(null)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Build an offer
          </Button>
        )
      ) : loading || departures === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the open dates…
        </p>
      ) : departures.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">No priced date is open on the site right now.</p>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {editing === "new" && standing.length > 0 && (
            <p className="rounded-md bg-info-muted px-3 py-2 text-xs text-info">
              Option {standing.length + 1} of this card - it goes out with the same link as the others, and the first one booked cancels the rest.
            </p>
          )}

          <Step n={1} title="Tour and date">
            {/* `modal`: in the board's window the list would otherwise swallow the mouse wheel (the dialog locks scroll) */}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen} modal>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  aria-label="Tour and date"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-start shadow-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    otherTourChosen && "border-warning/50",
                  )}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-info-muted text-info" aria-hidden>
                    <MapPinned className="h-5 w-5" />
                  </span>
                  {chosen ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold" dir="auto">
                        {chosen.tourName}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        <Ltr className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">{chosen.code}</Ltr> · {fmtDate(chosen.startDate)}
                      </span>
                    </span>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">Search a tour or a date</span>
                  )}
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[18rem] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Tour name, code or date…" />
                  <CommandList>
                    <CommandEmpty>No priced date matches.</CommandEmpty>
                    <CommandGroup>
                      {departures.map((d) => (
                        <CommandItem
                          key={d.id}
                          value={`${d.tourName ?? ""} ${d.code} ${fmtDate(d.startDate)} ${d.startDate}`}
                          onSelect={() => {
                            setDepartureId(d.id);
                            setPickerOpen(false);
                            // another date sells other rooms: keep what it sells, else start from its double room
                            setCounts((current) => {
                              const kept = Object.fromEntries(Object.entries(current).filter(([k, n]) => n > 0 && d.rooms.some((r) => r.key === k)));
                              if (Object.keys(kept).length) return kept;
                              return d.rooms.some((r) => r.key === "double_room") ? { double_room: 1 } : {};
                            });
                          }}
                        >
                          <Check className={cn("h-4 w-4 shrink-0", d.id === departureId ? "opacity-100" : "opacity-0")} />
                          <span className="min-w-0 flex-1 truncate" dir="auto">
                            {d.tourName}
                          </span>
                          {cardPackageId && d.packageId === cardPackageId && (
                            <span className="shrink-0 rounded-full bg-success-muted px-1.5 text-[10px] font-semibold text-success">card&apos;s tour</span>
                          )}
                          <span className="shrink-0 text-xs tabular text-muted-foreground">
                            {d.code} · {fmtDate(d.startDate)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {otherTourChosen && <OtherTourNote offerTour={chosen?.tourName ?? null} cardTour={cardTourName} />}
          </Step>

          {chosen && (
            <Step n={2} title="Rooms" aside={total ? `${total} room${total === 1 ? "" : "s"} · up to ${LINK_ROOMS_MAX}` : "Count the customer's rooms"}>
              <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm">
                {chosen.rooms.map((room) => {
                  const n = counts[room.key] ?? 0;
                  const line = priceOf(room.key);
                  const shownPrice = n > 0 && line ? line.price : room.price;
                  const currency = n > 0 && line ? quote?.currency : chosen.currency;
                  return (
                    <li key={room.key} className={cn("flex items-center gap-3 py-2 pe-2 ps-0 transition-colors", n > 0 ? "bg-success-muted/70" : "hover:bg-muted/40")}>
                      <span className={cn("h-9 w-1 shrink-0 rounded-e-full", n > 0 ? "bg-success" : "bg-transparent")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", n > 0 ? "font-semibold" : "font-medium")} dir="auto">
                          {room.title}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">a room</span>
                      </span>
                      {/* every room says what it costs before the rep counts it (Alon 10.11); a chosen one shows the site's quote with its discount */}
                      <span className="w-24 shrink-0 text-end tabular">
                        <span className={cn("block text-sm", n > 0 ? "font-bold" : "font-medium text-foreground/80")}>{fmtPrice(shownPrice, currency)}</span>
                        {n > 0 && line?.discount ? <span className="block text-[11px] font-semibold text-success">−{fmtPrice(line.discount, quote?.currency)}</span> : null}
                      </span>
                      <span className="flex shrink-0 items-center rounded-full border bg-background p-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-full"
                          aria-label={`One ${room.title} less`}
                          disabled={!n}
                          onClick={() => bump(room.key, -1)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span
                          className={cn(
                            "grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-bold tabular",
                            n > 0 ? "bg-success text-success-foreground" : "text-muted-foreground",
                          )}
                        >
                          {n}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-full"
                          aria-label={`One ${room.title} more`}
                          disabled={total >= LINK_ROOMS_MAX}
                          onClick={() => bump(room.key, 1)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {total > 0 && (
                // a fixed forest band in both themes, as the sidebar: the one dark thing in the window is the price
                <div className="flex items-center justify-between gap-3 rounded-lg bg-brand-forest px-4 py-3 text-white" aria-live="polite">
                  <span className="text-sm text-white/75">On the site</span>
                  {quoting && !quote ? (
                    <Loader2 className="h-4 w-4 animate-spin text-white/75" />
                  ) : quote ? (
                    <span className="flex items-baseline gap-2 tabular">
                      {quote.discount > 0 && <span className="text-xs text-white/60 line-through">{fmtPrice(quote.subtotal, quote.currency)}</span>}
                      <strong className="text-xl text-brand-mint">{fmtPrice(quote.total, quote.currency)}</strong>
                    </span>
                  ) : (
                    <span className="text-xs text-white/75">The site cannot price this choice</span>
                  )}
                </div>
              )}
              {quote?.reason && (
                <Notice tone="warning">The site would not take this booking now ({quote.reason.replace(/_/g, " ")}) - check the date&apos;s seats.</Notice>
              )}
              {pdf && pdf.key === pdfKey && (
                <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" aria-live="polite">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  {pdf.state === "printing" ? (
                    <>
                      Preparing the itinerary PDF… <Loader2 className="h-3 w-3 animate-spin" />
                    </>
                  ) : pdf.state === "ready" ? (
                    <>
                      The itinerary PDF goes with the link ·{" "}
                      <a href={pdf.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
                        open it
                      </a>
                    </>
                  ) : (
                    <span>{pdf.error} The offer goes without it.</span>
                  )}
                </p>
              )}
            </Step>
          )}

          {/* the offer's follow-up: required, so no offer goes out without a day to call back */}
          <Step
            n={chosen ? 3 : 2}
            title={
              <label htmlFor="link-follow-up" className="flex items-center gap-1.5">
                Follow up on <span className="text-destructive">*</span>
              </label>
            }
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
              {QUICK_DAYS.map((q) => {
                const day = inDays(q.days);
                return (
                  <button
                    key={q.days}
                    type="button"
                    onClick={() => setFollowUp(day)}
                    aria-pressed={followUp === day}
                    className={cn(
                      "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      followUp === day && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
              <Input id="link-follow-up" type="date" dir="ltr" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="h-8 w-auto tabular" />
            </div>
          </Step>

          <div className="space-y-2 border-t pt-4">
            <div className={cn("grid gap-2", whatsappApi && "sm:grid-cols-2")}>
              <Button className="w-full" variant={whatsappApi ? "outline" : "default"} onClick={() => void prepare(false)} disabled={busy || !ready}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {editing !== "new" ? "Save the offer" : "Prepare offer"}
              </Button>
              {whatsappApi && (
                <Button className="w-full" onClick={() => void prepare(true)} disabled={busy || !ready} title="Sends the offer from the company's WhatsApp number">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send on WhatsApp
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {ready ? 'Next: send it on WhatsApp or by e-mail - the case moves to "Offer sent" when it goes out.' : "Choose a date, rooms and the follow-up day."}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
  if (bare) return <div className="space-y-3">{body}</div>;
  return (
    <Section
      icon={Link2}
      tone="brand"
      title="Booking link"
      description={`An offer: the site opens on the tour with the customer's rooms; the booking lands on this case. Up to ${OFFERS_MAX} on a card.`}
    >
      {body}
    </Section>
  );
}
