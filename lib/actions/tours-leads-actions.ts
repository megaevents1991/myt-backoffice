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
import { asObject, companyAudit } from "@/lib/tours/company-kit";
import { isoToJerusalemLocal, todayIso } from "@/lib/tours/format";
import { LEAD_KIND_LABELS, type Lead } from "@/types/tours.types";
import {
  LEAD_STATUSES,
  leadMatches,
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

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-leads-actions", fallback);

/** The table loads the company's leads in one go, newest first, up to this many. */
const LIST_LIMIT = 5000;
const EXPORT_LIMIT = 20000;
const COLUMNS =
  "id, created_at, kind, name, phone, email, message, source_path, status, assigned_to, payload, utm, follow_up_date, notes";
/** The longest note staff can keep on a lead. */
const NOTES_MAX = 4000;

/**
 * A spreadsheet cell has no timezone: it shows the clock reading it is given.
 * Shift the instant by Israel's offset at that moment, so the cell reads the
 * operators' local time. The offset comes from isoToJerusalemLocal (to the
 * minute), the one Israel-time conversion of the tours screens.
 */
function wallClock(iso: string): Date {
  const instant = Date.parse(iso);
  const minute = instant - (instant % 60_000);
  return new Date(instant + (Date.parse(`${isoToJerusalemLocal(iso)}Z`) - minute));
}

type LeadColumns = Pick<
  Lead,
  | "id"
  | "created_at"
  | "kind"
  | "name"
  | "phone"
  | "email"
  | "message"
  | "source_path"
  | "status"
  | "assigned_to"
  | "payload"
  | "utm"
  | "follow_up_date"
  | "notes"
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
  payload: asObject(lead.payload),
  utm: asObject(lead.utm),
  followUpDate: lead.follow_up_date,
  notes: lead.notes,
});

/**
 * The company's leads of a kind and a status, newest first (id breaks ties, so
 * paging never skips a row). Company scope is applied here, once. The search
 * runs on the rows (leadMatches), the same rule as the inbox.
 */
function filtered(company: Company, filters: Partial<LeadFilters>) {
  let query = supabaseTyped.from("leads").select(COLUMNS).eq("company_id", company.id);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.status) query = query.eq("status", filters.status);
  return query.order("created_at", { ascending: false }).order("id", { ascending: false });
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
    return failure(e, "Failed to load the leads");
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
    return failure(e, "Failed to load the leads");
  }
}

/** Change the status, the owner, the follow-up day and / or the staff notes of one lead. */
export async function updateLead(
  id: string,
  change: { status?: string; assignedTo?: string | null; followUpDate?: string | null; notes?: string },
): Promise<ActionResult<LeadRow>> {
  try {
    const { company } = await requireCompany("tours");
    const { data: before, error } = await supabaseTyped
      .from("leads")
      .select("id, status, assigned_to, follow_up_date, notes")
      .eq("company_id", company.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!before) return { success: false, error: "The lead was not found." };

    const patch: { status?: string; assigned_to?: string | null; follow_up_date?: string | null; notes?: string | null } = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (change.followUpDate !== undefined && change.followUpDate !== before.follow_up_date) {
      if (change.followUpDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(change.followUpDate)) {
        return { success: false, error: "The follow-up date is not a valid day." };
      }
      patch.follow_up_date = change.followUpDate;
      changes.follow_up_date = { from: before.follow_up_date, to: change.followUpDate };
    }
    if (change.notes !== undefined) {
      const notes = change.notes.trim();
      if (notes.length > NOTES_MAX) return { success: false, error: `Notes can be up to ${NOTES_MAX} characters.` };
      if (notes !== (before.notes ?? "")) {
        patch.notes = notes || null;
        // the trail records that the notes changed, not what a customer conversation said
        changes.notes = { from: before.notes ? `${before.notes.length} chars` : null, to: notes ? `${notes.length} chars` : null };
      }
    }
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
    return failure(e, "Failed to update the lead");
  }
}

/** The leads of the open view (status, kind, search) as an .xlsx file (base64), newest first. */
export async function exportLeads(filters: Partial<LeadFilters>): Promise<ActionResult<LeadsExport>> {
  try {
    const { company } = await requireCompany("tours");
    const { rows: found, error } = await fetchPaged<LeadColumns>(() => filtered(company, filters), EXPORT_LIMIT);
    if (error) throw new Error(`leads: ${error.message}`);
    const rows = found.map(toRow).filter((lead) => leadMatches(lead, filters.q ?? ""));
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
      { header: "Follow-up", key: "followUp", width: 12 },
      { header: "Notes", key: "notes", width: 50 },
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
        followUp: lead.followUpDate ?? "",
        notes: lead.notes ?? "",
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
        fileName: `leads-${company.slug}-${todayIso()}.xlsx`,
        base64: Buffer.from(buffer as ArrayBuffer).toString("base64"),
        rows: rows.length,
      },
    };
  } catch (e) {
    return failure(e, "Failed to export the leads");
  }
}
