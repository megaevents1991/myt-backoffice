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

const TABLE = "artists";
const REVALIDATE = ["/templates", "/templates/artists"];

export async function getArtists(): Promise<Person[]> {
  await requireStaff();
  return listRows<Person>(TABLE);
}
export async function getArtist(id: number): Promise<Person> {
  await requireStaff();
  return getRow<Person>(TABLE, id);
}
export async function createArtist(data: CreatePersonData): Promise<Person> {
  await requireStaff();
  const created = await createRow<Person>(TABLE, data, REVALIDATE);
  // New artist card ⇒ artist tag + auto-tag rule + category leaf under
  // אומנים. Tolerant: a sync failure must not fail the create.
  try {
    const res = await ensurePersonTaxonomy({
      kind: "artist",
      name: created.name,
      nameEnglish: created.name_english,
    });
    if (res.skipped) console.warn("artist taxonomy sync skipped:", res.skipped);
  } catch (e) {
    console.error("artist taxonomy sync failed:", e);
  }
  return created;
}
export async function updateArtist(
  id: number,
  data: UpdatePersonData,
): Promise<Person> {
  await requireStaff();
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteArtist(id: number): Promise<Person> {
  await requireStaff();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
/** Homepage "אמנים מובילים" carousel order - index in the array = position. */
export async function saveArtistsOrder(orderedIds: number[]): Promise<void> {
  await requireStaff();
  return saveRowOrder(TABLE, orderedIds, REVALIDATE);
}
