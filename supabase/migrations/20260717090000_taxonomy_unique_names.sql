-- DB-level backstop against duplicate taxonomy names. The server actions are
-- already idempotent (createCategory/createTag return the existing row on a
-- same-name create), but a unique index closes any remaining race window.
-- Case-insensitive; only live rows count (soft-deleted rows may keep names).
-- Categories: the same name is allowed under DIFFERENT parents (e.g. "דרבי"
-- under two leagues) - uniqueness is per (name, parent), with NULL parent
-- normalized so two roots can't share a name.

create unique index if not exists uq_event_tags_name_live
  on event_tags (lower(name))
  where is_deleted = false;

create unique index if not exists uq_event_categories_name_parent_live
  on event_categories (lower(name), coalesce(parent_id, 0))
  where is_deleted = false;
