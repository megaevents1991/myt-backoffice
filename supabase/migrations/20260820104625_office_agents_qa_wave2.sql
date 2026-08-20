-- Wave-2 QA: manual per-agent attribution + per-agent coupon conversions.
--
-- Idempotent, no CHECK constraints (main writes reservations; a value outside
-- an allow-list would turn a data-hygiene rule into a failed customer
-- booking - validated in the backoffice instead, per @.claude/rules/migrations.md).

-- Manager-set override: which office agent a reservation belongs to.
-- Wins over the UTM-derived attribution everywhere (lib/portal-attribution.ts
-- merges it as `row.agent_user_id ?? utmAttribution`). Nullable; main never
-- writes it - only the backoffice portal's assignReservationAgent does.
alter table public.reservations add column if not exists agent_user_id uuid;

comment on column public.reservations.agent_user_id is
  'Manager-set override: which office user (user_profiles.id) this booking is credited to. Wins over the UTM-derived attribution (utm_touches). Null = use UTM attribution / unattributed.';

-- Who converted credit into this coupon (user_profiles.id) - also covers
-- commission-funded coupons (createPartnerCoupon). Per-agent credit
-- redemptions and coupon lists are keyed on it; legacy/null rows belong to
-- the office/manager pot.
alter table public.coupons add column if not exists created_by uuid;

comment on column public.coupons.created_by is
  'user_profiles.id of whoever created this coupon (credit conversion or commission-funded coupon) via the partner portal. Null = pre-migration / created by staff - counts as the office/manager bucket.';
