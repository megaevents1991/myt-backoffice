"use client";

/**
 * V2 dashboard package search (2026-08-27 spec): the top of the agent's
 * dashboard is a package search engine - the default 8 rows are the
 * homepage-prioritized events ("ה-8 ששמנו בעמוד הבית כמומלצות"), a
 * "כרטיסים בלבד" toggle re-prices every row as cheapest ticket + the
 * ticket-only markup (what the customer really pays when skipping both
 * flight and hotel), and each row keeps the two partner tools - copy a coded
 * link / build a package.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { partnerLink } from "@/lib/site";
import { computePerPersonPackagePrice } from "@/lib/package-price";
import type { BuilderEvent } from "@/lib/actions/portal-package-actions";

const dateFmt = (value: string) => new Date(value).toLocaleDateString("he-IL");
const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

type Genre = "all" | "sport" | "music";

const genreOf = (e: BuilderEvent): Exclude<Genre, "all"> => {
  if (e.type.startsWith("sports")) return "sport";
  if (e.type.startsWith("music")) return "music";
  // tx_event carries both kinds - classify by tags, default music.
  const tags = (e.tags ?? "").toLowerCase();
  return /football|sport|soccer|basket|tennis|formula/.test(tags)
    ? "sport"
    : "music";
};

/** Cheapest ticket + ticket-only markup - the price a customer pays for
 *  "כרטיסים בלבד" (skip flight + hotel). Falls back to the regular skip
 *  markups when no ticket_only_markup is set, exactly like the order flow. */
const ticketOnlyPerPerson = (e: BuilderEvent): number | null => {
  if (e.tickets.length === 0) return null;
  const minTicket = Math.min(...e.tickets.map((t) => t.price));
  if (!Number.isFinite(minTicket)) return null;
  return computePerPersonPackagePrice(e, {
    ticketPrice: minTicket,
    flightSkipped: true,
    hotelSkipped: true,
    flightDelta: 0,
    hotelDelta: 0,
    hotelSkipRefPerGuest: null,
  });
};

export function DashboardSearch({
  trackingCode,
  events,
  agentUtm,
}: {
  trackingCode: string;
  events: BuilderEvent[];
  agentUtm?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<Genre>("all");
  const [ticketsOnly, setTicketsOnly] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const pool = events.filter((e) => genre === "all" || genreOf(e) === genre);
    if (!term) {
      // Default: the homepage-prioritized events lead (nearest date first
      // inside each group), 8 rows like the homepage's recommended set.
      return [...pool]
        .sort((a, b) => {
          const ap = a.is_prioritized ? 0 : 1;
          const bp = b.is_prioritized ? 0 : 1;
          return ap - bp || +new Date(a.date) - +new Date(b.date);
        })
        .slice(0, 8);
    }
    return pool
      .filter(
        (e) =>
          e.name.toLowerCase().includes(term) ||
          e.location_name.toLowerCase().includes(term),
      )
      .slice(0, 12);
  }, [events, query, genre]);

  const copyLink = async (eventId: number) => {
    try {
      await navigator.clipboard.writeText(
        partnerLink(trackingCode, eventId, undefined, agentUtm),
      );
      setCopiedId(eventId);
      setTimeout(
        () => setCopiedId((prev) => (prev === eventId ? null : prev)),
        2000,
      );
    } catch (error) {
      console.error("copyLink:", error);
    }
  };

  const genres: { key: Genre; label: string }[] = [
    { key: "all", label: "הכל" },
    { key: "sport", label: "ספורט" },
    { key: "music", label: "מוזיקה" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש חבילה לפי אירוע, קבוצה, אמן או עיר..."
            className="pe-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
          {genres.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGenre(g.key)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold transition-colors",
                genre === g.key
                  ? "bg-brand-forest text-white dark:bg-brand-mint dark:text-brand-forest"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Switch checked={ticketsOnly} onCheckedChange={setTicketsOnly} />
          <span className="flex items-center gap-1">
            <Ticket className="size-4" />
            כרטיסים בלבד
          </span>
        </label>
      </div>

      {matches.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          לא נמצאו אירועים זמינים לחיפוש הזה.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {matches.map((event) => {
            const perPerson = ticketsOnly
              ? ticketOnlyPerPerson(event)
              : event.site_price;
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {event.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.image_url}
                      alt=""
                      className="size-10 shrink-0 rounded-full border-2 border-white object-cover object-top shadow-sm"
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{event.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.location_name} · {dateFmt(event.date)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {perPerson != null && (
                    <div className="text-end">
                      <p className="font-bold tabular-nums" dir="ltr">
                        {usd(perPerson * 2)}
                      </p>
                      <p className="text-[11px] text-muted-foreground" dir="rtl">
                        סה&quot;כ ({usd(perPerson)} לנוסע)
                        {ticketsOnly && " · כרטיס בלבד"}
                      </p>
                    </div>
                  )}
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
