-- Build Your Euro Trip - "suggest your trip to others" (Dor, 24.10.2026).
-- Spec: myt-main, branch feat/multi-event-itinerary - the summary step's opt-in, written with the trip's hold.
--
-- (1) itinerary_route_requests - one row per customer who held a trip they built themselves AND ticked "רוצים
--     שנציע את הטיול שלכם גם לאחרים?" on the summary, with the name they gave it (optional). Staff read them at
--     /events/trips/requests and turn one into a staff trip (itinerary_routes) in one click, or reject it.
--     WRITTEN by myt-main (app/api/itinerary/confirm, service role) right after the trip's reservations rows are
--     inserted - best effort: a failure here never fails the customer's hold, and a missing table is skipped;
--     UPDATED by the backoffice (lib/actions/itinerary-requests-actions.ts and the trip save that publishes it):
--     status, route_id, handled_by / handled_at. Never deleted by the screen (rejected rows stay for the record).
--     event_ids is the trip as the customer built it, in trip (date) order. itinerary_group = the trip's
--     reservations group (reservations.itinerary_group) and is UNIQUE: one suggestion per hold, so a retried
--     request cannot write it twice. reservation_id = the trip's first reservations row (the backoffice links it).
--     The contact columns copy the hold's main contact - the same data its reservations rows hold.
--     RLS is on with no policies = service role only; grants taken away, like itinerary_routes.
--
-- Additive only: a new table and one index. Idempotent: safe to re-run.
-- Rollback (by hand, outside the CLI): supabase/rollback/20261024084720_itinerary_route_requests.sql

create table if not exists public.itinerary_route_requests (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  title           text,
  event_ids       bigint[] not null,
  itinerary_group uuid not null,
  reservation_id  bigint,
  pax             smallint,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  status          text not null default 'new',
  route_id        bigint references public.itinerary_routes (id) on delete set null,
  handled_by      uuid,
  handled_at      timestamptz
);

-- title: optional, at most 80 characters (the staff trip title's own cap). event_ids: 2 or 3 events (coalesce: an
-- empty array has no first dimension). status: the three the screen knows. Guarded so a re-run does not fail.
do $$
begin
  alter table public.itinerary_route_requests
    add constraint itinerary_route_requests_title_len_chk
    check (title is null or char_length(title) <= 80);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.itinerary_route_requests
    add constraint itinerary_route_requests_event_ids_len_chk
    check (coalesce(array_length(event_ids, 1), 0) between 2 and 3);
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.itinerary_route_requests
    add constraint itinerary_route_requests_status_chk
    check (status in ('new', 'published', 'rejected'));
exception
  when duplicate_object then null;
end
$$;

-- A unique constraint brings its index: on a re-run Postgres answers duplicate_table (the index) or
-- duplicate_object (the constraint), either way it is already there.
do $$
begin
  alter table public.itinerary_route_requests
    add constraint itinerary_route_requests_group_key unique (itinerary_group);
exception
  when duplicate_object or duplicate_table then null;
end
$$;

-- The one read: newest first (the screen groups them by event set itself).
create index if not exists itinerary_route_requests_created_idx
  on public.itinerary_route_requests (created_at desc);

alter table public.itinerary_route_requests enable row level security;
revoke all on public.itinerary_route_requests from anon, authenticated;

comment on table public.itinerary_route_requests is
  'Euro Trip: customers who held a self-built trip and offered it to others, with the name they gave it. Written by myt-main with the hold (app/api/itinerary/confirm), handled by the backoffice (/events/trips/requests): published as an itinerary_routes row or rejected. Service role only (RLS on, no policies).';
comment on column public.itinerary_route_requests.title is
  'The name the customer gave the trip (optional, trimmed, at most 80 characters). Staff edit it before publishing.';
comment on column public.itinerary_route_requests.event_ids is
  'events.id of the trip in trip (date) order, 2 or 3 (CHECK). No foreign key (arrays cannot have one).';
comment on column public.itinerary_route_requests.itinerary_group is
  'reservations.itinerary_group of the hold that carried the suggestion. UNIQUE: one suggestion per hold.';
comment on column public.itinerary_route_requests.reservation_id is
  'The trip''s first reservations row (the backoffice links /reservations/<id>). No foreign key: a reservation may be removed.';
comment on column public.itinerary_route_requests.pax is
  'Travellers on the hold.';
comment on column public.itinerary_route_requests.contact_name is
  'The hold''s main contact, first and last name (as on its reservations rows).';
comment on column public.itinerary_route_requests.contact_email is
  'The hold''s main contact email.';
comment on column public.itinerary_route_requests.contact_phone is
  'The hold''s main contact phone.';
comment on column public.itinerary_route_requests.status is
  'new | published (made a staff trip, route_id set) | rejected.';
comment on column public.itinerary_route_requests.route_id is
  'The staff trip made from this request. Set null if that trip is deleted.';
comment on column public.itinerary_route_requests.handled_by is
  'Staff user (auth user id) who published or rejected it. No foreign key, like itinerary_routes.updated_by.';
comment on column public.itinerary_route_requests.handled_at is
  'When it was published or rejected.';
