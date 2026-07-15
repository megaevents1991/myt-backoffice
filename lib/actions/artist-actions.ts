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
  return createRow<Person>(TABLE, data, REVALIDATE);
}
export async function updateArtist(id: number, data: UpdatePersonData): Promise<Person> {
  await requireStaff();
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteArtist(id: number): Promise<Person> {
  await requireStaff();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
