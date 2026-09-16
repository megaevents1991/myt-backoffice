# Homepage layout (עמוד הבית) - design, 2026-09-16

Dor: "מבוקשים ביותר" becomes a Netflix-style single row, "החדשים ביותר" under it,
Google reviews move below the artists, and the backoffice gets a dummy homepage
where staff drag sections and the items inside every carousel into order.

## Data (backoffice owns, main reads with its service client)

```
homepage_sections(key text pk, position int, is_visible bool, updated_at)
homepage_items(section text, kind 'event'|'artist'|'team', ref_id text, position int,
               pk (section, kind, ref_id))
```

- `ref_id` = `events.id` as text for events, the row **slug** for artists/teams
  (main identifies people by slug: `sys.id`).
- Section keys: `hero`, `most_wanted`, `newest`, `football`, `artists`,
  `reviews`, `more_events`. `hero` is always first (UI pins it). Trust + FAQ stay
  fixed below and are not in the table.
- Migration backfills: `football`/`artists` items from `display_order`, `hero`
  from `featured_order` (artists and teams interleaved exactly as main did), so the
  deploy changes nothing visually. `display_order` / `featured_order` columns stay
  but nothing writes them any more; the Templates "Homepage Order" screens and the
  "Featured order" form field are removed.

## Main rules (`lib/homepageLayout.ts` + `app/page.tsx`)

- Section order/visibility from `homepage_sections`; keys missing from the table
  are appended in the default order, so a new section in code shows before staff
  ever touch it. Empty table / error = default order, everything visible.
- `hero`: listed items in position order (filtered by availability as before),
  then every other available artist/team interleaved as before.
- `football` / `artists`: available-first as before; inside each group listed
  position first, unlisted after by name.
- `most_wanted`: listed events (not sold out) first, then today's auto rule
  (prioritized, then filled from non-VIP non-sports), capped at 12.
- `newest`: listed events first, then future events by `created_at desc`
  excluding sold-out and anything already in "most wanted", capped at 12.
- Rows: native snap scroll (same track as the team/artist rows), card = the
  existing EventCard with a shorter image (`h-40`), `w-[76%]` on mobile so the
  next card peeks, `sm:w-[280px]` on desktop. Row height keeps the next section's
  heading inside a 375×667 viewport.

## Backoffice (`/homepage`, Website group, staff)

One page that looks like the site: a vertical list of section blocks (drag /
arrows to reorder, visibility switch, hero pinned) and inside each carousel
section a horizontal strip of item cards (drag / arrows, remove, "add" picker
over future events / active artists / active teams). One Save writes the whole
layout (`saveHomepageLayout`), audits it (`homepage.layout`) and pings main's
revalidate. Native HTML5 drag, no new dependency.
