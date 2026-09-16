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
import { fillTwinCategoryImage } from "@/lib/services/category-twins";

/** Task 16: a saved hero (or, failing that, blob) image fills the team's
 *  twin category card image too, when that category has none yet. Tolerant:
 *  a sync failure must not fail the save, same pattern as ensurePersonTaxonomy
 *  above. */
async function fillTwinImage(team: Person): Promise<void> {
  const imageUrl = team.image_url ?? team.art_image_url;
  if (!imageUrl) return;
  try {
    await fillTwinCategoryImage({
      kind: "team",
      personId: team.id,
      person: { id: team.id, name: team.name, name_english: team.name_english },
      imageUrl,
    });
  } catch (e) {
    console.error("team category-twin image fill failed:", e);
  }
}

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
  await fillTwinImage(created);
  return created;
}
export async function updateFootballTeam(
  id: number,
  data: UpdatePersonData,
): Promise<Person> {
  await requireStaff();
  const updated = await updateRow<Person>(TABLE, id, data, REVALIDATE);
  await fillTwinImage(updated);
  return updated;
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
