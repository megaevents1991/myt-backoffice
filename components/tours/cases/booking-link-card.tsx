"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Minus,
  Pencil,
  Plus,
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
import { listLinkDepartures, markOfferSent, prepareOffer, quoteLink, withdrawOffer } from "@/lib/actions/tours-cases-actions";
import {
  LINK_ROOMS_MAX,
  OFFER_CHANNEL_LABELS,
  linkMessage,
  offerSent,
  waLink,
  whatsappAppLink,
  type CaseOffer,
  type LinkDeparture,
  type LinkQuote,
  type OfferChannel,
} from "@/lib/tours/cases";
import { Notice, Section } from "@/components/tours/ui";

/** A day `n` days from today, as YYYY-MM-DD (the date box's value). */
function inDays(n: number): string {
  const [y, m, d] = todayIso().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const QUICK_DAYS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In a week", days: 7 },
];
const QUOTE_DELAY_MS = 350;

const roomsOf = (counts: Record<string, number>, d: LinkDeparture | undefined) =>
  d ? d.rooms.flatMap((r) => Array<string>(counts[r.key] ?? 0).fill(r.key)) : [];
const countsOf = (rooms: readonly string[]) => rooms.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

interface SendProps {
  offer: CaseOffer;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  busy: boolean;
  onSent: (via: OfferChannel) => void;
}

