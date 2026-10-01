"use server";

/**
 * Airline contracts of a tours company (functional spec 5.6).
 *
 * A contract says how many days before departure each deadline of a flight block
 * falls. Changing the days here does NOT move the deadlines of blocks that already
 * have them - the block panel recomputes on request ("חשב מחדש מהחוזה").
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { isDateOnly } from "@/lib/tours/deadlines";
import { CURRENCIES, type FlightContract } from "@/types/tours.types";
import type { ToursResult } from "@/lib/actions/tours-flight-actions";
import { dbFail as databaseFail, plainFail as fail } from "@/lib/tours/action-kit";

const dbFail = (where: string, error: unknown) => databaseFail("tours-contract-actions", where, error);

export interface TourContractRow extends FlightContract {
  /** Flight blocks of the company that use this contract. */
  blocks_count: number;
}

export interface TourContractInput {
  /** Omitted = a new contract. */
  id?: string;
  name: string;
  airline_group: string | null;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
  cxx1_days_before: number;
  cxx2_days_before: number;
  names_days_before: number | null;
  ticketing_days_before: number | null;
  commitment_amount: number | null;
  commitment_unit: string | null;
  name_change_fee: number | null;
  currency: string;
  terms_text: string | null;
  is_active: boolean;
}

const CONTRACT_KINDS = ["series_contract", "closed_group"];
const COMMITMENT_UNITS = ["per_group", "per_pax", "pct_of_fare"];
const BLOCKS_MAX = 50_000;

const isDays = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 730;
const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Every contract of the company, with how many blocks use it. */
export async function listTourContracts(): Promise<ToursResult<TourContractRow[]>> {
  const { company } = await requireCompany("tours");
  const { data, error } = await supabaseTyped
    .from("flight_contracts")
    .select("*")
    .eq("company_id", company.id)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
  if (error) return dbFail("list", error);

  const blocks = await fetchPaged<{ id: number; contract_id: string | null }>(
    () =>
      supabaseTyped
        .from("flights")
        .select("id,contract_id")
        .eq("company_id", company.id)
        .eq("is_deleted", false)
        .not("contract_id", "is", null)
        .order("id", { ascending: true }),
    BLOCKS_MAX,
  );
  if (blocks.error) return dbFail("blocks count", blocks.error);
  const counts = new Map<string, number>();
  for (const row of blocks.rows) {
    if (row.contract_id) counts.set(row.contract_id, (counts.get(row.contract_id) ?? 0) + 1);
  }

  return { success: true, data: (data ?? []).map((c) => ({ ...c, blocks_count: counts.get(c.id) ?? 0 })) };
}

/** Creates a contract, or updates one of this company. */
export async function saveTourContract(input: TourContractInput): Promise<ToursResult<{ id: string }>> {
  const { company } = await requireCompany("tours");

  const name = input.name?.trim();
  if (!name) return fail("שם החוזה חסר");
  if (!CONTRACT_KINDS.includes(input.kind)) return fail("סוג חוזה לא מוכר");
  if (!isDays(input.cxx1_days_before) || !isDays(input.cxx2_days_before)) {
    return fail("ימי ביטול ראשון ואחרון חייבים להיות מספר שלם, 0 ומעלה");
  }
  if (input.cxx2_days_before > input.cxx1_days_before) {
    return fail("הביטול האחרון קרוב ליציאה יותר מהראשון: מספר הימים שלו צריך להיות קטן או שווה");
  }
  for (const days of [input.names_days_before, input.ticketing_days_before]) {
    if (days !== null && !isDays(days)) return fail("ימי שמות וכרטוס חייבים להיות מספר שלם, 0 ומעלה, או ריקים");
  }
  for (const date of [input.valid_from, input.valid_to]) {
    if (date !== null && !isDateOnly(date)) return fail("תאריך תוקף לא תקין");
  }
  if (input.valid_from && input.valid_to && input.valid_to < input.valid_from) {
    return fail("סוף התוקף לפני תחילתו");
  }
  for (const amount of [input.commitment_amount, input.name_change_fee]) {
    if (amount !== null && !isAmount(amount)) return fail("סכום חייב להיות מספר, 0 ומעלה");
  }
  const unit = input.commitment_unit || null;
  if (unit !== null && !COMMITMENT_UNITS.includes(unit)) return fail("יחידת התחייבות לא מוכרת");
  if (!(CURRENCIES as readonly string[]).includes(input.currency)) return fail("מטבע לא מוכר");

  const values = {
    name,
    airline_group: input.airline_group?.trim() || null,
    kind: input.kind,
    valid_from: input.valid_from,
    valid_to: input.valid_to,
    cxx1_days_before: input.cxx1_days_before,
    cxx2_days_before: input.cxx2_days_before,
    names_days_before: input.names_days_before,
    ticketing_days_before: input.ticketing_days_before,
    commitment_amount: input.commitment_amount,
    commitment_unit: input.commitment_amount === null ? null : unit,
    name_change_fee: input.name_change_fee,
    currency: input.currency,
    terms_text: input.terms_text?.trim() || null,
    is_active: !!input.is_active,
  };

  const duplicate = (error: { code?: string }) => error.code === "23505";

  if (input.id) {
    const { data, error } = await supabaseTyped
      .from("flight_contracts")
      .update(values)
      .eq("id", input.id)
      .eq("company_id", company.id)
      .select("id");
    if (error) return duplicate(error) ? fail("כבר קיים חוזה בשם הזה") : dbFail("update", error);
    if (!data || data.length === 0) return fail("החוזה לא נמצא");
    await logAudit({
      action: "tours.contract.update",
      entityType: "flight_contract",
      entityId: input.id,
      changes: values,
      metadata: { company_id: company.id },
    });
    return { success: true, data: { id: input.id } };
  }

  const { data, error } = await supabaseTyped
    .from("flight_contracts")
    .insert({ ...values, company_id: company.id })
    .select("id")
    .single();
  if (error || !data) return error && duplicate(error) ? fail("כבר קיים חוזה בשם הזה") : dbFail("insert", error);
  await logAudit({
    action: "tours.contract.create",
    entityType: "flight_contract",
    entityId: data.id,
    changes: values,
    metadata: { company_id: company.id },
  });
  return { success: true, data: { id: data.id } };
}
