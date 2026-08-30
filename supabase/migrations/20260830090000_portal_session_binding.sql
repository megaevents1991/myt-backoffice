-- אזור סוכן (2026-08-30, doc items 1-3): main's agent mode must MIRROR the
-- backoffice login, not outlive it.
--
-- Until now myt-main minted its own week-long `partner_session` cookie at
-- handoff time and nothing ever revoked it: logging out of the portal, or
-- signing in as a DIFFERENT agent, left the old identity live on the customer
-- site ("מחובר על איציק בבק אופיס אבל באתר מראה אלון"), and an agent who
-- never signed in at all kept browsing as one for a week.
--
-- This column is the shared revocation point. The portal writes a fresh id on
-- every partner login and clears it on logout; the handoff token carries that
-- id, and main re-checks it on every partner request. Mismatch (logged out, or
-- a newer login elsewhere) = no agent mode, on the next request.
--
-- Idempotent: safe to re-run.

alter table "public"."user_profiles"
  add column if not exists "portal_session_id" text;

comment on column "public"."user_profiles"."portal_session_id" is
  'Current portal login id for this partner. Written on portal login, cleared on portal logout; myt-main compares it against the id inside its partner_session cookie so backoffice logout ends agent mode on the customer site.';
