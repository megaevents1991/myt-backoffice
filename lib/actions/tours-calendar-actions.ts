"use server";

/**
 * Holidays, fasts, carnivals and school breaks (functional spec 5.7). They are the
 * background of the departures board and of the season duplication.
 *
 * A row with company_id = null is global: every company sees it, and only a
 * superadmin may change it. Everything a company adds here belongs to that company.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { isDateOnly } from "@/lib/tours/deadlines";
import { CALENDAR_KINDS, type CalendarPeriod } from "@/types/tours.types";
import type { ToursResult } from "@/lib/actions/tours-flight-actions";

export interface CalendarPeriodRow extends CalendarPeriod {
  /** Shared by every company; read-only unless the viewer is a superadmin. */
  is_global: boolean;
  can_edit: boolean;
}

export interface CalendarPeriodInput {
  /** Omitted = a new period. */
  id?: string;
  year: number;
  name: string;
  kind: string;
  holiday_date: string | null;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
}

const ROWS_MAX = 5000;

const fail = (error: string): { success: false; error: string } => ({ success: false, error });

function dbFail(where: string, error: unknown): { success: false; error: string } {
  console.error(`tours-calendar-actions: ${where} failed`, JSON.stringify(error));
  return fail("הפעולה נכשלה. נסו שוב, ואם זה חוזר פנו לתמיכה.");
}

/** The periods of one year (the company's and the global ones) and every year that has any. */
export async function listCalendarPeriods(
  year: number,
): Promise<ToursResult<{ periods: CalendarPeriodRow[]; years: number[] }>> {
  const { session, company } = await requireCompany("tours");
  if (!Number.isInteger(year)) return fail("שנה לא תקינה");
  const scope = `company_id.eq.${company.id},company_id.is.null`;

  const [periodsRes, yearsRes] = await Promise.all([
    supabaseTyped.from("calendar_periods").select("*").or(scope).eq("year", year).limit(ROWS_MAX),
    supabaseTyped.from("calendar_periods").select("year").or(scope).limit(ROWS_MAX),
  ]);
  if (periodsRes.error) return dbFail("list", periodsRes.error);
  if (yearsRes.error) return dbFail("years", yearsRes.error);

  const sortKey = (p: CalendarPeriod) => p.start_date ?? p.holiday_date ?? p.end_date ?? "9999";
  const periods: CalendarPeriodRow[] = (periodsRes.data ?? [])
    .map((p) => ({
      ...p,
      is_global: p.company_id === null,
      can_edit: p.company_id !== null || session.role === "superadmin",
    }))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.name.localeCompare(b.name, "he"));
  const years = [...new Set((yearsRes.data ?? []).map((r) => r.year))].sort((a, b) => a - b);
  return { success: true, data: { periods, years } };
}

/** Adds a period to the company's calendar, or edits one. */
export async function saveCalendarPeriod(input: CalendarPeriodInput): Promise<ToursResult<{ id: string }>> {
  const { session, company } = await requireCompany("tours");

  const name = input.name?.trim();
  if (!name) return fail("שם התקופה חסר");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) return fail("שנה לא תקינה");
  if (!(CALENDAR_KINDS as readonly string[]).includes(input.kind)) return fail("סוג לא מוכר");
  for (const date of [input.holiday_date, input.start_date, input.end_date]) {
    if (date !== null && !isDateOnly(date)) return fail("תאריך לא תקין");
  }
  if (!input.holiday_date && !input.start_date) return fail("הזינו מועד, או תאריך תחילה");
  if (input.start_date && input.end_date && input.end_date < input.start_date) return fail("תאריך הסוף לפני ההתחלה");

  const values = {
    year: input.year,
    name,
    kind: input.kind,
    holiday_date: input.holiday_date,
    start_date: input.start_date,
    end_date: input.end_date,
    note: input.note?.trim() || null,
  };

  if (input.id) {
    const { data: existing, error: readError } = await supabaseTyped
      .from("calendar_periods")
      .select("id,company_id")
      .eq("id", input.id)
      .maybeSingle();
    if (readError) return dbFail("read", readError);
    // A period of another company does not exist as far as this caller is concerned.
    if (!existing || (existing.company_id !== null && existing.company_id !== company.id)) {
      return fail("התקופה לא נמצאה");
    }
    if (existing.company_id === null && session.role !== "superadmin") {
      return fail("תקופה גלובלית משותפת לכל החברות ונערכת רק על ידי צוות MYT");
    }
    const update = supabaseTyped.from("calendar_periods").update(values).eq("id", input.id);
    const { error } = await (existing.company_id === null
      ? update.is("company_id", null)
      : update.eq("company_id", company.id));
    if (error) return dbFail("update", error);
    await logAudit({
      action: "tours.calendar.update",
      entityType: "calendar_period",
      entityId: input.id,
      changes: values,
      metadata: { company_id: company.id },
    });
    return { success: true, data: { id: input.id } };
  }

  const { data, error } = await supabaseTyped
    .from("calendar_periods")
    .insert({ ...values, company_id: company.id })
    .select("id")
    .single();
  if (error || !data) return dbFail("insert", error);
  await logAudit({
    action: "tours.calendar.create",
    entityType: "calendar_period",
    entityId: data.id,
    changes: values,
    metadata: { company_id: company.id },
  });
  return { success: true, data: { id: data.id } };
}

/** Removes a period. The table keeps no history, so this is a real delete (the screen confirms first). */
export async function deleteCalendarPeriod(id: string): Promise<ToursResult> {
  const { session, company } = await requireCompany("tours");
  if (typeof id !== "string" || !id) return fail("התקופה לא נמצאה");

  const { data: existing, error: readError } = await supabaseTyped
    .from("calendar_periods")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) return dbFail("read", readError);
  if (!existing || (existing.company_id !== null && existing.company_id !== company.id)) {
    return fail("התקופה לא נמצאה");
  }
  if (existing.company_id === null && session.role !== "superadmin") {
    return fail("תקופה גלובלית משותפת לכל החברות ונמחקת רק על ידי צוות MYT");
  }

  const remove = supabaseTyped.from("calendar_periods").delete().eq("id", id);
  const { error } = await (existing.company_id === null
    ? remove.is("company_id", null)
    : remove.eq("company_id", company.id));
  if (error) return dbFail("delete", error);

  // The whole row goes into the audit log - it is the only copy left.
  await logAudit({
    action: "tours.calendar.delete",
    entityType: "calendar_period",
    entityId: id,
    changes: existing,
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}
