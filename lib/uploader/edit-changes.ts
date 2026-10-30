/**
 * "What you changed" (Alon round 3, note 2b; spec docs/superpowers/specs/2026-10-29-uploader-alon-round-3-design.md;
 * the second-edit round, docs/superpowers/specs/2026-10-30-uploader-second-edit-round-design.md): an event a person edited
 * in the editor, compared with its item's baseline (`uploader_items.payload` - what the uploader last wrote to the event,
 * or what the last learn accepted), as the kinds the learn dialog can apply to the run's other shows, and a verdict per
 * show saying who gets each kind and why not. Pure - no DB, no network.
 *
 *  - `venue`: the TixStock zones / categories / a new TixStock description / the excluded map sections
 *    (`ticketsFixedByHand` / `sectionsFixedByHand` in classify.ts) - the hall template learns them.
 *  - `descriptions`: a LiveTickets ticket description cleared or set, per category key. TixStock descriptions are NOT
 *    in it: they follow the hall template (`inStepWithTemplate` refills an empty one from the zone), so a code clear
 *    would not stick - they belong to the hall kind and the editor's zones board (review finding 4).
 *  - `event_description`: the event's own description - to a show at the same hall whose text still reads what the source's
 *    read before the edit. Same hall + same old text is what keeps a football run safe: Lazio's texts each name another opponent.
 *  - `place`: the location and lodging columns that changed - same hall, same start. A new flight city is not carried: it
 *    changes the flights and the base prices.
 *
 * A learn REBASES the source item's payload over the kinds it applied cleanly (`rebaseTickets`), so the next edit is
 * seen again (note 2a) and an unticked or cut-off kind stays pending. The payload keeps the ticket count the uploader
 * wrote (`withBuiltCount`), so the approve-time edit diff still records a category a person deleted.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Alon round 3").
 */
import { normalizeName } from "@/lib/on-tour";
import { isFixedByHand } from "@/lib/uploader/classify";
import { editDiff, stable } from "@/lib/uploader/decisions";
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import type { EventTicket } from "@/types/app.types";
import type { ShowIdentity } from "@/types/uploader.types";

/** The suppliers whose ticket descriptions the learn carries (TixStock's follow the hall template - see the header). */
export const DESCRIBED_SUPPLIERS = ["livetickets"] as const;
export type DescribedSupplier = (typeof DESCRIBED_SUPPLIERS)[number];

/** The kinds of change the learn dialog lists. */
export type EditKind = "venue" | "descriptions" | "event_description" | "place";

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
 * `descriptions` = a ticket description differs, `event_description` / `place` = the event's own (a new flight city is
 * none - `notCarriedEdits` names it). Nothing to compare (no payload, no row) = none.
 */
