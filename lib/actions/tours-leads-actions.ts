"use server";

/**
 * Leads inbox of a tours company: every form of the customer site (lead form,
 * contact, cancellation request, newsletter, advisor request) lands in
 * public.leads through c_<slug>.submit_lead(). This file is the backoffice
 * side: read, filter, change status, assign, export.
 */
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import type { SessionPayload } from "@/lib/auth/session";
import type { Json } from "@/types/database.types";
import { LEAD_KIND_LABELS, type Lead } from "@/types/tours.types";
import {
  LEADS_PAGE_SIZE,
  LEAD_STATUSES,
  leadStatusLabel,
  type ActionResult,
  type LeadAssignee,
  type LeadFilters,
  type LeadRow,
  type LeadsExport,
  type LeadsMeta,
  type LeadsPage,
  type LeadStatus,
} from "@/components/tours/content/shared";

const EXPORT_LIMIT = 20000;
const COLUMNS = "id, created_at, kind, name, phone, email, message, source_path, status, assigned_to, payload, utm";

function failure(e: unknown, fallback: string): { success: false; error: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith("Forbidden: the active company")) {
    return { success: false, error: "המסך הזה שייך לחברה שמוכרת טיולים. החליפו חברה בסרגל העליון." };
  }
  if (message === "Unauthorized") return { success: false, error: "אין הרשאה לפעולה הזו" };
  console.error(`${fallback}:`, e);
  return { success: false, error: fallback };
}

/**
 * A spreadsheet cell has no timezone: it shows the clock reading it is given.
 * Shift the instant so the cell reads the operators' local time (Israel).
 */
