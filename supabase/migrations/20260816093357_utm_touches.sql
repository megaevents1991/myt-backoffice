-- Attribution touches captured from the myt_utm cookie at checkout.
-- position 0 = primary (the attribution), 1..n = older history touches.
-- Written by myt-main's confirm-order (service role); read by the backoffice.
create table if not exists utm_touches (
  id bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id),
  position smallint not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  fbclid text,
  is_influencer boolean not null default false,
  visited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists utm_touches_reservation_idx on utm_touches (reservation_id);
create index if not exists utm_touches_source_idx on utm_touches (utm_source);
create index if not exists utm_touches_campaign_idx on utm_touches (utm_campaign);

-- Service-role only (both apps write/read server-side). No anon policies on purpose.
alter table utm_touches enable row level security;
