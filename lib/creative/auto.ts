/**
 * Guard-free creative cores shared by the designer server actions
 * (`lib/actions/creative-actions.ts`, which add requireStaff) and the
 * nightly campaign cron (`/api/cron/nightlyCampaignCreatives`, cron-secret
 * guarded). Server-only - imports the service-role client.
 *
 * Campaign flow: every feed-eligible event gets an auto-generated creative
 * (square → feed image_link, banner → additional_image_link). Clean
 * auto-derivation (matched teams/artist) uses the branded logo composition;
 * when derivation warns (unmatched names, no artist image), it falls back to
 * a full-bleed creative using the event's own photo ("photo" kind) - only a
 * genuinely imageless or priceless event still skips (feed then falls back
 * to the original card image untouched). Regeneration is hash-driven:
 * date/price/name change → new hash → re-render next run.
 */
import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase-server";
import {
  renderCreativePng,
  SIZES,
  type CreativeSize,
} from "@/lib/creative/render";
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
  // "team:<id>" (football_teams) or "logo:<id>" (football_logos) - see input.ts.
  homeRef: string | null;
  awayRef: string | null;
  artistName: string | null;
  artistImageUrl: string | null;
  // Whether artistImageUrl is a real transparent cut-out (art_image_url) vs a
  // regular photo (image_url/card_image_url) - decides blob-card vs plain
  // circular-avatar rendering (see MatchTemplate). Meaningless when kind !== "artist".
  artistIsCutout: boolean;
  // Event's own regular photo - the fallback subject for the "photo" creative
  // kind when no team/artist logo could be matched (see `warnings`).
  cardImageUrl: string | null;
  eventName: string;
  // Single-team spotlight fallback: when only ONE side of a "A - B" match
  // resolved to a known team/logo (the opponent isn't in the library), this
  // carries that one team's identity so the campaign flow can build a
  // single-subject creative instead of discarding a real crest.
  partialTeamName: string | null;
  partialTeamImageUrl: string | null;
  partialTeamIsCutout: boolean;
  warnings: string[];
};

type PersonRow = {
  id: number;
  name: string;
  name_english: string | null;
  logo_url: string | null;
  art_image_url: string | null;
  image_url: string | null;
  // artists.gallery (jsonb) - array of image URLs, empty for most rows.
  // Only loaded for artists; football_teams/logos subjects leave it unset.
  gallery?: string[] | null;
};

// PersonRow + where it came from, so a match maps back to a subject ref.
type SubjectRow = PersonRow & { ref: string };

/**
 * Optional per-run lookup caches so batch callers (the nightly campaign cron)
 * don't re-fetch the full artists / football_teams / football_logos tables
 * for EVERY event (~40 full-table reads per run). Scoped to the caller's
 * object - no TTL, no cross-request staleness; single-event designer calls
 * simply omit it and fetch fresh.
 */
