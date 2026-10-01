/**
 * Data access for the "tours" product type (schema `tours`, see
 * supabase/migrations/20261001100100_tours_schema.sql).
 *
 * Every tours table carries company_id, and the service-role client bypasses
 * RLS, so the company filter is the caller's job. Take the id from
 * requireCompany("tours") and pass it to EVERY query:
 *
 *   const { company } = await requireCompany("tours");
 *   const { data } = await toursDb().from("departures").select("*").eq("company_id", company.id);
 *
 * Writes must set company_id from the same value, never from client input.
 */
import { supabaseTyped } from "@/lib/supabase-server";

export const toursDb = () => supabaseTyped.schema("tours");

/** PostgREST caps a response at 1000 rows - page through everything that can grow past that. */
export const TOURS_PAGE_SIZE = 1000;
