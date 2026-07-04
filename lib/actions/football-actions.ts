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

const TABLE = "football_teams";
const REVALIDATE = ["/templates", "/templates/football"];

export async function getFootballTeams(): Promise<Person[]> {
  await requireAdmin();
  return listRows<Person>(TABLE);
}
export async function getFootballTeam(id: number): Promise<Person> {
  await requireAdmin();
  return getRow<Person>(TABLE, id);
}
export async function createFootballTeam(data: CreatePersonData): Promise<Person> {
  await requireAdmin();
  return createRow<Person>(TABLE, data, REVALIDATE);
}
export async function updateFootballTeam(id: number, data: UpdatePersonData): Promise<Person> {
  await requireAdmin();
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteFootballTeam(id: number): Promise<Person> {
  await requireAdmin();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
