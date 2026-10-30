/**
 * A date opens on a tour a card waits for (Alon 30.10: "כשנפתח תאריך אני רוצה אוטומציה ששולחת ואטסאפ עדכון ללקוח ... וזה
 * מעביר אותו לטודיי טסקט למחרת שנציג יחייג"; Dor took every recommended answer). Every rule is pure here, and so is one
 * tick over injected reads and writes (`runWaitlistTick`), so scripts/tours-waitlist-dates-selftest.ts runs it with a
 * fake `send` - no test can reach a real customer. The I/O is lib/services/tours-waitlist-dates.ts.
 *
 * - Open = the site's own rule (mega-family lib/data/departures.mjs + lib/content.ts pricedOpen): not past, not sold out
 *   or closed, no waiting list of its own, a double-room price.
 * - A date must stay open for OPEN_SETTLE_MS, so a publish undone at once sends nothing, and it must be first seen open
 *   AFTER the card started waiting, so a rep moving a card to the list sends nothing for a date already open.
 * - A card that names a date waits for that date alone; a card that names only a tour takes its soonest open date; a
 *   card with no tour stays with the reps.
 * - The card moves FIRST and only then the message goes out: a crash can leave a card moved with no message (it says
 *   so, and the rep has the text ready), never a message sent twice.
 * - The card moves whatever happens to the message; the WhatsApp is held back only by a reason the card then prints.
 */
import { nextWorkingDay } from "@/lib/reservations/follow-up";
import { siteSaleStatus } from "@/components/tours/departures/departure-utils";
import { DATE_OPENED_STATUS, bookingLink, isOpenCard, packagePathOf, phoneKey, whatsappPhone, type CaseStatus, type RouteCard } from "@/lib/tours/cases";
import { departureSiteId } from "@/types/tours.types";

export { DATE_OPENED_STATUS };
/**
 * How long a date must stay open before it counts. The check runs hourly: one tick sees it, the next acts. Under the hour
 * on purpose - a cron a few seconds early would otherwise wait a whole extra hour.
 */
export const OPEN_SETTLE_MS = 50 * 60 * 1000;
/** A ceiling per company per hour, counted in the database: a wrong publish, or a second run of the cron, cannot reach more. */
export const MAX_CARDS_PER_TICK = 30;
/**
 * Messages a day (a rolling 24 hours, per company) to numbers we never spoke to (Dor 30.10). The form is public, so a
 * number on the list may be one somebody else typed: past this the card still moves and a rep calls.
 */
export const FIRST_CONTACT_MAX_PER_DAY = 20;
/** The approved WhatsApp template (Hebrew; {{1}} first name, {{2}} tour, {{3}} link). */
export const WAITLIST_TEMPLATE_DEFAULT = "waitlist_date_open";
export const WAITLIST_TEMPLATE_LANGUAGE = "he";

/** A name that goes out in our message: letters, one word, short. A visitor typed it, and it goes to a phone they typed. */
const NAME_ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M}'’׳-]{0,19}$/u;
const NO_NAME = "חברים";
const NO_TOUR = "הטיול";
/** The hours a customer may get this message, Israel time: [from, to) per weekday, Sunday = 0. Shabbat has none. */
const SEND_HOURS: Record<number, [number, number] | null> = { 0: [9, 20], 1: [9, 20], 2: [9, 20], 3: [9, 20], 4: [9, 20], 5: [9, 13], 6: null };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One date of a tour as the site would sell it. `saleStatus` is already the site's (seats included: siteSaleStatus). */
export interface SiteDate {
  id: string;
  code: string | null;
  packageId: string;
  startDate: string;
  saleStatus: string;
  /** Staff fill this date through its own waiting list (`data.waitlist`): not sold online. */
  listOpen: boolean;
  /** The site's rule: a double-room price in the table, or a price kept on the date itself (an imported date). */
  priced: boolean;
  productId: number | null;
  tourName: string | null;
  packagePath: string;
}

export function isOpenDate(d: SiteDate, today: string): boolean {
  return d.startDate >= today && d.saleStatus !== "sold_out" && d.saleStatus !== "closed" && !d.listOpen && d.priced && d.productId !== null;
}

