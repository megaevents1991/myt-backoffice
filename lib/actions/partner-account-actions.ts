"use server"

import { requireAdmin } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import { logAudit } from "@/lib/audit"
import {
  COMMISSION_TYPES,
  MARKETING_PARTNER_TYPES,
  isCustomerRefundPartner,
  type CommissionType,
  type PartnerType,
} from "@/types/partner.types"
import type { Role } from "@/types/auth.types"

/**
 * A partner and its portal login are one thing to staff and two rows to the DB:
 * `partners` holds the commercial terms, `user_profiles` + Supabase Auth hold
 * the login, contact details and signed agreement. Creating one without the
 * other is what left agents unable to log in and logins pointing at nothing.
 *
 * Everything here writes BOTH sides or neither.
 */

/** Only marketing partners get a login — customer-refund rows never do. */
export type MarketingPartnerType = (typeof MARKETING_PARTNER_TYPES)[number]

export interface PartnerAccountInput {
  partner_tracking_code: string
  /** Stored as `partners.name_hebrew` and `user_profiles.display_name`. */
  name: string
  email: string
  phone?: string | null
  type: MarketingPartnerType
  /** Required when creating, and when adding a login to a legacy partner. */
  password?: string | null
  commission: number
  commission_type: CommissionType
  /** Discount passed on to the partner's followers. */
  user_discount: number
  /** Company/VAT number (ח.פ). */
  supplier_number?: number | null
  is_active: boolean
}

export type PartnerAccountResult =
  | { ok: true; partner_tracking_code: string; user_id: string | null }
  | { ok: false; error: string }

const MIN_PASSWORD_LENGTH = 8

function validate(input: PartnerAccountInput): string | null {
  if (!input.partner_tracking_code?.trim()) return "Tracking code is required"
  if (!input.email?.trim()) return "Email is required"
  if (!input.name?.trim()) return "Name is required"
  if (!MARKETING_PARTNER_TYPES.includes(input.type)) {
    return `Partner type must be one of ${MARKETING_PARTNER_TYPES.join(", ")}`
  }
  if (!COMMISSION_TYPES.includes(input.commission_type)) {
    return `Commission type must be one of ${COMMISSION_TYPES.join(", ")}`
  }
  if (!Number.isFinite(input.commission) || input.commission < 0) {
    return "Commission must be a non-negative number"
  }
  if (input.commission_type === "percent_of_sale" && input.commission > 100) {
    return "A percentage commission cannot exceed 100"
  }
  if (!Number.isFinite(input.user_discount) || input.user_discount < 0) {
    return "Follower discount must be a non-negative number"
  }
  if (input.supplier_number != null && !Number.isFinite(input.supplier_number)) {
    return "Company number (ח.פ) must be a number"
  }
  return null
}

/** The partner columns, mapped explicitly — never spread caller input. */
function partnerRow(input: PartnerAccountInput) {
  return {
    name_hebrew: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    commission: input.commission,
    commission_type: input.commission_type,
    user_discount: input.user_discount,
    supplier_number: input.supplier_number ?? null,
    type: input.type as PartnerType,
    is_active: input.is_active,
  }
}

async function findLinkedUser(trackingCode: string) {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("id,email,role,is_active")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle()
  if (error) {
    console.error("findLinkedUser:", JSON.stringify(error))
    return null
  }
  return data as { id: string; email: string; role: Role; is_active: boolean } | null
}

/**
 * Create a partner and its portal login together.
 *
 * The partner row goes in first because the login's `partner_tracking_code` is
 * a foreign key onto it. If the login then fails, the partner row is removed so
 * a failed submit never leaves a half-built account behind.
 */
