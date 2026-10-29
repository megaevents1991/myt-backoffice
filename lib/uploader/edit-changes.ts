/**
 * "What you changed" (Alon round 3, note 2b; spec docs/superpowers/specs/2026-10-29-uploader-alon-round-3-design.md):
 * an event a person edited in the editor, compared with its item's baseline (`uploader_items.payload` - what the
 * uploader last wrote to the event, or what the last learn accepted), as the two kinds the learn dialog can apply to
 * the run's other shows. Pure - no DB, no network.
 *
 *  - `venue`: the TixStock zones / categories / a new TixStock description / the excluded map sections
 *    (`ticketsFixedByHand` / `sectionsFixedByHand` in classify.ts) - the hall template learns them.
 *  - `descriptions`: a LiveTickets ticket description cleared or set, per category key. TixStock descriptions are NOT
 *    in it: they follow the hall template (`inStepWithTemplate` refills an empty one from the zone), so a code clear
 *    would not stick - they belong to the hall kind and the editor's zones board (review finding 4).
 *
 * A learn REBASES the source item's payload over the kinds it applied cleanly (`rebaseTickets`), so the next edit is
 * seen again (note 2a) and an unticked or cut-off kind stays pending. The payload keeps the ticket count the uploader
 * wrote (`withBuiltCount`), so the approve-time edit diff still records a category a person deleted.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Alon round 3").
 */
import { normalizeName } from "@/lib/on-tour";
import { isFixedByHand } from "@/lib/uploader/classify";
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import type { EventTicket } from "@/types/app.types";
import type { ShowIdentity } from "@/types/uploader.types";

/** The suppliers whose ticket descriptions the learn carries (TixStock's follow the hall template - see the header). */
export const DESCRIBED_SUPPLIERS = ["livetickets"] as const;
export type DescribedSupplier = (typeof DESCRIBED_SUPPLIERS)[number];

/** The kinds of change the learn dialog lists. */
export type EditKind = "venue" | "descriptions";

/** One category's description on the edited event against its baseline. `category` = the name as the ticket prints it. */
export type DescriptionChange = { supplier: DescribedSupplier; key: string; category: string; from: string; to: string };

/**
 * What the edit asks of the other shows: `clearAll` = a supplier whose every description the edit left empty (and
 * cleared at least one) - every other show loses that supplier's descriptions, any category; `clear` / `set` = one
 * category cleared / given new text (a `set` reaches the shows at the same venue only).
 */
export type DescriptionPlan = {
  clearAll: DescribedSupplier[];
  clear: { supplier: DescribedSupplier; key: string; category: string }[];
  set: { supplier: DescribedSupplier; key: string; category: string; text: string }[];
};

const supplierOf = (ticket: EventTicket): DescribedSupplier | null => (ticketSupplier(ticket, "tx_event") === "livetickets" ? "livetickets" : null);
const isTixStock = (ticket: EventTicket): boolean => ticketSupplier(ticket, "tx_event") === "tixstock";
const categoryOf = (ticket: EventTicket): string => (ticket.supplierCategory || ticket.category || "").trim();
const keyOf = (ticket: EventTicket): string => normalizeSupplierCategory(categoryOf(ticket));
const descriptionOf = (ticket: EventTicket): string => (typeof ticket.description === "string" ? ticket.description.trim() : "");
const slotOf = (supplier: DescribedSupplier, key: string): string => `${supplier}|${key}`;

/** A stored ticket list (a payload's or a row's) as tickets; anything unreadable is none. */
export function ticketsOf(raw: unknown): EventTicket[] {
  return Array.isArray(raw)
    ? raw.filter((t): t is EventTicket => typeof t === "object" && t !== null && !Array.isArray(t) && typeof (t as { category?: unknown }).category === "string")
    : [];
}

/** supplier|key -> the FIRST ticket of that slot (described suppliers only, a ticket with no category key skipped). */
function bySlot(tickets: EventTicket[]): Map<string, EventTicket> {
  const out = new Map<string, EventTicket>();
  for (const t of tickets) {
    const supplier = supplierOf(t);
    const key = keyOf(t);
    if (!supplier || key === "") continue;
    const slot = slotOf(supplier, key);
    if (!out.has(slot)) out.set(slot, t);
  }
  return out;
}

/**
 * The kinds of change on an event against its item's baseline (the board's `editKinds`): `venue` = `isFixedByHand`,
 * `descriptions` = a ticket description differs. Nothing to compare (no payload, no row) = none.
 */
