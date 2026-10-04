"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { israelDate } from "@/lib/tasks/reminders";
import { isFollowUpDate } from "@/lib/reservations/follow-up";
import {
  isMissingColumn,
  loadFollowUps,
  type FollowUpRow,
} from "@/lib/services/reservation-follow-ups";

const db = supabaseTyped;

/** `today` rides along so the screen colours the rows by the same day the server sorted them. */
export type FollowUpList = { ok: true; today: string; rows: FollowUpRow[] } | { ok: false };

/** The Follow-up pile for the dashboard banner and card. A failed read comes back as
 *  `ok: false` (a thrown action error is masked in production) and the dashboard shows
 *  nothing rather than "nobody is waiting". */
export async function listFollowUps(): Promise<FollowUpList> {
  await requireStaff();
  const today = israelDate(new Date());
  try {
    return { ok: true, today, rows: await loadFollowUps(today) };
  } catch (error) {
    console.error("listFollowUps:", error instanceof Error ? error.message : JSON.stringify(error));
    return { ok: false };
  }
}

/** The call-back day of one reservation, set from the reservations table. null = no day
 *  (the row then reads "No date" and still counts as waiting). */
export async function setFollowUpDate(
  id: number,
  date: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Unknown reservation." };
  if (date !== null && !isFollowUpDate(date)) return { ok: false, error: "That is not a valid date." };

  const notYet = "This will be available after the system update.";
  const { data: before, error: readError } = await db
    .from("reservations")
    .select("follow_up_date")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    console.error("setFollowUpDate read:", JSON.stringify(readError));
    return { ok: false, error: isMissingColumn(readError) ? notYet : "Could not save the date." };
  }
  if (!before) return { ok: false, error: "Unknown reservation." };

  const { error } = await db.from("reservations").update({ follow_up_date: date }).eq("id", id);
  if (error) {
    console.error("setFollowUpDate:", JSON.stringify(error));
    return { ok: false, error: isMissingColumn(error) ? notYet : "Could not save the date." };
  }
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: id,
    changes: { follow_up_date: { from: before.follow_up_date, to: date } },
  });
  return { ok: true };
}
