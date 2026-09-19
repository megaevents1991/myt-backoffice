// Names below are real category names measured on 2026-09-19 (ours from TixStock, theirs from
// LiveTickets) - the classifier is only as good as its reading of those two vocabularies.
import { compareSeats, seatTier, seatTierLabel } from "../lib/services/seat-tier";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

check("upper (en)", seatTier("Upper Tier Seating"), "upper");
check("upper (de)", seatTier("Oberrang"), "upper");
check("upper (it)", seatTier("Terzo Anello Verde"), "upper");
check("upper (es)", seatTier("Planta 4"), "upper");
check("height beats side", seatTier("Shortside Upper Tier"), "upper");
check("lower", seatTier("Lower Tier Seating"), "lower");
check("vip beats tier", seatTier("Lower Tier Seating - VIP"), "vip");
check("lounge is vip", seatTier("Westview Lounge - Seats Only"), "vip");
check("standing (de)", seatTier("Innenraum Stehplatz"), "standing");
check("floor", seatTier("Floor"), "standing");
check("general admission", seatTier("General Admission"), "standing");
check("category n", seatTier("Category 2"), "cat2");
check("cat n short", seatTier("Cat 2 Plus"), "cat2");
check("long side", seatTier("Long side (Tevere)"), "long_side");
check("longside one word", seatTier("Longside (Monte Mario)"), "long_side");
check("unknown stays null", seatTier("Distinti Nord Est"), null);
check("empty", seatTier(""), null);
check("label named", seatTierLabel("upper"), "יציע עליון");
check("label cat", seatTierLabel("cat3"), "קטגוריה 3");

const seat = (title: string, price: number) => ({ title, titleHe: null, price });
// Pitbull, measured: ours "Floor", their only seat "Lower Tier Seating" - different products.
const pitbull = compareSeats("Floor", [seat("Lower Tier Seating", 180)]);
check("mismatch flagged", [pitbull?.mismatch, pitbull?.sameTier], [true, null]);
// Ours upper; their cheapest is lower-priced standing, but they do sell an upper seat.
const mixed = compareSeats("Oberrang", [seat("Upper Tier Seating", 140), seat("General Admission", 90), seat("Upper Tier Seating", 150)]);
check("same tier found, cheapest of it", [mixed?.cheapest.price, mixed?.mismatch, mixed?.sameTier?.price, mixed?.count], [90, true, 140, 3]);
const same = compareSeats("Upper Tier", [seat("Upper Tier Seating", 120), seat("Lower Tier Seating", 200)]);
check("same tier already cheapest", [same?.mismatch, same?.sameTier], [false, null]);
const unknown = compareSeats("Distinti Nord Est", [seat("Long side (Tevere)", 300)]);
check("unknown ours is no mismatch", [unknown?.mismatch, unknown?.sameTier, unknown?.ourTier], [false, null, null]);
check("zero-priced seats ignored", compareSeats("Floor", [seat("Floor", 0)]), null);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
