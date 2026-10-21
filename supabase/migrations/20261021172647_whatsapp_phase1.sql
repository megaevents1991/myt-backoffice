-- WhatsApp Cloud API, phase 1 ("the wire") - spec docs/superpowers/specs/2026-10-21-whatsapp-cloud-api-design.md,
-- sections 5, 6 and 9. A tours company's number runs in COEXISTENCE with the WhatsApp Business app: the reps keep the
-- app, Meta mirrors every message (the customer's and what a rep writes in the app) to our webhook, and the system
-- sends templates from the same number. Every table is service-role only (RLS on, no policies), like the rest of the
-- tours area. Idempotent: the workflow may re-run it.

-- ---------------------------------------------------------------- 1. accounts - one row per company number
create table if not exists public.wa_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  waba_id text not null,                              -- the WhatsApp Business Account
  phone_number_id text not null,                      -- what the webhook routes on
  display_phone text not null default '',             -- "+972 54-227-2554" as Meta prints it
  verified_name text,
  mode text not null default 'coexistence',           -- coexistence | api_only (no check: a later mode needs no migration)
  provider text not null default 'meta',              -- meta | bsp:<name>
  quality_rating text,                                -- from phone_number_quality_update
  messaging_limit text,                               -- the tier from account_update
  history_requested_at timestamptz,                   -- the 6-month sync must be requested within 24 h of onboarding
  history_synced_at timestamptz,
  connected_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id)
);
create index if not exists wa_accounts_company_idx on public.wa_accounts (company_id) where is_active;
alter table public.wa_accounts enable row level security;
revoke all on table public.wa_accounts from anon, authenticated;

-- ---------------------------------------------------------------- 2. messages - every message, both directions
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  wa_message_id text not null,                        -- Meta's id (wamid...) - the idempotency key
  phone text not null,                                -- the customer, digits in international form (972541234567)
  phone_key text not null,                            -- the last 9 digits (public.phone_key)
  customer_id uuid references public.customers(id) on delete set null,     -- TOURS: by phone_key at insert
  case_id uuid references public.leads(id) on delete set null,             -- TOURS: the card the conversation is on
  reservation_id bigint references public.reservations(id) on delete set null, -- MEGA EVENTS (its own round) - reserved
  direction text not null,                            -- in | out
  origin text not null,                               -- customer | app | api | automation | broadcast | history
  type text not null default 'text',                  -- text | image | document | audio | video | sticker | location | contacts | template | reaction | unsupported
  text text,                                          -- body / caption / a stand-in like "[תמונה]"
  media jsonb,                                        -- { id, mime, sha256, storage_path } - the file in the private bucket wa-media
  template jsonb,                                     -- { name, language, params }
  status text not null default 'received',            -- received | accepted | sent | delivered | read | failed
  status_at timestamptz,
  error text,
  sent_by uuid references public.user_profiles(id) on delete set null,     -- staff who pressed send (api); null for app / automation
  automation_id uuid,
  campaign_id uuid,
  sent_at timestamptz not null default now(),         -- Meta's timestamp
  inserted_at timestamptz not null default now(),
  unique (wa_message_id)
);
create index if not exists wa_messages_phone_idx on public.wa_messages (company_id, phone_key, sent_at desc);
create index if not exists wa_messages_customer_idx on public.wa_messages (customer_id, sent_at desc);
create index if not exists wa_messages_case_idx on public.wa_messages (case_id);
create index if not exists wa_messages_campaign_idx on public.wa_messages (campaign_id) where campaign_id is not null;
alter table public.wa_messages enable row level security;
revoke all on table public.wa_messages from anon, authenticated;

-- ---------------------------------------------------------------- 3. templates - a cache of the company's approved templates
create table if not exists public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  language text not null default 'he',
  category text,                                      -- MARKETING | UTILITY | AUTHENTICATION
  status text not null,                               -- APPROVED | PENDING | REJECTED | PAUSED | ...
  body text,
  param_count int,
  synced_at timestamptz not null default now(),
  unique (company_id, name, language)
);
alter table public.wa_templates enable row level security;
revoke all on table public.wa_templates from anon, authenticated;

-- ---------------------------------------------------------------- 4. the private bucket for received media
-- Private: a customer's picture or document. Meta keeps media 30 days; we keep our copy.
insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 5. consent + window on the customer, "seen" on the card
-- wa_consent: none | form (claimed on a site form, unconfirmed) | opted_in | customer | opted_out (no check).
-- Three steps for the NOT NULL, per the migrations rule.
alter table public.customers add column if not exists wa_consent text;
update public.customers set wa_consent = 'none' where wa_consent is null;
alter table public.customers alter column wa_consent set default 'none';
alter table public.customers alter column wa_consent set not null;
alter table public.customers
  add column if not exists wa_consent_source text,     -- site_form | reply | booking_terms | staff:<user id>
  add column if not exists wa_consent_at timestamptz,
  add column if not exists wa_last_in_at timestamptz,  -- the customer's newest message: the 24-hour window
  add column if not exists wa_profile_name text;       -- the name WhatsApp gives
