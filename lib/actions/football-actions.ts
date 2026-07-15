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
export async function createFootballTeam(data: CreatePersonData): Promise<Person> {
  await requireStaff();
  return createRow<Person>(TABLE, data, REVALIDATE);
}
export async function updateFootballTeam(id: number, data: UpdatePersonData): Promise<Person> {
  await requireStaff();
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteFootballTeam(id: number): Promise<Person> {
  await requireStaff();
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
