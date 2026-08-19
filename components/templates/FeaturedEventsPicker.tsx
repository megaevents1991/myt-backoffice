"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listCategoryEvents,
  type TagEventRow,
} from "@/lib/actions/event-taxonomy-actions";

/** "2026-09-12" → "12/09/26" (no dayjs needed for a list label). */
const shortDate = (d: string | null) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "";

/**
 * One curated, ORDERED list of event ids (selected rows + add-by-search).
 * Order here is display order on the site.
 */
function CuratedList({
  label,
  hint,
  ids,
  onChange,
  events,
  loading,
}: {
  label: string;
  hint: string;
  ids: number[];
  onChange: (ids: number[]) => void;
  events: TagEventRow[];
  loading: boolean;
}) {
  const [search, setSearch] = useState("");

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const q = search.trim().toLowerCase();
  const candidates = events.filter(
    (e) =>
      !ids.includes(e.id) &&
      (!q ||
        e.name.toLowerCase().includes(q) ||
        (e.name_english ?? "").toLowerCase().includes(q)),
  );

  const move = (i: number, dir: -1 | 1) => {
    const next = [...ids];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <section className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      {ids.length > 0 && (
        <ul className="space-y-1">
          {ids.map((id, i) => {
            const ev = byId.get(id);
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm"
              >
                <span className="w-5 shrink-0 text-center text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {ev ? (
                    <>
                      {ev.name}
                      <span className="mr-2 text-xs text-muted-foreground">
                        {shortDate(ev.date)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      אירוע #{id} (עבר / לא זמין - לא יוצג באתר)
                    </span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label="הזז למעלה"
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="הזז למטה"
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => onChange(ids.filter((x) => x !== id))}
                  aria-label="הסר"
                >
                  <X className="size-3.5 text-destructive" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={loading ? "טוען אירועים…" : "חיפוש אירוע להוספה…"}
        disabled={loading}
      />
      {!loading && candidates.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
          {candidates.slice(0, 15).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onChange([...ids, e.id])}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-sm hover:bg-muted"
              >
                <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {shortDate(e.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && events.length === 0 && (
        <p className="text-xs text-muted-foreground">
          אין אירועים עתידיים בקטגוריה הזו (הקטגוריה נבנית מתגיות).
        </p>
      )}
    </section>
  );
}

/**
 * Curation of the site's בולטים + חבילות מומלצות sections for a category
 * page. Stored inside `categories.page_content` (featured_event_ids /
 * recommended_event_ids) - empty list = the site picks automatically
 * ("בולט" tag, else the soonest available events).
 */
export function FeaturedEventsPicker({
  categoryId,
  featuredIds,
  recommendedIds,
  onFeaturedChange,
  onRecommendedChange,
}: {
  categoryId: number;
  featuredIds: number[];
  recommendedIds: number[];
  onFeaturedChange: (ids: number[]) => void;
  onRecommendedChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(
    featuredIds.length > 0 || recommendedIds.length > 0,
  );
  const [events, setEvents] = useState<TagEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Candidate pool loads on first expand only - the form opens fast.
  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    listCategoryEvents(categoryId)
      .then(setEvents)
      .catch((e) => console.error("listCategoryEvents failed:", e))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [open, loaded, categoryId]);

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-right"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold">
          אירועים בולטים וחבילות מומלצות (אוצרות ידנית)
          {(featuredIds.length > 0 || recommendedIds.length > 0) && (
            <span className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {featuredIds.length + recommendedIds.length} נבחרו
            </span>
          )}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-6 border-t p-4">
          <CuratedList
            label='"בולטים" (משחקים / הופעות / אירועים בולטים)'
            hint="הסדר כאן = הסדר באתר. ריק = אוטומטי: אירועים עם תגית בולט, ואם אין - הקרובים ביותר."
            ids={featuredIds}
            onChange={onFeaturedChange}
            events={events}
            loading={loading}
          />
          <CuratedList
            label='"חבילות מומלצות"'
            hint="מוצג בעמודי הוורטיקל (כדורגל / מוזיקה). ריק = אוטומטי: החבילות הזמינות הקרובות."
            ids={recommendedIds}
            onChange={onRecommendedChange}
            events={events}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
