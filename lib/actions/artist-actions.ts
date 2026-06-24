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

const TABLE = "artists";
const REVALIDATE = ["/templates", "/templates/artists"];

export async function getArtists(): Promise<Person[]> {
  return listRows<Person>(TABLE);
}
export async function getArtist(id: number): Promise<Person> {
  return getRow<Person>(TABLE, id);
}
export async function createArtist(data: CreatePersonData): Promise<Person> {
  return createRow<Person>(TABLE, data, REVALIDATE);
}
export async function updateArtist(id: number, data: UpdatePersonData): Promise<Person> {
  return updateRow<Person>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteArtist(id: number): Promise<Person> {
  return softDeleteRow<Person>(TABLE, id, REVALIDATE);
}
export async function uploadArtistImage(formData: FormData): Promise<string> {
  return uploadTemplateImage(formData);
}
