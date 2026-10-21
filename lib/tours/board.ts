/**
 * The Reservations board's own rules (Alon's TODAY round, 21.10.2026; spec
 * docs/superpowers/specs/2026-10-21-tours-board-round-design.md). Pure - no DB, no React - and tested in
 * scripts/tours-cases-selftest.ts.
 *
 * - WHO SEES WHAT: a manager (a global admin, or an admin member of the company) sees every card; a rep sees the cards
 *   assigned to them and the unassigned ones - never another rep's. Cards are filtered, customers (people) are not.
 * - THE REP'S OWN ORDER: TODAY is numbered 1..N in the viewer's own order (kept per user and company); what was never
 *   dragged follows ARRIVAL - the oldest first, the newest lead last ("ליד אחרון - פריוריטי אחרון").
 * - THE NOTE LINE: the first line of a card's notes on the row, bold when it was written today (Israel day).
 */
import { ADMIN_ROLES, type Role } from "@/types/auth.types";
import { todayIso } from "@/lib/tours/deadlines";

// ---------------------------------------------------------------- who sees what
export interface BoardViewer {
  id: string;
  /** Sees every card of the company and assigns in bulk. */
  manager: boolean;
}

/** A global admin is a manager everywhere; otherwise the company membership says (`company_members.role`). */
export function boardViewerOf(id: string, role: Role, membershipRole: string | null): BoardViewer {
  return { id, manager: ADMIN_ROLES.includes(role) || membershipRole === "admin" };
}

/** A rep sees their own cards and the unassigned ones; a manager sees all. */
export const canSeeCard = (card: { assignedTo: string | null }, viewer: BoardViewer): boolean =>
  viewer.manager || card.assignedTo === null || card.assignedTo === viewer.id;

export const visibleCards = <T extends { assignedTo: string | null }>(cards: readonly T[], viewer: BoardViewer): T[] =>
  cards.filter((c) => canSeeCard(c, viewer));

/**
 * The row an action answered, back on the viewer's list: kept in place - or, when the viewer may not see it any more (a
 * rep handed it to another rep), dropped, with the new owner named so the screen can say "handed to X".
 */
export function afterSave<T extends { id: string; assignedTo: string | null }>(cards: readonly T[], saved: T, viewer: BoardViewer): { cards: T[]; handedTo: string | null } {
  if (canSeeCard(saved, viewer)) return { cards: cards.map((c) => (c.id === saved.id ? saved : c)), handedTo: null };
  return { cards: cards.filter((c) => c.id !== saved.id), handedTo: saved.assignedTo };
}

// ---------------------------------------------------------------- the rep's own order
/** The most ids one saved order holds. */
export const BOARD_ORDER_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** When a card last came to the rep: the newest inquiry that joined it, else its creation (never earlier than that). */
export function arrivalOf(createdAt: string, inquiryTimes: readonly string[]): string {
  let latest = createdAt;
  for (const at of inquiryTimes) if (typeof at === "string" && at > latest) latest = at;
  return latest;
}

/**
 * The numbered list: the saved order first (ids no longer on the list and repeats are ignored), then everything else
 * by arrival, oldest first (the id breaks a tie so the order is stable). Positions are 1..N with no gaps.
 */
export function orderBoard<T extends { id: string; arrivedAt: string }>(rows: readonly T[], savedIds: readonly string[]): { row: T; position: number }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const placed = new Set<string>();
  for (const id of savedIds) {
    const row = byId.get(id);
    if (!row || placed.has(id)) continue;
    placed.add(id);
    out.push(row);
  }
  const rest = rows.filter((r) => !placed.has(r.id)).sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.id.localeCompare(b.id));
  return [...out, ...rest].map((row, index) => ({ row, position: index + 1 }));
}

/** The list after a drag: `activeId` lands where `overId` was (dnd-kit's arrayMove). An unknown id moves nothing. */
export function moveInOrder(ids: readonly string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** "Type a place": the id moved to the 1-based place, clamped to the list; not a whole number = unchanged. */
export function placeInOrder(ids: readonly string[], id: string, place: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || !Number.isInteger(place)) return [...ids];
  const to = Math.min(Math.max(place, 1), ids.length) - 1;
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** What a client sent as an order: uuids only, lower-cased, deduped, the first BOARD_ORDER_MAX kept. */
export function cleanOrderIds(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of ids) {
    if (typeof value !== "string" || !UUID.test(value)) continue;
    const id = value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= BOARD_ORDER_MAX) break;
  }
  return out;
}

// ---------------------------------------------------------------- the note line
export const NOTE_LINE_MAX = 80;

/** The first non-blank line of the notes, trimmed, cut to NOTE_LINE_MAX with an ellipsis; "" when there is none. */
export function noteLine(notes: string | null | undefined): string {
  const line = (notes ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > NOTE_LINE_MAX ? `${line.slice(0, NOTE_LINE_MAX - 1)}…` : line;
}

/** The note's stamp falls on `today` (an Israel day, YYYY-MM-DD). An empty or unreadable stamp = false. */
export function writtenToday(at: string | null | undefined, today: string): boolean {
  if (!at) return false;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return false;
  return todayIso(new Date(time)) === today;
}
