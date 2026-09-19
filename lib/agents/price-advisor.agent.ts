// AGENT #2 - the price advisor ("יועץ המחיר").
//
// It never looks at a competitor or decides a light - that is agent #1 (price-light.agent.ts).
// This agent is handed the DETERMINISTIC facts price-advice.ts already computed for one red scope
// (a markup cut that would move it to orange/green, a cheaper LiveTickets ticket, a nights gap -
// every one of them a number the light's own arithmetic can already back up) and its only job is
// to re-word and RANK up to 3 of them as short Hebrew sentences for the task an auto-opened red
// light gets. It may never state a number that isn't already in the facts it was given: the guard
// that enforces this (`numbersAreFromFacts`) lives in lib/services/price-advisor.ts, next to the
// one Anthropic call this agent makes.
import { LIGHT_GREEN_USD, LIGHT_RED_USD } from "@/lib/services/price-light";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "@/lib/services/price-margins";
import type { LightDecisionSnapshot } from "@/types/price-light.types";
import type { AgentDefinition, AuditLessonRow } from "./types";

/**
 * The rules block, generated from the live constants this agent's facts are built from.
 *
 * Written for the model: it exists to keep the advisor inside the one lane it is allowed to
 * suggest anything about (a markup cut) and to restate, in its own words, the guard the caller
 * enforces mechanically - a number outside the facts is discarded either way, but a model that
 * already knows the rule wastes fewer calls getting there.
 */
export function priceAdvisorHouseRules(): string {
  return [
    "HOUSE RULES (generated from the pricing engine your facts already come from):",
    `- A scope is red at a gap of $${LIGHT_RED_USD}+ and green once it is $${Math.abs(LIGHT_GREEN_USD)} under - you never invent a new gap, only word and rank the facts already computed for you.`,
    "- A suggestion may point at exactly three kinds of change, and only when a fact you were given states it: a MARKUP cut (the package's or the ticket's), OTHER TRAVEL DAYS around the same event (leave a day later / return a day earlier), or buying the ticket from ANOTHER SUPPLIER. Never a base flight/hotel price, never a change of the event itself, and a human always makes the actual edit, never you.",
    "- When a supplier fact says it cannot be attached today (\"מידע בלבד\"), keep that caveat in your wording - never present it as something the team can do right now.",
    `- The site's +$${FLIGHT_MARGIN_USD} flight / +$${HOTEL_MARGIN_USD} hotel margins are intentional and stay whatever you suggest - never recommend removing or reducing them.`,
    "- Every dollar figure you write must already appear, verbatim, in the facts you were given (e.g. \"$40\") - a number that is not in the facts is discarded before a human ever sees it.",
    "- You word and rank up to 3 of the given facts as short Hebrew sentences, most important (biggest saving) first. You never open or close a task and never write a price yourself.",
  ].join("\n");
}

/** `price_light.repriced` metadata, widened with the actual-cut fields it carries alongside the
 *  comparison snapshot (`column`/`before`/`after` on `setEventMarkupFromLight`, 2026-09-17). */
interface RepricedMetadata extends Partial<LightDecisionSnapshot> {
  column?: string;
  before?: number | null;
  after?: number | null;
}

function repricedSnapshot(row: AuditLessonRow): RepricedMetadata | null {
  const m = row.metadata as RepricedMetadata | null;
  if (!m || (m.scope !== "package" && m.scope !== "ticket") || typeof m.light !== "string") return null;
  return m;
}

/** "package red +$420 · ours $2045 vs golasso $1625" - the gap half of a lesson line. */
function describeGap(s: RepricedMetadata): string {
  const parts = [`${s.scope} ${s.light}`];
  if (typeof s.diff_usd === "number") parts.push(`${s.diff_usd > 0 ? "+" : ""}$${s.diff_usd}`);
  if (typeof s.our_usd === "number" && typeof s.normalized_usd === "number") {
    parts.push(`ours $${s.our_usd} vs ${s.competitor ?? "competitor"} $${s.normalized_usd}`);
  }
  return parts.join(" · ");
}

/**
 * What this agent learns from.
 *
 * `price_light.repriced` is the strongest signal there is for a PRICE ADVISOR specifically: it is
 * the one action that says what a human actually CUT (column/before/after), against the gap they
 * were looking at - "what our team does with a gap like this one" is exactly what a wording agent
 * should read back. `agent.feedback` is direct thumbs up/down on this agent's own suggestions
 * (AI Factory "יומן" tab); it is a SHARED action across every agent, so a row is only a lesson here
 * when its own `metadata.agent` says "price-advisor" - otherwise a feedback mark left on the price
 * light judge's verdicts would silently teach this agent something about itself it never said.
 */
