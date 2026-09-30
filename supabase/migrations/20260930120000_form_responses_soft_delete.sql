-- Staff and forms operators remove an irrelevant response (a test, a duplicate,
-- a family that answered the wrong form) from the trips report, its averages
-- and the PDF export - without destroying it: a removal can be undone, and the
-- audit log records who removed what. House soft-delete convention, same as
-- forms.is_deleted: "MM-DD-YYYY", null = live.
alter table form_responses add column if not exists is_deleted text;
