/**
 * The description template of the tour uploader (Alon 25.10: "תבנית קבועה שאני כותב ואז הוא רק ישלים את
 * השמות / מפעל בעברית לכל קבוצה"). Pure - no DB, no network.
 *
 * `events.description` is what the order page prints under the event's title and what the Meta feed reads
 * for its text. The build used to write "Fulham FC vs Arsenal FC at Craven Cottage" - English, and the
 * Hebrew rename never touched it. Now staff write ONE standing template per family (football = a team or
 * a competition run, artist = a performer run) with `{token}` places; the build fills it, the names dialog
 * fills it again once the Hebrew names exist, and the board's "apply" rewrites a run's events.
 *
 * A token with no Hebrew value prints its English one (a team the names dialog has not named yet, a
 * competition no league tag knows) and is reported in `english`, so the board can say which places are
 * still in English; a token with no value at all prints nothing. `{אולם}` prints the hall's Hebrew name
 * (`venue_maps.name_he`, confirmed in the classify dialog - round 2, D3) and the supplier's venue when the
 * hall has none; the venue and the date are never reported as English.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Description template").
 */
import { normalizeName } from "@/lib/on-tour";
import type { ShowIdentity, SubjectKind } from "@/types/uploader.types";

/** The longest template staff may save. */
export const DESCRIPTION_TEMPLATE_MAX = 600;
/** The longest filled description written to an event (a fill longer than this is cut). */
export const DESCRIPTION_MAX = 1000;

export const TEMPLATE_FAMILIES = ["football", "artist"] as const;
export type TemplateFamily = (typeof TEMPLATE_FAMILIES)[number];

/** A team or a competition run builds fixtures (football); an artist run builds shows. */
export const familyOf = (kind: SubjectKind): TemplateFamily => (kind === "artist" ? "artist" : "football");

/** The `uploader_settings` key a family's template is stored under. */
export const templateKey = (family: TemplateFamily): string => `description_template:${family}`;

/** Every token a family's template may use, in the order the editor lists them, with what each prints. */
export const DESCRIPTION_TOKENS: Record<TemplateFamily, readonly { token: string; hint: string }[]> = {
  football: [
    { token: "בית", hint: "הקבוצה המארחת, בעברית" },
    { token: "חוץ", hint: "הקבוצה האורחת, בעברית" },
    { token: "מפעל", hint: "הליגה / הגביע, בעברית" },
    { token: "אירוע", hint: "שם האירוע כפי שהוא באתר" },
    { token: "אולם", hint: "שם האצטדיון בעברית (נקבע בסיווג הכרטיסים), אחרת כפי שהספק כותב אותו" },
    { token: "עיר", hint: "העיר" },
    { token: "תאריך", hint: "תאריך המשחק" },
  ],
  artist: [
    { token: "אמן", hint: "שם האמן, בעברית" },
    { token: "אירוע", hint: "שם האירוע כפי שהוא באתר" },
    { token: "אולם", hint: "שם האולם בעברית (נקבע בסיווג הכרטיסים), אחרת כפי שהספק כותב אותו" },
    { token: "עיר", hint: "העיר" },
    { token: "תאריך", hint: "תאריך ההופעה" },
  ],
};

const TOKEN = /\{([^{}]{1,20})\}/g;
const HEBREW_LETTER = /[א-ת]/;

/** The template as it is stored: trimmed, null when empty; refused when too long or naming a token its family does not know. */
export function cleanTemplate(raw: unknown, family: TemplateFamily): { ok: true; template: string | null } | { ok: false; problem: string } {
  if (raw === null || raw === undefined) return { ok: true, template: null };
  if (typeof raw !== "string") return { ok: false, problem: "התבנית אינה טקסט" };
  const template = raw.replace(/\r\n?/g, "\n").trim();
  if (template === "") return { ok: true, template: null };
  if (template.length > DESCRIPTION_TEMPLATE_MAX) return { ok: false, problem: `התבנית ארוכה מ-${DESCRIPTION_TEMPLATE_MAX} תווים` };
  const known = new Set(DESCRIPTION_TOKENS[family].map((t) => t.token));
  const unknown = [...template.matchAll(TOKEN)].map((m) => m[1].trim()).filter((t) => !known.has(t));
  if (unknown.length > 0) return { ok: false, problem: `לא מוכר: ${[...new Set(unknown)].map((t) => `{${t}}`).join(", ")}` };
  return { ok: true, template };
}

