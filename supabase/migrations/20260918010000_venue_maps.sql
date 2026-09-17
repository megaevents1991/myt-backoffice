-- Venue maps we OWN (multi-supplier events, 2026-09).
--
-- A tx_event's seat map used to be TixStock's SVG, loaded from their S3 and matched by THEIR
-- category names - so a supplier renaming its categories broke the map, and a second supplier's
-- tickets had nowhere to land. A venue map is our copy of that drawing plus OUR zones:
--
--   zones               [{ "id": "long-l3", "label": "לאורך המגרש - קומה 3", "sections": ["<data-section id>", ...] }]
--   supplier_categories { "tixstock": { "<normalized category>": "<zone id>" }, "livetickets": { ... } }
--
-- `svg_url` is the published copy in the public `map_images` bucket: the source drawing with a
-- `data-zones="<zone ids>"` attribute stamped on every section. Events point `map_image_url` at
-- it, and the main app lights sections by ticket.zoneId - no supplier names involved.
-- `supplier_categories` is the venue template: the next event at this stadium gets its zone
-- mapping pre-filled, the operator only confirms.
--
-- Backoffice-only table (main never reads it - everything main needs is stamped onto the
-- tickets and into the SVG), so no column contract with main to keep.

create table if not exists public.venue_maps (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  source_url          text not null unique,
  svg_url             text,
  zones               jsonb not null default '[]'::jsonb,
  supplier_categories jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists venue_maps_svg_url_idx on public.venue_maps (svg_url);

-- Service-role only, like agent_instructions / tasks: RLS on, no policies. Every access goes
-- through guarded server actions (lib/actions/venue-map-actions.ts, requireStaff).
alter table public.venue_maps enable row level security;
