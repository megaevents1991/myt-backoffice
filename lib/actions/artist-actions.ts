"use server";

import { requireStaff } from "@/lib/auth/guards";
import {
  listRows,
  getRow,
  createRow,
  updateRow,
  softDeleteRow,
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
/**
 * An artist row created INACTIVE by the tour uploader's names dialog: no picture and no taxonomy yet
 * (no tag, no auto-tag rule, no `/c/` leaf) - those appear when staff activate it in Templates
 * (`updateArtist` below). Throws like `createRow` (a taken slug = Postgres 23505).
 */
export async function createArtistInactive(
  data: CreatePersonData,
): Promise<Person> {
  await requireStaff();
  return createRow<Person>(TABLE, { ...data, is_active: false }, REVALIDATE);
}
export async function updateArtist(
  id: number,
  data: UpdatePersonData,
): Promise<Person> {
  await requireStaff();
  // Activating an artist the uploader created inactive: its taxonomy (tag, rule, /c/ leaf) is created
  // now, as `createArtist` does for an artist born active. Read only when the save activates.
  let wasInactive = false;
  if (data.is_active === true) {
    try {
      wasInactive = (await getRow<Person>(TABLE, id)).is_active === false;
    } catch (e) {
      console.error("artist activation check failed:", e);
    }
  }
  const updated = await updateRow<Person>(TABLE, id, data, REVALIDATE);
  if (wasInactive) {
    // Tolerant: a sync failure must not fail the save.
    try {
      const res = await ensurePersonTaxonomy({
        kind: "artist",
        name: updated.name,
        nameEnglish: updated.name_english,
      });
      if (res.skipped) console.warn("artist taxonomy sync skipped:", res.skipped);
    } catch (e) {
      console.error("artist taxonomy sync failed:", e);
    }
  }
  return updated;
}
export async function softDeleteArtist(id: number): Promise<Person> {
  await requireStaff();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
// Homepage carousel / hero order moved to /homepage (homepage_items) - 2026-09-16.