export function editKindsOf(
  payload: Record<string, unknown> | null,
  row: { tickets_and_rates: unknown; tx_excluded_sections?: unknown } | null,
): EditKind[] {
  if (!payload || !row) return [];
  const kinds: EditKind[] = [];
  if (isFixedByHand({ payload }, row)) kinds.push("venue");
  if (descriptionChanges(ticketsOf(payload.tickets_and_rates), ticketsOf(row.tickets_and_rates)).length > 0) kinds.push("descriptions");
  return kinds;
}

/** Each category whose description differs from the baseline's; a category the baseline did not have is no description change. */
export function descriptionChanges(baseline: EventTicket[], current: EventTicket[]): DescriptionChange[] {
  const was = bySlot(baseline);
  const out: DescriptionChange[] = [];
  for (const [slot, ticket] of bySlot(current)) {
    const old = was.get(slot);
    if (!old) continue;
    const from = descriptionOf(old);
    const to = descriptionOf(ticket);
    if (from === to) continue;
    out.push({ supplier: supplierOf(ticket) as DescribedSupplier, key: keyOf(ticket), category: categoryOf(ticket), from, to });
  }
  return out;
}

/** The changes as a plan: a supplier left with no description at all (and one cleared) is `clearAll`; the rest one category each. */
export function descriptionPlan(changes: DescriptionChange[], current: EventTicket[]): DescriptionPlan {
  const clearAll = DESCRIBED_SUPPLIERS.filter((supplier) => {
    const own = current.filter((t) => supplierOf(t) === supplier);
    return own.length > 0 && own.every((t) => descriptionOf(t) === "") && changes.some((c) => c.supplier === supplier && c.to === "");
  });
  const plan: DescriptionPlan = { clearAll, clear: [], set: [] };
  for (const c of changes) {
    if (clearAll.includes(c.supplier)) continue;
    if (c.to === "") plan.clear.push({ supplier: c.supplier, key: c.key, category: c.category });
    else plan.set.push({ supplier: c.supplier, key: c.key, category: c.category, text: c.to });
  }
  return plan;
}

export const isEmptyPlan = (plan: DescriptionPlan): boolean => plan.clearAll.length === 0 && plan.clear.length === 0 && plan.set.length === 0;

/**
 * The plan on another show's tickets. A ticket is touched only while its description still equals that show's
 * baseline (never one a person typed there, never a ticket the baseline does not know); a `set` only when the show
 * is at the same venue. `changed` = how many tickets got a new description. A ticket a person ALREADY brought to the
 * plan's text by hand (its row equals the target, its baseline does not) is `adopted`: the event is left as it is,
 * only the baseline follows - so that show stops reading as edited (review finding 7). `bySlot` = supplier|key -> the
 * text the show's payload follows (`patchDescriptions`), for changed and adopted slots alike.
 */
export function applyDescriptionPlan(
  row: EventTicket[],
  baseline: EventTicket[],
  plan: DescriptionPlan,
  sameVenue: boolean,
): { tickets: EventTicket[]; changed: number; adopted: number; bySlot: Map<string, string> } {
  const base = bySlot(baseline);
  const clear = new Set(plan.clear.map((c) => slotOf(c.supplier, c.key)));
  const set = new Map(plan.set.map((s) => [slotOf(s.supplier, s.key), s.text]));
  const touched = new Map<string, string>();
  let changed = 0;
  let adopted = 0;
  const tickets = row.map((t) => {
    const supplier = supplierOf(t);
    const key = keyOf(t);
    if (!supplier || key === "") return t;
    const slot = slotOf(supplier, key);
    const old = base.get(slot);
    if (!old) return t;
    const target = plan.clearAll.includes(supplier) || clear.has(slot) ? "" : sameVenue && set.has(slot) ? (set.get(slot) as string) : null;
    if (target === null) return t;
    const now = descriptionOf(t);
    if (now !== descriptionOf(old)) {
      // typed by hand: left alone - unless it already reads what the plan asks (then the baseline follows)
      if (now === target && !touched.has(slot)) {
        adopted += 1;
        touched.set(slot, target);
      }
      return t;
    }
    if (target === now) return t;
    changed += 1;
    touched.set(slot, target);
    return { ...t, description: target };
  });
  return { tickets, changed, adopted, bySlot: touched };
}

/**
 * The tickets a code rewrite stores as a show's new baseline (the hall's `rewriteVenueItems` - review finding 1),
 * keeping every LiveTickets description a person typed: where the row's description differed from the old baseline
 * BEFORE the rewrite and the rewrite left it as it was, the baseline keeps its old text - so a later learn never takes
 * the hand-typed text for the show's own (and overwrites it), and the show's own edit stays visible.
 */
