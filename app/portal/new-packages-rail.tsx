"use client";

/**
 * "מה חדש" — one card PER ARTIST, main-site brand look (forest surface, mint
 * accent), arrow-paged rail. Design rules applied (ui-ux-pro-max):
 * - No nested scrollbar: the strip pages with arrow buttons (scrollbar hidden,
 *   touch swipe still works on mobile) — scroll-in-scroll is a trap.
 * - Click a card → its upcoming dates open in a fixed panel BELOW the rail,
 *   capped at 6 visible + "ועוד N" (no inner scrolling either).
 * - Touch targets ≥44px, aria-expanded on cards, aria-labels on arrows,
 *   150-250ms transitions, RTL-aware chevrons.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Music2 } from "lucide-react";
import type { PortalNewGroup } from "@/lib/actions/portal-dashboard-actions";

const VISIBLE_DATES = 6;

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function NewPackagesRail({ groups }: { groups: PortalNewGroup[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Arrows appear only when the strip actually overflows — with few artists
  // everything is already visible and dead arrows just confuse.
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => setOverflowing(rail.scrollWidth > rail.clientWidth + 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [groups.length]);

  if (groups.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        אין חבילות חדשות מהחודש האחרון. ברגע שנעלה אירועים חדשים — הם יופיעו כאן.
      </p>
    );
  }

  const open = groups.find((group) => group.key === openKey) ?? null;

  // RTL rail: "forward" (next cards) is visually to the LEFT.
  const page = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * -rail.clientWidth * 0.9, behavior: "smooth" });
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <div
          ref={railRef}
          data-new-rail
          className="flex gap-3 overflow-x-auto scroll-smooth pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {groups.map((group) => {
            const selected = group.key === openKey;
            return (
              <button
                key={group.key}
                type="button"
                aria-expanded={selected}
                onClick={() => setOpenKey(selected ? null : group.key)}
                className={`group w-36 shrink-0 overflow-hidden rounded-xl border-2 bg-[#0A1A14] text-right transition-all duration-200 ${
                  selected
                    ? "border-[#5BFF95] shadow-[0_0_0_3px_rgba(91,255,149,.25)]"
                    : "border-transparent hover:border-[#5BFF95]/50"
                }`}
              >
                <div className="relative h-24 w-full overflow-hidden bg-[#12271e]">
                  {group.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={group.image_url}
                      alt={group.name}
                      className="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <Music2 className="h-7 w-7 text-[#5BFF95]/60" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-bold text-white">{group.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-[#5BFF95]">
                    <CalendarDays className="h-3 w-3" aria-hidden />
                    {group.events.length === 1
                      ? "תאריך אחד"
                      : `${group.events.length} תאריכים`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {overflowing && (
          <>
            {/* RTL: the rail advances LEFTWARD — "next" sits on the LEFT edge
                pointing left, "previous" on the RIGHT pointing right. */}
            <button
              type="button"
              aria-label="הצגת החבילות הבאות"
              onClick={() => page(1)}
              className="absolute -end-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border bg-background/95 shadow-md transition-colors hover:bg-muted"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="הצגת החבילות הקודמות"
              onClick={() => page(-1)}
              className="absolute -start-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border bg-background/95 shadow-md transition-colors hover:bg-muted"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="mb-2 text-sm font-semibold">
            התאריכים הקרובים של {open.name}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {open.events.slice(0, VISIBLE_DATES).map((event) => (
              <a
                key={event.id}
                href={event.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:border-[#5BFF95] hover:bg-[#5BFF95]/5"
              >
                <span className="min-w-0">
                  <span className="font-medium tabular-nums">{formatDate(event.date)}</span>
                  {event.location && (
                    <span className="ms-2 truncate text-muted-foreground">
                      {event.location}
                    </span>
                  )}
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            ))}
          </div>
          {open.events.length > VISIBLE_DATES && (
            <p className="mt-2 text-xs text-muted-foreground">
              ועוד {open.events.length - VISIBLE_DATES} תאריכים — כולם זמינים דרך הלינק האישי שלכם באתר.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
