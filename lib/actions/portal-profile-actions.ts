"use server"

import { requirePartner } from "@/lib/auth/guards"
import { supabase } from "@/lib/supabase-server"
import { verifyPassword } from "@/lib/auth/supabase-auth"
import { logAudit } from "@/lib/audit"

/**
 * Partner self-service profile (פעולות על הפרופיל).
 *
 * Everything here operates on the SIGNED-IN partner only (session.sub /
 * session.partner_code) — no id ever comes from the client. Password and email
 * changes re-verify the current password first: the admin API doesn't, and a
 * borrowed open tab must not be enough to take over the account.
 *
 * The payment card is stored MASKED (holder/brand/last4/expiry). Full card
 * numbers are rejected outright — we never hold a PAN, anywhere.
 */

const MIN_PASSWORD_LENGTH = 8

export interface MyProfileDetails {
  email: string
  display_name: string | null
  phone: string | null
  logo_url: string | null
  /** The uploaded agreement — null when staff never attached one. */
  contract_url: string | null
  role: "agent" | "affiliate"
  commission: number
  commission_type: string
  user_discount: number
  bank_details: BankDetails | null
  payment_card: PaymentCardMasked | null
}

export interface BankDetails {
  bank_name: string
  branch: string
  account_number: string
  account_holder: string
}

export interface PaymentCardMasked {
  holder: string
  brand: string
  last4: string
  /** MM/YY */
  expiry: string
}

type ActionResult = { ok: true } | { ok: false; error: string }

export async function getMyProfileDetails(): Promise<MyProfileDetails | null> {
  const session = await requirePartner()

  const fetchPartner = (columns: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("partners")
      .select(columns)
      .eq("partner_tracking_code", session.partner_code)
      .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profilePromise = (supabase as any)
    .from("user_profiles")
    .select("email,display_name,phone,logo_url,contract_url")
    .eq("id", session.sub)
    .maybeSingle()

  const [initialPartnerResult, profileResult] = await Promise.all([
    fetchPartner(
      "commission,commission_type,user_discount,bank_details,payment_card"
    ),
    profilePromise,
  ])
  let partnerResult = initialPartnerResult
  if (partnerResult.error?.code === "42703") {
    // bank/card columns not migrated yet — the sections just render empty.
    partnerResult = await fetchPartner("commission,commission_type,user_discount")
  }

  if (partnerResult.error) {
    console.error("getMyProfileDetails partner:", JSON.stringify(partnerResult.error))
    return null
  }
  if (profileResult.error) {
    console.error("getMyProfileDetails profile:", JSON.stringify(profileResult.error))
    return null
  }
  if (!partnerResult.data) return null

  const partner = partnerResult.data as {
    commission: number | null
    commission_type: string | null
    user_discount: number | null
    bank_details?: BankDetails | null
    payment_card?: PaymentCardMasked | null
  }
  const profile = (profileResult.data ?? {}) as {
    email?: string
    display_name?: string | null
    phone?: string | null
    logo_url?: string | null
    contract_url?: string | null
  }

  return {
    email: profile.email ?? session.email,
    display_name: profile.display_name ?? null,
    phone: profile.phone ?? null,
    logo_url: profile.logo_url ?? null,
    contract_url: profile.contract_url ?? null,
    role: session.role as "agent" | "affiliate",
    commission: Number(partner.commission ?? 0),
    commission_type: partner.commission_type ?? "fixed_per_ticket",
    user_discount: Number(partner.user_discount ?? 0),
    bank_details: partner.bank_details ?? null,
    payment_card: partner.payment_card ?? null,
  }
}

export async function changeMyPassword(input: {
  current: string
  next: string
}): Promise<ActionResult> {
  const session = await requirePartner()
  if (!input.next || input.next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `סיסמה חדשה: לפחות ${MIN_PASSWORD_LENGTH} תווים` }
  }
  const verified = await verifyPassword(session.email, input.current ?? "")
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.reason === "transient"
          ? "לא הצלחנו לאמת את הסיסמה כרגע. נסו שוב בעוד רגע."
          : "הסיסמה הנוכחית שגויה",
    }
  }
  const { error } = await supabase.auth.admin.updateUserById(session.sub, {
    password: input.next,
  })
  if (error) {
    console.error("changeMyPassword:", JSON.stringify(error))
    return { ok: false, error: "שינוי הסיסמה נכשל. נסו שוב." }
  }
  await logAudit({ action: "password_reset", entityType: "user", entityId: session.sub })
  return { ok: true }
}