/** A row of tours.departures, as lib/services/tours-waitlist-dates.ts reads it. */
export interface SiteDateRow {
  id: string;
  code: string | null;
  package_id: string;
  start_date: string;
  sale_status: string;
  legacy_product_id: number | null;
  site_id: number;
  waitlist: unknown;
  price_offer: unknown;
  price_regular: unknown;
  packages: { name: string; slug: string; is_active: boolean; is_deleted: string | null; path: unknown; stub: unknown } | null;
}

/**
 * The date as the site would sell it (mega-family lib/data/departures.mjs + lib/content.ts, over the views of c_<slug>):
 * its seats decide sold out, and a tour that is switched off, deleted or a stub has no page to send anyone to, so
 * `productId` is null and the date is not open. Switching the tour on is then a date first seen open.
 */
export function siteDateOf(row: SiteDateRow, ctx: { doublePriced: boolean; seats: { allocated: number; remaining: number } }): SiteDate {
  const pkg = row.packages;
  const sold = !!pkg && pkg.is_active && !pkg.is_deleted && !pkg.stub;
  return {
    id: row.id,
    code: row.code,
    packageId: row.package_id,
    startDate: row.start_date,
    saleStatus: siteSaleStatus({ sale_status: row.sale_status, allocated: ctx.seats.allocated, remaining: ctx.seats.remaining }),
    listOpen: row.waitlist === true,
    priced: ctx.doublePriced || (row.price_offer ?? row.price_regular ?? null) !== null,
    productId: sold ? departureSiteId(row) : null,
    tourName: pkg?.name ?? null,
    packagePath: pkg ? packagePathOf(pkg.slug, typeof pkg.path === "string" ? pkg.path : null) : "",
  };
}

/** What to stamp (open, not watched yet) and what to forget (watched, no longer open - reopening starts the clock anew). */
export function watchPlan(openIds: readonly string[], watched: ReadonlyMap<string, string>): { stamp: string[]; clear: string[] } {
  const open = new Set(openIds);
  return { stamp: openIds.filter((id) => !watched.has(id)), clear: [...watched.keys()].filter((id) => !open.has(id)) };
}

/** A card in "רשימת המתנה". `consent` = customers.wa_consent. */
export interface WaitingCard {
  id: string;
  caseNo: number;
  packageId: string | null;
  departureId: string | null;
  /** When it started waiting (leads.waitlist_since, stamped by a trigger on every way in). */
  waitlistSince: string | null;
  firstName: string | null;
  phone: string | null;
  customerId: string | null;
  /** customers.wa_consent, or opted_out when ANY customer of this number opted out (a merge or a move can hide it). */
  consent: string | null;
  /** The customer's stored phones as whole numbers (972...); null = nothing stored to compare with. */
  customerNumbers: string[] | null;
  /** The customer has an open or paid card on this tour besides the waiting one. */
  otherCardOnTour: boolean;
  /** leads.no_auto_message: it came in a burst of waiting-list forms (leads_fill), so a rep looks at it first. */
  burstHeld: boolean;
  /** isKnownContact: we spoke to this number, so the day's cap on new numbers does not apply. */
  knownContact: boolean;
  linkToken: string | null;
}

/** A number that confirmed or wrote to us on WhatsApp. A box ticked on a public form proves nothing: anyone can type a phone. */
export function isKnownContact(consent: string | null, lastInAt: string | null): boolean {
  return consent === "opted_in" || consent === "customer" || !!lastInAt;
}

/** Another card of this customer on this tour that is still alive (the board's own rule: not closed, not a trip gone). */
export function hasOtherOpenCard(card: { id: string; packageId: string | null }, others: readonly RouteCard[], statuses: readonly CaseStatus[], today: string): boolean {
  return others.some((o) => o.id !== card.id && !!card.packageId && o.packageId === card.packageId && isOpenCard(o, statuses, today));
}

/**
 * The date that answers this card now, or null. `seen` = when each date was first seen open. `liveIds` = the dates still
 * on the site, open or not: a card that named a date gone from it takes the tour's next date (the form promised to tell
 * them about the tour). `leavesAfter` = the rep's follow-up day: a date leaving by then cannot be sold by that call.
 */