/** Does the template print the competition (`{מפעל}`, spaces inside the braces allowed)? Only then are the league tags read. */
export const usesCompetition = (template: string): boolean => /\{\s*מפעל\s*\}/.test(template);

/** What one token prints: `he` first, else `en` (reported as still English), else nothing. */
export type TokenValue = { he: string | null; en: string | null };
export type DescriptionValues = Record<string, TokenValue>;

/** The template filled. `english` = the tokens printed in English for want of a Hebrew value, each once, in template order. */
export function fillDescription(template: string, values: DescriptionValues): { text: string; english: string[] } {
  const english: string[] = [];
  const filled = template.replace(TOKEN, (_whole, name: string) => {
    const token = name.trim();
    const value = values[token];
    const he = value?.he?.trim() || null;
    if (he !== null) return he;
    const en = value?.en?.trim() || null;
    if (en !== null && !english.includes(token)) english.push(token);
    return en ?? "";
  });
  // a token that printed nothing leaves its spaces behind: one space between words, none at a line's ends
  const text = filled
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, DESCRIPTION_MAX);
  return { text, english };
}

/**
 * The Hebrew name of a competition from the `league` tags (`name_english` normalized -> Hebrew `name`):
 * the exact name first, else the longest tag name the supplier's name contains or is contained in
 * ("English Premier League" -> "Premier League"). A tag name under 4 letters never matches by containment.
 */
export function leagueHebrew(competition: string | null, leagueHe: Record<string, string>): string | null {
  const name = normalizeName(competition);
  if (name === "") return null;
  if (leagueHe[name]) return leagueHe[name];
  const hit = Object.keys(leagueHe)
    .filter((key) => key.length >= 4 && (name.includes(key) || key.includes(name)))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? leagueHe[hit] : null;
}

/** "2026-11-28" -> "28/11/2026"; anything else as it came. */
function dayOf(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

const he = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t !== "" && HEBREW_LETTER.test(t) ? t : null;
};
const any = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Every token's value for one show. `teamsHe` is keyed like `eventNames` reads it (pass it through
 * `withSupplierSpellings` first); `eventName` is the event's name as it stands; `cityHe` the event's city as
 * the site prints it (`eventCityName`), when the event has a location; `venueHe` the hall's Hebrew name
 * (`venue_maps.name_he` of the show's drawing), null when it has none - `{אולם}` then prints the supplier's venue.
 */
export function descriptionValues(input: {
  show: ShowIdentity;
  eventName: string;
  teamsHe: Record<string, string>;
  leagueHe: Record<string, string>;
  cityHe: string | null;
  subject: { name_he: string | null; name_en: string };
  venueHe: string | null;
}): DescriptionValues {
  const { show, teamsHe } = input;
  const side = (team: string | null): TokenValue => ({ he: he(team === null ? null : teamsHe[normalizeName(team)]), en: any(team) });
  return {
    בית: side(show.home_team),
    חוץ: side(show.away_team),
    מפעל: { he: leagueHebrew(show.competition, input.leagueHe), en: any(show.competition) },
    אירוע: { he: he(input.eventName), en: any(input.eventName) ?? any(show.name_english) },
    אמן: { he: he(input.subject.name_he), en: any(input.subject.name_en) },
    // the hall's Hebrew name, else the venue as the supplier writes it (never reported as English); a date is a date
    אולם: { he: any(input.venueHe) ?? any(show.venue) ?? any(show.city), en: null },
    עיר: { he: he(input.cityHe), en: any(input.cityHe) ?? any(show.city) },
    תאריך: { he: dayOf(show.date), en: null },
  };
}