export async function changeMyEmail(input: {
  next: string
  currentPassword: string
}): Promise<ActionResult> {
  const session = await requirePartner()
  const next = input.next?.trim().toLowerCase()
  if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
    return { ok: false, error: "כתובת מייל לא תקינה" }
  }
  const verified = await verifyPassword(session.email, input.currentPassword ?? "")
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.reason === "transient"
          ? "לא הצלחנו לאמת את הסיסמה כרגע. נסו שוב בעוד רגע."
          : "הסיסמה הנוכחית שגויה",
    }
  }

  // Identity first — if the auth update fails nothing else moved.
  const { error: authError } = await supabase.auth.admin.updateUserById(session.sub, {
    email: next,
    email_confirm: true,
  })
  if (authError) {
    console.error("changeMyEmail auth:", JSON.stringify(authError))
    const taken = (authError as { code?: string }).code === "email_exists"
    return {
      ok: false,
      error: taken ? "הכתובת הזו כבר בשימוש" : "שינוי המייל נכשל. נסו שוב.",
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: profileError } = await (supabase as any)
    .from("user_profiles")
    .update({ email: next })
    .eq("id", session.sub)
  if (profileError) {
    console.error("changeMyEmail profile:", JSON.stringify(profileError))
    return {
      ok: false,
      error: "המייל עודכן חלקית — פנו אלינו כדי להשלים את העדכון.",
    }
  }
  // partners.email feeds the monthly report — keep it in step, best-effort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: partnerError } = await (supabase as any)
    .from("partners")
    .update({ email: next })
    .eq("partner_tracking_code", session.partner_code)
  if (partnerError) {
    console.error("changeMyEmail partner:", JSON.stringify(partnerError))
  }
  await logAudit({
    action: "update",
    entityType: "user",
    entityId: session.sub,
    changes: { email: next },
  })
  return { ok: true }
}

export async function updateMyPhone(input: { phone: string }): Promise<ActionResult> {
  const session = await requirePartner()
  const phone = input.phone?.trim() ?? ""
  if (phone && !/^[\d+\-\s()]{6,20}$/.test(phone)) {
    return { ok: false, error: "מספר טלפון לא תקין" }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_profiles")
    .update({ phone: phone || null })
    .eq("id", session.sub)
  if (error) {
    console.error("updateMyPhone:", JSON.stringify(error))
    return { ok: false, error: "עדכון הטלפון נכשל. נסו שוב." }
  }
  await logAudit({
    action: "update",
    entityType: "user",
    entityId: session.sub,
    changes: { phone: phone || null },
  })
  return { ok: true }
}

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : ""

export async function updateMyBankDetails(input: BankDetails): Promise<ActionResult> {
  const session = await requirePartner()
  const details: BankDetails = {
    bank_name: text(input.bank_name, 60),
    branch: text(input.branch, 20),
    account_number: text(input.account_number, 30),
    account_holder: text(input.account_holder, 80),
  }
  if (!details.bank_name || !details.account_number || !details.account_holder) {
    return { ok: false, error: "בנק, מספר חשבון ושם בעל החשבון — חובה" }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("partners")
    .update({ bank_details: details })
    .eq("partner_tracking_code", session.partner_code)
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      return {
        ok: false,
        error: "היכולת הזו תהיה זמינה אחרי עדכון המערכת הקרוב.",
      }
    }
    console.error("updateMyBankDetails:", JSON.stringify(error))
    return { ok: false, error: "שמירת פרטי הבנק נכשלה. נסו שוב." }
  }
  await logAudit({
    action: "update",
    entityType: "partner",
    entityId: session.partner_code,
    metadata: { bank_details_updated: true },
  })
  return { ok: true }
}