export function editKindsOf(
  payload: Record<string, unknown> | null,
  row: ({ tickets_and_rates: unknown; tx_excluded_sections?: unknown } & Record<string, unknown>) | null,
): EditKind[] {
  if (!payload || !row) return [];
  const kinds: EditKind[] = [];
  if (isFixedByHand({ payload }, row)) kinds.push("venue");
  if (descriptionChanges(ticketsOf(payload.tickets_and_rates), ticketsOf(row.tickets_and_rates)).length > 0) kinds.push("descriptions");
  if (eventDescriptionChange(payload, row)) kinds.push("event_description");
  const place = placeChange(payload, row);
  if (place && !place.flightChanged) kinds.push("place");
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
 * only the baseline follows - so that show stops reading as edited (review finding 7). `typed` = tickets left alone
 * because a person wrote something else there. `bySlot` = supplier|key -> the text the show's payload follows
 * (`patchDescriptions`), for changed and adopted slots alike.
 */
export function applyDescriptionPlan(
  row: EventTicket[],
  baseline: EventTicket[],
  plan: DescriptionPlan,
  sameVenue: boolean,
): { tickets: EventTicket[]; changed: number; adopted: number; typed: number; bySlot: Map<string, string> } {
  const base = bySlot(baseline);
  const clear = new Set(plan.clear.map((c) => slotOf(c.supplier, c.key)));
  const set = new Map(plan.set.map((s) => [slotOf(s.supplier, s.key), s.text]));
  const touched = new Map<string, string>();
  let changed = 0;
  let adopted = 0;
  let typed = 0;
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
      if (now !== target) typed += 1;
      else if (!touched.has(slot)) {
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
  return { tickets, changed, adopted, typed, bySlot: touched };
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
 * Is `b` at the same hall as `a`? The same venue name, and the same TixStock drawing or the same city (both normalized) - two
 * spellings of a city on one drawing are one hall. A shared drawing ALONE is not: TixStock hands placeholders like "General
 * Admission.svg" to 244 venues, and what follows this answer (a written text, a second city, a transfer note) must not reach a
 * show in another city (second-edit round, review). A show with no venue name is at no known hall.
 */
export function sameVenue(a: ShowIdentity, b: ShowIdentity): boolean {
  const venue = normalizeName(a.venue);
  if (venue === "" || venue !== normalizeName(b.venue)) return false;
  const drawing = a.suppliers.tixstock?.venue_map_url?.trim() ?? "";
  if (drawing !== "" && drawing === (b.suppliers.tixstock?.venue_map_url?.trim() ?? "")) return true;
  return normalizeName(a.city) === normalizeName(b.city);
}

/** The note for the AI a learn may carry (`addAgentInstruction`'s own bounds). */
export const LEARN_NOTE_MIN = 3;
export const LEARN_NOTE_MAX = 500;

/**
 * `learnFromEvent`'s options from the client: one boolean per kind (absent = on), `note` trimmed - empty or absent =
 * none, else LEARN_NOTE_MIN..LEARN_NOTE_MAX characters. null = not that shape (refused before any read).
 */
export function cleanLearnOptions(raw: unknown): { venue: boolean; descriptions: boolean; eventDescription: boolean; place: boolean; note: string | null } | null {
  if (raw === undefined || raw === null) return { venue: true, descriptions: true, eventDescription: true, place: true, note: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const flag = (v: unknown): boolean | null => (v === undefined ? true : typeof v === "boolean" ? v : null);
  const venue = flag(o.venue);
  const descriptions = flag(o.descriptions);
  const eventDescription = flag(o.eventDescription);
  const place = flag(o.place);
  if (venue === null || descriptions === null || eventDescription === null || place === null) return null;
  if (o.note !== undefined && o.note !== null && typeof o.note !== "string") return null;
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (note !== "" && (note.length < LEARN_NOTE_MIN || note.length > LEARN_NOTE_MAX)) return null;
  return { venue, descriptions, eventDescription, place, note: note === "" ? null : note };
}

// ---- the second-edit round: the event's own fields, and a verdict per show ------------------------------------

type Loose = Record<string, unknown>;

const textOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The event's own description against its baseline. null = no change, nothing to compare, or a cleared one (never carried). */
export type EventDescriptionChange = { from: string; to: string };
export function eventDescriptionChange(payload: Loose | null, row: Loose | null): EventDescriptionChange | null {
  if (!payload || !row || typeof payload.description !== "string" || typeof row.description !== "string") return null;
  const from = payload.description.trim();
  const to = row.description.trim();
  return from === to || to === "" ? null : { from, to };
}

/** What the `place` kind carries, and each column's database default (a payload that never set one reads as its default). */
export const PLACE_FIELDS = ["location", "event_location", "lodging_mode", "lodging_default", "lodging_note", "split_default_nights"] as const;
export type PlaceField = (typeof PLACE_FIELDS)[number];
const PLACE_DEFAULTS: Record<PlaceField, unknown> = { location: null, event_location: null, lodging_mode: "flight_city", lodging_default: "flight", lodging_note: null, split_default_nights: 2 };

const placeValue = (o: Loose, field: PlaceField): unknown => {
  const v = o[field];
  return v === undefined || v === null || v === "" ? PLACE_DEFAULTS[field] : v;
};
const iataOf = (location: unknown): string | null => {
  const v = typeof location === "object" && location !== null ? (location as { city_iata?: unknown }).city_iata : null;
  return typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : null;
};
const placeNameOf = (location: unknown): string | null => {
  const v = typeof location === "object" && location !== null ? (location as { name?: unknown }).name : null;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

/**
 * The location and lodging columns that differ from the baseline: `patch` = their new values (only those), `before` = the
 * old, `flightChanged` = another flight city (not carried - it changes the flights and the base prices), `from` / `to` = the
 * location's name, for the dialog. A column the row was read without does not count. null = no change.
 */
export type PlaceChange = {
  fields: PlaceField[];
  patch: Partial<Record<PlaceField, unknown>>;
  before: Partial<Record<PlaceField, unknown>>;
  flightChanged: boolean;
  from: string | null;
  to: string | null;
};
export function placeChange(payload: Loose | null, row: Loose | null): PlaceChange | null {
  if (!payload || !row) return null;
  const fields: PlaceField[] = [];
  const patch: PlaceChange["patch"] = {};
  const before: PlaceChange["before"] = {};
  for (const field of PLACE_FIELDS) {
    if (row[field] === undefined || (field === "location" && (payload.location === undefined || row.location === null))) continue;
    const was = placeValue(payload, field);
    const is = placeValue(row, field);
    if (stable(was) === stable(is)) continue;
    fields.push(field);
    patch[field] = is;
    before[field] = was;
  }
  if (fields.length === 0) return null;
  // an IATA that went empty, or that a ticket-only show was given, is another flight city too: main searches flights by it
  const flightChanged = fields.includes("location") && iataOf(payload.location) !== iataOf(row.location);
  return { fields, patch, before, flightChanged, from: placeNameOf(payload.location), to: placeNameOf(row.location) };
}

/**
 * Why a kind does not reach a show (or reaches it only partly): `other_hall` = not at the source's hall; `typed_by_hand` = a
 * person wrote something else there (it stays theirs); `different` = the show started from another text or place, so the
 * source's new one would not fit it; `already` = it already reads that; `no_category` = the show sells no such ticket.
 */
export type SkipReason = "other_hall" | "typed_by_hand" | "different" | "already" | "no_category";
/** One kind on one show: `applies` + how many things it writes; a `reason` beside `applies` = only part of it reaches the show. */
export type ShowVerdict = { applies: boolean; count: number; reason: SkipReason | null };

const skip = (reason: SkipReason): ShowVerdict => ({ applies: false, count: 0, reason });
const APPLIES: ShowVerdict = { applies: true, count: 1, reason: null };

/** A show of the run as the verdicts read it: its identity, its baseline, its event as it is now. */
export type LearnShow = { show: ShowIdentity; payload: Loose | null; row: Loose };

export function descriptionVerdict(change: EventDescriptionChange, source: ShowIdentity, other: LearnShow): ShowVerdict {
  if (!sameVenue(source, other.show)) return skip("other_hall");
  const now = textOf(other.row.description);
  if (now === change.to) return skip("already");
  if (now !== textOf(other.payload?.description)) return skip("typed_by_hand");
  return now === change.from ? APPLIES : skip("different");
}

export function placeVerdict(change: PlaceChange, source: ShowIdentity, other: LearnShow): ShowVerdict {
  if (!sameVenue(source, other.show)) return skip("other_hall");
  const baseline = other.payload ?? {};
  const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
  if (change.fields.every((f) => same(placeValue(other.row, f), change.patch[f]))) return skip("already");
  if (change.fields.some((f) => !same(placeValue(other.row, f), placeValue(baseline, f)))) return skip("typed_by_hand");
  return change.fields.every((f) => same(placeValue(baseline, f), change.before[f])) ? APPLIES : skip("different");
}

/** The ticket-description plan on one show: how many tickets it changes, and why the rest do not change. */
export function ticketVerdict(row: EventTicket[], baseline: EventTicket[], plan: DescriptionPlan, atSameVenue: boolean): ShowVerdict {
  const base = bySlot(baseline);
  const inPlan = (supplier: DescribedSupplier, key: string): boolean =>
    plan.clearAll.includes(supplier) || plan.clear.some((c) => c.supplier === supplier && c.key === key) || plan.set.some((s) => s.supplier === supplier && s.key === key);
  const held = row.filter((t) => {
    const supplier = supplierOf(t);
    return supplier !== null && base.has(slotOf(supplier, keyOf(t))) && inPlan(supplier, keyOf(t));
  });
  if (held.length === 0) return skip("no_category");
  const applied = applyDescriptionPlan(row, baseline, plan, atSameVenue);
  const setElsewhere = !atSameVenue && plan.set.some((s) => base.has(slotOf(s.supplier, s.key)));
  if (applied.changed > 0) return { applies: true, count: applied.changed, reason: applied.typed > 0 ? "typed_by_hand" : setElsewhere ? "other_hall" : null };
  if (applied.typed > 0) return skip("typed_by_hand");
  return skip(setElsewhere ? "other_hall" : "already");
}

/** One other built show in the learn dialog: who it is, and a verdict for each kind that has a change. */
export type LearnShowRow = {
  itemId: string;
  eventId: number;
  date: string;
  city: string;
  venue: string | null;
  verdicts: Partial<Record<EditKind, ShowVerdict>>;
};

/** The dialog's per-show list. `venueSiblings` = the items the hall kind rewrites; null = no hall change to carry. */
/** How many shows a kind actually reaches - what the editor's toast promises. */
export const showsReached = (rows: LearnShowRow[]): number => rows.filter((row) => Object.values(row.verdicts).some((verdict) => verdict?.applies === true)).length;

export function learnShowRows(input: {
  source: LearnShow;
  others: (LearnShow & { itemId: string; eventId: number })[];
  venueSiblings: Set<string> | null;
  plan: DescriptionPlan;
  description: EventDescriptionChange | null;
  place: PlaceChange | null;
}): LearnShowRow[] {
  const { source, plan, description, place, venueSiblings } = input;
  return input.others.map((other) => {
    const verdicts: LearnShowRow["verdicts"] = {};
    if (venueSiblings) verdicts.venue = venueSiblings.has(other.itemId) ? APPLIES : skip("other_hall");
    if (!isEmptyPlan(plan)) {
      verdicts.descriptions = ticketVerdict(ticketsOf(other.row.tickets_and_rates), ticketsOf(other.payload?.tickets_and_rates), plan, sameVenue(source.show, other.show));
    }
    if (description) verdicts.event_description = descriptionVerdict(description, source.show, other);
    if (place) verdicts.place = placeVerdict(place, source.show, other);
    return { itemId: other.itemId, eventId: other.eventId, date: other.show.date, city: other.show.city, venue: other.show.venue, verdicts };
  });
}

/**
 * What one show gets from the event's own kinds: `event` = the columns to write (a kind that applies), `payload` = what its
 * baseline follows - also where a person already typed the same (`already`), so that card stops reading as edited. A carried
 * description stays a person's (`description_by_hand` - a later template rewrite must not overwrite it); an `already` whose
 * baseline reads it too is nobody's typing, so nothing follows and the show keeps following the template.
 */
export function eventFieldsFor(
  description: EventDescriptionChange | null,
  place: PlaceChange | null,
  descriptionIs: ShowVerdict | null | undefined,
  placeIs: ShowVerdict | null | undefined,
  baseline: Loose | null,
): { event: Loose; payload: Loose } {
  const event: Loose = {};
  const payload: Loose = {};
  if (description && descriptionIs) {
    if (descriptionIs.applies) event.description = description.to;
    if (descriptionIs.applies || (descriptionIs.reason === "already" && textOf(baseline?.description) !== description.to)) {
      payload.description = description.to;
      payload.description_by_hand = true;
    }
  }
  if (place && placeIs) {
    if (placeIs.applies) Object.assign(event, place.patch);
    if (placeIs.applies || placeIs.reason === "already") Object.assign(payload, place.patch);
  }
  return { event, payload };
}

/**
 * The source item's baseline after a learn, over the event's own kinds it applied cleanly (`rebaseTickets`' twin); an unticked or
 * cut-off kind stays pending. `built_fields` keeps what the uploader first wrote, set once per field: the approve-time edit diff
 * reads it (decisions.ts `fieldOf`, as `built_tickets_count`), so a learn does not erase that a person changed the event.
 */
export function rebaseEventFields(payload: Loose, row: Loose, kinds: { description: boolean; place: boolean }): Loose {
  const out: Loose = {};
  const built: Loose = {};
  if (kinds.description) {
    const change = eventDescriptionChange(payload, row);
    if (change) {
      out.description = change.to;
      out.description_by_hand = true;
      built.description = payload.description;
    }
  }
  if (kinds.place) {
    const change = placeChange(payload, row);
    if (change && !change.flightChanged) {
      Object.assign(out, change.patch);
      for (const field of change.fields) built[field] = payload[field];
    }
  }
  if (Object.keys(built).length > 0) {
    const already = typeof payload.built_fields === "object" && payload.built_fields !== null ? (payload.built_fields as Loose) : {};
    out.built_fields = { ...built, ...already };
  }
  return out;
}

/** The edits no kind carries - the dialog names them, so a change that goes nowhere is never a mystery. */
export type NotCarried = "name" | "name_english" | "date" | "def_date_depart" | "def_date_return" | "base_flight_price" | "base_hotel_price" | "event_additional_markup" | "ticket_only_markup" | "package_mode" | "flight_city" | "description_cleared" | "ticket_label" | "livetickets_zone" | "livetickets_tickets" | "tixstock_description_cleared";

const CARRIED_FIELDS = new Set<string>(["description", "tickets_count", ...PLACE_FIELDS]);

export function notCarriedEdits(payload: Loose | null, row: Loose | null): NotCarried[] {
  if (!payload || !row) return [];
  const out = editDiff(payload, row)
    .map((d) => d.field)
    .filter((field) => !CARRIED_FIELDS.has(field)) as NotCarried[];
  if (placeChange(payload, row)?.flightChanged) out.push("flight_city");
  if (typeof payload.description === "string" && typeof row.description === "string" && textOf(payload.description) !== "" && textOf(row.description) === "") out.push("description_cleared");
  const key = (t: EventTicket): string => `${ticketSupplier(t, "tx_event")}|${keyOf(t)}`;
  const was = new Map(ticketsOf(payload.tickets_and_rates).map((t) => [key(t), t]));
  const now = ticketsOf(row.tickets_and_rates);
  const pairs = now.flatMap((t) => {
    const old = was.get(key(t));
    return old ? [{ t, old }] : [];
  });
  if (pairs.some(({ t, old }) => t.category.trim() !== old.category.trim())) out.push("ticket_label");
  if (pairs.some(({ t, old }) => supplierOf(t) !== null && (t.zoneId || "") !== (old.zoneId || ""))) out.push("livetickets_zone");
  const liveKeys = (list: EventTicket[]): string[] => list.filter((t) => supplierOf(t) !== null).map(key).sort();
  if (stable(liveKeys(ticketsOf(payload.tickets_and_rates))) !== stable(liveKeys(now))) out.push("livetickets_tickets");
  if (pairs.some(({ t, old }) => isTixStock(t) && descriptionOf(old) !== "" && descriptionOf(t) === "")) out.push("tixstock_description_cleared");
  return out;
}

/**
 * Did this save touch anything a learn carries? The editor's toast asks only then - an edit left pending must not ask again on
 * every later save of an unrelated field. `before` = the form as last saved (JSON); none or unreadable = ask.
 */
export function editTouchesLearnFields(before: string | null, after: Loose): boolean {
  let was: Loose;
  try {
    const parsed: unknown = before === null ? null : JSON.parse(before);
    if (typeof parsed !== "object" || parsed === null) return true;
    was = parsed as Loose;
  } catch {
    return true;
  }
  return ["description", "tickets_and_rates", "tx_excluded_sections", ...PLACE_FIELDS].some((field) => stable(was[field]) !== stable(after[field]));
}
