"use server";

import { supabase } from "@/lib/supabase-server";
import { renderCreativePng, SIZES, type CreativeSize } from "@/lib/creative/render";
import { buildCreativeInput, teamImage, type CreativeParams } from "@/lib/creative/input";
import { updateEvent } from "./event-actions";
import type { Event, EventTicket } from "@/types/app.types";

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
  const input = await buildCreativeInput(params);
  // Hebrew names slugify to "" — fall back to ids/date so files never collide.
  const dateSlug = params.dateText.replace(/\./g, "-");
  const slug =
    params.kind === "artist"
      ? `${slugify(input.homeName) || "artist"}-${dateSlug}`
      : `${slugify(input.homeName) || `team-${params.homeId}`}-vs-${slugify(input.awayName ?? "") || `team-${params.awayId}`}-${dateSlug}`;

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
  homeTeamId: number | null;
  awayTeamId: number | null;
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

const norm = (s: string) => s.toLowerCase().replace(/['"’.]/g, "").trim();

// Match one side of "ברצלונה - ריאל מדריד" against a person/team row by
// Hebrew or English name (exact or containment, both directions).
function matchPerson(part: string, rows: PersonRow[]): PersonRow | null {
  const p = norm(part);
  if (!p) return null;
  let best: PersonRow | null = null;
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

// Replicates main-app computePackagePrice: flight + hotel + min available
// ticket + markups (composed per-component when any markup_* set, else the
// global 175) + event_additional_markup. See myt-main lib/events/price.ts.
function computePackagePrice(event: {
  tickets_and_rates: EventTicket[] | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  event_additional_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
}): number | null {
  const available = (event.tickets_and_rates || []).filter(
    (t) => t?.available !== false,
  );
  if (available.length === 0) return null;
  const minTicket = Math.min(...available.map((t) => t.price));
  const composed =
    event.markup_ticket != null ||
    event.markup_flight != null ||
    event.markup_hotel != null;
  const markup = composed
    ? (event.markup_ticket ?? 0) + (event.markup_flight ?? 0) + (event.markup_hotel ?? 0)
    : 175;
  return Math.round(
    (event.base_flight_price ?? 0) +
      (event.base_hotel_price ?? 0) +
      minTicket +
      markup +
      (event.event_additional_markup ?? 0),
  );
}

export async function getCreativeDefaults(eventId: number): Promise<CreativeDefaults> {
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
      homeTeamId: null,
      awayTeamId: null,
      artistName,
      artistImageUrl,
      warnings,
    };
  }

  // Match creative: split "home - away" and match against football_teams.
  const { data: teamRows, error: tErr } = await supabase
    .from("football_teams")
    .select("id,name,name_english,logo_url,art_image_url,image_url")
    .eq("is_deleted", false);
  if (tErr) console.error(JSON.stringify(tErr));
  const teams = (teamRows || []) as PersonRow[];

  let homeTeamId: number | null = null;
  let awayTeamId: number | null = null;
  // Try both names; first one that splits into exactly two parts wins.
  for (const source of [event.name, event.name_english]) {
    if (!source) continue;
    const parts = source.split(/\s+[-–—]\s+|\s+vs\.?\s+/i).map((p) => p.trim());
    if (parts.length !== 2) continue;
    const home = matchPerson(parts[0], teams);
    const away = matchPerson(parts[1], teams);
    if (home && away && home.id !== away.id) {
      homeTeamId = home.id;
      awayTeamId = away.id;
      if (!teamImage(home)) warnings.push(`לקבוצה ${home.name} אין תמונה`);
      if (!teamImage(away)) warnings.push(`לקבוצה ${away.name} אין תמונה`);
      break;
    }
  }
  if (homeTeamId === null || awayTeamId === null) {
    warnings.push("לא זוהו שתי קבוצות משם האירוע — בחר ידנית");
  }

  return {
    kind: "match",
    dateText,
    timeText,
    locationText,
    price,
    currency: "$",
    homeTeamId,
    awayTeamId,
    artistName: null,
    artistImageUrl: null,
    warnings,
  };
}