/** The ways to send an offer. A click on WhatsApp or e-mail records it as sent (markOfferSent) - copying does not. */
function SendButtons({ offer, phone, email, firstName, busy, onSent }: SendProps) {
  const { toast } = useToast();
  const message = linkMessage(firstName, offer.tourName, offer.url);
  const app = whatsappAppLink(phone, message);
  const web = waLink(phone, message);
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent("קישור להזמנה")}&body=${encodeURIComponent(message)}` : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(offer.url);
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

/** The offer on the case: what was prepared, whether and how it was sent - with Send / Edit and resend / Withdraw. */
function OfferSummary(props: SendProps & { onEdit: () => void; onWithdraw: () => void }) {
  const { offer, busy, onEdit, onWithdraw } = props;
  const sent = offerSent(offer);
  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium" dir="auto">
          {offer.tourName ?? "Tour"} ·{" "}
          <span className="tabular">
            {offer.departureCode} · {fmtDate(offer.startDate)}
          </span>
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
        {offer.bookingRef && <p className="text-xs font-medium text-success">The customer booked through it: {offer.bookingRef}</p>}
      </div>
      {sent ? (
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
          <SendButtons {...props} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {sent && <SendAgain {...props} />}
        <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
          <Pencil className="h-4 w-4" />
          Edit and resend
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onWithdraw} disabled={busy}>
          <Undo2 className="h-4 w-4" />
          Withdraw
        </Button>
      </div>
    </div>
  );
}

/**
 * "Booking link" on the case page - an OFFER (Alon 18.10). Pick a priced date (searchable by tour, code or
 * date), the customer's rooms - each with the site's price and the total, discounts included - and the day
 * to follow up; "Prepare offer" keeps it on the case, and it counts as sent only through WhatsApp or e-mail,
 * which moves the case to "Offer sent". The offer stays visible with Edit and resend / Withdraw. Nothing
 * loads until the builder opens.
 */
export function BookingLinkCard({
  caseId,
  defaultDepartureId,
  hasSite,
  whatsappApi,
  offer,
  phone,
  email,
  firstName,
  onChanged,
}: {
  caseId: string;
  defaultDepartureId: string | null;
  hasSite: boolean;
  /** The company's own WhatsApp number is connected (Cloud API): the offer can go out from it. */
  whatsappApi: boolean;
  offer: CaseOffer | null;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  onChanged: () => void;
}) {
  const run = useActionToast();
  const confirm = useConfirm();
  const [building, setBuilding] = useState(false);
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

  const chosen = useMemo(() => departures?.find((d) => d.id === departureId), [departures, departureId]);
  const rooms = roomsOf(counts, chosen);
  const roomsKey = rooms.join(",");
  const total = rooms.length;
  const today = todayIso();
  const followUpOk = /^\d{4}-\d{2}-\d{2}$/.test(followUp) && followUp >= today;
  const ready = !!chosen && total > 0 && followUpOk;

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

  const open = async (from?: CaseOffer | null) => {
    setBuilding(true);
    setLoading(true);
    const answer = await run(() => listLinkDepartures());
    setLoading(false);
    if (!answer.success) {
      setBuilding(false);
      return;
    }
    setDepartures(answer.data);
    const start = answer.data.find((d) => d.id === (from?.departureId ?? defaultDepartureId)) ?? null;
    setDepartureId(start?.id ?? "");
    if (from && start) setCounts(countsOf(from.rooms.filter((k) => start.rooms.some((r) => r.key === k))));
    else setCounts(start?.rooms.some((r) => r.key === "double_room") ? { double_room: 1 } : {});
    setFollowUp(from?.followUpDate && from.followUpDate >= today ? from.followUpDate : "");
    if (!start && answer.data.length) setPickerOpen(true);
  };

  const bump = (key: string, by: 1 | -1) =>
    setCounts((current) => {
      if (by > 0 && total >= LINK_ROOMS_MAX) return current;
      return { ...current, [key]: Math.max(0, (current[key] ?? 0) + by) };
    });

  const prepare = async (sendWhatsApp: boolean) => {
    if (!chosen || !ready) return;
    setBusy(true);
    const answer = await run(
      () => prepareOffer(caseId, { departureId: chosen.id, rooms, followUpDate: followUp, sendWhatsApp }),
      sendWhatsApp ? "Offer sent" : "Offer ready - now send it",
    );
    setBusy(false);
    if (!answer.success) return;
    setBuilding(false);
    onChanged();
  };

  // the link itself opens WhatsApp / the mail app; this records that it went out
  const sent = (via: OfferChannel) => {
    void (async () => {
      setBusy(true);
      const answer = await run(() => markOfferSent(caseId, via), 'Recorded as sent - the case is "Offer sent"');
      setBusy(false);
      if (answer.success) onChanged();
    })();
  };

  const withdraw = async () => {
    const agreed = await confirm({
      title: "Withdraw the offer?",
      description:
        "It leaves the case, and its link no longer lands bookings here (a booking through it is matched by phone like any other). The status stays as it is.",
      confirmLabel: "Withdraw",
      destructive: true,
    });
    if (!agreed) return;
    setBusy(true);
    const answer = await run(() => withdrawOffer(caseId), "Offer withdrawn");
    setBusy(false);
    if (answer.success) onChanged();
  };

  const priceOf = (key: string) => quote?.lines.find((l) => l.key === key);

  return (
    <Section
      icon={Link2}
      tone="brand"
      title="Booking link"
      description="An offer: the site opens on the tour with the customer's rooms; the booking lands on this case."
    >
      {!hasSite ? (
        <p className="text-sm text-muted-foreground">The company has no site address yet - set it in the company settings.</p>
      ) : !building ? (
        offer ? (
          <OfferSummary
            offer={offer}
            phone={phone}
            email={email}
            firstName={firstName}
            busy={busy}
            onSent={sent}
            onEdit={() => void open(offer)}
            onWithdraw={() => void withdraw()}
          />
        ) : (
          <Button variant="outline" className="w-full" onClick={() => void open()} disabled={loading}>
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
          <Button size="sm" variant="ghost" onClick={() => setBuilding(false)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={pickerOpen} aria-label="Tour and date" className="w-full justify-between font-normal">
                <span className="truncate" dir="auto">
                  {chosen ? `${chosen.tourName ?? ""} · ${chosen.code} · ${fmtDate(chosen.startDate)}` : "Search a tour or a date"}
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
              </Button>
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

          {chosen && (
            <div className="space-y-1">
              {chosen.rooms.map((room) => {
                const n = counts[room.key] ?? 0;
                const line = priceOf(room.key);
                return (
                  <div
                    key={room.key}
                    className={cn("flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm", n > 0 && "border-primary/40 bg-primary/5")}
                  >
                    <span className="min-w-0">
                      <span className="block truncate" dir="auto">
                        {room.title}
                      </span>
                      {n > 0 && line && (
                        <span className="block text-xs tabular text-muted-foreground">
                          {fmtPrice(line.price, quote?.currency)} a room
                          {line.discount ? ` · −${fmtPrice(line.discount, quote?.currency)}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`One ${room.title} less`} disabled={!n} onClick={() => bump(room.key, -1)}>
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="w-5 text-center tabular">{n}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`One ${room.title} more`}
                        disabled={total >= LINK_ROOMS_MAX}
                        onClick={() => bump(room.key, 1)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </div>
                );
              })}
              {total > 0 && (
                <div className="flex items-baseline justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm" aria-live="polite">
                  <span className="text-muted-foreground">On the site</span>
                  {quoting && !quote ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : quote ? (
                    <span className="text-end tabular">
                      {quote.discount > 0 && (
                        <span className="me-2 text-xs text-muted-foreground line-through">{fmtPrice(quote.subtotal, quote.currency)}</span>
                      )}
                      <strong>{fmtPrice(quote.total, quote.currency)}</strong>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">The site cannot price this choice</span>
                  )}
                </div>
              )}
              {quote?.reason && (
                <Notice tone="warning">The site would not take this booking now ({quote.reason.replace(/_/g, " ")}) - check the date&apos;s seats.</Notice>
              )}
            </div>
          )}

          {/* the offer's follow-up: required, so no offer goes out without a day to call back */}
          <div className="space-y-1.5 rounded-md border p-2">
            <label htmlFor="link-follow-up" className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Follow up on <span className="text-destructive">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_DAYS.map((q) => {
                const day = inDays(q.days);
                return (
                  <button
                    key={q.days}
                    type="button"
                    onClick={() => setFollowUp(day)}
                    aria-pressed={followUp === day}
                    className={cn(
                      "min-h-8 rounded-full border px-2.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      followUp === day && "border-primary bg-primary/10 font-semibold text-primary",
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
              <Input id="link-follow-up" type="date" dir="ltr" min={today} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="h-8 w-auto tabular" />
            </div>
          </div>

          <div className={cn("grid gap-2", whatsappApi && "sm:grid-cols-2")}>
            <Button className="w-full" variant={whatsappApi ? "outline" : "default"} onClick={() => void prepare(false)} disabled={busy || !ready}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Prepare offer
            </Button>
            {whatsappApi && (
              <Button className="w-full" onClick={() => void prepare(true)} disabled={busy || !ready} title="Sends the offer from the company's WhatsApp number">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send on WhatsApp
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {ready ? 'Next: send it on WhatsApp or by e-mail - the case moves to "Offer sent" when it goes out.' : "Choose a date, rooms and the follow-up day."}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setBuilding(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </Section>
  );
}
