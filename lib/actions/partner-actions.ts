"use server"

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server"
import { PARTNER_TYPES, type Partner, type PartnerInput, type PartnerType } from "@/types/partner.types"
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit"

/** Columns a staff user is allowed to write. Anything else is dropped. */
const WRITABLE_COLUMNS = [
  "name_hebrew",
  "email",
  "password",
  "commission",
  "user_discount",
  "supplier_number",
  "type",
  "is_active",
] as const satisfies readonly (keyof PartnerInput)[]

function assertMoney(label: string, value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be a non-negative number`)
  }
  return n
}

/**
 * Map client input to DB columns explicitly — never spread a caller-supplied
 * object into a row, or a crafted call could set commission/is_active/type.
 */
function toPartnerRow(input: Partial<PartnerInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const column of WRITABLE_COLUMNS) {
    if (!(column in input)) continue
    const value = input[column]
    switch (column) {
      case "commission":
      case "user_discount":
        row[column] = assertMoney(column, value)
        break
      case "type":
        if (value != null && !PARTNER_TYPES.includes(value as PartnerType)) {
          throw new Error(`type must be one of ${PARTNER_TYPES.join(", ")}`)
        }
        row[column] = value ?? null
        break
      case "supplier_number":
        row[column] =
          value === "" || value == null ? null : assertMoney("supplier_number", value)
        break
      case "is_active":
        row[column] = Boolean(value)
        break
      default:
        row[column] = value
    }
  }
  return row
}

/** Never log partner passwords — redact before logAudit. */
function redactPassword<T extends Record<string, unknown>>(obj: T): T {
  if (!("password" in obj)) return obj
  return { ...obj, password: "***" }
}

function redactPasswordDiff(
  diff: Record<string, { from: unknown; to: unknown }>
): Record<string, { from: unknown; to: unknown }> {
  if (!("password" in diff)) return diff
  return { ...diff, password: { from: "***", to: "***" } }
}

/**
 * Never select `password` into a client component — it is stored in plaintext
 * and would ride along in the RSC payload of every partner list.
 */
const LIST_COLUMNS =
  "partner_tracking_code,name_hebrew,email,commission,user_discount,supplier_number,type,is_active,created_at"

export type PartnerListItem = Omit<Partner, "password">

export async function getPartners() {
  await requireStaff();
  const { data, error } = await supabase
    .from("partners")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data as unknown as PartnerListItem[]
}

export async function getPartner(trackingCode: string) {
  await requireStaff();
  const { data, error } = await supabase
    .from("partners")
    .select(LIST_COLUMNS)
    .eq("partner_tracking_code", trackingCode)
    .single()

  if (error) throw error
  return data as unknown as PartnerListItem
}

export async function createPartner(partner: PartnerInput & { partner_tracking_code: string }) {
  await requireStaff();
  const trackingCode = partner.partner_tracking_code?.trim()
  if (!trackingCode) throw new Error("Tracking code is required")

  const row = {
    ...toPartnerRow(partner),
    partner_tracking_code: trackingCode,
    created_at: new Date().toISOString().slice(0, 10),
  }
  const { data, error } = await supabase
    .from("partners")
    .insert(row)
    .select(LIST_COLUMNS)
    .single()

  if (error) throw error
  const created = data as unknown as PartnerListItem
  await logAudit({
    action: "create",
    entityType: "partner",
    entityId: created.partner_tracking_code,
    changes: redactPassword(row),
  })
  return created
}

export async function updatePartner(trackingCode: string, partner: Partial<PartnerInput>) {
  await requireStaff();
  const row = toPartnerRow(partner)
  const before = await fetchBefore("partners", "partner_tracking_code", trackingCode, row)
  const { data, error } = await supabase
    .from("partners")
    .update(row)
    .eq("partner_tracking_code", trackingCode)
    .select(LIST_COLUMNS)
    .single()

  if (error) throw error
  await logAudit({
    action: "update",
    entityType: "partner",
    entityId: trackingCode,
    changes: redactPasswordDiff(diffChanges(before, row)),
  })
  return data as unknown as PartnerListItem
}

export async function deletePartner(trackingCode: string) {
  await requireStaff();
  const { error } = await supabase.from("partners").delete().eq("partner_tracking_code", trackingCode)

  if (error) throw error
  await logAudit({ action: "delete", entityType: "partner", entityId: trackingCode })
  return true
}

export async function bulkDeletePartners(trackingCodes: string[]) {
  await requireStaff();
  const { error } = await supabase.from("partners").delete().in("partner_tracking_code", trackingCodes)

  if (error) throw error
  await logAudit({
    action: "delete",
    entityType: "partner",
    entityId: null,
    metadata: { ids: trackingCodes, count: trackingCodes.length },
  })
  return true
}

/**
 * Copy a partner as a starting point for a new one. The copy is created
 * INACTIVE and keeps the source email: staff must edit it before it goes live,
 * and until then the monthly report cron won't pay or mail it twice.
 */
export async function duplicatePartner(trackingCode: string, opts?: { skipAudit?: boolean }) {
  await requireStaff();
  const { data: sourceData, error: fetchError } = await supabase
    .from("partners")
    .select(LIST_COLUMNS)
    .eq("partner_tracking_code", trackingCode)
    .single()

  if (fetchError) throw fetchError
  const source = sourceData as unknown as PartnerListItem

  const newTrackingCode = await generateCopyTrackingCode(trackingCode)
  const row = {
    ...toPartnerRow({
      name_hebrew: source.name_hebrew,
      email: copyEmail(source.email, newTrackingCode),
      password: "",
      commission: source.commission,
      user_discount: source.user_discount,
      supplier_number: source.supplier_number,
      type: source.type,
      is_active: false,
    }),
    partner_tracking_code: newTrackingCode,
    created_at: new Date().toISOString().slice(0, 10),
  }

  const { data: insertedData, error: insertError } = await supabase
    .from("partners")
    .insert(row)
    .select(LIST_COLUMNS)
    .single()

  if (insertError) throw insertError
  const created = insertedData as unknown as PartnerListItem
  if (!opts?.skipAudit) {
    await logAudit({
      action: "create",
      entityType: "partner",
      entityId: created.partner_tracking_code,
      metadata: { duplicated_from: trackingCode },
    })
  }
  return created
}

/**
 * A unique address for a copied partner, via plus-addressing
 * (`a@b.com` → `a+CODE@b.com`). Two partners must not share an email: the main
 * app reads this table for affiliate auth. The old `copy_${email}` form was
 * unique but not a valid address, and the monthly cron would try to mail it.
 */
function copyEmail(email: string, newTrackingCode: string): string {
  const at = email.lastIndexOf("@")
  if (at <= 0) return `${email}+${newTrackingCode}`
  return `${email.slice(0, at)}+${newTrackingCode}@${email.slice(at + 1)}`
}

/**
 * `${code}_copy_${N}` with the first N that is free. The old millisecond-based
 * suffix collided whenever two copies landed in the same ms-mod-1e6 window.
 */
async function generateCopyTrackingCode(trackingCode: string): Promise<string> {
  const prefix = `${trackingCode}_copy_`
  const { data, error } = await supabase
    .from("partners")
    .select("partner_tracking_code")
    .like("partner_tracking_code", `${prefix}%`)

  if (error) throw error
  const taken = new Set((data ?? []).map((r) => (r as { partner_tracking_code: string }).partner_tracking_code))
  for (let n = 1; n <= taken.size + 1; n++) {
    const candidate = `${prefix}${n}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`Could not allocate a copy code for ${trackingCode}`)
}

export async function bulkDuplicatePartners(trackingCodes: string[]) {
  await requireStaff();
  const duplicatedPartners: PartnerListItem[] = []

  // Sequential: each copy's tracking code depends on the ones already inserted.
  for (const trackingCode of trackingCodes) {
    const duplicatedPartner = await duplicatePartner(trackingCode, { skipAudit: true })
    duplicatedPartners.push(duplicatedPartner)
  }

  await logAudit({
    action: "create",
    entityType: "partner",
    entityId: null,
    metadata: { ids: trackingCodes, count: trackingCodes.length },
  })
  return duplicatedPartners
}

