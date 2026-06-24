"use server";

import {
  listRows,
  getRow,
  createRow,
  updateRow,
  softDeleteRow,
  uploadTemplateImage,
} from "./template-crud";
import type {
  Person,
  CreatePersonData,
  UpdatePersonData,
} from "../../types/person.types";

const TABLE = "football_teams";
const REVALIDATE = ["/templates", "/templates/football"];

export async function getFootballTeams(): Promise<Person[]> {
  return listRows<Person>(TABLE);
}
export async function getFootballTeam(id: number): Promise<Person> {
  return getRow<Person>(TABLE, id);
}
export async function createFootballTeam(data: CreatePersonData): Promise<Person> {
  return createRow<Person>(TABLE, data, REVALIDATE);
}
export async function updateFootballTeam(id: number, data: UpdatePersonData): Promise<Person> {
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteFootballTeam(id: number): Promise<Person> {
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
export async function uploadFootballImage(formData: FormData): Promise<string> {
  return uploadTemplateImage(formData);
}