alter table public.leads add column if not exists wa_seen_at timestamptz; -- when the card's rep last opened its thread

-- ---------------------------------------------------------------- 6. leads_fill: a WhatsApp message joins the newest open card
-- Re-pasted WHOLE from 20261019180000 (never a partial edit). Two changes, both marked "(2026-10-21)":
--   (a) kind = 'whatsapp' joins the customer's NEWEST open card whatever its tour, and is never filed - a message
--       is the continuation of a conversation, not a form about a tour (TS twin: routeInquiry in lib/tours/cases.ts);
--   (b) the site's marketing checkbox ("acceptance" = on) or a newsletter signup marks the customer opted in - never
--       over a customer who asked to be removed.
create or replace function public.leads_fill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid bigint;
  v_slug text;
  v_dep record;
  v_key text;
  v_cust uuid;
  v_rep uuid;
  v_target record;
  v_joined boolean := false;
  v_new_customer boolean := false;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  new.payload := coalesce(new.payload, '{}'::jsonb) - 'matched_by' - 'related_case' - 'merged' - 'merged_into' - 'joined_into' - 'inquiries';
  if new.type is null or new.type = '' then
    -- a 'whatsapp' row (an inbound message, 2026-10-21) takes the 'lead' arm
    new.type := case when new.kind in ('notify', 'waitlist', 'newsletter') then 'potential'
                     when new.kind in ('booking', 'advisor') then 'reservation'
                     else 'lead' end;
  end if;
  if coalesce(new.first_name, '') = '' and coalesce(new.last_name, '') = '' and coalesce(btrim(new.name), '') <> '' then
    new.first_name := split_part(btrim(new.name), ' ', 1);
    new.last_name := nullif(btrim(substr(btrim(new.name), length(new.first_name) + 1)), '');
  elsif coalesce(btrim(new.name), '') = '' and (coalesce(new.first_name, '') <> '' or coalesce(new.last_name, '') <> '') then
    new.name := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
  end if;
  new.utm := public.clean_utm(new.utm);
  if new.departure_id is null then
    v_pid := coalesce(
      nullif(substring(coalesce(new.source_path, '') from '[?&]product_id=([0-9]{1,12})(?:[&#]|$)'), '')::bigint,
      case when jsonb_typeof(new.payload->'date') = 'object' and coalesce(new.payload#>>'{date,productId}', '') ~ '^[0-9]{1,12}$'
           then (new.payload#>>'{date,productId}')::bigint end);
    if v_pid is not null then
      select d.id, d.package_id into v_dep
        from tours.departures d
       where d.company_id = new.company_id and d.is_deleted is null
         and (d.legacy_product_id = v_pid or d.site_id = v_pid)
       order by (d.legacy_product_id is not distinct from v_pid) desc
       limit 1;
      if found then
        new.departure_id := v_dep.id;
        new.package_id := coalesce(new.package_id, v_dep.package_id);
      end if;
    end if;
  end if;
  if new.package_id is null then
    v_slug := coalesce(nullif(new.payload->>'slug', ''),
                       public.url_decode(substring(coalesce(new.source_path, '') from '^/package/([^/?#]+)')));
    if v_slug is not null then
      select p.id into new.package_id
        from tours.packages p
       where p.company_id = new.company_id and p.slug = v_slug and p.is_deleted is null
       limit 1;
    end if;
  end if;

  -- the customer: the one the backoffice named (of this company), else the phone's, else a new one. A form
  -- never writes over a known customer - a visitor typed it.
  if new.customer_id is not null then
    select c.id into v_cust from public.customers c where c.id = new.customer_id and c.company_id = new.company_id;
  end if;
  v_key := public.phone_key(new.phone);
  if v_cust is null and v_key <> '' then
    select c.id into v_cust from public.customers c
     where c.company_id = new.company_id and c.is_deleted is null and c.phone_keys @> array[v_key]
     order by c.customer_no limit 1;
  end if;
  if v_cust is null then
    insert into public.customers (company_id, first_name, last_name, phones, email, id_number, acc_num)
    values (new.company_id, nullif(btrim(new.first_name), ''), nullif(btrim(new.last_name), ''),
            case when coalesce(btrim(new.phone), '') <> '' then array[btrim(new.phone)] else '{}'::text[] end,
            nullif(lower(btrim(new.email)), ''), nullif(btrim(new.id_number), ''), nullif(btrim(new.acc_num), ''))
    returning id into v_cust;
    v_new_customer := true;
  end if;
  new.customer_id := v_cust;

  -- (b) the site's marketing checkbox / a newsletter signup (2026-10-21, spec section 9) is a CLAIM, not consent:
  -- wa_consent = 'form' (claimed, unconfirmed - marketing needs opted_in / customer; a later round confirms it by a
  -- reply), ONLY on a customer this very form created, with the lead's id as the evidence. A form is unauthenticated
  -- and keyed by a phone anyone can type, so a known customer is never touched (security review 21.10).
  if v_new_customer and (new.kind = 'newsletter' or coalesce(new.payload->>'acceptance', '') in ('on', 'true', '1')) then
    update public.customers c
       set wa_consent = 'form', wa_consent_source = 'site_form:' || new.id::text, wa_consent_at = now()
     where c.id = v_cust and c.wa_consent = 'none';
  end if;

  -- a known customer goes back to whoever handled them last (a card staff type keeps the rep they chose, "Unassigned" too)
  if new.assigned_to is null and new.kind <> 'manual' then
    select l.assigned_to into v_rep
      from public.leads l
     where l.customer_id = v_cust and l.assigned_to is not null and l.is_deleted is null
     order by l.created_at desc
     limit 1;
    new.assigned_to := v_rep;
  end if;

  -- a SITE FORM (a booking routes itself; staff choose by hand). Open card = not closed, not waiting to be
  -- filed, not a paid trip that already left. Twin: routeInquiry / isOpenCard in lib/tours/cases.ts.
  if new.kind not in ('booking', 'advisor', 'manual', 'newsletter') and not coalesce(new.to_file, false) then
    v_joined := false;
    if new.kind = 'whatsapp' then
      -- (a) a WhatsApp message (2026-10-21): the continuation of a conversation, not a form about a tour - it joins
      -- the customer's NEWEST open card whatever its tour, and is never filed
      select l.id, l.case_no into v_target
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
       order by coalesce(l.updated_at, l.created_at) desc
       limit 1;
      v_joined := found;
    elsif new.package_id is not null then
      select l.id, l.case_no into v_target
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file and l.package_id = new.package_id
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
       order by l.created_at desc
       limit 1;
      v_joined := found;
    end if;
    if v_joined then
      -- the same tour again (or the customer's conversation): it joins that card, which says the customer came back
      new.is_deleted := v_today;
      new.payload := new.payload || jsonb_build_object('joined_into', jsonb_build_object('id', v_target.id, 'case_no', v_target.case_no));
      update public.leads l
         set status = case when l.status in ('no_answer', 'offer_sent', 'future')
                            and exists (select 1 from public.lead_statuses s where s.company_id = l.company_id and s.key = 'returned')
                           then 'returned' else l.status end,
             follow_up_date = v_today,
             payload = l.payload || jsonb_build_object('inquiries',
               coalesce(case when jsonb_typeof(l.payload->'inquiries') = 'array' then l.payload->'inquiries' end, '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object(
                    'id', new.id, 'case_no', new.case_no, 'at', now(), 'kind', new.kind,
                    'message', left(new.message, 500), 'source_path', left(new.source_path, 300), 'utm', new.utm,
                    -- what the form was SENT AS: it joined by the phone alone, which anyone can type. The card's
                    -- name / contact are never written from it; the card page warns when these are not the
                    -- card's person (senderDiffers in lib/tours/cases.ts).
                    'name', left(nullif(btrim(new.name), ''), 120), 'phone', left(nullif(btrim(new.phone), ''), 40),
                    'email', left(nullif(lower(btrim(new.email)), ''), 200),
                    -- the form's other fields (a waiting list's date...), unless they are unusually big
                    'fields', case when pg_column_size(new.payload) < 4000 then new.payload - 'joined_into' else '{}'::jsonb end)))
       where l.id = v_target.id;
    elsif new.kind <> 'whatsapp' and new.package_id is null and exists (
      select 1
        from public.leads l
        left join tours.departures d on d.id = l.departure_id
       where l.company_id = new.company_id and l.customer_id = v_cust and l.is_deleted is null
         and not l.to_file
         and not public.lead_status_closed(new.company_id, l.status)
         and not (l.status in ('paid', 'deposit_paid') and coalesce(d.start_date < v_today, false))
    ) then
      -- no tour named and the customer has open cards: the rep decides where it goes
      new.to_file := true;
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.leads_fill() from public;
revoke execute on function public.leads_fill() from anon, authenticated;
