"use server";

/**
 * Leads of a tours company: every form of the customer site (lead form,
 * contact, cancellation request, newsletter, advisor request) lands in
 * public.leads through c_<slug>.submit_lead(). This file is the backoffice
 * side: read, change status, assign, export. A lead becomes a reservation
 * through createToursReservation (tours-reservation-actions.ts).
 */
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { taskPeopleOf } from "@/lib/services/task-people";
import { actionFail, fetchAll } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import type { Json } from "@/types/database.types";
import { LEAD_KIND_LABELS, type Lead } from "@/types/tours.types";
import {
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

const SCOPE = "tours-leads-actions";
/** The table loads the company's leads in one go, newest first, up to this many. */
const LIST_LIMIT = 5000;
const EXPORT_LIMIT = 20000;
const COLUMNS = "id, created_at, kind, name, phone, email, message, source_path, status, assigned_to, payload, utm";

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

/** The company's leads narrowed by the filters. Company scope is applied here, once. */
function filtered(company: Company, filters: Partial<LeadFilters>) {
  let query = supabaseTyped.from("leads").select(COLUMNS).eq("company_id", company.id);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  // free text: every word must appear in one of the text fields
  const words = (filters.q ?? "")
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

/**
 * Staff who can own a lead - the people the company's tasks can be given to
 * (lib/services/task-people.ts): its active staff members plus every active
 * superadmin, so whoever opens the inbox is on the list.
 */
async function assigneesOf(company: Company): Promise<LeadAssignee[]> {
  const people = await taskPeopleOf(company);
  if (!people) throw new Error("leads: the staff list could not be read");
  return people
    .map((p) => ({ id: p.id, name: p.display_name || p.email, email: p.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/** Every lead of the company for the table, newest first (search, views and paging run in the table). */
export async function listLeads(): Promise<ActionResult<LeadsPage>> {
  try {
    const { company } = await requireCompany("tours");
    const { rows, truncated, error } = await fetchPaged<LeadColumns>(() => filtered(company, {}), LIST_LIMIT);
    if (error) throw new Error(`leads: ${error.message}`);
    return { success: true, data: { rows: rows.map(toRow), truncated } };
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** What the filters and the assign menu need: who can own a lead, which kinds exist. */
export async function getLeadsMeta(): Promise<ActionResult<LeadsMeta>> {
  try {
    const { session, company } = await requireCompany("tours");
    const [assignees, kinds] = await Promise.all([
      assigneesOf(company),
      fetchAll((from, to) =>
        supabaseTyped.from("leads").select("kind").eq("company_id", company.id).order("id").range(from, to),
      ),
    ]);
    const known = Object.keys(LEAD_KIND_LABELS);
    const seen = [...new Set(kinds.map((r) => r.kind))].filter((k) => !known.includes(k));
    return { success: true, data: { assignees, kinds: [...known, ...seen.sort()], currentUserId: session.sub } };
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** Change the status and / or the owner of one lead. */
export async function updateLead(
  id: string,
  change: { status?: string; assignedTo?: string | null },
): Promise<ActionResult<LeadRow>> {
  try {
    const { company } = await requireCompany("tours");
    const { data: before, error } = await supabaseTyped
      .from("leads")
      .select("id, status, assigned_to")
      .eq("company_id", company.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!before) return { success: false, error: "The lead was not found." };

    const patch: { status?: string; assigned_to?: string | null } = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (change.status !== undefined && change.status !== before.status) {
      if (!LEAD_STATUSES.includes(change.status as LeadStatus)) return { success: false, error: "Unknown status." };
      patch.status = change.status;
      changes.status = { from: before.status, to: change.status };
    }
    if (change.assignedTo !== undefined && change.assignedTo !== before.assigned_to) {
      if (change.assignedTo !== null) {
        const allowed = await assigneesOf(company);
        if (!allowed.some((p) => p.id === change.assignedTo)) {
          return { success: false, error: "A lead can be assigned only to a member of the company's staff." };
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
        metadata: companyAudit(company),
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
    return actionFail(e, SCOPE);
  }
}

/** The leads of the open view (status, kind, search) as an .xlsx file (base64), newest first. */
export async function exportLeads(filters: Partial<LeadFilters>): Promise<ActionResult<LeadsExport>> {
  try {
    const { company } = await requireCompany("tours");
    const { rows: found, error } = await fetchPaged<LeadColumns>(() => filtered(company, filters), EXPORT_LIMIT);
    if (error) throw new Error(`leads: ${error.message}`);
    const rows = found.map(toRow);
    const names = new Map((await assigneesOf(company)).map((p) => [p.id, p.name]));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "Date", key: "date", width: 18 },
      { header: "Type", key: "kind", width: 24 },
      { header: "Name", key: "name", width: 24 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Email", key: "email", width: 28 },
      { header: "Message", key: "message", width: 50 },
      { header: "Source Page", key: "source", width: 30 },
      { header: "Status", key: "status", width: 12 },
      { header: "Assigned To", key: "assigned", width: 20 },
      { header: "Form Details", key: "payload", width: 50 },
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
    return actionFail(e, SCOPE);
  }
}