export async function createPartnerAccount(
  input: PartnerAccountInput
): Promise<PartnerAccountResult> {
  const actor = await requireAdmin()

  const invalid = validate(input)
  if (invalid) return { ok: false, error: invalid }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }
  }

  const trackingCode = input.partner_tracking_code.trim()
  const email = input.email.trim().toLowerCase()

  const { data: existing } = await supabase
    .from("partners")
    .select("partner_tracking_code")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle()
  if (existing) {
    return { ok: false, error: `Tracking code "${trackingCode}" is already taken` }
  }

  const { error: partnerError } = await supabase.from("partners").insert({
    ...partnerRow(input),
    partner_tracking_code: trackingCode,
    // Legacy plaintext column the main app reads for affiliate auth. The portal
    // login lives in Supabase Auth, so this gets an unusable sentinel — never
    // the real password, and never "" (which an equality check could match).
    password: `disabled-${crypto.randomUUID()}`,
    created_at: new Date().toISOString().slice(0, 10),
  })
  if (partnerError) {
    console.error("createPartnerAccount partner:", JSON.stringify(partnerError))
    return { ok: false, error: "Could not create the partner" }
  }

  const user = await createPortalUser({
    email,
    password: input.password,
    displayName: input.name.trim(),
    role: input.type,
    trackingCode,
    phone: input.phone ?? null,
    createdBy: actor.sub,
  })

  if (!user.ok) {
    // Undo the partner so the submit is all-or-nothing.
    const { error: rollbackError } = await supabase
      .from("partners")
      .delete()
      .eq("partner_tracking_code", trackingCode)
    if (rollbackError) {
      console.error(
        "createPartnerAccount rollback failed (orphan partner):",
        JSON.stringify(rollbackError)
      )
      return {
        ok: false,
        error: `${user.error}. The partner row could not be rolled back — delete "${trackingCode}" manually.`,
      }
    }
    return { ok: false, error: user.error }
  }

  await logAudit({
    action: "create",
    entityType: "partner",
    entityId: trackingCode,
    changes: { ...partnerRow(input), user_id: user.id, phone: input.phone ?? null },
  })

  return { ok: true, partner_tracking_code: trackingCode, user_id: user.id }
}

/**
 * Update a partner and its login together. A legacy partner with no login gets
 * one as soon as a password is supplied — that is the backfill path for the
 * partners that predate user management.
 */
export async function updatePartnerAccount(
  trackingCode: string,
  input: PartnerAccountInput
): Promise<PartnerAccountResult> {
  const actor = await requireAdmin()

  const invalid = validate(input)
  if (invalid) return { ok: false, error: invalid }

  // Customer-refund rows are opened per booking by the main app. Saving one
  // through this form would retype it as a real affiliate and — if a password
  // were typed — mint a portal login for a customer's refund record.
  const { data: current, error: currentError } = await supabase
    .from("partners")
    .select("type,name_hebrew")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle()
  if (currentError) {
    // Never fall through to the update — that would skip the guard below.
    console.error("updatePartnerAccount lookup:", JSON.stringify(currentError))
    return { ok: false, error: "Could not verify this partner" }
  }
  if (current && isCustomerRefundPartner(current as { type?: string | null; name_hebrew?: string | null })) {
    return {
      ok: false,
      error: "This is an automatic customer-refund record and cannot be edited as a partner",
    }
  }

  const { error: partnerError } = await supabase
    .from("partners")
    .update(partnerRow(input))
    .eq("partner_tracking_code", trackingCode)
  if (partnerError) {
    console.error("updatePartnerAccount partner:", JSON.stringify(partnerError))
    return { ok: false, error: "Could not update the partner" }
  }

  const linked = await findLinkedUser(trackingCode)

  if (!linked) {
    if (!input.password) {
      // Terms updated, still no way in. Reported, not silently ignored.
      await logAudit({
        action: "update",
        entityType: "partner",
        entityId: trackingCode,
        changes: partnerRow(input),
      })
      return { ok: true, partner_tracking_code: trackingCode, user_id: null }
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }
    }
    const created = await createPortalUser({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      displayName: input.name.trim(),
      role: input.type,
      trackingCode,
      phone: input.phone ?? null,
      createdBy: actor.sub,
    })
    if (!created.ok) return { ok: false, error: created.error }
    await logAudit({
      action: "update",
      entityType: "partner",
      entityId: trackingCode,
      changes: { ...partnerRow(input), user_id: created.id },
    })
    return { ok: true, partner_tracking_code: trackingCode, user_id: created.id }
  }

  // Keep the login in step: role follows the partner type, and a disabled
  // partner must not still be able to sign in.
  const { error: profileError } = await (supabase as any)
    .from("user_profiles")
    .update({
      display_name: input.name.trim(),
      role: input.type,
      phone: input.phone ?? null,
      is_active: input.is_active,
    })
    .eq("id", linked.id)
  if (profileError) {
    console.error("updatePartnerAccount profile:", JSON.stringify(profileError))
    return { ok: false, error: "Partner saved, but its login could not be updated" }
  }

  if (input.password) {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }
    }
    const { error: pwError } = await supabase.auth.admin.updateUserById(linked.id, {
      password: input.password,
    })
    if (pwError) {
      console.error("updatePartnerAccount password:", JSON.stringify(pwError))
      return { ok: false, error: "Partner saved, but the password could not be changed" }
    }
    await logAudit({ action: "password_reset", entityType: "user", entityId: linked.id })
  }

  await logAudit({
    action: "update",
    entityType: "partner",
    entityId: trackingCode,
    changes: { ...partnerRow(input), user_id: linked.id },
  })

  return { ok: true, partner_tracking_code: trackingCode, user_id: linked.id }
}

