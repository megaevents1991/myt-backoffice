import { supabase } from "@/lib/supabase-server";
import {
  buildPriceText,
  type CardBgKind,
  type CreativeInput,
  type CreativeVariant,
} from "@/components/creative/MatchTemplate";

type BaseParams = {
  dateText: string;
  timeText: string | null;
  locationText: string;
  price: number;
  currency: string;
  mode: "package" | "ticket";
  // Design-base render: no blob cards, no subject images (see MatchTemplate).
  bare?: boolean;
  // Card design overrides (see MatchTemplate): background kind + blob color/shape.
  bgKind?: CardBgKind;
  colorIndex?: number | null;
  shapeIndex?: number | null;
  // Designer sizing (see MatchTemplate): image/bg zoom + image offsets.
  imgScale?: number | null;
  imgOffsetX?: number | null;
  imgOffsetY?: number | null;
  bgScale?: number | null;
  // Text layout + full-bleed photo mode (see MatchTemplate).
  variant?: CreativeVariant;
  heroPhoto?: boolean;
};

// A match side comes from one of two stores: "team:<id>" = football_teams
// (full CMS template rows), "logo:<id>" = football_logos (lightweight logo
// library). A bare numeric string is legacy shorthand for a team.
export type SubjectRef = { source: "team" | "logo"; id: number };

export function parseSubjectRef(ref: string): SubjectRef | null {
  const m = /^(?:(team|logo):)?(\d+)$/.exec(ref.trim());
  if (!m) return null;
  return { source: (m[1] as "team" | "logo") ?? "team", id: Number(m[2]) };
}

export type CreativeParams =
  | (BaseParams & { kind: "match"; homeRef: string; awayRef: string })
  // isCutout: is imageUrl a real transparent cut-out, or a regular photo?
  // Determines blob-card vs plain circular-avatar rendering (see
  // MatchTemplate) - default true (assume cut-out) so existing callers keep
  // today's look until they explicitly say otherwise.
  | (BaseParams & {
      kind: "artist";
      imageUrl: string;
      artistName: string;
      isCutout?: boolean;
    })
  // Fallback when no team/artist logo could be matched - plain circular
  // avatar using the event's own (regular, non-cutout) photo.
  | (BaseParams & { kind: "photo"; imageUrl: string; eventName: string });

type FootballTeamRow = {
  id: number;
  name: string;
  logo_url: string | null;
  art_image_url: string | null;
  image_url: string | null;
};

type FootballLogoRow = {
  id: number;
  name_english: string;
  name_hebrew: string | null;
  logo_url: string;
};

// Best team visual available: dedicated logo → blob cut-out → photo.
export function teamImage(t: {
  logo_url: string | null;
  art_image_url: string | null;
  image_url: string | null;
}): string | null {
  return t.logo_url ?? t.art_image_url ?? t.image_url;
}

export async function buildCreativeInput(
  params: CreativeParams,
): Promise<CreativeInput> {
  const priceText = buildPriceText(params.mode, params.price, params.currency);
  const base = {
    dateText: params.dateText,
    timeText: params.timeText,
    locationText: params.locationText,
    priceText,
    bare: params.bare ?? false,
    bgKind: params.bgKind,
    colorIndex: params.colorIndex ?? null,
    shapeIndex: params.shapeIndex ?? null,
    imgScale: params.imgScale ?? null,
    imgOffsetX: params.imgOffsetX ?? null,
    imgOffsetY: params.imgOffsetY ?? null,
    bgScale: params.bgScale ?? null,
    variant: params.variant,
    heroPhoto: params.heroPhoto ?? false,
  };

  if (params.kind === "artist") {
    if (!params.artistName || (!params.imageUrl && !params.bare)) {
      throw new Error("Artist creative requires imageUrl and artistName");
    }
    return {
      kind: "artist",
      homeLogoUrl: params.imageUrl,
      homeName: params.artistName,
      homeHasCutout: params.isCutout ?? true,
      ...base,
    };
  }

  if (params.kind === "photo") {
    if (!params.eventName || (!params.imageUrl && !params.bare)) {
      throw new Error("Photo creative requires imageUrl and eventName");
    }
    return {
      kind: "photo",
      homeLogoUrl: params.imageUrl,
      homeName: params.eventName,
      homeHasCutout: false,
      ...base,
    };
  }

  const homeRef = parseSubjectRef(params.homeRef);
  const awayRef = parseSubjectRef(params.awayRef);
  if (!homeRef || !awayRef) throw new Error("Bad team/logo reference");

  const refs = [homeRef, awayRef];
  const teamIds = refs.filter((r) => r.source === "team").map((r) => r.id);
  const logoIds = refs.filter((r) => r.source === "logo").map((r) => r.id);

  const [teamsRes, logosRes] = await Promise.all([
    teamIds.length
      ? supabase
          .from("football_teams")
          .select("id,name,logo_url,art_image_url,image_url")
          .in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    logoIds.length
      ? // football_logos isn't in the generated DB types yet - cast like template-crud.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("football_logos")
          .select("id,name_english,name_hebrew,logo_url")
          .in("id", logoIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (teamsRes.error || logosRes.error) {
    console.error(JSON.stringify(teamsRes.error ?? logosRes.error));
    throw new Error("Failed to load teams");
  }
  const teams = (teamsRes.data || []) as FootballTeamRow[];
  const logoRows = (logosRes.data || []) as FootballLogoRow[];

  // isCutout: logo_url/art_image_url are real transparent cut-outs (the
  // football_logos library is ENTIRELY dedicated crests, always a cut-out);
  // image_url is a regular photo fallback - not blob-safe (see MatchTemplate).
  const resolve = (
    ref: SubjectRef,
  ): { name: string; img: string | null; isCutout: boolean } => {
    if (ref.source === "logo") {
      const l = logoRows.find((r) => r.id === ref.id);
      if (!l) throw new Error("Logo not found");
      return {
        name: l.name_hebrew ?? l.name_english,
        img: l.logo_url,
        isCutout: true,
      };
    }
    const t = teams.find((r) => r.id === ref.id);
    if (!t) throw new Error("Team not found");
    if (t.logo_url) return { name: t.name, img: t.logo_url, isCutout: true };
    if (t.art_image_url)
      return { name: t.name, img: t.art_image_url, isCutout: true };
    return { name: t.name, img: t.image_url, isCutout: false };
  };
  const home = resolve(homeRef);
  const away = resolve(awayRef);
  if ((!home.img || !away.img) && !params.bare) {
    throw new Error(
      `No image (logo/art/photo) for: ${[!home.img && home.name, !away.img && away.name].filter(Boolean).join(", ")}`,
    );
  }

  return {
    kind: "match",
    homeLogoUrl: home.img ?? "",
    awayLogoUrl: away.img ?? "",
    homeName: home.name,
    awayName: away.name,
    homeHasCutout: home.isCutout,
    awayHasCutout: away.isCutout,
    ...base,
  };
}
