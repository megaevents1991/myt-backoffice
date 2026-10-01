"use server";

/**
 * Reservations of a tours company - the counterpart of the Mega Events
 * Reservations screen. A tours company has no online booking yet: operations
 * type in what was sold, one row per booking (+pax) or cancellation (-pax),
 * in tours.departure_sales_entries. The rows feed the seats of each departure
 * (tours.departure_stats); a mistaken row is soft-deleted and stops counting.
 *
 * Used by /tours/reservations, the Reservations tab of the departure card and
 * "Create Reservation" on a lead.
 */
import { revalidatePath } from "next/cache";

import { logAudit } from "@/lib/audit";
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { toursDb } from "@/lib/tours/db";
import { addDays, todayIso } from "@/lib/tours/deadlines";
import { actionFail, actionOk, chunk, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { departureSiteId } from "@/types/tours.types";
import type {
  ReservationDeparture,
  ReservationInput,
  ToursReservationRow,
} from "@/components/tours/reservations/types";

const SCOPE = "tours-reservation-actions";
const ROWS_MAX = 20000;
/** Departures the picker offers: from a month back (late entries) onwards. */
const PICKER_PAST_DAYS = 30;
const ENTRY_COLUMNS =
  "id, departure_id, pax, docket_no, note, customer_name, customer_phone, customer_email, lead_id, entered_by, created_at";

type EntryRow = {
  id: string;
  departure_id: string;
  pax: number;
  docket_no: string | null;
  note: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  lead_id: string | null;
  entered_by: string | null;
  created_at: string;
};

const clean = (value: string | null | undefined, max: number): string | null => {
  const text = (value ?? "").trim().slice(0, max);
  return text === "" ? null : text;
};

/** Who typed each row in: display name, else e-mail. */
async function authorNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const part of chunk([...new Set(ids)], 100)) {
    const { data, error } = await supabaseTyped.from("user_profiles").select("id, display_name, email").in("id", part);
    if (error) throw new Error(`user_profiles: ${error.message}`);
    for (const p of data) names.set(p.id, p.display_name || p.email);
  }
  return names;
}

/** The rows of the screens, joined with their departure and tour page. */
async function toRows(companyId: string, entries: EntryRow[]): Promise<ToursReservationRow[]> {
  const departures = new Map<string, { code: string; start_date: string; packageName: string | null }>();
  for (const part of chunk([...new Set(entries.map((e) => e.departure_id))], 100)) {
    const { data, error } = await toursDb()
      .from("departures")
      .select("id, code, start_date, packages(name)")
      .eq("company_id", companyId)
      .in("id", part);
    if (error) throw new Error(`departures: ${error.message}`);
    for (const d of data) {
      departures.set(d.id, {
        code: d.code,
        start_date: d.start_date,
        packageName: (d.packages as { name: string } | null)?.name ?? null,
      });
    }
  }
  const authors = await authorNames(entries.map((e) => e.entered_by).filter((v): v is string => Boolean(v)));
  return entries.map((e) => {
    const d = departures.get(e.departure_id);
    return {
      id: e.id,
      createdAt: e.created_at,
      departureId: e.departure_id,
      departureCode: d?.code ?? "",
      departureDate: d?.start_date ?? null,
      tourName: d?.packageName ?? null,
      pax: e.pax,
      docketNo: e.docket_no,
      note: e.note,
      customerName: e.customer_name,
      customerPhone: e.customer_phone,
      customerEmail: e.customer_email,
      leadId: e.lead_id,
      enteredBy: e.entered_by ? (authors.get(e.entered_by) ?? null) : null,
    };
  });
}

