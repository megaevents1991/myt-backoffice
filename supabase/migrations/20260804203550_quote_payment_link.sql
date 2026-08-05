-- A quote built from a prepared package can carry the package's coded order
-- link; the PDF renders it as a "register & pay" CTA. Null = info-only quote
-- (the agent's choice at creation time). The server action only ever stores a
-- link on the caller's own tracking code, pointing at the public site.

alter table "public"."quotes"
  add column if not exists "payment_link" text;

comment on column "public"."quotes"."payment_link" is
  'Partner-coded site order link (optionally package-pinned) rendered as the PDF payment CTA; null = information-only quote.';
