-- Homepage carousel control (2026-10-14).
-- Spec: docs/superpowers/specs/2026-10-14-homepage-carousel-control-design.md
--
-- 1. A pinned card may be a Google review ("לקוחות משתפים" gets the same control
--    as every other row). myt-main never writes homepage_items, so the CHECK stays.
-- 2. Every row may now hide cards (`config.hidden`, "<kind>:<id>" strings). The
--    one row that could before - "החדשים ביותר", `config.hidden_event_ids` - is
--    copied into the new form. The old key is left in place (myt-main reads both);
--    the board's next save writes only `hidden`.
--
-- `homepage_items.position` now reads as the card's place in its row. Every pin
-- saved so far is 0..n-1 per row, which means the same - no data change.

alter table public.homepage_items drop constraint if exists homepage_items_kind_check;
alter table public.homepage_items
  add constraint homepage_items_kind_check check (kind in ('event', 'artist', 'team', 'review'));

update public.homepage_sections
set config = config || jsonb_build_object(
  'hidden',
  (
    select coalesce(jsonb_agg('event:' || v.id order by v.ord), '[]'::jsonb)
    from jsonb_array_elements_text(config -> 'hidden_event_ids') with ordinality as v(id, ord)
    where v.id ~ '^[1-9][0-9]*$'
  )
)
where jsonb_typeof(config -> 'hidden_event_ids') = 'array'
  and not (config ? 'hidden');
