/**
 * The Follow-up pile, read session-free: every live reservation whose status is "Follow-up",
 * in the order to work it (lib/reservations/follow-up.ts). One read for the dashboard banner
 * and card (lib/actions/reservation-follow-up-actions.ts) and for the morning mail
 * (lib/services/follow-up-reminder.ts), so the three can never disagree about who is waiting.
 *
 * A failed read THROWS - an empty list would read as "nobody is waiting".
 */
import { supabaseTyped } from "@/lib/supabase-server";
import { getReservationEventOrderInfoPrimaryName } from "@/lib/utils";
import {
  compareFollowUps,
  followUpState,
  isFollowUpStatus,
  type FollowUpState,
} from "@/lib/reservations/follow-up";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

const db = supabaseTyped;

/** More rows than this in Follow-up at once is not a pile, it is a bug. */
const PILE_MAX = 1000;

// The status box takes free text, so the read is wide and isFollowUpStatus has the last word.
const STATUS_PATTERN = "follow%up%";

const COLUMNS =
  "id,created_at,main_contact_first_name,main_contact_last_name,main_contact_phone_number,main_contact_email,event_id,event_order_info,comments,status" as const;
const COLUMNS_DATED = `${COLUMNS},follow_up_date` as const;

export interface FollowUpRow {
  id: number;
  created_at: string;
  name: string;
  phone: string;
  email: string;
  event_id: number;
  event_name: string;
  comments: string | null;
  follow_up_date: string | null;
  state: FollowUpState;
}

interface PileDbRow {
  id: number;
  created_at: string;
  main_contact_first_name: string;
  main_contact_last_name: string;
  main_contact_phone_number: string;
  main_contact_email: string;
  event_id: number;
  event_order_info: unknown;
  comments: string | null;
  status: string;
  follow_up_date: string | null;
}

/** "column does not exist" - 42703 raw, PGRST204 when the schema cache lacks it. The deploy
 *  can beat the migration that adds `follow_up_date`; nothing may break in that window. */
export function isMissingColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "42703" || code === "PGRST204") return true;
  return typeof message === "string" && /column .* does not exist/i.test(message);
}

async function readPile(): Promise<PileDbRow[]> {
  const dated = await db
    .from("reservations")
    .select(COLUMNS_DATED)
    .is("is_deleted", null)
    .ilike("status", STATUS_PATTERN)
    .order("id", { ascending: true })
    .limit(PILE_MAX);
  if (!dated.error) return dated.data ?? [];
  if (!isMissingColumn(dated.error)) {
    throw new Error(`follow-up read failed: ${JSON.stringify(dated.error)}`);
  }
  // Not migrated yet: the pile still shows, every row without a day.
  const bare = await db
    .from("reservations")
    .select(COLUMNS)
    .is("is_deleted", null)
    .ilike("status", STATUS_PATTERN)
    .order("id", { ascending: true })
    .limit(PILE_MAX);
  if (bare.error) throw new Error(`follow-up read failed: ${JSON.stringify(bare.error)}`);
  return (bare.data ?? []).map((row) => ({ ...row, follow_up_date: null }));
}

/** `today` = the date in Israel (israelDate) - a call-back day is a day on the office's calendar. */
export async function loadFollowUps(today: string): Promise<FollowUpRow[]> {
  const rows = await readPile();
  return rows
    .filter((row) => isFollowUpStatus(row.status))
    .sort((a, b) => compareFollowUps(a, b, today))
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      name:
        [row.main_contact_first_name, row.main_contact_last_name].filter(Boolean).join(" ").trim() ||
        `#${row.id}`,
      phone: row.main_contact_phone_number ?? "",
      email: row.main_contact_email ?? "",
      event_id: row.event_id,
      // jsonb written by main at checkout - cast once, here.
      event_name: getReservationEventOrderInfoPrimaryName(
        row.event_order_info as ReservationEventOrderInfo | null,
      ),
      comments: row.comments,
      follow_up_date: row.follow_up_date,
      state: followUpState(row.follow_up_date, today),
    }));
}
