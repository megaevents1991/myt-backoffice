/** Labels for the three boards, the seven roadmap phases and the marketing
 *  channels. The ONLY place these strings live (spec §1.1) - the old roadmap
 *  app's palette is not carried over; colours come from the MYT Admin tokens. */
import { MKT_CHANNELS, TASK_BOARDS, type MktChannel, type TaskBoard } from "@/types/task.types";

export const BOARD_META: Record<TaskBoard, { label: string; hint: string }> = {
  dev: { label: "פיתוח", hint: "מפת הדרכים של המוצר" },
  marketing: { label: "שיווק", hint: "קמפיינים, תוכן, שותפויות" },
  ops: { label: "תפעול", hint: "מה שהמערכת מייצרת + משימות שוטפות" },
};

export const PHASES: Record<number, { name: string; sub: string }> = {
  1: { name: "ליבה ותפעול", sub: "ספקים, הזמנות, כרטיסים" },
  2: { name: "תשלומים ומסחר", sub: "פיצולים, חיוב, גמישות כספית" },
  3: { name: "עיצוב ו-UX", sub: "מיתוג, חווית משתמש" },
  4: { name: "בק אופיס ואופרציה", sub: "כלים פנימיים, אוטומציה, דוחות" },
  5: { name: "מוצרים מתקדמים", sub: "חבילות קומפלקס, טורנירים" },
  6: { name: "שיווק וצמיחה", sub: "דיוור, אוטומציות, B2B" },
  7: { name: "AI וטכנולוגיה", sub: "בינה מלאכותית, CMS, אינטגרציות" },
};

export const CHANNEL_META: Record<MktChannel, { label: string }> = {
  social: { label: "סושיאל" },
  email: { label: "אימייל" },
  seo: { label: "SEO" },
  ads: { label: "ממומן" },
  content: { label: "תוכן" },
  partnerships: { label: "שותפויות" },
  pr: { label: "PR" },
};

export function validBoard(value: unknown): value is TaskBoard {
  return typeof value === "string" && (TASK_BOARDS as readonly string[]).includes(value);
}

/** null is valid - only the dev board carries a phase. */
export function validPhase(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

export function validChannel(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && (MKT_CHANNELS as readonly string[]).includes(value);
}

export function validProgress(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}
