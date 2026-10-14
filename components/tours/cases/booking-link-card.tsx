"use client";

import { useMemo, useState } from "react";
import { Copy, Link2, Loader2, Mail, MessageCircle, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtDate, fmtInstant } from "@/lib/tours/format";
import { listLinkDepartures, mintBookingLink } from "@/lib/actions/tours-cases-actions";
import { LINK_ROOMS_MAX, type BookingLinkResult, type LinkDeparture } from "@/lib/tours/cases";
import { Section } from "@/components/tours/ui";

/**
 * "Send a booking link": a date and the customer's rooms, and the site opens on
 * that tour with the rooms filled - the customer types the passengers and
 * sends. The link carries the case's token, so the booking lands on this case.
 * Nothing loads until "Build a link" is clicked.
 */
export function BookingLinkCard({
  caseId,
  defaultDepartureId,
  linkSentAt,
  hasSite,
  onSent,
}: {
  caseId: string;
  defaultDepartureId: string | null;
  linkSentAt: string | null;
  hasSite: boolean;
  onSent: () => void;
}) {
  const run = useActionToast();
  const { toast } = useToast();
  const [departures, setDepartures] = useState<LinkDeparture[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [departureId, setDepartureId] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
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
  const bump = (key: string, by: 1 | -1) =>
    setCounts((current) => {
      const next = Math.max(0, (current[key] ?? 0) + by);
      if (by > 0 && total >= LINK_ROOMS_MAX) return current;
      return { ...current, [key]: next };
    });

  const mint = async () => {
    if (!chosen) return;
    const rooms = chosen.rooms.flatMap((r) => Array<string>(counts[r.key] ?? 0).fill(r.key));
    setMinting(true);
    const answer = await run(() => mintBookingLink(caseId, { departureId: chosen.id, rooms }), "Booking link ready");
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
            <p className="text-sm text-muted-foreground">This date has no price table yet - the customer will choose the rooms on the site.</p>
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

          <Button className="w-full" onClick={mint} disabled={minting || !chosen || (chosen.rooms.length > 0 && total === 0)}>
            {minting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Create link
          </Button>

          {result && (
            <div className="space-y-2">
              <Input readOnly dir="ltr" value={result.url} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={copy}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
                <Button variant="outline" size="sm" asChild disabled={!result.whatsapp}>
                  {result.whatsapp ? (
                    <a href={result.whatsapp} target="_blank" rel="noreferrer">
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp
                    </a>
                  ) : (
                    <span>
                      <MessageCircle className="h-4 w-4" />
                      No phone
                    </span>
                  )}
                </Button>
                <Button variant="outline" size="sm" asChild disabled={!result.mailto}>
                  {result.mailto ? (
                    <a href={result.mailto}>
                      <Mail className="h-4 w-4" />
                      E-mail
                    </a>
                  ) : (
                    <span>
                      <Mail className="h-4 w-4" />
                      No e-mail
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