export const PRICE_ADVISOR_LEARNS_FROM: AgentDefinition["learnsFrom"] = [
  {
    action: "price_light.repriced",
    toLesson: (row) => {
      const s = repricedSnapshot(row);
      if (!s) return null;
      // Rows written before the column/before/after fields existed carry the gap but not the
      // actual cut - "a human did something" teaches nothing about wording a suggestion, so they
      // are dropped rather than guessed at (the same rule the price-light agent applies to its
      // own pre-snapshot rows).
      if (typeof s.column !== "string") return null;
      const before = typeof s.before === "number" ? `$${s.before}` : s.before === null ? "$0" : "?";
      const after = typeof s.after === "number" ? `$${s.after}` : s.after === null ? "$0" : "?";
      return `${describeGap(s)} — a human cut ${s.column} from ${before} to ${after}`;
    },
  },
  {
    action: "agent.feedback",
    toLesson: (row) => {
      const m = row.metadata as { agent?: string; summary?: string; verdict_ok?: boolean; note?: string } | null;
      if (m?.agent !== "price-advisor") return null;
      const summary = typeof m?.summary === "string" ? m.summary.trim() : "";
      if (!summary) return null;
      const verdict = m?.verdict_ok ? "RIGHT" : "WRONG";
      const note = typeof m?.note === "string" ? m.note.trim() : "";
      return `staff marked the advice ${verdict}: ${summary}${note ? ` - ${note}` : ""}`;
    },
  },
];

export const PRICE_ADVISOR_AGENT: AgentDefinition = {
  key: "price-advisor",
  title: "Price advisor",
  role:
    "יועץ המחיר נכנס לתמונה אחרי שמשימה נפתחת אוטומטית על אור אדום שהתחלף הלילה. הוא מקבל את " +
    "העובדות הדטרמיניסטיות שהרמזור עצמו כבר חישב לאותו scope (lib/services/price-advice.ts) - כמה " +
    "להוריד מהמארקאפ כדי לעבור לכתום/ירוק, אותו כרטיס אצל ספק אחר (LiveTickets, TixStock, XS2Event), " +
    "פער לילות מול המתחרה, וימי נסיעה אחרים סביב אותו אירוע שיוצאים זולים יותר (חיפושי Amadeus " +
    "אמיתיים של lib/services/price-alternatives.ts) - ומנסח ומדרג מתוכן עד 3 הצעות קצרות בעברית, מהחיסכון הגדול ביותר. הוא לא ממציא " +
    "עובדה או מספר משלו: כל סכום שהוא כותב חייב להופיע כפי שהוא באחת העובדות שקיבל, ובלי זה - " +
    "התשובה שלו נפסלת ומה שמגיע למשימה הוא הבלוק הדטרמיניסטי בלבד.",
  decides: [
    "איך לנסח ולדרג עד 3 הצעות מתוך העובדות הנתונות, מהחיסכון הגדול ביותר",
  ],
  neverDoes: [
    "לא כותב סכום דולר שלא מופיע כפי שהוא באחת העובדות שקיבל",
    "לא מציע לשנות מחיר בסיס, טיסה או מלון, או את מרווחי ה+$100/+$120 - הוא רשאי להצביע רק על קיצוץ מארקאפ, ימי נסיעה אחרים או ספק כרטיסים אחר, רק כשעובדה שקיבל אומרת זאת, ותמיד דרך בן אדם",
    "לא פותח ולא סוגר משימה - זה נשאר ל-openAutoRedTasks ולצוות",
    "לא קובע את הרמזור ולא נוגע בהתאמה למתחרה - זה סוכן #1 (price-light)",
  ],
  humanDecides: [
    "האם לקצץ בפועל את המארקאפ, ובכמה",
    "האם לשנות את ימי הנסיעה של החבילה, או לצרף ספק כרטיסים נוסף לאירוע",
    "האם ההצעה רלוונטית או שהפער מקובל כרגע",
    "משוב על ההצעה עצמה (AI Factory \"יומן\")",
  ],
  switchEnv: "PRICE_ADVISOR_AI",
  modelEnv: "PRICE_ADVISOR_AI_MODEL",
  defaultModel: "claude-opus-5",
  // Same discipline as the price-light judge (lib/agents/price-light.agent.ts): a short timeout and
  // no SDK retry, because the nightly's wall-clock budget is only checked BETWEEN events.
  timeoutMs: 12_000,
  callsPerRun: 15,
  // No confidence gate: this agent never decides same_event/found/unsure like the judge does, it
  // only words facts that are already true. The field exists on every agent regardless.
  confidenceMin: 0,
  usdPerMInput: 5,     // Opus 5 pricing, same as the price-light agent
  usdPerMOutput: 25,
  memoryMaxChars: 4_000,
  lessonMax: 10,
  lessonChars: 340,
  lessonLookbackDays: 120,
  learnsFrom: PRICE_ADVISOR_LEARNS_FROM,
  houseRules: priceAdvisorHouseRules,
};
