export interface FootballLogo {
  id: number;
  name_english: string;
  name_hebrew: string | null;
  logo_url: string;
  created_at: string;
}

export interface UpdateFootballLogoData {
  name_english?: string;
  name_hebrew?: string | null;
}
