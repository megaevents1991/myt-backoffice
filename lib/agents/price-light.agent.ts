// AGENT #1 - the price light (רמזור).
//
// It answers one question the rule matcher could not: which competitor listing is the same event
// as ours, and what does that listing include. It never sets a light and never writes a price -
// the light is arithmetic (lib/services/price-light.ts), and this only supplies better inputs to
// it. Everything the agent IS - model, ceiling, timeout, confidence floor, what it learns from -
// is declared here; the plumbing lives in lib/agents/.
import {
  BAG_USD, BREAKFAST_USD, CONNECTION_USD, MAX_WINDOW_DAYS, NIGHT_RATE_MAX_USD,
  NIGHT_RATE_MIN_USD, STAR_STEP_USD, TRANSFER_USD,
} from "@/lib/services/price-light";
import { correctionLessonText } from "@/lib/services/price-light-corrections";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "@/lib/services/price-margins";
import type { LightDecisionSnapshot } from "@/types/price-light.types";
import type { AgentDefinition, AuditLessonRow } from "./types";

/**
 * The rules block, generated from the live constants.
 *
 * Written for the model, not for us: it says which attributes are worth money (so extraction
 * effort goes where it matters) and states the duration rule explicitly, because nights are the
 * field the crawlers most often leave unknown and the one that moves the most money.
 */
export function priceLightHouseRules(): string {
  return [
    "HOUSE RULES (generated from our pricing engine - your answers feed this arithmetic):",
    "- Everything is per person, in a double room. Compare like for like.",
    `- DURATION MATTERS MOST. When the page prints departure and return dates, nights = return - departure; report that number even when the marketing copy says otherwise. A travel window longer than ${MAX_WINDOW_DAYS} days is a season page, not one trip - then nights is "unknown".`,
    `- What each extracted attribute is worth to us: checked bag $${BAG_USD}, a connecting flight $${CONNECTION_USD}, each hotel star $${STAR_STEP_USD} per night, each night $${NIGHT_RATE_MIN_USD}-${NIGHT_RATE_MAX_USD} (our own hotel rate for that trip), breakfast $${BREAKFAST_USD} per night, transfers $${TRANSFER_USD}.`,
    '- "unknown" is always better than a guess: an invented attribute moves real money, a missing one only widens our tolerance.',
    `- Our package price in recorded decisions before 2026-09-17 included the site's +$${FLIGHT_MARGIN_USD} flight / +$${HOTEL_MARGIN_USD} hotel margins; from then on it is the margin-free 'from' price.`,
  ].join("\n");
}

/** The comparison as it stood when a human decided something about it, or null on an older row
 *  that predates the snapshot (those decisions are dropped rather than guessed at). */
function snapshot(row: AuditLessonRow): LightDecisionSnapshot | null {
  const m = row.metadata as Partial<LightDecisionSnapshot> | null;
  if (!m || (m.scope !== "package" && m.scope !== "ticket") || typeof m.light !== "string") return null;
  return m as LightDecisionSnapshot;
}

/** "package red +$420 · ours $2045 vs golasso $1625 · nights 4 vs 3" - the evidence half of a line. */
function describe(s: LightDecisionSnapshot): string {
  const parts = [`${s.scope} ${s.light}`];
  if (s.diff_usd != null) parts.push(`${s.diff_usd > 0 ? "+" : ""}$${s.diff_usd}`);
  if (s.our_usd != null && s.normalized_usd != null) {
    parts.push(`ours $${s.our_usd} vs ${s.competitor ?? "competitor"} $${s.normalized_usd}`);
  }
  if (s.scope === "package" && s.nights_ours != null) {
    parts.push(`nights ${s.nights_ours} vs ${s.nights_theirs ?? "unknown"}`);
  }
  return parts.join(" · ");
}

/** One decision → one lesson line, or null when the row carries nothing to learn from. */
function decision(verdict: string): (row: AuditLessonRow) => string | null {
  return (row) => {
    const s = snapshot(row);
    if (!s) return null;
    return `${describe(s)} — ${verdict}`;
  };
}

/**
 * What this agent learns from: every mark staff leave on /price-light.
 *
 * Order matters - the character cap bites the tail, so the most instructive source goes first.
 * An OVERRIDE carries a human's own sentence about why the comparison was wrong ("they sell 3
 * nights, we sell 4"), which is the only source that speaks directly about matching. The other
 * four are outcomes: they say what our team does when a comparison looks a certain way, which is
 * market evidence rather than a matching correction. Both are wanted (Dor, 2026-09-13: "ה-AI
 * חייב ללמוד לפי הסימונים שלנו ברמזור"); they are simply not equally sharp.
 */
