"use server";

import { supabase } from "@/lib/supabase-server";
import { renderCreativePng, SIZES, type CreativeSize } from "@/lib/creative/render";
import { buildCreativeInput, teamImage, type CreativeParams } from "@/lib/creative/input";
import { updateEvent } from "./event-actions";
import type { Event } from "@/types/app.types";
import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { computePackagePrice } from "@/lib/package-price";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function revalidateMain(): Promise<void> {
  const primary = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const parallel =
    process.env.NEXT_SECRET_PARALLEL_HOTEL_SERVICE_URL ||
    "https://mondial2026.mega-events.co.il";
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!primary || !secret) return;
  // Same dual-target fan-out as app/api/revalidate/route.ts; best-effort, never throws.
  const targets = [...new Set([primary, parallel])];
  await Promise.allSettled(
    targets.map(async (baseUrl) => {
      try {
        await fetch(
          `${baseUrl.replace(/\/$/, "")}/api/revalidate?secret=${encodeURIComponent(secret)}`,
        );
      } catch (error) {
        console.error("revalidate failed (non-fatal):", baseUrl, error);
      }
    }),
  );
}

export async function generateCreative(
  params: CreativeParams & { attachEventId?: number | null },
): Promise<{ squareUrl: string; bannerUrl: string }> {
  await requireStaff();
  const input = await buildCreativeInput(params);
  // Hebrew names slugify to "" — fall back to ids/date so files never collide.
  const dateSlug = params.dateText.replace(/\./g, "-");
  const slug =
    params.kind === "artist"
      ? `${slugify(input.homeName) || "artist"}-${dateSlug}`
      : `${slugify(input.homeName) || params.homeRef.replace(":", "-")}-vs-${slugify(input.awayName ?? "") || params.awayRef.replace(":", "-")}-${dateSlug}`;

  const urls: Record<CreativeSize, string> = { square: "", banner: "" };
  for (const size of Object.keys(SIZES) as CreativeSize[]) {
    const png = await renderCreativePng(input, size);
    const path = `output/${slug}-${size}.png`;
    const { error } = await supabase.storage
      .from("creatives")
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (error) {
      console.error(JSON.stringify(error));
      throw new Error(`Upload failed for ${size}`);
    }
    urls[size] = supabase.storage.from("creatives").getPublicUrl(path).data.publicUrl;
  }

  if (params.attachEventId) {
    try {
      await updateEvent(params.attachEventId, { card_image_url: urls.square });
    } catch (error) {
      console.error(JSON.stringify(error));
      throw new Error("Creative saved, but attaching to event failed");
    }
    await revalidateMain();
  }

  await logAudit({
    action: "create",
    entityType: "creative",
    entityId: params.attachEventId ?? null,
    metadata: { kind: params.kind, sizes: Object.keys(SIZES) },
  });

  return { squareUrl: urls.square, bannerUrl: urls.banner };
}

// ---------------------------------------------------------------------------
// Auto-prefill: pick an event → derive everything the creative needs from it.
// ---------------------------------------------------------------------------

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

export async function getCreativeDefaults(eventId: number): Promise<CreativeDefaults> {
  await requireStaff();
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
  const d = new Date(event.date);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateText = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  const timeText =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      ? null
      : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

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
