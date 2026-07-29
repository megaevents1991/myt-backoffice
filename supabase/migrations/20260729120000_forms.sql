-- Dynamic forms (טפסים): staff-built bilingual questionnaires sent to clients.
--
-- Backoffice-owned. The main app does not read these tables. A live form is read
-- and its response inserted through the service-role client inside server actions
-- only (app/f/*) — the anon key never touches these tables, so no RLS policies,
-- matching the other backoffice-owned tables (event_categories, coupons, ...).

create table if not exists forms (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  title_en       text not null,
  title_he       text,
  description_en text,
  description_he text,
  status         text not null default 'draft' check (status in ('draft','live','closed')),
  default_lang   text not null default 'en' check (default_lang in ('en','he')),
  -- Invite links only: allows a token to be submitted more than once.
  -- The shared public link is always multi-submit.
  allow_multiple boolean not null default false,
  thank_you_en   text,
  thank_you_he   text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Soft delete, house convention: "MM-DD-YYYY" date string, never a boolean.
  is_deleted     text
);
create index if not exists idx_forms_status on forms(status) where is_deleted is null;
create index if not exists idx_forms_created on forms(created_at desc);

create table if not exists form_fields (
  id             bigint generated always as identity primary key,
  form_id        bigint not null references forms(id) on delete cascade,
  -- short_text | long_text | number | email | phone | date | select | radio |
  -- checkbox | yes_no | rating | scale | section
  type           text not null,
  position       integer not null default 0,
  label_en       text not null default '',
  label_he       text,
  help_en        text,
  help_he        text,
  placeholder_en text,
  placeholder_he text,
  required       boolean not null default false,
  -- [{ value, label_en, label_he }] for select / radio / checkbox
  options        jsonb not null default '[]'::jsonb,
  -- { min, max, step } for number/scale, { max } for rating, { rows } for long_text
  config         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_form_fields_form on form_fields(form_id, position);

create table if not exists form_invites (
  id              bigint generated always as identity primary key,
  form_id         bigint not null references forms(id) on delete cascade,
  -- 32-char hex, the only credential on the /f/i/<token> link
  token           text not null unique,
  recipient_name  text,
  recipient_email text,
  recipient_phone text,
  lang            text not null default 'en' check (lang in ('en','he')),
  -- { "<field_id>": value } seeded into the rendered form
  prefill         jsonb not null default '{}'::jsonb,
  -- Optional links to existing records. Plain bigint, no FK: reservations and
  -- events are owned elsewhere and an invite must survive their deletion.
  reservation_id  bigint,
  event_id        bigint,
  sent_at         timestamptz,
  opened_at       timestamptz,
  submitted_at    timestamptz,
  send_error      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_form_invites_form on form_invites(form_id, created_at desc);

create table if not exists form_responses (
  id           bigint generated always as identity primary key,
  form_id      bigint not null references forms(id) on delete cascade,
  -- null for submissions that came through the shared public link
  invite_id    bigint references form_invites(id) on delete set null,
  -- { "<field_id>": value }
  answers      jsonb not null default '{}'::jsonb,
  lang         text not null default 'en',
  ip           text,
  user_agent   text,
  submitted_at timestamptz not null default now()
);
create index if not exists idx_form_responses_form on form_responses(form_id, submitted_at desc);
-- Backs the per-IP submission rate limit on the public endpoint.
create index if not exists idx_form_responses_rate on form_responses(form_id, ip, submitted_at desc);
