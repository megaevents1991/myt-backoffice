/**
 * Partner types.
 *
 * `agent` (סוכן) sells on the customer's behalf and is invoiced via
 * `supplier_number`; `affiliate` (משפיען) drives traffic with a tracking code
 * and coupons. Those two are the partner-marketing types staff create and
 * manage by hand.
 *
 * `customer_refund` (החזר ללקוח) is NOT partner marketing: the main app opens
 * one of these rows automatically for every customer who books, so they run to
 * thousands and would swamp the influencer list if left typed as `affiliate`.
 * They are classified, counted, and filtered separately.
 */
export const MARKETING_PARTNER_TYPES = ["agent", "affiliate"] as const
export const PARTNER_TYPES = [...MARKETING_PARTNER_TYPES, "customer_refund"] as const

export type PartnerType = (typeof PARTNER_TYPES)[number]

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  agent: "סוכן",
  affiliate: "משפיען",
  customer_refund: "החזר ללקוח",
}

/** The legacy name the main app gives every auto-created customer-refund row. */
export const CUSTOMER_REFUND_NAME_MARKER = "ניתן להתעלם"

/**
 * True for the auto-created per-customer refund rows. Reads the `type` column,
 * falling back to the Hebrew name marker for rows predating the backfill
 * migration. The fallback matches `20260729160000_partner_customer_refund_type`
 * exactly, so the app and the DB never disagree about what a row is.
 */
export function isCustomerRefundPartner(partner: {
  type?: string | null
  name_hebrew?: string | null
}): boolean {
  if (partner.type === "customer_refund") return true
  // The name marker wins over the `type` column on purpose: `type` DEFAULTs to
  // 'affiliate', and the main app inserts these rows without setting it — so a
  // brand-new refund row arrives typed as an influencer. Trusting `type` here
  // would let every row created after this deploy back into the partner lists.
  return partner.name_hebrew?.includes(CUSTOMER_REFUND_NAME_MARKER) ?? false
}

/**
 * How `partners.commission` is read. The column carries no unit of its own.
 * `fixed_per_ticket` is the DB default and how every legacy partner is paid.
 */
export const COMMISSION_TYPES = ["fixed_per_ticket", "percent_of_sale"] as const
export type CommissionType = (typeof COMMISSION_TYPES)[number]

export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  fixed_per_ticket: "דולר לכרטיס",
  percent_of_sale: "אחוז ממחיר החבילה",
}

export type Partner = {
  created_at: string
  name_hebrew: string | null
  partner_tracking_code: string
  email: string
  password: string
  commission: number
  commission_type: CommissionType | null
  user_discount: number
  /** The partner's company/VAT number (ח.פ), printed on the monthly report. */
  supplier_number: number | null
  type: PartnerType | null
  is_active: boolean
}

/** Fields a staff user may set. Excludes the PK and server-owned columns. */
export type PartnerInput = Omit<Partner, "created_at" | "partner_tracking_code">
