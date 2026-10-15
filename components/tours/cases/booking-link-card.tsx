"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Copy, ExternalLink, Link2, Loader2, Mail, MessageCircle, Minus, Plus, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtDate, fmtInstant, todayIso } from "@/lib/tours/format";
import { listLinkDepartures, mintBookingLink } from "@/lib/actions/tours-cases-actions";
import { LINK_ROOMS_MAX, type BookingLinkResult, type LinkDeparture } from "@/lib/tours/cases";
import { Section } from "@/components/tours/ui";

/** A day `n` days from today, as YYYY-MM-DD (the date box's value). */
function inDays(n: number): string {
  const [y, m, d] = todayIso().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}
const QUICK_DAYS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In a week", days: 7 },
];

/**
 * "Send a booking link": a date and the customer's rooms, and the site opens on
 * that tour with the rooms filled - the customer types the passengers and
 * sends. The link carries the case's token, so the booking lands on this case.
 * A link is an offer (Alon 15.10): the case moves to "Offer sent" and the rep
 * must say when to call back - no day, no link. Nothing loads until "Build a
 * link" is clicked.
 */
export function BookingLinkCard({
  caseId,
  defaultDepartureId,
  linkSentAt,
  hasSite,
  whatsappApi,
  onSent,
}: {
  caseId: string;
  defaultDepartureId: string | null;
  linkSentAt: string | null;
  hasSite: boolean;
  /** The company's own WhatsApp number is connected (Cloud API): the link can go out from it. */
  whatsappApi: boolean;
  onSent: () => void;
}) {
  const run = useActionToast();
  const { toast } = useToast();
  const [departures, setDepartures] = useState<LinkDeparture[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [departureId, setDepartureId] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [followUp, setFollowUp] = useState("");
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<BookingLinkResult | null>(null);

  const open = async () => {
    setLoading(true);
    const answer = await run(() => listLinkDepartures());
    setLoading(false);
    if (!answer.success) return;
    setDepartures(answer.data);
    const first = answer.data.find((d) => d.id === defaultDepartureId) ?? answer.data[0];
    setDepartureId(first?.id ?? "");
    setCounts(first?.rooms.some((r) => r.key === "double_room") ? { double_room: 1 } : {});
  };

  const chosen = useMemo(() => departures?.find((d) => d.id === departureId), [departures, departureId]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const today = todayIso();
  const followUpOk = /^\d{4}-\d{2}-\d{2}$/.test(followUp) && followUp >= today;
  const ready = !!chosen && chosen.rooms.length > 0 && total > 0 && followUpOk;
  const bump = (key: string, by: 1 | -1) =>
    setCounts((current) => {
      const next = Math.max(0, (current[key] ?? 0) + by);
      if (by > 0 && total >= LINK_ROOMS_MAX) return current;
      return { ...current, [key]: next };
    });

  const mint = async (sendWhatsApp: boolean) => {
    if (!chosen || !ready) return;
    const rooms = chosen.rooms.flatMap((r) => Array<string>(counts[r.key] ?? 0).fill(r.key));
    setMinting(true);
    const answer = await run(
      () => mintBookingLink(caseId, { departureId: chosen.id, rooms, followUpDate: followUp, sendWhatsApp }),
      'Booking link ready - the case is "Offer sent"',
    );
    setMinting(false);
    if (!answer.success) return;
    setResult(answer.data);
    onSent();
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast({ title: "Link copied" });
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Select the link and copy it by hand." });
    }
  };

  return (
    <Section title="Booking link" description="The site opens on the tour with the customer's rooms filled in; the booking lands on this case.">
      {!hasSite ? (
        <p className="text-sm text-muted-foreground">The company has no site address yet - set it in the company settings.</p>
      ) : departures === null ? (
        <div className="space-y-2">
          <Button variant="outline" className="w-full" onClick={open} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Build a link
          </Button>
          {linkSentAt && <p className="text-xs text-muted-foreground">Last link: {fmtInstant(linkSentAt)}</p>}
        </div>
      ) : departures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departure is open on the site right now.</p>
      ) : (
        <div className="space-y-3">
          <Select
            value={departureId}
            onValueChange={(id) => {
              setDepartureId(id);
              setResult(null);
              // another date sells other rooms: start from its double room, never carry keys it does not sell
              const next = departures.find((d) => d.id === id);
              setCounts(next?.rooms.some((r) => r.key === "double_room") ? { double_room: 1 } : {});
            }}
          >
            <SelectTrigger aria-label="Departure">
              <SelectValue placeholder="Choose a departure" />
            </SelectTrigger>
            <SelectContent>
              {departures.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span dir="auto">
                    {d.code} · {fmtDate(d.startDate)} · {d.tourName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {chosen && chosen.rooms.length === 0 && (
            <p className="text-sm text-muted-foreground">This date has no price table yet, so the site cannot take a booking for it. Price the date first, or send the tour page.</p>
          )}
          {chosen && chosen.rooms.length > 0 && (
            <div className="space-y-1">
              {chosen.rooms.map((room) => (
                <div key={room.key} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                  <span>{room.title}</span>
                  <span className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`One ${room.title} less`} disabled={!counts[room.key]} onClick={() => bump(room.key, -1)}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-5 text-center tabular">{counts[room.key] ?? 0}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`One ${room.title} more`} disabled={total >= LINK_ROOMS_MAX} onClick={() => bump(room.key, 1)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* the offer's follow-up: required, so no link goes out without a day to call back */}
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
              <input
                id="link-follow-up"
                type="date"
                dir="ltr"
                min={today}
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm tabular"
                aria-describedby="link-follow-up-hint"
              />
            </div>
            <p id="link-follow-up-hint" className="text-xs text-muted-foreground">
              {followUpOk ? `The case moves to "Offer sent" and comes back to you on ${fmtDate(followUp)}.` : "Pick the day to get back to the customer - the link needs it."}
            </p>
          </div>

          <div className={cn("grid gap-2", whatsappApi && "sm:grid-cols-2")}>
            <Button className="w-full" variant={whatsappApi ? "outline" : "default"} onClick={() => void mint(false)} disabled={minting || !ready}>
              {minting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Create link
            </Button>
            {whatsappApi && (
              <Button className="w-full" onClick={() => void mint(true)} disabled={minting || !ready} title="Sends the link from the company's WhatsApp number">
                {minting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send on WhatsApp
              </Button>
            )}
          </div>

          {result && (
            <div className="space-y-2">
              <Input readOnly dir="ltr" value={result.url} onFocus={(e) => e.currentTarget.select()} className="text-xs" aria-label="Booking link" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button variant="outline" size="sm" onClick={copy}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
                {result.whatsappApp ? (
                  <Button variant="outline" size="sm" asChild>
                    {/* the rep's WhatsApp app, on this chat, the message typed in - no browser tab */}
                    <a href={result.whatsappApp} title="Opens WhatsApp on this computer">
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <MessageCircle className="h-4 w-4" />
                    No phone
                  </Button>
                )}
                {result.whatsapp && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={result.whatsapp} target="_blank" rel="noreferrer" title="WhatsApp Web, in a new tab">
                      <ExternalLink className="h-4 w-4" />
                      Web
                    </a>
                  </Button>
                )}
                {result.mailto ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={result.mailto}>
                      <Mail className="h-4 w-4" />
                      E-mail
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <Mail className="h-4 w-4" />
                    No e-mail
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
