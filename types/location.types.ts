// Location types for the locations CRUD functionality

export interface Location {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  city_iata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLocationData {
  name: string;
  latitude: number;
  longitude: number;
  city_iata?: string;
}

export interface UpdateLocationData {
  name?: string;
  latitude?: number;
  longitude?: number;
  city_iata?: string;
}

export interface LocationWithDistance extends Location {
  distance?: number; // Distance in kilometers from a reference point
}
