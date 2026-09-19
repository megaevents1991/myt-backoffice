// Which PART of the house a ticket category sits in - a coarse read of the category's name.
//
// Pure (no DB, no fetch; scripts/seat-tier-selftest.ts). The ticket light compares our cheapest
// ticket with LiveTickets' cheapest, and the two are often different seats: measured 2026-09-19,
// 86 of 91 matched events carried category names that do not pair by text at all (ours come from
// TixStock - "Oberrang", "Shortside Upper Tier" - theirs are LiveTickets' own - "Upper Tier
// Seating", "Category 2"), and some pairs are plainly different products ("Floor" against "Lower
// Tier Seating"). This does not change the light. It lets the comparison sheet SAY when the two
// cheapest seats are different tiers, and show their cheapest seat in OUR tier beside it, so a
// human reads like for like. A name it cannot place is null - never a guess.

export const SEAT_TIERS = ["vip", "standing", "upper", "middle", "lower", "short_side", "long_side"] as const;
type NamedTier = (typeof SEAT_TIERS)[number];
export type SeatTier = NamedTier | `cat${number}`;

export const SEAT_TIER_HE: Record<NamedTier, string> = {
  vip: "VIP / אירוח",
  standing: "עמידה / רחבה",
  upper: "יציע עליון",
  middle: "יציע אמצעי",
  lower: "יציע תחתון",
  short_side: "מאחורי השער",
  long_side: "לאורך המגרש",
};

// Order matters: the first hit wins. VIP first ("Lower Tier Seating - VIP" is a VIP product),
// then a numbered category (the supplier's own ladder), then the height of the stand - "Shortside
// Upper Tier" is an UPPER seat before it is a short-side one, because height is what both
// vocabularies share - and only then the side of the pitch.
const RULES: [NamedTier | "cat", RegExp][] = [
  ["vip", /\b(vip|hospitality|lounge|premium|suite|executive|platinum|business)\b|אירוח/i],
  ["cat", /\b(?:cat|category|kategorie|categoria|categor[ií]a)\.?\s*(\d)\b|קטגוריה\s*(\d)/i],
  ["standing", /\b(standing|stehplatz|steh|floor|innenraum|pista|parterre|pit|general admission|golden circle|front of stage|pelouse|fosse)\b|עמידה|רחבה/i],
  ["upper", /\b(upper|oberrang|terzo anello|third ring|tier 3|level 3|balcony|balcon|planta [3-9])\b|עליון/i],
  ["middle", /\b(middle|mittelrang|secondo anello|second ring|tier 2|level 2|club level|planta 2)\b|אמצעי/i],
  ["lower", /\b(lower|unterrang|primo anello|first ring|tier 1|level 1|planta 1)\b|תחתון/i],
  ["short_side", /\b(short\s*side|behind (?:the )?goal|curva|kurve|fondo|virage)\b|מאחורי השער/i],
  ["long_side", /\b(long\s*side|tribuna|lateral|gegengerade)\b/i],
];

/** The tier a category name describes, or null when the name does not say. */
export function seatTier(name: string | null | undefined): SeatTier | null {
  const text = (name ?? "").trim();
  if (!text) return null;
  for (const [tier, re] of RULES) {
    const m = text.match(re);
    if (!m) continue;
    if (tier === "cat") return `cat${Number(m[1] ?? m[2])}`;
    return tier;
  }
  return null;
}

export function seatTierLabel(tier: SeatTier): string {
  const named = SEAT_TIERS.find((t) => t === tier);
  return named ? SEAT_TIER_HE[named] : `קטגוריה ${tier.slice(3)}`;
}

export interface PricedSeat { title: string; titleHe: string | null; price: number }

export interface SeatComparison {
  /** Their cheapest seat - the one the ticket light is computed against. */
  cheapest: PricedSeat;
  /** How many priced categories they list for this show. */
  count: number;
  ourTier: SeatTier | null;
  theirTier: SeatTier | null;
  /** Both tiers are known and they differ: the two cheapest seats are not the same product. */
  mismatch: boolean;
  /** Their cheapest seat in OUR tier, when the cheapest one is not already it. */
  sameTier: PricedSeat | null;
}

/** Their seats against our cheapest ticket's category. Null when they list no priced seat. */
export function compareSeats(ourCategory: string | null | undefined, theirs: PricedSeat[]): SeatComparison | null {
  const priced = theirs.filter((s) => Number.isFinite(s.price) && s.price > 0).sort((a, b) => a.price - b.price);
  const cheapest = priced[0];
  if (!cheapest) return null;
  const tierOf = (s: PricedSeat) => seatTier(s.title) ?? seatTier(s.titleHe);
  const ourTier = seatTier(ourCategory);
  const theirTier = tierOf(cheapest);
  const mismatch = ourTier != null && theirTier != null && ourTier !== theirTier;
  const sameTier = ourTier != null && theirTier !== ourTier ? priced.find((s) => tierOf(s) === ourTier) ?? null : null;
  return { cheapest, count: priced.length, ourTier, theirTier, mismatch, sameTier };
}
