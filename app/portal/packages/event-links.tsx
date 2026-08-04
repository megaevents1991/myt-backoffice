"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { partnerLink } from "@/lib/site";
import type { BuilderEvent } from "@/lib/actions/portal-package-actions";

const dateFmt = (value: string) => new Date(value).toLocaleDateString("he-IL");
const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/**
 * Search every sellable event; each row hands the partner its two tools —
 * a ready-to-send coded link, or the package builder preloaded on the event.
 */
export function EventLinks({
  trackingCode,
  events,
}: {
  trackingCode: string;
  events: BuilderEvent[];
}) {
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return events.slice(0, 8);
    return events
      .filter(
        (e) =>
          e.name.toLowerCase().includes(term) ||
          e.location_name.toLowerCase().includes(term)
      )
      .slice(0, 12);
  }, [events, query]);

  const copyLink = async (eventId: number) => {
    try {
      await navigator.clipboard.writeText(partnerLink(trackingCode, eventId));
      setCopiedId(eventId);
      setTimeout(() => setCopiedId((prev) => (prev === eventId ? null : prev)), 2000);
    } catch (error) {
      console.error("copyLink:", error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי אירוע או עיר..."
          className="pe-9"
        />
      </div>

      {matches.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          לא נמצאו אירועים זמינים לחיפוש הזה.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {matches.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{event.name}</p>
                <p className="text-xs text-muted-foreground">
                  {event.location_name} · {dateFmt(event.date)}
                  {event.site_price != null && (
                    <span className="ms-2">{usd(event.site_price)} לנוסע</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => copyLink(event.id)}
                >
                  {copiedId === event.id ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      הועתק!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      העתק קישור
                    </>
                  )}
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="rounded-full bg-brand-forest font-semibold text-primary-foreground hover:bg-brand-forest/90"
                >
                  <Link href={`/portal/packages/new?event=${event.id}`}>
                    בניית חבילה
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        הקישור נושא את קוד המעקב שלכם ומנחית את הלקוח ישר על עמוד ההזמנה של
        האירוע — כל הזמנה שתגיע דרכו משויכת אליכם אוטומטית.
      </p>
    </div>
  );
}
