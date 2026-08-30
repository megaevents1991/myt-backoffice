-- אזור סוכן (2026-08-30, doc item 4): "שמשנים עמלה זה צריך להשפיע על הלינק".
--
-- The wizard's "הוסף עמלה / תן הנחה ללקוח" used to travel ONLY inside a signed
-- quote link, so the plain package link (`?pkg=<share_token>`) kept charging
-- site price - two links, two prices, no way to tell them apart. The adjust now
-- lives ON the package, so every way of sharing it quotes the same number.
--
-- USD per traveler: positive = the agent's uplift above site price, negative =
-- a discount funded from their own commission (the portal caps it at the
-- commission; myt-main's confirm-order price floor is the real backstop).
--
-- Idempotent: safe to re-run.

alter table "public"."prepared_packages"
  add column if not exists "price_adjust_per_person" numeric not null default 0;

comment on column "public"."prepared_packages"."price_adjust_per_person" is
  'Agent price change per traveler in USD (+ uplift / - discount off their commission). Applied by myt-main when the package link is opened - see app/api/package/[id]/route.ts.';