export const PRICE_LIGHT_LEARNS_FROM: AgentDefinition["learnsFrom"] = [
  {
    action: "price_light.override",
    toLesson: (row) => {
      const note = typeof row.metadata?.note === "string" ? row.metadata.note.trim() : "";
      if (!note) return null;                       // an override with no reason teaches nothing
      const s = snapshot(row);
      // `light` in the row is the light that was OVERRULED; `to_light` is what the human forced
      // it to. Rows written before 2026-09-13 carry only the new light, hence the fallback.
      const to = typeof row.metadata?.to_light === "string" ? row.metadata.to_light
        : typeof row.metadata?.light === "string" ? row.metadata.light : "?";
      const head = s ? describe(s) : String(row.metadata?.scope ?? "package");
      return `${head} — a human OVERRULED the light to "${to}" and wrote: "${note}"`;
    },
  },
  {
    // A field fixed in the detailed comparison (2026-09-18). Second only to an override: it names
    // the exact value that was wrong and what it should have been. Only what this agent itself can
    // get wrong is a lesson for it - a value IT extracted, or a same-event call (its other job).
    // A price or a parser-read field staff corrected is the crawler's mistake: it still fixes the
    // light and still counts in the per-competitor parser report, but quoting it here would spend
    // the agent's ten lesson slots teaching it about regexes it never runs.
    action: "price_light.corrected",
    toLesson: (row) => {
      const m = row.metadata;
      if (m?.source !== "ai" && m?.field !== "not_same_event") return null;
      return correctionLessonText(m ?? {});
    },
  },
  {
    action: "price_light.repriced",
    toLesson: decision("a human judged the gap REAL and went to cut our price"),
  },
  {
    action: "price_light.removed",
    toLesson: decision("a human pulled the event off the site rather than match this price"),
  },
  {
    action: "price_light.sold_out",
    toLesson: decision("a human marked the event SOLD OUT on the site (taken off sale, not deleted)"),
  },
  {
    action: "price_light.silenced",
    toLesson: decision("a human looked and judged this gap ACCEPTABLE for now (we stay pricier on purpose)"),
  },
  {
    action: "price_light.task_opened",
    toLesson: decision("a human opened a task to chase this gap"),
  },
  {
    action: "agent.feedback",
    // Direct thumbs up/down on ONE verdict (AI Factory "יומן" tab), not an outcome on the screen
    // like the sources above - so it needs its own summary of what was judged, or it teaches
    // nothing (a bare "wrong" with no context is not a lesson, only a scorecard tick).
    toLesson: (row) => {
      const m = row.metadata as { agent?: string; match_id?: number; verdict_ok?: boolean; note?: string; summary?: string } | null;
      const summary = typeof m?.summary === "string" ? m.summary.trim() : "";
      if (!summary) return null;
      const verdict = m?.verdict_ok ? "RIGHT" : "WRONG";
      const note = typeof m?.note === "string" ? m.note.trim() : "";
      return `staff marked the agent verdict ${verdict}: ${summary}${note ? ` - ${note}` : ""}`;
    },
  },
];

export const PRICE_LIGHT_AGENT: AgentDefinition = {
  key: "price-light",
  title: "Price light judge",
  role:
    "סוכן הרמזור נכנס לתמונה רק כשההתאמה החוקית (lib/services/price-light.ts) לא הצליחה להכריע " +
    "בעצמה: הוא מקבל את האירוע שלנו וכמה מודעות מתחרים שדומות לו, ועונה על שתי שאלות - האם זו " +
    "אותה מודעה בדיוק (אמן/קבוצה, תאריך, עיר), ומה כתוב במודעה שההתאמה החוקית לא ידעה לחלץ " +
    "(לילות, כוכבי מלון, מזוודה, ארוחת בוקר, טיסה ישירה או עם קונקשן, העברות). התשובה שלו הופכת " +
    "לקלט טוב יותר לחישוב הרמזור - היא לא הרמזור עצמו.",
  decides: [
    "האם מודעת מתחרה מתארת את אותו אירוע שלנו (same_event)",
    "חילוץ פרטי מודעה שההתאמה החוקית לא הצליחה לחלץ: לילות, כוכבי מלון, מזוודה, ארוחת בוקר, טיסה ישירה/עם קונקשן, העברות",
  ],
  neverDoes: [
    "לא קובע את הרמזור (ירוק/כתום/אדום/לבד בשוק) - זה חישוב אריתמטי, לא שלו",
    "לא כותב מחיר בסיס, מחיר אתר או כל מספר שמשפיע על מה שהלקוח משלם",
    "לא מסיר אירוע מהאתר ולא משנה את הסטטוס שלו",
  ],
  humanDecides: [
    "הוזל - המחיר שלנו יקר באמת, ללכת לתקן אותו",
    "הסר מהאתר - למשוך את האירוע מהמכירה",
    "אירוע נמכר (Sold Out) - האירוע לא מוצע יותר, לא נמחק",
    "דריסה (override) של הרמזור עם הערה מנומקת",
    "תיקון בהשוואה המפורטת - מחיר, תכולת חבילה או 'לא אותו אירוע', עם סיבה והערה (גובר על מה שהסוכן חילץ)",
    "השאר בפיד - הפער מקובל כרגע, להשתיק זמנית",
  ],
  switchEnv: "PRICE_LIGHT_AI",
  modelEnv: "PRICE_LIGHT_AI_MODEL",
  defaultModel: "claude-opus-5",
  // 12s, not 20s, and no SDK retry: the nightly checks its wall-clock budget only BETWEEN events,
  // so a slow call inside one event is time the budget cannot see. Two events' worth of hung calls
  // used to be enough to strand the tail of a run.
  timeoutMs: 12_000,
  callsPerRun: 40,
  confidenceMin: 0.8,
  usdPerMInput: 5,     // Opus 5 pricing
  usdPerMOutput: 25,
  memoryMaxChars: 2_500,
  lessonMax: 10,
  lessonChars: 200,
  lessonLookbackDays: 120,
  learnsFrom: PRICE_LIGHT_LEARNS_FROM,
  houseRules: priceLightHouseRules,
};
