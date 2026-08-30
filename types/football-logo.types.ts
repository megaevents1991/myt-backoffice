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

/**
 * Why an upload was refused.
 *
 * Everything except "server" is the operator's to fix - wrong file, a name
 * that's already taken, an expired session. "server" means a real bug and the
 * UI says so out loud, so nobody wastes time re-picking a perfectly good file.
 */
export type LogoUploadFailureKind = "invalid" | "conflict" | "auth" | "server";

/**
 * createFootballLogo RETURNS its failures instead of throwing: Next replaces
 * the message of any error thrown out of a server action in a production build
 * with the generic "An error occurred in the Server Components render" text, so
 * a thrown reason never reaches the screen. A returned value passes through.
 */
export type CreateFootballLogoResult =
  | { ok: true; logo: FootballLogo }
  | {
      ok: false;
      kind: LogoUploadFailureKind;
      message: string;
      /** Raw provider/DB text - shown only for "server" failures. */
      detail?: string;
    };
