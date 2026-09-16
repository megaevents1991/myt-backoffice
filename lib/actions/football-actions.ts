"use server";

import { requireStaff } from "@/lib/auth/guards";
import {
  listRows,
  getRow,
  createRow,
  updateRow,
  softDeleteRow,
  saveRowOrder,
} from "./template-crud";
import type {
  Person,
  CreatePersonData,
  UpdatePersonData,
} from "../../types/person.types";
import { ensurePersonTaxonomy } from "@/lib/services/taxonomy-sync";

const TABLE = "football_teams";
const REVALIDATE = ["/templates", "/templates/football"];

export async function getFootballTeams(): Promise<Person[]> {
  await requireStaff();
  return listRows<Person>(TABLE);
}
export async function getFootballTeam(id: number): Promise<Person> {
  await requireStaff();
  return getRow<Person>(TABLE, id);
}
export async function createFootballTeam(
  data: CreatePersonData,
): Promise<Person> {
  await requireStaff();
  const created = await createRow<Person>(TABLE, data, REVALIDATE);
  // New team card ⇒ team tag + auto-tag rule + category leaf under
  // הקבוצות שלנו. Tolerant: a sync failure must not fail the create.
  try {
    const res = await ensurePersonTaxonomy({
      kind: "team",
      name: created.name,
      nameEnglish: created.name_english,
    });
    if (res.skipped) console.warn("team taxonomy sync skipped:", res.skipped);
  } catch (e) {
    console.error("team taxonomy sync failed:", e);
  }
  return created;
}
export async function updateFootballTeam(
  id: number,
  data: UpdatePersonData,
): Promise<Person> {
  await requireStaff();
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteFootballTeam(id: number): Promise<Person> {
  await requireStaff();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
/** Homepage "כדורגל" carousel order - index in the array = position. */
export async function saveFootballTeamsOrder(
  orderedIds: number[],
): Promise<void> {
  await requireStaff();
  return saveRowOrder(TABLE, orderedIds, REVALIDATE);
}