function wallClock(iso: string, timeZone = "Asia/Jerusalem"): Date {
  const instant = new Date(iso);
  const inZone = new Date(instant.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(instant.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(instant.getTime() + (inZone.getTime() - inUtc.getTime()));
}

const asRecord = (value: Json): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

type LeadColumns = Pick<
  Lead,
  "id" | "created_at" | "kind" | "name" | "phone" | "email" | "message" | "source_path" | "status" | "assigned_to" | "payload" | "utm"
>;

const toRow = (lead: LeadColumns): LeadRow => ({
  id: lead.id,
  createdAt: lead.created_at,
  kind: lead.kind,
  name: lead.name,
  phone: lead.phone,
  email: lead.email,
  message: lead.message,
  sourcePath: lead.source_path,
  status: lead.status,
  assignedTo: lead.assigned_to,
  payload: asRecord(lead.payload),
  utm: asRecord(lead.utm),
});

const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The day after, so "to" is inclusive whatever the time of day. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The instant a calendar day starts for the operators (Israel time), as ISO. */
function dayStart(day: string, timeZone = "Asia/Jerusalem"): string {
  const utc = new Date(`${day}T00:00:00Z`);
  const inZone = new Date(utc.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(utc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(utc.getTime() - (inZone.getTime() - inUtc.getTime())).toISOString();
}

/** The company's leads narrowed by the filters. Company scope is applied here, once. */
function filtered(company: Company, filters: LeadFilters, withCount: boolean) {
  let query = supabaseTyped
    .from("leads")
    .select(COLUMNS, withCount ? { count: "exact" } : undefined)
    .eq("company_id", company.id);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  if (isDay(filters.from)) query = query.gte("created_at", dayStart(filters.from));
  if (isDay(filters.to)) query = query.lt("created_at", dayStart(nextDay(filters.to)));
  // free text: every word must appear in one of the text fields
  const words = filters.q
    .replace(/[,()"\\%*]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  for (const word of words) {
    const like = `%${word}%`;
    query = query.or(
      ["name", "phone", "email", "message", "source_path"].map((column) => `${column}.ilike.${like}`).join(","),
    );
  }
  return query.order("created_at", { ascending: false });
}

/** Staff who can own a lead: the company's members, plus whoever is looking at the inbox. */
async function assigneesOf(company: Company, session: SessionPayload): Promise<LeadAssignee[]> {
  const { data, error } = await supabaseTyped
    .from("company_members")
    .select("user_id, role, user_profiles!inner(id, email, display_name, is_active)")
    .eq("company_id", company.id)
    .in("role", ["admin", "editor"]);
  if (error) throw error;
  const people = (data ?? [])
    .map((m) => m.user_profiles as unknown as { id: string; email: string; display_name: string | null; is_active: boolean })
    .filter((p) => p && p.is_active)
    .map((p) => ({ id: p.id, name: p.display_name || p.email, email: p.email }));
  if (!people.some((p) => p.id === session.sub)) {
    const { data: me } = await supabaseTyped
      .from("user_profiles")
      .select("id, email, display_name")
      .eq("id", session.sub)
      .maybeSingle();
    people.push({ id: session.sub, name: me?.display_name || session.email, email: session.email });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export async function listLeads(filters: LeadFilters, page = 0): Promise<ActionResult<LeadsPage>> {
  try {
    const { company } = await requireCompany("tours");
    const safePage = Number.isInteger(page) && page > 0 ? page : 0;
    const from = safePage * LEADS_PAGE_SIZE;
    const { data, error, count } = await filtered(company, filters, true).range(from, from + LEADS_PAGE_SIZE - 1);
    if (error) throw error;
    return {
      success: true,
      data: { rows: ((data ?? []) as unknown as LeadColumns[]).map(toRow), total: count ?? 0, page: safePage },
    };
  } catch (e) {
    return failure(e, "טעינת הלידים נכשלה");
  }
}

/** What the filters and the assign menu need: who can own a lead, which kinds exist. */
export async function getLeadsMeta(): Promise<ActionResult<LeadsMeta>> {
  try {
    const { session, company } = await requireCompany("tours");
    const [assignees, kinds] = await Promise.all([
      assigneesOf(company, session),
      supabaseTyped.from("leads").select("kind").eq("company_id", company.id).range(0, 4999),
    ]);
    if (kinds.error) throw kinds.error;
    const known = Object.keys(LEAD_KIND_LABELS);
    const seen = [...new Set((kinds.data ?? []).map((r) => r.kind))].filter((k) => !known.includes(k));
    return { success: true, data: { assignees, kinds: [...known, ...seen.sort()], currentUserId: session.sub } };
  } catch (e) {
    return failure(e, "טעינת הלידים נכשלה");
  }
}

/** Change the status and / or the owner of one lead. */
export async function updateLead(
  id: string,
  change: { status?: string; assignedTo?: string | null },
): Promise<ActionResult<LeadRow>> {
  try {
    const { session, company } = await requireCompany("tours");
    const { data: before, error } = await supabaseTyped
      .from("leads")
      .select("id, status, assigned_to")
      .eq("company_id", company.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!before) return { success: false, error: "הליד לא נמצא" };

    const patch: { status?: string; assigned_to?: string | null } = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (change.status !== undefined && change.status !== before.status) {
      if (!LEAD_STATUSES.includes(change.status as LeadStatus)) return { success: false, error: "סטטוס לא מוכר" };
      patch.status = change.status;
      changes.status = { from: before.status, to: change.status };
    }
    if (change.assignedTo !== undefined && change.assignedTo !== before.assigned_to) {
      if (change.assignedTo !== null) {
        const allowed = await assigneesOf(company, session);
        if (!allowed.some((p) => p.id === change.assignedTo)) {
          return { success: false, error: "אפשר לשייך ליד רק לאיש צוות של החברה" };
        }
      }
      patch.assigned_to = change.assignedTo;
      changes.assigned_to = { from: before.assigned_to, to: change.assignedTo };
    }

    if (Object.keys(patch).length) {
      const { error: updateError } = await supabaseTyped
        .from("leads")
        .update(patch)
        .eq("company_id", company.id)
        .eq("id", id);
      if (updateError) throw updateError;
      await logAudit({
        action: "update",
        entityType: "lead",
        entityId: id,
        changes,
        metadata: { company: company.slug },
      });
      revalidatePath("/tours/leads");
    }
    const { data: fresh, error: freshError } = await supabaseTyped
      .from("leads")
      .select(COLUMNS)
      .eq("company_id", company.id)
      .eq("id", id)
      .single();
    if (freshError) throw freshError;
    return { success: true, data: toRow(fresh as unknown as LeadColumns) };
  } catch (e) {
    return failure(e, "עדכון הליד נכשל");
  }
}

/** The filtered list as an .xlsx file (base64), newest first. */
export async function exportLeads(filters: LeadFilters): Promise<ActionResult<LeadsExport>> {
  try {
    const { session, company } = await requireCompany("tours");
    const rows: LeadRow[] = [];
    for (let from = 0; from < EXPORT_LIMIT; from += 1000) {
      const { data, error } = await filtered(company, filters, false).range(from, from + 999);
      if (error) throw error;
      const batch = (data ?? []) as unknown as LeadColumns[];
      rows.push(...batch.map(toRow));
      if (batch.length < 1000) break;
    }
    const names = new Map((await assigneesOf(company, session)).map((p) => [p.id, p.name]));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("לידים", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "תאריך", key: "date", width: 18 },
      { header: "סוג", key: "kind", width: 20 },
      { header: "שם", key: "name", width: 24 },
      { header: "טלפון", key: "phone", width: 16 },
      { header: "אימייל", key: "email", width: 28 },
      { header: "הודעה", key: "message", width: 50 },
      { header: "עמוד מקור", key: "source", width: 30 },
      { header: "סטטוס", key: "status", width: 12 },
      { header: "משויך ל", key: "assigned", width: 20 },
      { header: "פרטים נוספים", key: "payload", width: 50 },
      { header: "UTM", key: "utm", width: 30 },
    ];
    const json = (value: Record<string, unknown>) => (Object.keys(value).length ? JSON.stringify(value) : "");
    for (const lead of rows) {
      sheet.addRow({
        date: wallClock(lead.createdAt),
        kind: LEAD_KIND_LABELS[lead.kind] ?? lead.kind,
        name: lead.name ?? "",
        phone: lead.phone ?? "",
        email: lead.email ?? "",
        message: lead.message ?? "",
        source: lead.sourcePath ?? "",
        status: leadStatusLabel(lead.status),
        assigned: lead.assignedTo ? (names.get(lead.assignedTo) ?? "") : "",
        payload: json(lead.payload),
        utm: json(lead.utm),
      });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn("date").numFmt = "dd.mm.yy hh:mm";

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      success: true,
      data: {
        fileName: `leads-${company.slug}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        base64: Buffer.from(buffer as ArrayBuffer).toString("base64"),
        rows: rows.length,
      },
    };
  } catch (e) {
    return failure(e, "ייצוא הלידים נכשל");
  }
}