/**
 * Auth user + profile, rolling the auth user back if the profile insert fails
 * so a retry isn't blocked by an email that is taken but unusable.
 */
async function createPortalUser(args: {
  email: string
  password: string
  displayName: string
  role: MarketingPartnerType
  trackingCode: string
  phone: string | null
  createdBy: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
  })
  if (authError || !created?.user) {
    console.error("createPortalUser auth:", JSON.stringify(authError))
    return {
      ok: false,
      error: authError?.message ?? "Could not create the login for this partner",
    }
  }

  const { error: profileError } = await (supabase as any).from("user_profiles").insert({
    id: created.user.id,
    email: args.email,
    display_name: args.displayName || null,
    role: args.role,
    partner_tracking_code: args.trackingCode,
    phone: args.phone || null,
    is_active: true,
    created_by: args.createdBy,
  })
  if (profileError) {
    console.error("createPortalUser profile:", JSON.stringify(profileError))
    await supabase.auth.admin
      .deleteUser(created.user.id)
      .catch((e) =>
        console.error("createPortalUser rollback failed (orphan auth user):", JSON.stringify(e))
      )
    return { ok: false, error: "Could not create the login for this partner" }
  }

  await logAudit({
    action: "user_created",
    entityType: "user",
    entityId: created.user.id,
    changes: {
      email: args.email,
      role: args.role,
      partner_tracking_code: args.trackingCode,
      display_name: args.displayName || null,
    },
  })
  return { ok: true, id: created.user.id }
}

/** The partner + login as one record, for the unified edit form. */
export interface PartnerAccount extends PartnerAccountInput {
  user_id: string | null
  user_email: string | null
  contract_url: string | null
  /** Auto-created per booking — not editable as a partner. */
  is_customer_refund: boolean
}

export async function getPartnerAccount(
  trackingCode: string
): Promise<PartnerAccount | null> {
  await requireAdmin()

  const { data: partner, error } = await supabase
    .from("partners")
    .select(
      "partner_tracking_code,name_hebrew,email,commission,commission_type,user_discount,supplier_number,type,is_active"
    )
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle()
  if (error) {
    console.error("getPartnerAccount:", JSON.stringify(error))
    throw error
  }
  if (!partner) return null

  const row = partner as unknown as {
    partner_tracking_code: string
    name_hebrew: string | null
    email: string
    commission: number
    commission_type: CommissionType | null
    user_discount: number
    supplier_number: number | null
    type: PartnerType | null
    is_active: boolean
  }

  const { data: profile } = await (supabase as any)
    .from("user_profiles")
    .select("id,email,phone,contract_url")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle()

  return {
    partner_tracking_code: row.partner_tracking_code,
    name: row.name_hebrew ?? "",
    email: row.email,
    phone: profile?.phone ?? null,
    type: row.type === "agent" ? "agent" : "affiliate",
    password: null,
    commission: row.commission ?? 0,
    commission_type: row.commission_type ?? "fixed_per_ticket",
    user_discount: row.user_discount ?? 0,
    supplier_number: row.supplier_number,
    is_active: row.is_active,
    user_id: profile?.id ?? null,
    user_email: profile?.email ?? null,
    contract_url: profile?.contract_url ?? null,
    is_customer_refund: isCustomerRefundPartner(row),
  }
}
