/**
 * The tour uploader's description template - its storage and the run rewrite (Alon 25.10). The rules
 * are pure in lib/uploader/description.ts; this file reads and writes `uploader_settings`, reads the
 * `league` tags' Hebrew names, and rewrites the description of a run's built events.
 *
 * A rewrite touches an event only while its description is still the one the uploader wrote (the item's
 * `payload.description`, which follows every rewrite) - one a person typed in the editor, or carried to other
 * shows with "למדו והחילו" (`description_by_hand`), stays theirs and is counted as `editedByHand`. A fill that
 * prints nothing never blanks an event.
 *
 * `{אולם}` prints the hall's Hebrew name (`venue_maps.name_he`, round 2 D3): the build reads it with the
 * template it already has, a rewrite reads it once per drawing (`hallNames`).
 *
 * Migration 20261027120500_uploader_settings.sql. Before it is applied every read answers "no template"
 * (`ready: false`) and the build keeps its English default.
 */
import "server-only";
import { logAudit } from "@/lib/audit";
import { eventCityName, type LodgingEvent } from "@/lib/lodging";
import { normalizeName } from "@/lib/on-tour";
import { AGENT, logDb, nowIso, readVenueTemplate, transitionItem } from "@/lib/services/uploader-store";
import { supabase } from "@/lib/supabase-server";
import { decision } from "@/lib/uploader/decisions";
import { cleanTemplate, descriptionIsAPersons, descriptionValues, fillDescription, templateKey, type DescriptionValues, type TemplateFamily } from "@/lib/uploader/description";
import { withSupplierSpellings } from "@/lib/uploader/names";
import type { UploaderItem } from "@/types/uploader.types";

// `uploader_settings` is newer than types/database.types.ts - one boundary cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type DbError = { message: string; code?: string } | null;

/** The table is not there yet (the migration has not run): a missing relation, or PostgREST's schema cache without it. */
const isMissingTable = (error: DbError): boolean => error?.code === "42P01" || error?.code === "PGRST205";

/** A `.in()` list travels in the URL - keep it short. */
const IN_CHUNK = 200;

const HEBREW_LETTER = /[א-ת]/;

export type TemplateRead = { ok: true; template: string | null; ready: boolean } | { ok: false };

/** A family's standing template. `ready: false` = the table is not migrated yet (no template, nothing to save to). */
export async function readDescriptionTemplate(family: TemplateFamily): Promise<TemplateRead> {
  const { data, error } = (await db.from("uploader_settings").select("value").eq("key", templateKey(family)).maybeSingle()) as {
    data: { value: { template?: unknown } | null } | null;
    error: DbError;
  };
  if (error) {
    if (isMissingTable(error)) return { ok: true, template: null, ready: false };
    logDb(`uploader_settings ${family} template read`, error);
    return { ok: false };
  }
  // stored by writeDescriptionTemplate, but a jsonb row is checked again: a bad value reads as no template
  const clean = cleanTemplate(data?.value?.template ?? null, family);
  return { ok: true, template: clean.ok ? clean.template : null, ready: true };
}

/** Saves (or clears, with null) a family's template. */
export async function writeDescriptionTemplate(family: TemplateFamily, template: string | null, by: string): Promise<"ok" | "missing_table" | "db_error"> {
  const { error } = (await db
    .from("uploader_settings")
    .upsert({ key: templateKey(family), value: { template }, updated_by: by, updated_at: nowIso() }, { onConflict: "key" })) as { error: DbError };
  if (!error) return "ok";
  if (isMissingTable(error)) return "missing_table";
  logDb(`uploader_settings ${family} template write`, error);
  return "db_error";
}

/** The `league` tags' Hebrew names keyed by `normalizeName(name_english)` - what `{מפעל}` prints. A failed read = none (the English name prints). */
export async function readLeagueHebrew(): Promise<Record<string, string>> {
  const { data, error } = (await db.from("event_tags").select("name,name_english").eq("type", "league").eq("is_deleted", false)) as {
    data: { name: string | null; name_english: string | null }[] | null;
    error: DbError;
  };
  if (error) {
    logDb("event_tags (league names) read", error);
    return {};
  }
  const out: Record<string, string> = {};
  for (const tag of data ?? []) {
    const key = normalizeName(tag.name_english);
    const name = (tag.name ?? "").trim();
    if (key !== "" && HEBREW_LETTER.test(name) && !out[key]) out[key] = name;
  }
  return out;
}

