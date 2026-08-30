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
import { Check, Copy, Search, SlidersHorizontal, Ticket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { partnerLink } from "@/lib/site";
import { computePerPersonPackagePrice } from "@/lib/package-price";
import type { BuilderEvent } from "@/lib/actions/portal-package-actions";

const dateFmt = (value: string) => new Date(value).toLocaleDateString("he-IL");
const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/** The search has no traveler picker, so the "total" line prices the usual
 *  couple. Named rather than inlined so the label and the maths can't drift. */
const PRICE_PREVIEW_TRAVELERS = 2;

type Genre = "all" | "sport" | "music";
type SortMode = "recommended" | "date" | "priceAsc" | "priceDesc";

const genreOf = (e: BuilderEvent): Exclude<Genre, "all"> => {
  if (e.type.startsWith("sports")) return "sport";
  if (e.type.startsWith("music")) return "music";
  // tx_event carries both kinds - classify by the taxonomy's vertical tag
  // (folded into `tags` by getPackageBuilderEvents), then by name shape:
  // Hebrew fixture names are "קבוצה - קבוצה" or a tournament round.
  const tags = (e.tags ?? "").toLowerCase();
  if (/music|מוסיקה|מוזיקה/.test(tags)) return "music";
  if (/football|sport|soccer|basket|tennis|formula|כדורגל|ספורט/.test(tags))
    return "sport";
  return /מונדיאל|יורו|גביע|ליגת| - /.test(e.name) ? "sport" : "music";
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
  const [month, setMonth] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("recommended");
  const [ticketsOnly, setTicketsOnly] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // חיפוש מתקדם - mapped options built from the taxonomy tags the events
  // actually carry (leagues, teams, music genres, cities) + free date/price
  // ranges, mirroring the main site's search filters.
  const [advOpen, setAdvOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [league, setLeague] = useState("all");
  const [team, setTeam] = useState("all");
  const [musicGenre, setMusicGenre] = useState("all");
  const [artist, setArtist] = useState("all");
  const [city, setCity] = useState("all");
  const [priceMax, setPriceMax] = useState("");

  const advActiveCount =
    [league, team, musicGenre, artist, city].filter((v) => v !== "all").length +
    [dateFrom, dateTo, priceMax].filter(Boolean).length;

  const resetAdvanced = () => {
    setDateFrom("");
    setDateTo("");
    setLeague("all");
    setTeam("all");
    setMusicGenre("all");
    setArtist("all");
    setCity("all");
    setPriceMax("");
  };

  // Distinct tag names per filter, with how many events carry each - only
  // options that actually match something are offered.
  const advOptions = useMemo(() => {
    const collect = (type: string) => {
      const counts = new Map<string, number>();
      for (const e of events) {
        for (const t of e.tag_list ?? []) {
          if (t.type === type) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
        }
      }
      return [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"),
      );
    };
    return {
      leagues: collect("league"),
      teams: collect("team"),
      genres: collect("genre"),
      artists: collect("artist"),
      cities: collect("city"),
    };
  }, [events]);

  const hasTag = (e: BuilderEvent, type: string, name: string) =>
    (e.tag_list ?? []).some((t) => t.type === type && t.name === name);

  // "חודש" dropdown options - every month that actually has an event.
  const months = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      const d = new Date(e.date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!seen.has(key)) {
        seen.set(
          key,
          d.toLocaleDateString("he-IL", { month: "long", year: "numeric" }),
        );
      }
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const inMonth = (e: BuilderEvent) => {
    if (month === "all") return true;
    const d = new Date(e.date);
    return (
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === month
    );
  };

  // Pill counts, like the doc's mock (הכל 140 · ספורט 90 · מוזיקה 50) -
  // counted inside the chosen month so the numbers match the list below.
  const genreCounts = useMemo(() => {
    const pool = events.filter(inMonth);
    return {
      all: pool.length,
      sport: pool.filter((e) => genreOf(e) === "sport").length,
      music: pool.filter((e) => genreOf(e) === "music").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, month]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const price = (e: BuilderEvent) =>
      (ticketsOnly ? ticketOnlyPerPerson(e) : e.site_price) ?? Infinity;
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    // עד תאריך is inclusive - push it to the end of that day.
    const toMs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 : null;
    const maxPrice = priceMax ? Number(priceMax) : null;

    const pool = events
      .filter((e) => genre === "all" || genreOf(e) === genre)
      .filter(inMonth)
      .filter(
        (e) =>
          !term ||
          e.name.toLowerCase().includes(term) ||
          e.location_name.toLowerCase().includes(term),
      )
      .filter((e) => fromMs == null || +new Date(e.date) >= fromMs)
      .filter((e) => toMs == null || +new Date(e.date) < toMs)
      .filter((e) => league === "all" || hasTag(e, "league", league))
      .filter((e) => team === "all" || hasTag(e, "team", team))
      .filter((e) => musicGenre === "all" || hasTag(e, "genre", musicGenre))
      .filter((e) => artist === "all" || hasTag(e, "artist", artist))
      .filter(
        (e) =>
          city === "all" ||
          hasTag(e, "city", city) ||
          e.location_name.includes(city),
      )
      .filter(
        (e) =>
          maxPrice == null ||
          !Number.isFinite(maxPrice) ||
          price(e) <= maxPrice,
      );

    const sorted = [...pool].sort((a, b) => {
      switch (sort) {
        case "date":
          return +new Date(a.date) - +new Date(b.date);
        case "priceAsc":
          return price(a) - price(b);
        case "priceDesc":
          return price(b) - price(a);
        default:
          // Recommended: the homepage-prioritized events lead, nearest date
          // first inside each group - 8 rows like the homepage's set.
          return (
            (a.is_prioritized ? 0 : 1) - (b.is_prioritized ? 0 : 1) ||
            +new Date(a.date) - +new Date(b.date)
          );
      }
    });

    // Default view: 8 recommended rows; once the user filters/sorts, more.
    const untouched =
      !term && month === "all" && sort === "recommended" && advActiveCount === 0;
    return sorted.slice(0, untouched ? 8 : 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    events,
    query,
    genre,
    month,
    sort,
    ticketsOnly,
    dateFrom,
    dateTo,
    league,
    team,
    musicGenre,
    artist,
    city,
    priceMax,
  ]);

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

  const genres: { key: Genre; label: string; count: number }[] = [
    { key: "all", label: "הכל", count: genreCounts.all },
    { key: "sport", label: "ספורט", count: genreCounts.sport },
    { key: "music", label: "מוזיקה", count: genreCounts.music },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
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
              <span
                className={cn(
                  "ms-1 text-xs tabular-nums",
                  genre === g.key ? "opacity-80" : "text-muted-foreground",
                )}
              >
                {g.count}
              </span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">חודש</span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל התאריכים</SelectItem>
              {months.map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">סינון</span>
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recommended">מומלצים</SelectItem>
              <SelectItem value="date">תאריך קרוב</SelectItem>
              <SelectItem value="priceAsc">מחיר עולה</SelectItem>
              <SelectItem value="priceDesc">מחיר יורד</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Switch checked={ticketsOnly} onCheckedChange={setTicketsOnly} />
          <span className="flex items-center gap-1">
            <Ticket className="size-4" />
            כרטיסים בלבד
          </span>
        </label>
        <Button
          type="button"
          variant={advOpen || advActiveCount > 0 ? "secondary" : "outline"}
          size="sm"
          className="rounded-full"
          onClick={() => setAdvOpen((open) => !open)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          חיפוש מתקדם
          {advActiveCount > 0 && (
            <span className="rounded-full bg-brand-forest px-1.5 text-xs font-bold text-white">
              {advActiveCount}
            </span>
          )}
        </Button>
      </div>

      {advOpen && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200 space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">מתאריך</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">עד תאריך</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">מחיר מקסימלי לנוסע ($)</span>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="ללא הגבלה"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                className="h-9"
              />
            </label>
            {advOptions.leagues.length > 0 && (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">ליגה</span>
                <Select value={league} onValueChange={setLeague}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הליגות</SelectItem>
                    {advOptions.leagues.map(([name, count]) => (
                      <SelectItem key={name} value={name}>
                        {name} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {advOptions.teams.length > 0 && (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">קבוצה</span>
                <Select value={team} onValueChange={setTeam}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הקבוצות</SelectItem>
                    {advOptions.teams.map(([name, count]) => (
                      <SelectItem key={name} value={name}>
                        {name} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {advOptions.genres.length > 0 && (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">ז&apos;אנר מוזיקה</span>
                <Select value={musicGenre} onValueChange={setMusicGenre}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הז&apos;אנרים</SelectItem>
                    {advOptions.genres.map(([name, count]) => (
                      <SelectItem key={name} value={name}>
                        {name} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {advOptions.artists.length > 0 && (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">אמן</span>
                <Select value={artist} onValueChange={setArtist}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל האמנים</SelectItem>
                    {advOptions.artists.map(([name, count]) => (
                      <SelectItem key={name} value={name}>
                        {name} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {advOptions.cities.length > 0 && (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">יעד</span>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל היעדים</SelectItem>
                    {advOptions.cities.map(([name, count]) => (
                      <SelectItem key={name} value={name}>
                        {name} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
          {advActiveCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={resetAdvanced}
            >
              <X className="h-3.5 w-3.5" />
              איפוס חיפוש מתקדם
            </Button>
          )}
        </div>
      )}

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
                    // Per-traveler is the headline number (Dor, 2026-08-30):
                    // the big figure used to be the 2-traveler total with
                    // "לנוסע" in small print, which read as the price of one.
                    // The ×2 is spelled out below instead of implied.
                    <div className="text-end">
                      <p className="font-bold tabular-nums" dir="ltr">
                        {usd(perPerson)}
                      </p>
                      <p className="text-[11px] text-muted-foreground" dir="rtl">
                        לנוסע · סה&quot;כ ל-{PRICE_PREVIEW_TRAVELERS} נוסעים{" "}
                        <span dir="ltr" className="tabular-nums">
                          {usd(perPerson * PRICE_PREVIEW_TRAVELERS)}
                        </span>
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
                    {/* Carries the "כרטיסים בלבד" choice into the builder, which
                        then goes tickets → summary (doc 2026-08-30, item 10). */}
                    <Link
                      href={`/portal/packages/new?event=${event.id}${
                        ticketsOnly ? "&tickets=1" : ""
                      }`}
                    >
                      {ticketsOnly ? "בניית כרטיס" : "בניית חבילה"}
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
