"use server";

import { requireAdmin } from "@/lib/auth/guards";
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

const TABLE = "artists";
const REVALIDATE = ["/templates", "/templates/artists"];

export async function getArtists(): Promise<Person[]> {
  await requireAdmin();
  return listRows<Person>(TABLE);
}
export async function getArtist(id: number): Promise<Person> {
  await requireAdmin();
  return getRow<Person>(TABLE, id);
}
export async function createArtist(data: CreatePersonData): Promise<Person> {
  await requireAdmin();
  return createRow<Person>(TABLE, data, REVALIDATE);
}
export async function updateArtist(id: number, data: UpdatePersonData): Promise<Person> {
  await requireAdmin();
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteArtist(id: number): Promise<Person> {
  await requireAdmin();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