type DescriptionRow = {
  id: number;
  name: string | null;
  description: string | null;
  location: LodgingEvent["location"] | null;
  event_location: LodgingEvent["event_location"];
  is_hidden: boolean | null;
};

async function readDescriptionRows(ids: number[]): Promise<Map<number, DescriptionRow> | null> {
  const out = new Map<number, DescriptionRow>();
  const wanted = [...new Set(ids)];
  for (let i = 0; i < wanted.length; i += IN_CHUNK) {
    const { data, error } = (await db
      .from("events")
      .select("id,name,description,location,event_location,is_hidden")
      .in("id", wanted.slice(i, i + IN_CHUNK))
      .is("is_deleted", null)) as { data: DescriptionRow[] | null; error: DbError };
    if (error) {
      logDb("events (description) read", error);
      return null;
    }
    for (const row of data ?? []) out.set(row.id, row);
  }
  return out;
}

async function writeEventDescription(eventId: number, description: string): Promise<boolean> {
  const { data, error } = (await db.from("events").update({ description }).eq("id", eventId).is("is_deleted", null).select("id")) as {
    data: { id: number }[] | null;
    error: DbError;
  };
  if (error) {
    logDb(`event ${eventId} description write`, error);
    return false;
  }
  if ((data ?? []).length === 0) {
    console.error(`uploader: event ${eventId} description not written - deleted meanwhile`);
    return false;
  }
  return true;
}

type ValuesInput = {
  item: Pick<UploaderItem, "show">;
  eventName: string;
  location: LodgingEvent["location"] | null;
  eventLocation: LodgingEvent["event_location"];
  teamsHe: Record<string, string>;
  leagueHe: Record<string, string>;
  subject: { name_he: string | null; name_en: string };
  /** The hall's Hebrew name (`venue_maps.name_he` of the show's drawing); null = none, `{אולם}` prints the supplier's venue. */
  venueHe: string | null;
};

/** The show's TixStock drawing url - what its hall's template is found by (null: a LiveTickets-only show). */
const drawingOf = (item: Pick<UploaderItem, "show">): string | null => {
  const url = item.show.suppliers.tixstock?.venue_map_url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
};

/**
 * The Hebrew name of each hall the items play at (`venue_maps.name_he` of their drawing), one read per
 * drawing, keyed by drawing url; a drawing with no template or no name is not in the map. null = a read failed (logged).
 */
export async function hallNames(items: Pick<UploaderItem, "show">[]): Promise<Map<string, string> | null> {
  const urls = [...new Set(items.map(drawingOf).filter((u): u is string => u !== null))];
  const reads = await Promise.all(urls.map(async (url) => ({ url, read: await readVenueTemplate(url) })));
  const out = new Map<string, string>();
  for (const { url, read } of reads) {
    if (read.failed) return null;
    if (read.row?.name_he) out.set(url, read.row.name_he);
  }
  return out;
}

/** Every token's value for one show as its event stands (the city as the site prints it). */
function valuesFor(input: ValuesInput): DescriptionValues {
  const { show } = input.item;
  const city = input.location ? eventCityName({ location: input.location, event_location: input.eventLocation ?? null }) : "";
  return descriptionValues({
    show,
    eventName: input.eventName,
    teamsHe: withSupplierSpellings(input.teamsHe, [show.home_team, show.away_team]),
    leagueHe: input.leagueHe,
    cityHe: city === "" ? null : city,
    subject: input.subject,
    venueHe: input.venueHe,
  });
}

/** The fill for one show - shared by the build (before the event exists) and the rewrite. */
export function descriptionFor(input: ValuesInput & { template: string }): { text: string; english: string[] } {
  return fillDescription(input.template, valuesFor(input));
}