export async function updateMyPaymentCard(
  input: PaymentCardMasked
): Promise<ActionResult> {
  const session = await requirePartner()
  const holder = text(input.holder, 80)
  const brand = text(input.brand, 20)
  const last4 = text(input.last4, 30)
  const expiry = text(input.expiry, 7)

  // NEVER a full card number: exactly four digits, and no field may smuggle a
  // longer digit run in.
  if (!/^\d{4}$/.test(last4)) {
    return {
      ok: false,
      error: "מזינים רק את 4 הספרות האחרונות — אנחנו לא שומרים מספר כרטיס מלא",
    }
  }
  for (const value of [holder, brand, expiry]) {
    if (/\d{5,}/.test(value)) {
      return { ok: false, error: "אין להזין מספר כרטיס מלא באף שדה" }
    }
  }
  if (expiry && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
    return { ok: false, error: "תוקף בפורמט MM/YY" }
  }
  if (!holder) {
    return { ok: false, error: "שם בעל הכרטיס — חובה" }
  }

  const card: PaymentCardMasked = { holder, brand, last4, expiry }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("partners")
    .update({ payment_card: card })
    .eq("partner_tracking_code", session.partner_code)
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") {
      return {
        ok: false,
        error: "היכולת הזו תהיה זמינה אחרי עדכון המערכת הקרוב.",
      }
    }
    console.error("updateMyPaymentCard:", JSON.stringify(error))
    return { ok: false, error: "שמירת פרטי הכרטיס נכשלה. נסו שוב." }
  }
  await logAudit({
    action: "update",
    entityType: "partner",
    entityId: session.partner_code,
    metadata: { payment_card_updated: true, last4 },
  })
  return { ok: true }
}

/**
 * An influencer shifts points between their commission and their followers'
 * discount. The SUM is the agreement with us and cannot change here — only how
 * it is split. Both figures share the commission's unit (percent or $).
 */
export async function rebalanceMyCommissionSplit(input: {
  commission: number
  user_discount: number
}): Promise<ActionResult> {
  const session = await requirePartner()
  if (session.role !== "affiliate") {
    return { ok: false, error: "שינוי היחס זמין למשפיענים בלבד" }
  }
  const commission = Math.floor(Number(input.commission))
  const discount = Math.floor(Number(input.user_discount))
  if (
    !Number.isFinite(commission) ||
    !Number.isFinite(discount) ||
    commission < 0 ||
    discount < 0
  ) {
    return { ok: false, error: "ערכים לא תקינים" }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("partners")
    .select("commission,user_discount")
    .eq("partner_tracking_code", session.partner_code)
    .maybeSingle()
  if (error || !data) {
    console.error("rebalanceMyCommissionSplit read:", JSON.stringify(error))
    return { ok: false, error: "לא הצלחנו לקרוא את התנאים הנוכחיים. נסו שוב." }
  }
  const currentTotal = Number(data.commission ?? 0) + Number(data.user_discount ?? 0)
  if (commission + discount !== currentTotal) {
    return {
      ok: false,
      error: `הסכום הכולל חייב להישאר ${currentTotal} — אפשר רק לשנות את החלוקה`,
    }
  }

  // Guarded update: only flips if the row still holds the values we validated
  // against, so two concurrent submits can't smuggle a total change through.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: updateError } = await (supabase as any)
    .from("partners")
    .update({ commission, user_discount: discount })
    .eq("partner_tracking_code", session.partner_code)
    .eq("commission", data.commission)
    .eq("user_discount", data.user_discount)
    .select("partner_tracking_code")
    .maybeSingle()
  if (updateError) {
    console.error("rebalanceMyCommissionSplit:", JSON.stringify(updateError))
    return { ok: false, error: "העדכון נכשל. נסו שוב." }
  }
  if (!updated) {
    return { ok: false, error: "התנאים השתנו הרגע — רעננו ונסו שוב." }
  }
  await logAudit({
    action: "update",
    entityType: "partner",
    entityId: session.partner_code,
    changes: { commission, user_discount: discount },
    metadata: { self_service_rebalance: true },
  })
  return { ok: true }
}
