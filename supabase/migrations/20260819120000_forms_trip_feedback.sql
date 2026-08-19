-- Trip-feedback support for dynamic forms (מגה תיירות escort feedback):
--
--  * forms.review_link_url  - external review URL (Google) offered on the
--    thank-you screen only when every answered star rating scored full marks.
--    Never included in the public form payload; the submit action decides.
--  * form_fields.staff_only - filled by staff (the trip escort) via a trip
--    link's prefill, stripped from the public payload so clients never see it.
--    Client-submitted values for these fields are ignored on submit.
--  * form_invites.multi_use - a "trip link": one token shared with a whole
--    group, submittable any number of times. prefill carries the escort's
--    staff-field answers, merged into every response server-side.
--  * form_invites.label     - human name for a trip link in the invites table
--    (e.g. the trip code / departure), since it has no single recipient.

alter table forms
  add column if not exists review_link_url text;

alter table form_fields
  add column if not exists staff_only boolean not null default false;

alter table form_invites
  add column if not exists multi_use boolean not null default false;

alter table form_invites
  add column if not exists label text;
