"use server"

import { supabase } from "@/lib/supabase-server"
import type { Partner } from "@/types/partner.types"

export async function getPartners() {
  const { data, error } = await supabase.from("partners").select("*").order("created_at", { ascending: false })

  if (error) throw error
  return data as Partner[]
}

export async function getPartner(trackingCode: string) {
  const { data, error } = await supabase.from("partners").select("*").eq("partner_tracking_code", trackingCode).single()

  if (error) throw error
  return data as Partner
}

export async function createPartner(partner: Omit<Partner, "created_at">) {
  const { data, error } = await supabase.from("partners").insert(partner).select()

  if (error) throw error
  return data[0] as Partner
}

export async function updatePartner(trackingCode: string, partner: Partial<Partner>) {
  const { data, error } = await supabase
    .from("partners")
    .update(partner)
    .eq("partner_tracking_code", trackingCode)
    .select()

  if (error) throw error
  return data[0] as Partner
}

export async function deletePartner(trackingCode: string) {
  const { error } = await supabase.from("partners").delete().eq("partner_tracking_code", trackingCode)

  if (error) throw error
  return true
}

export async function bulkDeletePartners(trackingCodes: string[]) {
  const { error } = await supabase.from("partners").delete().in("partner_tracking_code", trackingCodes)

  if (error) throw error
  return true
}

export async function duplicatePartner(trackingCode: string) {
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
  return newPartnerData[0] as Partner
}

export async function bulkDuplicatePartners(trackingCodes: string[]) {
  const duplicatedPartners: Partner[] = []

  // We need to duplicate each partner one by one
  for (const trackingCode of trackingCodes) {
    const duplicatedPartner = await duplicatePartner(trackingCode)
    duplicatedPartners.push(duplicatedPartner)
  }

  return duplicatedPartners
}

