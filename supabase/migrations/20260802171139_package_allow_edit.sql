-- Whether the customer opening a prepared-package link may change the
-- composition (ticket category/qty, flight, hotel) or gets it locked exactly
-- as the agent built it. Default TRUE = today's behavior (editable), so
-- existing rows and links keep working unchanged.
--
-- Locking never blocks a piece the customer HAS to choose anyway: a stale
-- (needs_repick) piece and a deliberately-left-live piece stay pickable -
-- myt-main's /api/package/[id] + order flow enforce that nuance.

alter table "public"."prepared_packages"
  add column if not exists "allow_edit" boolean not null default true;

comment on column "public"."prepared_packages"."allow_edit" is
  'FALSE = the customer cannot change the pinned composition; stale or agent-left-live pieces remain pickable. TRUE (default) = normal editable order flow.';
