-- Deleting a partner was impossible once the main app logged a single click
-- for them: affiliates_tracking's FK to partners carries no ON DELETE action
-- (= RESTRICT), so every affiliate with any tracking history failed with a
-- foreign-key violation ("Failed to delete partner" in the partners list).
--
-- Click rows are meaningless without their partner — cascade them away with
-- the delete. user_profiles' FK deliberately KEEPS its RESTRICT: the portal
-- login must be removed first (deletePartner does that explicitly via the
-- auth admin API), and the FK stays as the safety net if a future writer
-- forgets.
alter table "public"."affiliates_tracking"
  drop constraint if exists "affiliates_tracking_affiliate_id_fkey";
alter table "public"."affiliates_tracking"
  add constraint "affiliates_tracking_affiliate_id_fkey"
  foreign key ("affiliate_id") references "public"."partners"("partner_tracking_code")
  on delete cascade;
