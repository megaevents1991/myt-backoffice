// The words more than one /uploader component prints - one copy, so the composer, the plan card
// and the runs list can never word the same thing two ways. Plain module (no "use client"): strings
// and a lookup only.
import type { SubjectKind } from "@/types/uploader.types";

/** The agent switch is off (or the parse came back "off"): the plan is filled by hand. */
export const AGENT_OFF_LINE = "הסוכן כבוי - מלאו את התוכנית ידנית";

export const SUBJECT_KIND_HE: Record<SubjectKind, string> = {
  artist: "אמן",
  team: "קבוצה",
  competition: "תחרות",
};

/** Every `kind` a server action of this screen can answer with, in the screen's words. */
const ACTION_ERROR_HE: Record<string, string> = {
  bad_input: "הבקשה לא תקינה - בדקו שהבריף לא ריק",
  brief_too_long: "הבריף ארוך מהמותר - קצרו אותו",
  bad_plan: "יש בתוכנית שדות לא תקינים",
  roster_read_failed: "לא הצלחנו לקרוא את רשימת האמנים והקבוצות - נסו שוב",
  subject_not_found: "לא הצלחנו לקרוא את רשימת האמנים והקבוצות - נסו שוב",
  search_failed: "החיפוש אצל הספקים נכשל - נסו שוב",
  db_error: "השמירה נכשלה - נסו שוב",
};

/** A server action's `kind` in the screen's words; anything unknown (or a throw, "") gets the generic line. */
export function actionErrorText(kind: string): string {
  return ACTION_ERROR_HE[kind] ?? "משהו השתבש - נסו שוב";
}
