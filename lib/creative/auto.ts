/**
 * Guard-free creative cores shared by the designer server actions
 * (`lib/actions/creative-actions.ts`, which add requireStaff) and the
 * nightly campaign cron (`/api/cron/nightlyCampaignCreatives`, cron-secret
 * guarded). Server-only — imports the service-role client.
 *
 * Campaign flow: every feed-eligible event gets an auto-generated creative
 * (square → feed image_link, banner → additional_image_link) IF the same
 * auto-derivation the designer uses comes back clean. Any warning = skip;
 * the feed falls back to the event's original card image. Regeneration is
 * hash-driven: date/price/name change → new hash → re-render next run.
 */
import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase-server";
import { renderCreativePng, SIZES, type CreativeSize } from "@/lib/creative/render";
import {
  buildCreativeInput,
  teamImage,
  type CreativeParams,
} from "@/lib/creative/input";
import { computePackagePrice } from "@/lib/package-price";
import type { Event } from "@/types/app.types";

export type CreativeDefaults = {
  kind: "match" | "artist";
  dateText: string; // DD.MM.YYYY
  timeText: string | null; // HH:MM, null when event has no meaningful time
  locationText: string;
  price: number | null; // final customer package price (main-app formula)
  currency: string;
  // "team:<id>" (football_teams) or "logo:<id>" (football_logos) — see input.ts.
  homeRef: string | null;
  awayRef: string | null;
  artistName: string | null;
  artistImageUrl: string | null;
  warnings: string[];
};

type PersonRow = {
  id: number;
  name: string;
  name_english: string | null;
  logo_url: string | null;
  art_image_url: string | null;
  image_url: string | null;
};

// PersonRow + where it came from, so a match maps back to a subject ref.
type SubjectRow = PersonRow & { ref: string };

