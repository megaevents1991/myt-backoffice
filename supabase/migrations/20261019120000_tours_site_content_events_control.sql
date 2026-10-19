-- Each tours company controls the Mega Events packages its site shows (2026-10-19, Dor: "שליטה מלאה
-- מה אנחנו מציגים באתר של פמילי, כולל סינכרון ידני ולא רק cron, וגם אופציה לבחירה ידנית").
--
-- Staff keep a document under its own key, 'events_control', in tours.site_content (Website > Mega
-- Events Packages, lib/actions/tours-events-actions.ts): the events they pin, the Mega Events rows
-- that fill the rest ("המבוקשים ביותר", "החדשים"), the events they hide, how many the site shows and
-- whether its search lists Mega Events. The sync (lib/services/tours-events-feed-sync.ts) reads it
-- and writes the company's 'events_feed' from it. A company without the document keeps the list it
-- had (lib/tours/events-control.ts DEFAULT_EVENTS_CONTROL).
--
-- The only change: the key CHECK of 20261014190000 admits the new key. The company site may read the
-- row through <schema>.site_content like every key; it holds event ids and switches, nothing private.
--
-- Additive. Rollback:
--   delete from tours.site_content where key = 'events_control';
--   alter table tours.site_content drop constraint site_content_key_check;
--   alter table tours.site_content add constraint site_content_key_check
--     check (key in ('general', 'header', 'footer', 'home', 'events_feed'));

alter table tours.site_content drop constraint if exists site_content_key_check;

alter table tours.site_content
  add constraint site_content_key_check
  check (key in ('general', 'header', 'footer', 'home', 'events_feed', 'events_control'));
