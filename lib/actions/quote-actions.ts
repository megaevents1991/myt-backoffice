"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { computePackagePrice, type PackagePriceEvent } from "@/lib/package-price";

export interface QuoteEventOption {
  id: number;
  name: string;
  date: string | null;
  location: string | null;
  suggested_price: number | null;
}

export interface QuoteLineItem {
  label: string;
  qty: number;
  unit_price: number;
}

export interface PortalQuote {
  id: number;
  created_at: string;
  customer_name: string | null;
  title: string | null;
  total: number | null;
  valid_until: string | null;
  status: string;
  pdf_storage_path: string | null;
  event_id: number | null;
}

type QuoteEventRow = PackagePriceEvent & {
  id: number;
  name: string;
  date: string | null;
  location: { name: string } | null;
};

export async function getQuoteEvents(): Promise<QuoteEventOption[]> {
  await requirePartner();
  const { data, error } = await (supabase as any)
    .from("events")
    .select(
      "id,name,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel",
    )
    .is("is_deleted", null)
    .gte("date", new Date().toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .limit(300);
  if (error) {
    console.error("getQuoteEvents:", JSON.stringify(error));
    return [];
  }
  return ((data ?? []) as QuoteEventRow[]).map((event) => ({
    id: event.id,
    name: event.name,
    date: event.date ?? null,
    location: event.location?.name ?? null,
    suggested_price: computePackagePrice(event),
  }));
}

export async function getPortalQuotes(): Promise<PortalQuote[]> {
  const session = await requirePartner();
  const { data, error } = await (supabase as any)
    .from("quotes")
    .select(
      "id,created_at,customer_name,title,total,valid_until,status,pdf_storage_path,event_id",
    )
    .eq("partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getPortalQuotes:", JSON.stringify(error));
    return [];
  }
  return (data as PortalQuote[]) ?? [];
}

export async function createQuote(input: {
  event_id?: number | null;
  customer_name: string;
  title: string;
  line_items: QuoteLineItem[];
  notes?: string | null;
  valid_until?: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const session = await requirePartner();

  const customer_name = input.customer_name?.trim();
  const title = input.title?.trim();
  if (!customer_name) return { ok: false, error: "Customer name is required" };
  if (!title) return { ok: false, error: "Title is required" };
  if (!Array.isArray(input.line_items) || input.line_items.length === 0) {
    return { ok: false, error: "At least one line item is required" };
  }

  for (const item of input.line_items) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Invalid line item" };
    }
    if (typeof item.label !== "string" || !item.label.trim()) {
      return { ok: false, error: "Every line item needs a label" };
    }
    if (
      !Number.isFinite(item.qty) ||
      !Number.isInteger(item.qty) ||
      item.qty <= 0 ||
      item.qty > 999
    ) {
      return { ok: false, error: `Invalid quantity for "${item.label}"` };
    }
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
      return { ok: false, error: `Invalid unit price for "${item.label}"` };
    }
    if (item.unit_price > 1_000_000) {
      return { ok: false, error: "Amount too large" };
    }
  }

  const total =
    Math.round(
      input.line_items.reduce((s, i) => s + i.qty * i.unit_price, 0) * 100,
    ) / 100;
  if (total > 10_000_000) {
    return { ok: false, error: "Amount too large" };
  }

  const { data, error } = await (supabase as any)
    .from("quotes")
    .insert({
      created_by: session.sub,
      partner_tracking_code: session.partner_code,
      event_id: input.event_id ?? null,
      customer_name,
      title,
      line_items: input.line_items,
      currency: "USD",
      total,
      notes: input.notes ?? null,
      valid_until: input.valid_until ?? null,
      status: "final",
    })
    .select("id")
    .single();

  if (error) {
    console.error("createQuote:", JSON.stringify(error));
    return { ok: false, error: "Failed to create quote" };
  }

  await logAudit({
    action: "quote_created",
    entityType: "quote",
    entityId: data.id,
    changes: { customer_name, title, total, event_id: input.event_id ?? null },
  });

  return { ok: true, id: data.id };
}
