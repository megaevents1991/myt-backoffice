// Location types for the locations CRUD functionality

export interface Location {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  city_iata: string | null;
  country_code: string | null;
  /** Other spellings of the city (English, local, supplier forms). Absent until the migration that adds the column is applied. */
  aliases?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateLocationData {
  name: string;
  latitude: number;
  longitude: number;
  city_iata?: string;
  country_code?: string;
  aliases?: string[];
}

export interface UpdateLocationData {
  name?: string;
  latitude?: number;
  longitude?: number;
  city_iata?: string;
  country_code?: string;
  aliases?: string[];
}

export interface LocationWithDistance extends Location {
  distance?: number; // Distance in kilometers from a reference point
}