export function openedDateFor(
  card: WaitingCard,
  open: readonly SiteDate[],
  seen: ReadonlyMap<string, string>,
  now: Date,
  opts: { liveIds?: ReadonlySet<string>; leavesAfter?: string } = {},
): SiteDate | null {
  const named = card.departureId && (!opts.liveIds || opts.liveIds.has(card.departureId)) ? card.departureId : null;
  if ((!named && !card.packageId) || !card.waitlistSince) return null;
  const since = Date.parse(card.waitlistSince);
  if (Number.isNaN(since)) return null;
  const answers = open
    .filter((d) => (named ? d.id === named : d.packageId === card.packageId))
    .filter((d) => !opts.leavesAfter || d.startDate > opts.leavesAfter)
    .filter((d) => {
      const at = Date.parse(seen.get(d.id) ?? "");
      return !Number.isNaN(at) && at <= now.getTime() - OPEN_SETTLE_MS && at > since;
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.code ?? "").localeCompare(b.code ?? ""));
  return answers[0] ?? null;
}

/** Never at night or on Shabbat (Israel time). The check keeps running; nothing moves until the hours come. */
export function isSendWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hours = SEND_HOURS[WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "")];
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return !!hours && hour >= hours[0] && hour < hours[1];
}

/** The failure mail goes out on one tick a day, or a stuck tick would mail eleven times. */
export function isMorningTick(now: Date): boolean {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).format(now);
  return isSendWindow(now) && Number(hour) === 9;
}

export const OPTED_OUT_WHY = "The customer opted out of WhatsApp.";
const ALREADY_TOLD_WHY = "The customer was already told through another card.";
const NEW_NUMBERS_CAP_WHY = "Today's limit of messages to new numbers was reached.";

/** Why this customer gets no message (Dor 30.10: everyone on the list but who opted out), or null. Shown on the card. */
export function whatsappBlock(card: Pick<WaitingCard, "consent" | "phone" | "customerNumbers" | "otherCardOnTour" | "burstHeld">): string | null {
  if (card.consent === "opted_out") return OPTED_OUT_WHY;
  const number = whatsappPhone(card.phone);
  if (!number) return "The card has no valid phone number.";
  // a card keeps the phone it came with: a rep who corrected the customer's phone leaves the typo here, and it is a
  // stranger's. The whole number: a form joins a customer by the last 9 digits, so another country's number can land here
  if (card.customerNumbers && !card.customerNumbers.includes(number)) return "The card's phone is no longer the customer's.";
  if (card.otherCardOnTour) return "The customer has another card on this tour.";
  if (card.burstHeld) return "It came in a burst of waiting-list forms: check the customer first.";
  return null;
}

/**
 * Why the template cannot go out, or null. Stricter than the send's own check: an automation sends only what the cache
 * knows as APPROVED - an unknown template would only collect failed rows from Meta.
 */
export function approvedTemplateBlock(cache: readonly { name: string; language: string; status: string }[], name: string): string | null {
  const known = cache.find((t) => t.name === name && t.language === WAITLIST_TEMPLATE_LANGUAGE);
  if (!known) return `The WhatsApp template "${name}" is not approved yet.`;
  return known.status === "APPROVED" ? null : `The WhatsApp template "${name}" is ${known.status}, not approved yet.`;
}

/**
 * The template's three variables. The name goes out from our verified number to a phone a visitor typed on a public
 * form, so it is one word of letters or nothing at all - no form can put a link or a sentence into our message - and
 * Meta refuses an empty variable or a line break inside one.
 */
