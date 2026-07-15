"use server"

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server"
import type { Partner } from "@/types/partner.types"
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit"

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

export async function getPartners() {
  await requireStaff();
  const { data, error } = await supabase.from("partners").select("*").order("created_at", { ascending: false })

  if (error) throw error
  return data as Partner[]
}

export async function getPartner(trackingCode: string) {
  await requireStaff();
  const { data, error } = await supabase.from("partners").select("*").eq("partner_tracking_code", trackingCode).single()

  if (error) throw error
  return data as Partner
}

export async function createPartner(partner: Omit<Partner, "created_at">) {
  await requireStaff();
  const { data, error } = await supabase.from("partners").insert(partner).select()

  if (error) throw error
  const created = data[0] as Partner
  await logAudit({
    action: "create",
    entityType: "partner",
    entityId: created.partner_tracking_code,
    changes: redactPassword(partner),
  })
  return created
}

export async function updatePartner(trackingCode: string, partner: Partial<Partner>) {
  await requireStaff();
  const before = await fetchBefore("partners", "partner_tracking_code", trackingCode, partner)
  const { data, error } = await supabase
    .from("partners")
    .update(partner)
    .eq("partner_tracking_code", trackingCode)
    .select()

  if (error) throw error
  await logAudit({
    action: "update",
    entityType: "partner",
    entityId: trackingCode,
    changes: redactPasswordDiff(diffChanges(before, partner)),
  })
  return data[0] as Partner
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

export async function duplicatePartner(trackingCode: string, opts?: { skipAudit?: boolean }) {
  await requireStaff();
  // First get the partner to duplicate
  const { data: partnerToDuplicate, error: fetchError } = await supabase
    .from("partners")
    .select("*")
    .eq("partner_tracking_code", trackingCode)
    .single()

  if (fetchError) throw fetchError

  // Generate a new tracking code
  const newTrackingCode = `${trackingCode}_copy_${Date.now().toString().slice(-6)}`

  // Create the new partner with the new tracking code
  const newPartner = {
    ...partnerToDuplicate,
    partner_tracking_code: newTrackingCode,
    email: `copy_${partnerToDuplicate.email}`,
    created_at: new Date().toISOString(),
  }

  // Insert the new partner
  const { data: newPartnerData, error: insertError } = await supabase.from("partners").insert(newPartner).select()

  if (insertError) throw insertError
  const created = newPartnerData[0] as Partner
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

export async function bulkDuplicatePartners(trackingCodes: string[]) {
  await requireStaff();
  const duplicatedPartners: Partner[] = []

  // We need to duplicate each partner one by one
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

