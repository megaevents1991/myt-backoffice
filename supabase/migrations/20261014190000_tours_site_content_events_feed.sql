-- Mega Events packages on the tours company sites (2026-10-14, Dor: "Full build now").
--
-- The cron /api/cron/toursEventsFeed (lib/services/tours-events-feed-sync.ts) keeps a short list
-- of Mega Events' hot packages - "המבוקשים ביותר" of mega-events.co.il, priced as its cards print
-- them - in tours.site_content under its own key, 'events_feed', one row per tours company. The
-- company site reads it at build time through <schema>.site_content, which already returns every
-- key of the company (provision_company(), 20261006100000) - no view changes.
--
-- The only change: the key CHECK of 20261005180000 admitted the four staff documents alone.
-- Staff editors never touch the new key (saveSiteDoc refuses keys outside SITE_DOC_KEYS).
--
-- Additive. Rollback:
--   delete from tours.site_content where key = 'events_feed';
--   alter table tours.site_content drop constraint site_content_key_check;
--   alter table tours.site_content add constraint site_content_key_check
--     check (key in ('general', 'header', 'footer', 'home'));

-- The inline CHECK was named by Postgres (site_content_key_check); drop whatever check reads the key.
do $events_feed$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'tours.site_content'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%key%'
  loop
    execute format('alter table tours.site_content drop constraint %I', c.conname);
  end loop;
end
$events_feed$;

alter table tours.site_content
  add constraint site_content_key_check
  check (key in ('general', 'header', 'footer', 'home', 'events_feed'));
