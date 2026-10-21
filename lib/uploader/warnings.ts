/**
 * What a built show should be looked at for (tour uploader, build step 8). Pure - no DB, no network:
 * the builder reads the subject's rows and the facts of the build and hands them in, this module
 * decides which warnings the review card carries and where each one's fix lives.
 *
 * Two sources, in this order: the SUBJECT's own pages (artist / team rows - missing page, cut-out,
 * event gallery, crest, bio, `/c/` twin) and what the BUILD found (new venue, unzoned tickets, a
 * supplier that did not answer, a single supplier, no Hebrew name, a far venue). The fix URLs are
 * the ones the gaps radar already uses (lib/services/creative-gaps.ts), so a "Do" button on a
 * card lands on the same field as the radar's.
 *
 * Texts live in `WARNING_TEXT` with `{placeholders}`; `warningsFor` fills them. Hebrew copy the
 * spec quotes is used verbatim.
 *
 * Selftest: scripts/tour-uploader-selftest.ts. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md (9.8).
 */
import type { SubjectKind, Warning } from "@/types/uploader.types";

/** The subject's rows, as the builder read them. `null` = the page does not exist. */
export interface SubjectRows {
  artist: {
    id: number;
    name: string;
    image_url: string | null;
    art_image_url: string | null;
    event_gallery: unknown[];
    bio: unknown | null;
    /** The artist has a `/c/` twin category. */
    hasTwin: boolean;
  } | null;
  team: {
    id: number;
    /** The crest search name: name_english || name, as the gaps radar searches. */
    name: string;
    logo_url: string | null;
    /** The crest is in the assets library (`/assets`) even though the team row has no logo. */
    crestInLibrary: boolean;
    image_url: string | null;
    art_image_url: string | null;
    bio: unknown | null;
    hasTwin: boolean;
  } | null;
}

/** What the build of ONE show found. */
export interface BuildFacts {
  /** No venue template (`venue_maps` row) for the supplier's seat map. */
  newVenue: boolean;
  /** Tickets left without a zone. */
  unzoned: number;
  totalTickets: number;
  /** The suppliers whose tickets the event carries. */
  suppliersUsed: ("tixstock" | "livetickets")[];
  /** The suppliers that did not answer (after the retry). */
  unreachable: ("tixstock" | "livetickets")[];
  hebrewName: boolean;
  /**
   * The nearest location when it is BEYOND `NEAR_LOCATION_KM` (no package was built) but WITHIN
   * `FAR_VENUE_KM` (a two-city package through that city is still sensible): the card offers that
   * build. Null when a location is near enough, or when none is within `FAR_VENUE_KM`.
   */
  farVenue: { city: string; km: number } | null;
}

/**
 * The Hebrew line per warning code, with `{placeholders}` for the numbers and names `warningsFor`
 * fills in. `new_venue` and `supplier_unreachable` are the spec's own words.
 */
export const WARNING_TEXT: Record<string, string> = {
  no_artist_page: "אין עמוד אמן באתר - צרו אחד ב-Templates",
  no_team_page: "אין עמוד קבוצה באתר - צרו אחד ב-Templates",
  no_cutout: "יש לאמן תמונה אבל אין גזרה (cut-out) - הקריאייטיב יצויר עם תמונה שטוחה",
  no_event_gallery: "אין לאמן גלריית אירועים - הכרטיסים והמודעות יצאו בלי רוטציית תמונות",
  no_crest: "אין סמל (crest) לקבוצה - הקריאייטיב והכרטיס יצאו בלי סמל",
  no_bio: "אין ביוגרפיה בעמוד - חסר טקסט",
  no_category_twin: "אין עמוד קטגוריה (/c/) תאום - לידיעה בלבד",
  new_venue: "אולם חדש - אין תבנית זונים; הכרטיסים יעלו בלי זונים",
  unzoned_tickets: "{count} מתוך {total} כרטיסים בלי זון - שייכו אותם בעורך",
  supplier_unreachable: "{supplier} לא ענה - האירוע נבנה בלי {short}; צרפו ידנית",
  single_supplier: "רק {supplier} מוכר את ההופעה (לידיעה)",
  no_hebrew_name: "לא נמצא שם בעברית - האירוע נבנה עם השם באנגלית",
  far_venue: "האולם רחוק מכל מיקום עם טיסות - {offer}",
  // BLOCKERS (UploaderItem.blockers): approval is refused until fixed in the editor (#fix-price).
  no_base_price: "אין מחיר בסיס לטיסה - מלאו בעורך לפני האישור",
  no_base_price_hotel: "אין מחיר בסיס למלון - מלאו בעורך לפני האישור",
};