export function keepHandDescriptions(written: EventTicket[], rowBefore: EventTicket[], oldBaseline: EventTicket[]): EventTicket[] {
  const before = bySlot(rowBefore);
  const old = bySlot(oldBaseline);
  const keep = new Map<string, string>();
  for (const [slot, ticket] of bySlot(written)) {
    const was = before.get(slot);
    const base = old.get(slot);
    if (!was || !base) continue;
    const typed = descriptionOf(was);
    if (typed !== descriptionOf(base) && descriptionOf(ticket) === typed) keep.set(slot, descriptionOf(base));
  }
  return patchDescriptions(written, keep);
}

/** The tickets with the description of every slot in `bySlot` replaced (a sibling's payload following its event). */
export function patchDescriptions(tickets: EventTicket[], texts: Map<string, string>): EventTicket[] {
  if (texts.size === 0) return tickets;
  return tickets.map((t) => {
    const supplier = supplierOf(t);
    const key = keyOf(t);
    if (!supplier || key === "") return t;
    const text = texts.get(slotOf(supplier, key));
    return text === undefined || text === descriptionOf(t) ? t : { ...t, description: text };
  });
}

/**
 * The source item's payload tickets after a learn (note 2a): the kinds it applied cleanly are accepted as the new
 * baseline, an unticked or cut-off kind stays pending. Both = the event's tickets as they are; venue alone = the
 * event's tickets with every LiveTickets ticket the payload knows as the payload had it (its description not
 * consumed); descriptions alone = the payload's tickets with every changed LiveTickets description taken from the
 * event; neither = the payload's.
 */
export function rebaseTickets(payload: EventTicket[], row: EventTicket[], kinds: { venue: boolean; descriptions: boolean }): EventTicket[] {
  if (kinds.venue && kinds.descriptions) return row;
  if (kinds.venue) {
    const old = bySlot(payload);
    return row.map((t) => {
      const supplier = supplierOf(t);
      if (isTixStock(t) || supplier === null) return t;
      return old.get(slotOf(supplier, keyOf(t))) ?? t;
    });
  }
  if (kinds.descriptions) {
    const texts = new Map(descriptionChanges(payload, row).map((c) => [slotOf(c.supplier, c.key), c.to]));
    return patchDescriptions(payload, texts);
  }
  return payload;
}

/**
 * A rebased payload keeps the ticket count the uploader last wrote (`built_tickets_count`, set once): the approve-time
 * edit diff reads it for `tickets_count` (decisions.ts `fieldOf`), so a category a person deleted is still recorded as
 * their edit after a learn (review finding 2).
 */
export function withBuiltCount(payload: Record<string, unknown>): Record<string, unknown> {
  if (typeof payload.built_tickets_count === "number") return payload;
  return { ...payload, built_tickets_count: Array.isArray(payload.tickets_and_rates) ? payload.tickets_and_rates.length : 0 };
}

/**
 * Is `b` at the same venue as `a`? The same TixStock drawing, else the same venue name in the same city (both
 * normalized). A show with neither a drawing nor a venue name is at no known venue.
 */
export function sameVenue(a: ShowIdentity, b: ShowIdentity): boolean {
  const drawingA = a.suppliers.tixstock?.venue_map_url?.trim() ?? "";
  const drawingB = b.suppliers.tixstock?.venue_map_url?.trim() ?? "";
  if (drawingA !== "" && drawingA === drawingB) return true;
  const venueA = normalizeName(a.venue);
  return venueA !== "" && venueA === normalizeName(b.venue) && normalizeName(a.city) === normalizeName(b.city);
}

/** The note for the AI a learn may carry (`addAgentInstruction`'s own bounds). */
export const LEARN_NOTE_MIN = 3;
export const LEARN_NOTE_MAX = 500;

/**
 * `learnFromEvent`'s options from the client: `venue` / `descriptions` booleans (absent = on), `note` trimmed - empty
 * or absent = none, else LEARN_NOTE_MIN..LEARN_NOTE_MAX characters. null = not that shape (refused before any read).
 */
export function cleanLearnOptions(raw: unknown): { venue: boolean; descriptions: boolean; note: string | null } | null {
  if (raw === undefined || raw === null) return { venue: true, descriptions: true, note: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const flag = (v: unknown): boolean | null => (v === undefined ? true : typeof v === "boolean" ? v : null);
  const venue = flag(o.venue);
  const descriptions = flag(o.descriptions);
  if (venue === null || descriptions === null) return null;
  if (o.note !== undefined && o.note !== null && typeof o.note !== "string") return null;
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note !== "" && (note.length < LEARN_NOTE_MIN || note.length > LEARN_NOTE_MAX)) return null;
  return { venue, descriptions, note: note === "" ? null : note };
}
