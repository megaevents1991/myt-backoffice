-- Homepage section-carousel ordering (כדורגל / אמנים מובילים on myt-main home).
-- Managed visually in the backoffice under Templates → Homepage Order;
-- read by myt-main app/page.tsx (available-first, then display_order).
-- NULL = unordered (sorts after ordered rows, alphabetical).

alter table artists add column if not exists display_order integer;
alter table football_teams add column if not exists display_order integer;
