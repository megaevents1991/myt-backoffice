-- Marketing dashboard (spec docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md).
-- 1) reservations: the supplier cost of the ticket, snapshotted by main's confirm-order
--    ('live') or filled nightly by the backoffice ('estimated'), and ops' real total
--    (actual_cost_usd wins over everything). No CHECK - main writes this table.
-- 2) eight backoffice-only tables: RLS on, no policies, service role only; main never reads them.
-- Additive only. Rollback: drop the eight tables, drop the four columns.

alter table public.reservations
  add column if not exists ticket_cost_usd     numeric,
  add column if not exists ticket_cost_source  text,
  add column if not exists actual_cost_usd     numeric,
  add column if not exists actual_cost_note    text;

create table if not exists public.ad_spend_daily (
  platform             text not null,          -- 'meta' | 'google'
  account_id           text not null,
  campaign_id          text not null,
  adset_key            text not null default '', -- Meta adset id | Google ad-group id | '' = campaign-level row
  level                text not null default 'adset', -- 'adset' | 'campaign'
  day                  date not null,
  spend                numeric not null default 0,
  currency             text not null default 'ILS',
  spend_usd            numeric not null default 0,
  fx_rate              numeric not null default 0,  -- USD per 1 unit of currency, at sync time
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  platform_conversions numeric not null default 0,
  platform_value       numeric not null default 0,
  synced_at            timestamptz not null default now(),
  primary key (platform, campaign_id, adset_key, day)
);
create index if not exists ad_spend_daily_day_idx on public.ad_spend_daily (day);
alter table public.ad_spend_daily enable row level security;

create table if not exists public.ad_entities (
  platform       text not null,
  id             text not null,
  kind           text not null,   -- 'campaign' | 'adset' | 'ad_group' | 'ad'
  name           text not null default '',
  parent_id      text,
  campaign_id    text,
  status         text,
  channel        text,            -- Meta objective | Google advertising_channel_type
  landing_domain text,
  url_tags       text,
  brand          text not null default 'other',   -- 'mega_events' | 'other'
  brand_source   text not null default 'rule',    -- 'rule' | 'manual'
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (platform, id)
);
create index if not exists ad_entities_campaign_idx on public.ad_entities (platform, campaign_id);
alter table public.ad_entities enable row level security;

create table if not exists public.ad_clicks (
  gclid        text primary key,
  campaign_id  text not null,
  ad_group_id  text,
  day          date not null,
  synced_at    timestamptz not null default now()
);
create index if not exists ad_clicks_day_idx on public.ad_clicks (day);
alter table public.ad_clicks enable row level security;

create table if not exists public.ig_media (
  id                 text primary key,
  ig_user_id         text not null,
  media_type         text,
  media_product_type text,        -- 'FEED' | 'REELS' | 'STORY'
  caption            text,
  permalink          text,
  media_url          text,
  thumbnail_url      text,
  posted_at          timestamptz,
  like_count         integer not null default 0,
  comments_count     integer not null default 0,
  reach              integer not null default 0,
  saved              integer not null default 0,
  shares             integer not null default 0,
  views              integer not null default 0,
  insights_at        timestamptz,
  synced_at          timestamptz not null default now()
);
create index if not exists ig_media_posted_idx on public.ig_media (ig_user_id, posted_at desc);
alter table public.ig_media enable row level security;

create table if not exists public.ig_media_insights_daily (
  media_id  text not null references public.ig_media(id) on delete cascade,
  day       date not null,
  reach     integer not null default 0,
  saved     integer not null default 0,
  shares    integer not null default 0,
  views     integer not null default 0,
  likes     integer not null default 0,
  comments  integer not null default 0,
  primary key (media_id, day)
);
alter table public.ig_media_insights_daily enable row level security;

create table if not exists public.ig_account_daily (
  ig_user_id  text not null,
  day         date not null,
  followers   integer not null default 0,
  media_count integer not null default 0,
  primary key (ig_user_id, day)
);
alter table public.ig_account_daily enable row level security;

create table if not exists public.marketing_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.marketing_settings enable row level security;

create table if not exists public.marketing_alerts (
  kind           text not null,   -- 'budget_bleed' | 'viral_post'
  key            text not null,   -- campaign id | media id
  payload        jsonb not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  last_mailed_at timestamptz,
  resolved_at    timestamptz,
  primary key (kind, key)
);
alter table public.marketing_alerts enable row level security;
