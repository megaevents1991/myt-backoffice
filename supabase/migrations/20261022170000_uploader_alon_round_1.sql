-- Tour uploader, round "Alon 1" - two columns. 22.10.2026.
-- Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (section 6.1)
--
-- (1) venue_maps.dropped_categories = { "tixstock": ["<normalized category>", ...], "tixstock_kept": [...] }:
--     the categories a venue never sells, and the rule-drops a person un-dropped (kept on the next run too).
--     The keys are `normalizeSupplierCategory` output - the same key the venue template uses.
--     WRITTEN by the backoffice only (the uploader's "classify tickets" confirm); main never reads it.
-- (2) uploader_runs.names_task_id: the one open task asking staff for the Hebrew names of a run
--     (spec section 7.1). No foreign key - the same style as uploader_items.event_id.
--
-- A zone's `description` needs no column: it is a new optional key inside the existing venue_maps.zones jsonb.

alter table public.venue_maps
  add column if not exists dropped_categories jsonb not null default '{}'::jsonb;

alter table public.uploader_runs
  add column if not exists names_task_id uuid;
