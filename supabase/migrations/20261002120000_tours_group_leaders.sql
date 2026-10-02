-- Group leaders of a tours company: who escorts a tour, and who escorts each
-- date. ADDITIVE ONLY.
--
-- * tours.packages.instructor_ids: the group leaders of the tour, in the order
--   the site lists them ("the leaders of this tour" on the tour page). An array
--   of tours.instructors ids - the backoffice checks they belong to the same
--   company; a deleted or inactive leader is simply skipped by the site.
-- * tours.departures.leader_id: the group leader of one date, for operations.
--   The site never sees it: the c_<slug>.departures view selects named columns.
--
-- The site views select packages.* and were created before the new column, so
-- they are re-provisioned here (public.reprovision_all_companies, the function
-- 20261001100400 documents for exactly this).
--
-- Mega Events is untouched: no public.* table is read or changed.
-- Rollback: section 10 of supabase/rollback/20261001_multi_company.sql.

alter table tours.packages
  add column if not exists instructor_ids uuid[] not null default '{}';

alter table tours.departures
  add column if not exists leader_id uuid references tours.instructors(id) on delete set null;

create index if not exists departures_leader_idx
  on tours.departures (leader_id) where leader_id is not null;

select public.reprovision_all_companies();