const norm = (s: string) => s.toLowerCase().replace(/['"’.]/g, "").trim();

// Match one side of "ברצלונה - ריאל מדריד" against a person/team row by
// Hebrew or English name (exact or containment, both directions).
function matchPerson<R extends PersonRow>(part: string, rows: R[]): R | null {
  const p = norm(part);
  if (!p) return null;
  let best: R | null = null;
  for (const r of rows) {
    for (const candidate of [r.name, r.name_english ?? ""]) {
      const c = norm(candidate);
      if (!c) continue;
      if (c === p) return r; // exact wins immediately
      if ((c.includes(p) || p.includes(c)) && !best) best = r;
    }
  }
  return best;
}

/** DD.MM.YYYY + optional HH:MM from the stored event date, in UTC. */
export function eventDateTexts(dateISO: string): {
  dateText: string;
  timeText: string | null;
} {
  const d = new Date(dateISO);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    dateText: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
    timeText:
      d.getUTCHours() === 0 && d.getUTCMinutes() === 0
        ? null
        : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** Auto-derive everything a creative needs from an event (no auth guard). */
export async function deriveCreativeDefaults(eventId: number): Promise<CreativeDefaults> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,name,name_english,type,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel,art_image_url,card_image_url",
    )
    .eq("id", eventId)
    .single();

  if (error || !data) {
    console.error(JSON.stringify(error));
    throw new Error("Event not found");
  }
  const event = data as unknown as Event;
  const warnings: string[] = [];

  // Date + optional time in UTC (midnight UTC = "no time set" — local getters
  // would shift stored midnight to 02:00/03:00 Israel time).
  const { dateText, timeText } = eventDateTexts(event.date);

  const locationText = event.location?.name ?? "";
  const price = computePackagePrice(event);
  if (price === null) warnings.push("אין כרטיסים זמינים — מחיר לא חושב, מלא ידנית");

  const displayName = event.name || event.name_english || "";

  // Kind detection: type prefix is unreliable (most events are tx_event), so
  // structure decides — "A - B" names are matches; a name that doesn't split
  // in two and exists in the artists table is an artist show.
  const splitsInTwo = [event.name, event.name_english].some(
    (source) =>
      source &&
      source.split(/\s+[-–—]\s+|\s+vs\.?\s+/i).map((p) => p.trim()).length === 2,
  );
  let isMusic = event.type.startsWith("music");
  if (!isMusic && !splitsInTwo) {
    const { data: probe, error: pErr } = await supabase
      .from("artists")
      .select("id")
      .eq("is_deleted", false)
      .or(`name.ilike.%${displayName}%,name_english.ilike.%${displayName}%`)
      .limit(1);
    if (pErr) console.error(JSON.stringify(pErr));
    isMusic = (probe?.length ?? 0) > 0;
  }

  if (isMusic) {
    // Artist creative: event cut-out → matched artist image → event card.
    let artistImageUrl = event.art_image_url ?? null;
    let artistName = displayName;
    const { data: artistRows, error: aErr } = await supabase
      .from("artists")
      .select("id,name,name_english,art_image_url,image_url")
      .eq("is_deleted", false);
    if (aErr) console.error(JSON.stringify(aErr));
    const rows: PersonRow[] = (artistRows || []).map((r) => ({
      ...(r as Omit<PersonRow, "logo_url">),
      logo_url: null,
    }));
    const match = matchPerson(displayName, rows);
    if (match) {
      artistName = match.name;
      artistImageUrl = artistImageUrl ?? match.art_image_url ?? match.image_url;
    }
    artistImageUrl = artistImageUrl ?? event.card_image_url ?? null;
    if (!artistImageUrl) warnings.push("לא נמצאה תמונת אמן — בחר תמונה ידנית");

    return {
      kind: "artist",
      dateText,
      timeText,
      locationText,
      price,
      currency: "$",
      homeRef: null,
      awayRef: null,
      artistName,
      artistImageUrl,
      warnings,
    };
  }

  // Match creative: split "home - away" and match against the logo library
  // first (the curated source), then football_teams. Exact-name matches win
  // over containment regardless of source (see matchPerson).
  const [teamsRes, logosRes] = await Promise.all([
    supabase
      .from("football_teams")
      .select("id,name,name_english,logo_url,art_image_url,image_url")
      .eq("is_deleted", false),
    // football_logos isn't in the generated DB types yet — cast like template-crud.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("football_logos")
      .select("id,name_english,name_hebrew,logo_url"),
  ]);
  if (teamsRes.error) console.error(JSON.stringify(teamsRes.error));
  if (logosRes.error) console.error(JSON.stringify(logosRes.error));

  const logoSubjects: SubjectRow[] = (
    (logosRes.data || []) as {
      id: number;
      name_english: string;
      name_hebrew: string | null;
      logo_url: string;
    }[]
  ).map((l) => ({
    id: l.id,
    name: l.name_hebrew ?? l.name_english,
    name_english: l.name_english,
    logo_url: l.logo_url,
    art_image_url: null,
    image_url: null,
    ref: `logo:${l.id}`,
  }));
  const teamSubjects: SubjectRow[] = ((teamsRes.data || []) as PersonRow[]).map(
    (t) => ({ ...t, ref: `team:${t.id}` }),
  );
  const subjects = [...logoSubjects, ...teamSubjects];

  let homeRef: string | null = null;
  let awayRef: string | null = null;
  // Try both names; first one that splits into exactly two parts wins.
  for (const source of [event.name, event.name_english]) {
    if (!source) continue;
    const parts = source.split(/\s+[-–—]\s+|\s+vs\.?\s+/i).map((p) => p.trim());
    if (parts.length !== 2) continue;
    const home = matchPerson(parts[0], subjects);
    const away = matchPerson(parts[1], subjects);
    if (home && away && home.ref !== away.ref) {
      homeRef = home.ref;
      awayRef = away.ref;
      if (!teamImage(home)) warnings.push(`לקבוצה ${home.name} אין תמונה`);
      if (!teamImage(away)) warnings.push(`לקבוצה ${away.name} אין תמונה`);
      break;
    }
  }
  if (homeRef === null || awayRef === null) {
    warnings.push("לא זוהו שתי קבוצות משם האירוע — בחר ידנית");
  }

  return {
    kind: "match",
    dateText,
    timeText,
    locationText,
    price,
    currency: "$",
    homeRef,
    awayRef,
    artistName: null,
    artistImageUrl: null,
    warnings,
  };
}

/** Render both sizes and upload to `creatives/output/<slugBase>-<size>.png`. */
export async function renderAndUploadCreative(
  input: Awaited<ReturnType<typeof buildCreativeInput>>,
  slugBase: string,
): Promise<Record<CreativeSize, string>> {
  const urls: Record<CreativeSize, string> = { square: "", banner: "" };
  for (const size of Object.keys(SIZES) as CreativeSize[]) {
    const png = await renderCreativePng(input, size);
    const path = `output/${slugBase}-${size}.png`;
    const { error } = await supabase.storage
      .from("creatives")
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (error) {
      console.error(JSON.stringify(error));
      throw new Error(`Upload failed for ${size}`);
    }
    urls[size] = supabase.storage.from("creatives").getPublicUrl(path).data.publicUrl;
  }
  return urls;
}

/* ------------------------- campaign (feed) flow ------------------------- */

/** The row shape the campaign cron works with. */
export type CampaignEventRow = Event & { campaign_input_hash?: string | null };

/** Hash of everything printed on the creative — change → regenerate. */
export function campaignInputHash(event: Event): string {
  const { dateText } = eventDateTexts(event.date);
  const price = computePackagePrice(event);
  return createHash("sha1")
    .update(`${dateText}|${price ?? "none"}|${event.name}`)
    .digest("hex")
    .slice(0, 12);
}

export type CampaignResult =
  | { status: "current" }
  | { status: "skipped"; reason: string }
  | { status: "generated"; squareUrl: string; bannerUrl: string };

/**
 * Ensure the event's campaign creative matches its current data. Stable
 * storage paths per event (upsert) + `?v=<hash>` on the stored URLs so the
 * CDN and Meta pick up regenerations.
 */
export async function generateCampaignForEvent(
  event: CampaignEventRow,
): Promise<CampaignResult> {
  const hash = campaignInputHash(event);
  if (event.campaign_input_hash === hash) return { status: "current" };

  // Records the hash even on skip — otherwise an event whose derivation
  // fails (unmatched teams, no artist image) gets re-evaluated on EVERY
  // cron run forever, permanently occupying batch slots and starving newer
  // events further down the date-ordered scan from ever being reached.
  // Existing campaign_image_url/banner (if any, from a prior successful
  // run) are left untouched — a newly-failing derivation shouldn't blank
  // out a previously good creative.
  const markChecked = async (): Promise<void> => {
    const { error } = await supabase
      .from("events")
      .update({ campaign_input_hash: hash } as never)
      .eq("id", event.id);
    if (error) {
      console.error("campaign hash checkpoint failed:", JSON.stringify(error));
    }
  };

  const defaults = await deriveCreativeDefaults(event.id);
  if (defaults.warnings.length > 0) {
    await markChecked();
    return { status: "skipped", reason: defaults.warnings.join("; ") };
  }
  if (defaults.price === null) {
    await markChecked();
    return { status: "skipped", reason: "no computable price" };
  }

  const params: CreativeParams =
    defaults.kind === "artist"
      ? {
          kind: "artist",
          imageUrl: defaults.artistImageUrl ?? "",
          artistName: defaults.artistName ?? "",
          dateText: defaults.dateText,
          timeText: defaults.timeText,
          locationText: defaults.locationText,
          price: defaults.price,
          currency: defaults.currency,
          mode: "package",
        }
      : {
          kind: "match",
          homeRef: defaults.homeRef ?? "",
          awayRef: defaults.awayRef ?? "",
          dateText: defaults.dateText,
          timeText: defaults.timeText,
          locationText: defaults.locationText,
          price: defaults.price,
          currency: defaults.currency,
          mode: "package",
        };

  const input = await buildCreativeInput(params);
  const urls = await renderAndUploadCreative(input, `auto/event-${event.id}`);
  const squareUrl = `${urls.square}?v=${hash}`;
  const bannerUrl = `${urls.banner}?v=${hash}`;

  const { error } = await supabase
    .from("events")
    .update({
      campaign_image_url: squareUrl,
      campaign_banner_url: bannerUrl,
      campaign_input_hash: hash,
      campaign_generated_at: new Date().toISOString(),
    } as never)
    .eq("id", event.id);
  if (error) {
    console.error("campaign column update failed:", JSON.stringify(error));
    throw new Error(
      "Creative rendered but saving campaign columns failed (migration applied?)",
    );
  }

  return { status: "generated", squareUrl, bannerUrl };
}
