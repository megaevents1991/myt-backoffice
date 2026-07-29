-- Per-user, per-table UI preferences (visible columns today; sort order, page
-- size, saved filters later). Generic on purpose so every backoffice table can
-- use the same store instead of each one inventing its own localStorage key.
--
-- user_id is the auth.users uuid carried in the signed session (`sub`).

create table if not exists "public"."user_table_preferences" (
  "user_id"     uuid        not null,
  "table_key"   text        not null,
  "preferences" jsonb       not null default '{}'::jsonb,
  "updated_at"  timestamptz not null default now(),
  primary key ("user_id", "table_key")
);

comment on table "public"."user_table_preferences" is
  'Per-user UI state for backoffice tables, keyed by a stable table_key such as "offline-flights".';

grant select, insert, update, delete
  on "public"."user_table_preferences" to "service_role";