export function dateOpenedParams(firstName: string | null | undefined, tourName: string | null | undefined, url: string): [string, string, string] {
  const word = (firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const name = NAME_ALLOWED.test(word) ? word : NO_NAME;
  const tour = (tourName ?? "").replace(/\s+/g, " ").trim() || NO_TOUR;
  return [name, tour, url];
}

/**
 * The same words as the template, for a rep who sends it from their own WhatsApp while the number is not connected. The
 * link stands on its own line: a full stop right after it can end up inside it, and Meta refuses a template that ends on
 * a variable.
 */
export function dateOpenedMessage(firstName: string | null | undefined, tourName: string | null | undefined, url: string): string {
  const [name, tour, link] = dateOpenedParams(firstName, tourName, url);
  return `היי ${name}, מה שחיכיתם לו עלה!\nנפתח תאריך ל${tour}.\nאפשר להציץ כאן: ${link}\nנציג שלנו יחזור אליכם בקרוב.`;
}

export type DateOpenedSend = "pending" | "sent" | "failed" | "skipped";
const SEND_STATES: readonly string[] = ["pending", "sent", "failed", "skipped"];

/** leads.date_opened: what happened when the card's date opened. `why` names what held the message back. */
export interface DateOpenedNote {
  departureId: string;
  code: string | null;
  startDate: string;
  tourName: string | null;
  url: string;
  at: string;
  whatsapp: DateOpenedSend;
  why: string | null;
  /** The message went to a number we never spoke to: what the day's cap counts. */
  firstContact?: boolean;
}

export function parseDateOpened(value: unknown): DateOpenedNote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const departureId = text(o.departureId);
  const url = text(o.url);
  const at = text(o.at);
  if (!departureId || !url || !at) return null;
  return {
    departureId,
    code: text(o.code),
    startDate: text(o.startDate) ?? "",
    tourName: text(o.tourName),
    url,
    at,
    whatsapp: SEND_STATES.includes(o.whatsapp as string) ? (o.whatsapp as DateOpenedSend) : "pending",
    why: text(o.why),
    ...(o.firstContact === true ? { firstContact: true } : {}),
  };
}

// ---------------------------------------------------------------- one tick of one company
export interface CardMove {
  token: string;
  followUpDate: string;
  note: DateOpenedNote;
}

export interface TickDeps {
  readDates(): Promise<SiteDate[]>;
  readWatch(): Promise<Map<string, string>>;
  stamp(ids: string[]): Promise<void>;
  clear(ids: string[]): Promise<void>;
  readCards(): Promise<WaitingCard[]>;
  /** The company's status list has "נפתח תאריך" (or it reads the default list, which does). */
  hasStatus(): Promise<boolean>;
  /** Cards this company moved in the last hour, whoever ran the check. A failed read throws: nothing moves on a guess. */
  movedLastHour(): Promise<number>;
  /** Messages sent to new numbers in the last 24 hours. A failed read holds new numbers back, never a known one. */
  firstContactsLastDay(): Promise<number>;
  /** Why the company cannot send at all (no number, no token, switched off), or null. Read once a tick; a failure is a reason. */
  senderProblem(): Promise<string | null>;
  templateProblem(): Promise<string | null>;
  newToken(): string;
  /** Moves the card only while it is still waiting; false = a rep got there first, and nothing goes out. */
  claim(card: WaitingCard, move: CardMove): Promise<boolean>;
  send(card: WaitingCard, params: [string, string, string]): Promise<{ ok: true } | { ok: false; error: string }>;
  record(card: WaitingCard, note: DateOpenedNote): Promise<void>;
  audit(card: WaitingCard, note: DateOpenedNote): Promise<void>;
}

export interface TickOptions {
  now: Date;
  today: string;
  siteUrl: string | null;
  dryRun: boolean;
  /** A Date.now() value: past it the rest wait for the next tick. */
  deadline: number;
}

/** Ids and counts only: a tick's report reaches the logs, so it never names a customer. */
export interface TickResult {
  open: number;
  stamped: number;
  cleared: number;
  waiting: number;
  due: number;
  moved: number;
  sent: number;
  remaining: number;
  outsideHours: boolean;
  wouldMove: { caseNo: number; code: string | null }[];
  problem: string | null;
  errors: string[];
}

/** A failed read of the WhatsApp setup is a reason on the card, never a card left on the list. */
async function problemOf(read: () => Promise<string | null>): Promise<string | null> {
  try {
    return await read();
  } catch (e) {
    return `Could not read the WhatsApp setup: ${e instanceof Error ? e.message : "failed"}`;
  }
}

