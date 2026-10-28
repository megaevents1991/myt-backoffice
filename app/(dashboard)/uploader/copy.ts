// The words more than one /uploader component prints - one copy, so the composer, the plan card
// and the runs list can never word the same thing two ways. Plain module (no "use client"): strings
// and a lookup only.
import { FAR_VENUE_KM } from "@/lib/uploader/constants";
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
  // The composer's only `bad_input` is an empty brief (it says so itself - BRIEF_INPUT_TEXT); the board's are a malformed call.
  bad_input: "הבקשה לא תקינה",
  brief_too_long: "הבריף ארוך מהמותר - קצרו אותו",
  bad_plan: "יש בתוכנית שדות לא תקינים",
  roster_read_failed: "לא הצלחנו לקרוא את רשימת האמנים והקבוצות - נסו שוב",
  subject_not_found: "לא הצלחנו לקרוא את רשימת האמנים והקבוצות - נסו שוב",
  search_failed: "החיפוש אצל הספקים נכשל - נסו שוב",
  db_error: "השמירה נכשלה - נסו שוב",
  // The review board's actions (/uploader/[id]).
  not_ready: "לא מוכן",
  blocked: "חסום",
  event_gone: "האירוע נמחק",
  time_budget: "נגמר הזמן - לחצו שוב",
  not_found: "ההופעה לא נמצאה - רעננו את הדף",
  not_question: "השאלה כבר נענתה",
  bad_answer: "התשובה לא מתאימה לשאלה - בחרו אחת מהאפשרויות",
  // Returned BEFORE anything is written - the show still asks its question.
  split_failed: "פיצול ההופעות נכשל, נסו שוב",
  // The answer IS saved; only the task did not close.
  task_not_closed: "התשובה נשמרה, אבל המשימה לא נסגרה",
  not_rejectable: "אי אפשר לדחות הופעה במצב הזה",
  not_retryable: "אין מה לנסות שוב - ההופעה כבר זזה",
  not_rebuildable: "אי אפשר לבנות את ההופעה מחדש במצב הזה",
  no_coordinates: "לאולם אין קואורדינטות - בנו ידנית",
  location_not_found: "המיקום לא נמצא",
  location_no_iata: "למיקום אין קוד שדה תעופה",
  event_not_deleted: "האירוע הקודם לא נמחק - שום דבר לא השתנה",
  not_running: "הריצה כבר לא בבנייה",
  not_resumable: "אין מה להמשיך בריצה הזו",
  stopped: "הריצה נעצרה",
  // The fix wave (21.10): createRun / resumeRun's one-run-per-subject rule, the parse cap, the conditional
  // soft delete, the two-city distance rule, approveAll's skipped re-check, a ready item whose event is gone.
  run_in_progress: "כבר רצה העלאה על הנושא הזה - חכו שתסתיים או עצרו אותה",
  // Only the parse refuses for the cap; the round "אלון 1" dialogs open for a manual fill instead (ruling R13).
  rate_limited: "יותר מדי פענוחים בזמן קצר - נסו שוב בעוד כמה דקות, או מלאו את התוכנית ידנית",
  event_live: "האירוע כבר באתר - לא נמחק",
  too_far: `העיר הזו רחוקה מדי מהאולם (מעל ${FAR_VENUE_KM} ק"מ) - בחרו עיר קרובה יותר`,
  recheck_skipped: "כל האישורים נשמרו; בדיקת הזמינות לא הספיקה ותרוץ בסנכרון המחירים הבא",
  // Round "אלון 1": the classification dialog and "learn from this event".
  svg_failed: "לא הצלחתי לקרוא את המפה של הספק",
  adopt_failed: "לא הצלחתי לאמץ את המפה",
  no_template: "לאירוע הזה אין תבנית אולם ללמוד ממנה",
  // Round 2: the names dialog's "זה עמוד קיים" - the page picked is gone (deleted since the search) or cannot name an event.
  team_not_found: "העמוד שנבחר לא נמצא - בחרו עמוד אחר",
  // Round 2: the plan card's "כוון את ה-AI". `steer_invalid` = an instruction under 3 or over 500 characters; the card stays as it was in every case.
  steer_invalid: "ההוראה צריכה להיות בין 3 ל-500 תווים",
  agent_off: "הסוכן כבוי - אי אפשר לכוון אותו, ערכו את התוכנית ידנית",
  steer_failed: "ה-AI לא הצליח לעדכן את התוכנית - נסחו את ההוראה אחרת, או ערכו ידנית. התוכנית נשארה כפי שהייתה",
  // Round 2: the create-location form (its own `problem` says what is wrong when the server gives one).
  invalid: "פרטי המיקום לא תקינים - בדקו את הטופס",
};

/** The composer's words for its `bad_input` (the brief is empty) - the generic line belongs to the board. */
export const BRIEF_INPUT_TEXT = "הבקשה לא תקינה - בדקו שהבריף לא ריק";

/** A server action's `kind` in the screen's words; anything unknown (or a throw, "") gets the generic line. */
export function actionErrorText(kind: string): string {
  return ACTION_ERROR_HE[kind] ?? "משהו השתבש - נסו שוב";
}