export type CreativeLookupCaches = {
  artists?: PersonRow[];
  subjects?: SubjectRow[];
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['"’.]/g, "")
    .trim();

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

/** Artists table rows (deduped per batch run through `caches`). */
async function loadArtistRows(
  caches?: CreativeLookupCaches,
): Promise<PersonRow[]> {
  if (caches?.artists) return caches.artists;
  const { data, error } = await supabase
    .from("artists")
    .select("id,name,name_english,art_image_url,image_url,gallery")
    .eq("is_deleted", false);
  if (error) console.error(JSON.stringify(error));
  const rows: PersonRow[] = ((data || []) as Omit<PersonRow, "logo_url">[]).map(
    (r) => ({ ...r, logo_url: null }),
  );
  if (caches) caches.artists = rows;
  return rows;
}

/**
 * Deterministic per-event pick from an artist's gallery (jsonb URL array).
 * Plain modulo on the event id: same-artist events carry near-sequential ids,
 * so this walks the gallery round-robin - maximum variety across the artist's
 * events, stable for any single event across re-renders.
 */
export function pickGalleryImage(
  gallery: unknown,
  eventId: number,
): string | null {
  const pool = Array.isArray(gallery)
    ? gallery.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  if (pool.length === 0) return null;
  return pool[eventId % pool.length];
}

/** The artist row an event's name matches (Hebrew first, English fallback). */
export function matchArtistForEvent(
  event: Pick<Event, "name" | "name_english">,
  rows: PersonRow[],
): PersonRow | null {
  const hebName = (event.name ?? "").trim();
  const engName = (event.name_english ?? "").trim();
  return matchPerson(hebName, rows) ?? matchPerson(engName, rows);
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
export async function deriveCreativeDefaults(
  eventId: number,
  caches?: CreativeLookupCaches,
): Promise<CreativeDefaults> {
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

  // Date + optional time in UTC (midnight UTC = "no time set" - local getters
  // would shift stored midnight to 02:00/03:00 Israel time).
  const { dateText, timeText } = eventDateTexts(event.date);

  const locationText = event.location?.name ?? "";
  const price = computePackagePrice(event);
  if (price === null)
    warnings.push("אין כרטיסים זמינים - מחיר לא חושב, מלא ידנית");

  // Names carry stray whitespace in the DB (114 future events at the time of
  // writing) - an untrimmed "%גרייסי אברמס %" ilike matches nothing.
  const hebName = (event.name ?? "").trim();
  const engName = (event.name_english ?? "").trim();
  const displayName = hebName || engName;

  // Kind detection: type prefix is unreliable (most events are tx_event), so
  // structure decides - "A - B" names are matches; a name that doesn't split
  // in two and exists in the artists table is an artist show.
  const splitsInTwo = [event.name, event.name_english].some(
    (source) =>
      source &&
      source.split(/\s+[-–-]\s+|\s+vs\.?\s+/i).map((p) => p.trim()).length ===
        2,
  );
  // A per-event cut-out (art_image_url) is itself strong evidence this is a
  // single-subject show, regardless of whether an artists-table row exists -
  // without this, an event with its own uploaded cutout but no matching
  // artists row (or matching team names) fell through to the team-match
  // path, failed there too, and its perfectly good cutout went unused.
  let isMusic =
    event.type.startsWith("music") || (!!event.art_image_url && !splitsInTwo);
  if (!isMusic && !splitsInTwo) {
    // Probe BOTH names. The Hebrew spellings drift from the library's
    // ("בון גובי" vs "בון ג'ובי", "פטבול" vs "פיטבול") while the English is
    // usually identical, so searching the Hebrew alone lost artists that were
    // sitting right there with an image.
    const terms = [hebName, engName].filter(Boolean);
    for (const term of terms) {
      const { data: probe, error: pErr } = await supabase
        .from("artists")
        .select("id")
        .eq("is_deleted", false)
        .or(`name.ilike.%${term}%,name_english.ilike.%${term}%`)
        .limit(1);
      if (pErr) console.error(JSON.stringify(pErr));
      if ((probe?.length ?? 0) > 0) {
        isMusic = true;
        break;
      }
    }
  }

  if (isMusic) {
    // Artist creative: event cut-out → matched artist image → event card.
    // Tracks whether the resolved image is a REAL cut-out (art_image_url,
    // blob-safe) or a regular photo (image_url/card_image_url - plain
    // circular-avatar rendering, see MatchTemplate) so a "clean" artist match
    // whose only image is a flat photo doesn't get crammed into a blob.
    let artistImageUrl: string | null = event.art_image_url ?? null;
    let artistIsCutout = artistImageUrl != null;
    let artistName = displayName;
    const rows = await loadArtistRows(caches);
    // Hebrew first, English as the fallback - same reason as the probe above.
    const match = matchArtistForEvent(event, rows);
    if (match) {
      artistName = match.name;
      if (!artistImageUrl) {
        // Gallery first: a per-event rotating pick beats the one static
        // artist image - that's what makes each product's creative (and so
        // the Meta feed) look different per event of the same artist. Falls
        // back to the artist cut-out/photo when the gallery is empty.
        //
        // Gallery images ARE cut-outs (the gallery editor's upload pipeline
        // strips backgrounds) - so they get the blob card with the seeded
        // per-event color/shape, not the plain avatar circle a raw photo
        // gets (2026-08-11: a cutout crammed into a cover-cropped circle
        // rendered as a floating torso).
        const galleryPick = pickGalleryImage(match.gallery, eventId);
        if (galleryPick) {
          artistImageUrl = galleryPick;
          artistIsCutout = true;
        } else if (match.art_image_url) {
          artistImageUrl = match.art_image_url;
          artistIsCutout = true;
        } else if (match.image_url) {
          artistImageUrl = match.image_url;
          artistIsCutout = false;
        }
      }
    }
    if (!artistImageUrl && event.card_image_url) {
      artistImageUrl = event.card_image_url;
      artistIsCutout = false;
    }
    if (!artistImageUrl) warnings.push("לא נמצאה תמונת אמן - בחר תמונה ידנית");

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
      artistIsCutout,
      partialTeamName: null,
      partialTeamImageUrl: null,
      partialTeamIsCutout: false,
      cardImageUrl: event.card_image_url ?? null,
      eventName: displayName,
      warnings,
    };
  }

  // Match creative: split "home - away" and match against the logo library
  // first (the curated source), then football_teams. Exact-name matches win
  // over containment regardless of source (see matchPerson).
  let subjects: SubjectRow[];
  if (caches?.subjects) {
    subjects = caches.subjects;
  } else {
    const [teamsRes, logosRes] = await Promise.all([
      supabase
        .from("football_teams")
        .select("id,name,name_english,logo_url,art_image_url,image_url")
        .eq("is_deleted", false),
      // football_logos isn't in the generated DB types yet - cast like template-crud.
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
    const teamSubjects: SubjectRow[] = (
      (teamsRes.data || []) as PersonRow[]
    ).map((t) => ({ ...t, ref: `team:${t.id}` }));
    subjects = [...logoSubjects, ...teamSubjects];
    if (caches) caches.subjects = subjects;
  }

  let homeRef: string | null = null;
  let awayRef: string | null = null;
  // When only ONE side of "A - B" matches a known team/logo (the common case
  // - the opponent just isn't in our small library), remember it: rather
  // than discard a perfectly good, real crest, the campaign flow uses it for
  // a single-team spotlight (see generateCampaignForEvent) instead of
  // skipping the whole fixture.
  let partialSubject: SubjectRow | null = null;
  // Try both names; first one that splits into exactly two parts wins.
  for (const source of [event.name, event.name_english]) {
    if (!source) continue;
    const parts = source.split(/\s+[-–-]\s+|\s+vs\.?\s+/i).map((p) => p.trim());
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
    if (!partialSubject) {
      const found = (home ?? away) as SubjectRow | null;
      if (found && teamImage(found)) partialSubject = found;
    }
  }
  if (homeRef === null || awayRef === null) {
    warnings.push("לא זוהו שתי קבוצות משם האירוע - בחר ידנית");
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
    artistIsCutout: false,
    partialTeamName: partialSubject?.name ?? null,
    partialTeamImageUrl: partialSubject ? teamImage(partialSubject) : null,
    partialTeamIsCutout: partialSubject
      ? partialSubject.logo_url != null || partialSubject.art_image_url != null
      : false,
    cardImageUrl: event.card_image_url ?? null,
    eventName: displayName,
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
    urls[size] = supabase.storage
      .from("creatives")
      .getPublicUrl(path).data.publicUrl;
  }
  return urls;
}

/* ------------------------- campaign (feed) flow ------------------------- */

/** The row shape the campaign cron works with. */
export type CampaignEventRow = Event & { campaign_input_hash?: string | null };

// Bump whenever a rendering/template change should force ALL existing
// creatives to regenerate on the next cron pass, even though their
// underlying event data hasn't changed. v2: no-cutout avatar treatment +
// real wordmark logo (2026-07-19). v3: new tagline, "מחיר ממוצע לנוסע" pill
// in brand mint at one size across both creatives, square subject cards,
// thousands separator (2026-07-29).
//
// STILL "v3" on purpose (2026-08-11): the hero/name-top/price-top layouts
// exist but are manual-designer-only until the creative team picks the new
// template together - bump to "v4" when that lands, and the whole catalog
// re-renders in the chosen look. Until then deploying this file changes
// nothing about existing creatives.
const RENDER_VERSION = "v3";

/**
 * Hash of everything printed on the creative - change → regenerate. Includes
 * the event's own image fields (card_image_url, art_image_url): without
 * this, uploading a missing photo/cutout directly on the event doesn't
 * change its date/price/name, so a prior skip stayed checkpointed forever
 * even after the actual blocker was fixed.
 *
 * `galleryUrl` is the deterministic artist-gallery pick for this event (see
 * pickGalleryImage) - batch callers pass it so uploading/editing an artist's
 * gallery regenerates that artist's creatives on the next run. (Fixing a
 * linked row's plain art_image_url/image_url instead still needs a manual
 * recheck - that data isn't in the hash.)
 */
export function campaignInputHash(
  event: Event,
  galleryUrl?: string | null,
): string {
  const { dateText } = eventDateTexts(event.date);
  const price = computePackagePrice(event);
  // The gallery segment is appended ONLY when a pick exists: with every
  // gallery still empty, hashes stay byte-identical to the pre-gallery
  // format, so deploying this code re-renders nothing. The first images
  // uploaded to an artist's gallery change only that artist's hashes.
  const gallerySegment = galleryUrl ? `|${galleryUrl}` : "";
  return createHash("sha1")
    .update(
      `${RENDER_VERSION}|${dateText}|${price ?? "none"}|${event.name}|${event.card_image_url ?? ""}|${event.art_image_url ?? ""}${gallerySegment}`,
    )
    .digest("hex")
    .slice(0, 12);
}

/**
 * Best-effort note of why an event has no creative (null clears it).
 *
 * Deliberately its own tolerant write: `campaign_skip_reason` is a diagnostic,
 * and a deploy that lands before its migration must not take creative
 * generation down with it. Failure is logged, never thrown.
 */
async function setSkipReason(
  eventId: number,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("events")
    .update({ campaign_skip_reason: reason } as never)
    .eq("id", eventId);
  if (error) {
    console.error("campaign skip reason not stored:", JSON.stringify(error));
  }
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
  caches?: CreativeLookupCaches,
): Promise<CampaignResult> {
  // Gallery-aware hash: the picked gallery image is part of what gets
  // rendered, so a gallery edit must produce a new hash (→ regenerate).
  const artistRows = await loadArtistRows(caches);
  const galleryMatch = matchArtistForEvent(event, artistRows);
  const galleryUrl = galleryMatch
    ? pickGalleryImage(galleryMatch.gallery, event.id)
    : null;
  const hash = campaignInputHash(event, galleryUrl);
  if (event.campaign_input_hash === hash) return { status: "current" };

  // Records the hash even on skip - otherwise an event whose derivation
  // fails (unmatched teams, no artist image) gets re-evaluated on EVERY
  // cron run forever, permanently occupying batch slots and starving newer
  // events further down the date-ordered scan from ever being reached.
  // Existing campaign_image_url/banner (if any, from a prior successful
  // run) are left untouched - a newly-failing derivation shouldn't blank
  // out a previously good creative.
  // The reason is stored on the event so "why is this product missing?" is
  // answerable in the UI instead of only in a cron response nobody reads.
  const markChecked = async (reason: string): Promise<void> => {
    const { error } = await supabase
      .from("events")
      .update({ campaign_input_hash: hash } as never)
      .eq("id", event.id);
    if (error) {
      console.error("campaign hash checkpoint failed:", JSON.stringify(error));
    }
    await setSkipReason(event.id, reason);
  };

  const defaults = await deriveCreativeDefaults(event.id, caches);
  if (defaults.price === null) {
    // The only remaining skip: Meta requires a price, so a priceless event has
    // no product to advertise. Everything else now renders SOMETHING branded.
    await markChecked("אין מחיר - אין כרטיסים זמינים לחישוב מחיר חבילה");
    return { status: "skipped", reason: "no computable price" };
  }

  const baseFields = {
    dateText: defaults.dateText,
    timeText: defaults.timeText,
    locationText: defaults.locationText,
    price: defaults.price,
    currency: defaults.currency,
    mode: "package" as const,
  };

  // The auto/campaign flow renders EXACTLY the v3 look for now: classic
  // layout, no hero mode. The new layouts (hero / name-top / price-top,
  // 2026-08-10) are manual-designer-only until the creative team picks the
  // production template together - then wire the choice in here and bump
  // RENDER_VERSION. Gallery picks still flow through artistImageUrl, so an
  // artist with gallery images already gets per-event photo variety.
  let params: CreativeParams;
  if (defaults.warnings.length === 0 && defaults.kind === "artist") {
    // isCutout flows through to input.ts/MatchTemplate: even a "clean" match
    // (artist found, no warnings) renders as a plain circular avatar instead
    // of a blob card when its only image is a regular photo, not a cut-out.
    params = {
      kind: "artist",
      imageUrl: defaults.artistImageUrl ?? "",
      artistName: defaults.artistName ?? "",
      isCutout: defaults.artistIsCutout,
      ...baseFields,
    };
  } else if (defaults.warnings.length === 0) {
    params = {
      kind: "match",
      homeRef: defaults.homeRef ?? "",
      awayRef: defaults.awayRef ?? "",
      ...baseFields,
    };
  } else if (defaults.partialTeamImageUrl) {
    // Only ONE side of "A - B" matched a known team (the common case - the
    // opponent just isn't in our small library). Rather than discard a real
    // crest, spotlight that one team on the football-stadium backdrop (same
    // look as the site's own team pages) with the FULL original match title
    // ("Arsenal - Coventry City") so it still reads as this specific fixture.
    params = {
      kind: "artist",
      imageUrl: defaults.partialTeamImageUrl,
      artistName: event.name || event.name_english || "",
      isCutout: defaults.partialTeamIsCutout,
      bgKind: "football",
      ...baseFields,
    };
  } else {
    // No matched team/artist logo - fall back to the event's own photo, and
    // when there isn't one either, to a BARE branded canvas (wordmark,
    // tagline, name, date, price pill; no subject image).
    //
    // Every priced event must reach the feed carrying our branding, so this
    // path never skips: a plain provider photo in a Meta ad is worth less than
    // a branded card, and an event with nothing at all used to drop out of the
    // catalogue entirely.
    const photoUrl = event.card_image_url || event.art_image_url;
    const eventName = (event.name || event.name_english || "").trim();
    params = photoUrl
      ? { kind: "photo", imageUrl: photoUrl, eventName, ...baseFields }
      : { kind: "photo", imageUrl: "", eventName, bare: true, ...baseFields };
  }

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
  await setSkipReason(event.id, null);

  return { status: "generated", squareUrl, bannerUrl };
}

/* ----------------------- batch runner (cron + UI) ----------------------- */

export type CampaignRunSummary = {
  /** Feed-eligible events looked at (not deleted, today onward). */
  scanned: number;
  /** Already up to date - hash matched, nothing to do. */
  current: number;
  generated: number[];
  skipped: { id: number; reason: string }[];
  errors: { id: number; error: string }[];
  /** Stale events left untouched because the run ran out of time/limit. */
  remaining: number;
  stoppedEarly: boolean;
};

export type CampaignRunOptions = {
  /** Max events to render this run. null/undefined = no cap (time-bound only). */
  limit?: number | null;
  /** Wall-clock budget; the run stops cleanly before the platform kills it. */
  timeBudgetMs?: number;
};

/**
 * Regenerate every campaign creative whose input hash changed, oldest event
 * first. Shared by the nightly cron and the manual "sync everything" button -
 * both get the same batching semantics.
 *
 * There is no per-run render CAP by default: the only bound is `timeBudgetMs`,
 * so a caller can loop (`while (summary.remaining > 0)`) and drain a backlog of
 * any size instead of the old 40-per-night trickle.
 */
export async function runCampaignCreatives(
  options: CampaignRunOptions = {},
): Promise<CampaignRunSummary> {
  const { limit = null, timeBudgetMs = 250_000 } = options;
  const started = Date.now();
  const todayISO = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("events")
    .select(
      "id,name,name_english,type,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup,markup_ticket,markup_flight,markup_hotel,skip_flight,art_image_url,card_image_url,campaign_input_hash",
    )
    .is("is_deleted", null)
    .gte("date", todayISO)
    .order("date", { ascending: true });
  if (error) {
    console.error("[campaign] events query failed:", JSON.stringify(error));
    throw new Error("events query failed");
  }

  const events = (data ?? []) as unknown as CampaignEventRow[];
  const summary: CampaignRunSummary = {
    scanned: events.length,
    current: 0,
    generated: [],
    skipped: [],
    errors: [],
    remaining: 0,
    stoppedEarly: false,
  };

  let processed = 0;
  // Shared per-run caches: artists/teams/logos tables load once, not per event.
  const caches: CreativeLookupCaches = {};
  // The pre-check hash is gallery-aware, so the artists table loads up front -
  // one query per run, same rows generateCampaignForEvent reuses via `caches`.
  const artistRows = await loadArtistRows(caches);
  for (const event of events) {
    // Cheap pre-check so "current" events don't count against the batch.
    const preMatch = matchArtistForEvent(event, artistRows);
    const preGalleryUrl = preMatch
      ? pickGalleryImage(preMatch.gallery, event.id)
      : null;
    if (event.campaign_input_hash === campaignInputHash(event, preGalleryUrl)) {
      summary.current++;
      continue;
    }
    if (
      (limit != null && processed >= limit) ||
      Date.now() - started > timeBudgetMs
    ) {
      summary.stoppedEarly = true;
      summary.remaining++;
      continue;
    }
    processed++;
    try {
      const result = await generateCampaignForEvent(event, caches);
      if (result.status === "generated") summary.generated.push(event.id);
      else if (result.status === "skipped")
        summary.skipped.push({ id: event.id, reason: result.reason });
      else summary.current++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[campaign] event ${event.id} failed:`, message);
      summary.errors.push({ id: event.id, error: message });
    }
  }

  console.log(
    `[campaign] scanned=${summary.scanned} current=${summary.current} generated=${summary.generated.length} skipped=${summary.skipped.length} errors=${summary.errors.length} remaining=${summary.remaining}${summary.stoppedEarly ? " (stopped early)" : ""}`,
  );
  return summary;
}
