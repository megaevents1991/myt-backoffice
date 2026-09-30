-- Staff and forms operators remove a trip link they do not need (a duplicate,
-- a typo in the code or date) from the trips report and the links list. Soft
-- delete, same convention as forms / form_responses: "MM-DD-YYYY", null = live.
-- A removed link stops taking answers; the report's undo brings it back.
alter table form_invites add column if not exists is_deleted text;