/** The token values of one built show, for the editor's live preview (its event read now); null = no such event. */
export async function sampleDescriptionValues(
  item: UploaderItem & { event_id: number },
  ctx: Pick<ValuesInput, "teamsHe" | "leagueHe" | "subject" | "venueHe">,
): Promise<DescriptionValues | null> {
  const rows = await readDescriptionRows([item.event_id]);
  const row = rows?.get(item.event_id);
  if (!row) return null;
  return valuesFor({ ...ctx, item, eventName: row.name ?? "", location: row.location, eventLocation: row.event_location });
}

/** The decision line a filled description leaves on its item (replacing an older one). */
export function descriptionDecisions(decisions: UploaderItem["decisions"], english: string[]): UploaderItem["decisions"] {
  return [...decisions.filter((d) => d.code !== "description_from_template"), decision("description_from_template", { english: english.join(", ") })];
}

export type DescriptionRewrite = {
  /** Events whose description was rewritten. */
  eventIds: number[];
  /** One of them is on the site (approved / not hidden) - main must be revalidated. */
  live: boolean;
  /** Events a person had already given their own description - left alone. */
  editedByHand: number;
  /** Rewritten with a token still in English (no Hebrew value yet). */
  english: number;
  failed: number;
};

const REWRITTEN: UploaderItem["status"][] = ["ready", "approved"];

/**
 * The template over a run's built events (ready / approved): each event whose description is still the
 * uploader's gets the fill; the item's payload and decision follow. null = the events or a hall's template
 * could not be read. Audited once, `uploader.description_applied`.
 */
export async function rewriteRunDescriptions(input: {
  runId: string;
  items: UploaderItem[];
  family: TemplateFamily;
  template: string;
  teamsHe: Record<string, string>;
  leagueHe: Record<string, string>;
  subject: { name_he: string | null; name_en: string };
  via: "board" | "names" | "classify";
}): Promise<DescriptionRewrite | null> {
  const targets = input.items.filter(
    (i): i is UploaderItem & { event_id: number } => REWRITTEN.includes(i.status) && typeof i.event_id === "number",
  );
  const out: DescriptionRewrite = { eventIds: [], live: false, editedByHand: 0, english: 0, failed: 0 };
  if (targets.length === 0) return out;
  const rows = await readDescriptionRows(targets.map((i) => i.event_id));
  if (rows === null) return null;
  const halls = await hallNames(targets);
  if (halls === null) return null;

  for (const item of targets) {
    const row = rows.get(item.event_id);
    if (!row) continue;
    const current = (row.description ?? "").trim();
    // typed by a person, or carried by "למדו והחילו": theirs
    if (descriptionIsAPersons(item.payload, current)) {
      out.editedByHand += 1;
      continue;
    }
    const { text, english } = descriptionFor({
      template: input.template,
      item,
      eventName: row.name ?? "",
      location: row.location,
      eventLocation: row.event_location,
      teamsHe: input.teamsHe,
      leagueHe: input.leagueHe,
      subject: input.subject,
      venueHe: halls.get(drawingOf(item) ?? "") ?? null,
    });
    if (text === "" || text === current) continue;
    if (!(await writeEventDescription(item.event_id, text))) {
      out.failed += 1;
      continue;
    }
    out.eventIds.push(item.event_id);
    if (english.length > 0) out.english += 1;
    if (item.status === "approved" || row.is_hidden !== true) out.live = true;
    const moved = await transitionItem(item.id, REWRITTEN, {
      // a person emptied a carried text and the template filled it: it is the uploader's own again
      payload: item.payload ? { ...item.payload, description: text, ...(item.payload.description_by_hand ? { description_by_hand: false } : {}) } : item.payload,
      decisions: descriptionDecisions(item.decisions, english),
    });
    if (moved === "db_error") out.failed += 1;
  }

  if (out.eventIds.length > 0) {
    await logAudit({
      action: "uploader.description_applied",
      entityType: "uploader_run",
      entityId: input.runId,
      metadata: { agent: AGENT, run_id: input.runId, family: input.family, via: input.via, event_ids: out.eventIds, edited_by_hand: out.editedByHand },
    });
  }
  return out;
}