/** The far-venue offer, in the spec's words: the warning carries it and the board's action button wears it. */
export function farVenueOffer(city: string, km: number): string {
  return `בנה כחבילה דרך ${city} (${Math.round(km)} ק"מ) עם פיצול מלון`;
}

const SUPPLIER_NAME = { tixstock: "TixStock", livetickets: "LiveTickets" } as const;
/** How the unreachable line names what the event is built without (the spec says "Live" for LiveTickets). */
const SUPPLIER_SHORT = { tixstock: "TixStock", livetickets: "Live" } as const;

function fill(code: string, params: Record<string, string | number> = {}): string {
  return (WARNING_TEXT[code] ?? code).replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ""));
}

function warning(code: string, params?: Record<string, string | number>, fix_url?: string): Warning {
  return fix_url === undefined ? { code, text: fill(code, params) } : { code, text: fill(code, params), fix_url };
}

/** null / undefined / blank string / empty list / empty object. */
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/** The warnings of one built show, subject first, then the build's facts. */
export function warningsFor(kind: SubjectKind, rows: SubjectRows, facts: BuildFacts): Warning[] {
  const out: Warning[] = [];

  if (kind === "artist") {
    const a = rows.artist;
    if (a === null) {
      out.push(warning("no_artist_page", undefined, "/templates/artists"));
    } else {
      const edit = `/templates/artists/${a.id}/edit`;
      if (!isEmpty(a.image_url) && isEmpty(a.art_image_url)) out.push(warning("no_cutout", undefined, `${edit}#fix-image`));
      if (!Array.isArray(a.event_gallery) || a.event_gallery.length === 0) out.push(warning("no_event_gallery", undefined, `${edit}#fix-gallery`));
      if (isEmpty(a.bio)) out.push(warning("no_bio", undefined, `${edit}#fix-bio`));
      if (!a.hasTwin) out.push(warning("no_category_twin"));
    }
  } else {
    // A competition has no page of its own: with no team row there is nothing to be missing.
    const t = rows.team;
    if (t === null) {
      if (kind === "team") out.push(warning("no_team_page", undefined, "/templates/football"));
    } else {
      if (isEmpty(t.logo_url) && !t.crestInLibrary) out.push(warning("no_crest", undefined, `/assets?q=${encodeURIComponent(t.name)}`));
      if (isEmpty(t.bio)) out.push(warning("no_bio", undefined, `/templates/football/${t.id}/edit#fix-bio`));
      if (!t.hasTwin) out.push(warning("no_category_twin"));
    }
  }

  // Unzoned tickets are implied by a venue with no template - say it once.
  if (facts.newVenue) out.push(warning("new_venue"));
  else if (facts.unzoned > 0) out.push(warning("unzoned_tickets", { count: facts.unzoned, total: facts.totalTickets }));

  for (const s of facts.unreachable) out.push(warning("supplier_unreachable", { supplier: SUPPLIER_NAME[s], short: SUPPLIER_SHORT[s] }));

  // "Only one sells it" is information about the market; a supplier that never answered says nothing about it.
  if (facts.suppliersUsed.length === 1 && facts.unreachable.length === 0) {
    out.push(warning("single_supplier", { supplier: SUPPLIER_NAME[facts.suppliersUsed[0]] }));
  }

  if (!facts.hebrewName) out.push(warning("no_hebrew_name"));
  if (facts.farVenue !== null) out.push(warning("far_venue", { offer: farVenueOffer(facts.farVenue.city, facts.farVenue.km) }));

  return out;
}
