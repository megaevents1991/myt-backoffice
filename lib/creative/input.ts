import { supabase } from "@/lib/supabase-server";
import {
  buildPriceText,
  type CardBgKind,
  type CreativeInput,
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
};

export type CreativeParams =
  | (BaseParams & { kind: "match"; homeId: number; awayId: number })
  | (BaseParams & { kind: "artist"; imageUrl: string; artistName: string });

type FootballTeamRow = {
  id: number;
  name: string;
  logo_url: string | null;
  art_image_url: string | null;
  image_url: string | null;
};

// Best team visual available: dedicated logo → blob cut-out → photo.
export function teamImage(t: {
  logo_url: string | null;
  art_image_url: string | null;
  image_url: string | null;
}): string | null {
  return t.logo_url ?? t.art_image_url ?? t.image_url;
}

export async function buildCreativeInput(params: CreativeParams): Promise<CreativeInput> {
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
  };

  if (params.kind === "artist") {
    if (!params.artistName || (!params.imageUrl && !params.bare)) {
      throw new Error("Artist creative requires imageUrl and artistName");
    }
    return {
      kind: "artist",
      homeLogoUrl: params.imageUrl,
      homeName: params.artistName,
      ...base,
    };
  }

  const { data, error } = await supabase
    .from("football_teams")
    .select("id,name,logo_url,art_image_url,image_url")
    .in("id", [params.homeId, params.awayId]);

  if (error) {
    console.error(JSON.stringify(error));
    throw new Error("Failed to load teams");
  }
  const teams = (data || []) as FootballTeamRow[];
  const home = teams.find((t) => t.id === params.homeId);
  const away = teams.find((t) => t.id === params.awayId);
  if (!home || !away) throw new Error("Team not found");
  const homeImg = teamImage(home);
  const awayImg = teamImage(away);
  if ((!homeImg || !awayImg) && !params.bare) {
    throw new Error(
      `No image (logo/art/photo) for: ${[!homeImg && home.name, !awayImg && away.name].filter(Boolean).join(", ")}`,
    );
  }

  return {
    kind: "match",
    homeLogoUrl: homeImg ?? "",
    awayLogoUrl: awayImg ?? "",
    homeName: home.name,
    awayName: away.name,
    ...base,
  };
}