/** Every reservation of the company, newest first. One departure only when `departureId` is given. */
export async function listToursReservations(departureId?: string): Promise<ActionResult<ToursReservationRow[]>> {
  try {
    const { company } = await requireCompany("tours");
    if (departureId !== undefined && !UUID.test(departureId)) throw new UserError("Departure not found.");
    const { rows, error } = await fetchPaged<EntryRow>(() => {
      let query = toursDb()
        .from("departure_sales_entries")
        .select(ENTRY_COLUMNS)
        .eq("company_id", company.id)
        .is("is_deleted", null);
      if (departureId) query = query.eq("departure_id", departureId);
      return query.order("created_at", { ascending: false });
    }, ROWS_MAX);
    if (error) throw new Error(`departure_sales_entries: ${error.message}`);
    return actionOk(await toRows(company.id, rows));
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** The departures a reservation can be made on: not deleted, from a month back on. */
export async function listReservationDepartures(): Promise<ActionResult<ReservationDeparture[]>> {
  try {
    const { company } = await requireCompany("tours");
    const { rows, error } = await fetchPaged<{
      id: string;
      code: string;
      start_date: string;
      is_published: boolean;
      legacy_product_id: number | null;
      site_id: number;
      packages: { name: string } | null;
    }>(
      () =>
        toursDb()
          .from("departures")
          .select("id, code, start_date, is_published, legacy_product_id, site_id, packages(name)")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .gte("start_date", addDays(todayIso(), -PICKER_PAST_DAYS))
          .order("start_date", { ascending: true })
          .order("code", { ascending: true }),
      ROWS_MAX,
    );
    if (error) throw new Error(`departures: ${error.message}`);
    return actionOk(
      rows.map((d) => ({
        id: d.id,
        code: d.code,
        startDate: d.start_date,
        tourName: d.packages?.name ?? null,
        isPublished: d.is_published,
        siteId: departureSiteId(d),
      })),
    );
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/**
 * A new booking (+pax) or cancellation (-pax) on a departure. With `leadId`
 * the row remembers the site lead it came from, and that lead is marked done.
 */
export async function createToursReservation(input: ReservationInput): Promise<ActionResult<ToursReservationRow>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!UUID.test(input.departureId)) throw new UserError("Choose a departure.");
    const pax = Math.trunc(Number(input.pax));
    if (!Number.isFinite(pax) || pax === 0 || Math.abs(pax) > 99) {
      throw new UserError("Travelers must be a whole number from 1 to 99.");
    }
    const email = clean(input.customerEmail, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("The e-mail address is not valid.");

    const { data: departure, error: departureError } = await toursDb()
      .from("departures")
      .select("id, code")
      .eq("company_id", company.id)
      .eq("id", input.departureId)
      .is("is_deleted", null)
      .maybeSingle();
    if (departureError) throw new Error(`departures: ${departureError.message}`);
    if (!departure) throw new UserError("The departure was not found - it may have been deleted.");

    let leadId: string | null = null;
    if (input.leadId) {
      if (!UUID.test(input.leadId)) throw new UserError("The lead was not found.");
      const { data: lead, error: leadError } = await supabaseTyped
        .from("leads")
        .select("id, status")
        .eq("company_id", company.id)
        .eq("id", input.leadId)
        .maybeSingle();
      if (leadError) throw new Error(`leads: ${leadError.message}`);
      if (!lead) throw new UserError("The lead was not found.");
      leadId = lead.id;
    }

    const { data: created, error } = await toursDb()
      .from("departure_sales_entries")
      .insert({
        company_id: company.id,
        departure_id: departure.id,
        pax,
        docket_no: clean(input.docketNo, 60),
        note: clean(input.note, 500),
        customer_name: clean(input.customerName, 120),
        customer_phone: clean(input.customerPhone, 40),
        customer_email: email,
        lead_id: leadId,
        entered_by: session.sub,
      })
      .select(ENTRY_COLUMNS)
      .single();
    if (error) throw new Error(`departure_sales_entries: ${error.message}`);

    if (leadId) {
      const { error: leadUpdateError } = await supabaseTyped
        .from("leads")
        .update({ status: "done" })
        .eq("company_id", company.id)
        .eq("id", leadId)
        .neq("status", "spam");
      if (leadUpdateError) console.error(`${SCOPE}: lead ${leadId} not marked done:`, leadUpdateError.message);
    }

    await logAudit({
      action: "create",
      entityType: "tours_reservation",
      entityId: created.id,
      changes: created,
      metadata: { company_id: company.id, departure_id: departure.id, departure_code: departure.code, lead_id: leadId },
    });
    revalidatePath("/tours/reservations");
    const [row] = await toRows(company.id, [created as EntryRow]);
    return actionOk(row);
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}

/** Marks a mistaken row deleted (it stays recoverable) - its travelers stop counting on the departure. */
export async function deleteToursReservation(id: string): Promise<ActionResult> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(id)) throw new UserError("The reservation was not found.");
    const { data, error } = await toursDb()
      .from("departure_sales_entries")
      .update({ is_deleted: todayIso() })
      .eq("company_id", company.id)
      .eq("id", id)
      .is("is_deleted", null)
      .select("id, departure_id, pax, docket_no, customer_name");
    if (error) throw new Error(`departure_sales_entries: ${error.message}`);
    if (!data || data.length === 0) throw new UserError("The reservation was not found - it may already be deleted.");
    await logAudit({
      action: "delete",
      entityType: "tours_reservation",
      entityId: id,
      changes: data[0],
      metadata: { company_id: company.id, departure_id: data[0].departure_id, soft: true },
    });
    revalidatePath("/tours/reservations");
    return actionOk(undefined);
  } catch (e) {
    return actionFail(e, SCOPE);
  }
}