export async function runWaitlistTick(deps: TickDeps, opts: TickOptions): Promise<TickResult> {
  const result: TickResult = { open: 0, stamped: 0, cleared: 0, waiting: 0, due: 0, moved: 0, sent: 0, remaining: 0, outsideHours: !isSendWindow(opts.now), wouldMove: [], problem: null, errors: [] };
  const dates = await deps.readDates();
  const open = dates.filter((d) => isOpenDate(d, opts.today));
  const watched = await deps.readWatch();
  const plan = watchPlan(open.map((d) => d.id), watched);
  result.open = open.length;
  result.stamped = plan.stamp.length;
  result.cleared = plan.clear.length;
  if (!opts.dryRun) {
    if (plan.stamp.length) await deps.stamp(plan.stamp);
    if (plan.clear.length) await deps.clear(plan.clear);
  }
  // a dry run answers at any hour; a real tick only starts the clocks outside the hours
  if (result.outsideHours && !opts.dryRun) return result;

  const liveIds = new Set(dates.map((d) => d.id));
  const followUpDate = nextWorkingDay(opts.today);
  const cards = await deps.readCards();
  result.waiting = cards.length;
  const due = cards
    .map((card) => ({ card, date: openedDateFor(card, open, watched, opts.now, { liveIds, leavesAfter: followUpDate }) }))
    .filter((d): d is { card: WaitingCard; date: SiteDate } => d.date !== null)
    .sort((a, b) => (a.card.waitlistSince ?? "").localeCompare(b.card.waitlistSince ?? ""));
  result.due = due.length;
  if (due.length === 0) return result;
  if (!opts.siteUrl) {
    result.problem = "The company has no site address, so no link can be built.";
    return result;
  }
  if (!(await deps.hasStatus())) {
    result.problem = `The company's status list has no "${DATE_OPENED_STATUS}".`;
    return result;
  }
  const turn = due.slice(0, Math.max(0, MAX_CARDS_PER_TICK - (await deps.movedLastHour())));
  result.remaining = due.length - turn.length;
  if (opts.dryRun) {
    result.wouldMove = turn.map((d) => ({ caseNo: d.card.caseNo, code: d.date.code }));
    return result;
  }
  if (turn.length === 0) return result;

  const sender = await problemOf(deps.senderProblem);
  const template = sender ? null : await problemOf(deps.templateProblem);
  // one number, one tour, one message: two cards of a customer both reach a rep
  const told = new Set<string>();
  let newNumbersLeft = 0;
  let newNumbersWhy = NEW_NUMBERS_CAP_WHY;
  if (!sender && !template) {
    try {
      newNumbersLeft = FIRST_CONTACT_MAX_PER_DAY - (await deps.firstContactsLastDay());
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      newNumbersWhy = `Could not count today's messages to new numbers: ${message}`;
      result.errors.push(newNumbersWhy);
    }
  }
  for (let i = 0; i < turn.length; i += 1) {
    if (Date.now() >= opts.deadline) {
      result.remaining += turn.length - i;
      break;
    }
    const { card, date } = turn[i];
    try {
      const token = card.linkToken ?? deps.newToken();
      const url = bookingLink({ siteUrl: opts.siteUrl, packagePath: date.packagePath, productId: date.productId as number, rooms: [], token });
      const note: DateOpenedNote = { departureId: date.id, code: date.code, startDate: date.startDate, tourName: date.tourName, url, at: opts.now.toISOString(), whatsapp: "pending", why: null };
      if (!(await deps.claim(card, { token, followUpDate, note }))) continue;
      result.moved += 1;
      const toldKey = `${phoneKey(card.phone)}|${date.packageId}`;
      const held = sender ?? template ?? whatsappBlock(card) ?? (told.has(toldKey) ? ALREADY_TOLD_WHY : !card.knownContact && newNumbersLeft <= 0 ? newNumbersWhy : null);
      let final: DateOpenedNote = { ...note, whatsapp: "skipped", why: held };
      if (!held) {
        try {
          const answer = await deps.send(card, dateOpenedParams(card.firstName, date.tourName, url));
          // a failed send told nobody: the customer's other card may still try
          if (answer.ok) told.add(toldKey);
          if (answer.ok && !card.knownContact) newNumbersLeft -= 1;
          final = answer.ok
            ? { ...note, whatsapp: "sent", why: null, ...(card.knownContact ? {} : { firstContact: true }) }
            : { ...note, whatsapp: "failed", why: answer.error };
        } catch (e) {
          final = { ...note, whatsapp: "failed", why: e instanceof Error ? e.message : "The send failed." };
        }
      }
      if (final.whatsapp === "sent") result.sent += 1;
      await deps.record(card, final);
      await deps.audit(card, final);
    } catch (e) {
      result.errors.push(`case ${card.caseNo}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return result;
}
