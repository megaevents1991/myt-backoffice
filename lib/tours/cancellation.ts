/**
 * A tour's cancellation fees (tours.cancellation_rules, migration 20261020150000 - Alon 20.10.2026: "cancellation
 * policy at the moment: Hotel $0 until 25 Nov · Flights $100 per passenger until 20 Nov, then $200 · Overall $400").
 * Each part of the tour (hotel / flights / land / other) has windows by the days left before the departure: a rule
 * holds while at least `untilDaysBefore` days are left; the rule with no number is the last window, up to the
 * departure. An order adds the parts up as of today. Pure - selftest scripts/tours-payments-selftest.ts.
 */

export const CANCEL_COMPONENTS = ["hotel", "flight", "land", "other"] as const;
export type CancelComponent = (typeof CANCEL_COMPONENTS)[number];
export const CANCEL_COMPONENT_LABELS: Record<CancelComponent, string> = { hotel: "Hotel", flight: "Flights", land: "Land", other: "Other" };

export const CANCEL_FEE_KINDS = ["per_pax", "per_order", "percent"] as const;
export type CancelFeeKind = (typeof CANCEL_FEE_KINDS)[number];
export const CANCEL_FEE_KIND_LABELS: Record<CancelFeeKind, string> = { per_pax: "per passenger", per_order: "per order", percent: "% of the order" };

export interface CancellationRule {
  component: CancelComponent;
  /** Holds while at least this many days are left before the departure; null = the last window. */
  untilDaysBefore: number | null;
  feeKind: CancelFeeKind;
  feeValue: number;
}

export const CANCEL_RULES_MAX = 40;
export const CANCEL_DAYS_MAX = 730;
export const CANCEL_FEE_MAX = 1_000_000;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
export const isCancelComponent = (v: unknown): v is CancelComponent => isOneOf(CANCEL_COMPONENTS, v);
export const isCancelFeeKind = (v: unknown): v is CancelFeeKind => isOneOf(CANCEL_FEE_KINDS, v);

/** Why a tour's rules cannot be saved, or null. */
export function checkCancellationRules(rules: readonly CancellationRule[]): string | null {
  if (rules.length > CANCEL_RULES_MAX) return `At most ${CANCEL_RULES_MAX} rules.`;
  const seen = new Set<string>();
  for (const r of rules) {
    if (!isCancelComponent(r.component)) return "Choose what each rule is for (hotel, flights, land or other).";
    if (!isCancelFeeKind(r.feeKind)) return "Choose how each fee is counted.";
    if (typeof r.feeValue !== "number" || !Number.isFinite(r.feeValue) || r.feeValue < 0 || r.feeValue > CANCEL_FEE_MAX) {
      return "A fee must be a number, 0 or more.";
    }
    if (r.feeKind === "percent" && r.feeValue > 100) return "A percent fee is 100 at most.";
    if (r.untilDaysBefore !== null && (!Number.isInteger(r.untilDaysBefore) || r.untilDaysBefore < 0 || r.untilDaysBefore > CANCEL_DAYS_MAX)) {
      return `Days before the departure: a whole number from 0 to ${CANCEL_DAYS_MAX}.`;
    }
    const key = `${r.component}:${r.untilDaysBefore ?? "last"}`;
    if (seen.has(key)) {
      return r.untilDaysBefore === null
        ? `${CANCEL_COMPONENT_LABELS[r.component]}: only one "until the departure" rule.`
        : `${CANCEL_COMPONENT_LABELS[r.component]}: two rules for ${r.untilDaysBefore} days before.`;
    }
    seen.add(key);
  }
  return null;
}

/** By part, then the earliest window first (most days left), the last window last. */
export function sortRules<T extends CancellationRule>(rules: readonly T[]): T[] {
  return [...rules].sort(
    (a, b) =>
      CANCEL_COMPONENTS.indexOf(a.component) - CANCEL_COMPONENTS.indexOf(b.component) ||
      (b.untilDaysBefore ?? -1) - (a.untilDaysBefore ?? -1),
  );
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Days left before the departure (yyyy-mm-dd both); below 0 once it left. */
export const daysLeft = (today: string, departureStart: string): number => dayNumber(departureStart) - dayNumber(today);

/** The last day a rule holds on a departure (yyyy-mm-dd), or null for the last window. */
export const ruleUntil = (rule: Pick<CancellationRule, "untilDaysBefore">, departureStart: string): string | null =>
  rule.untilDaysBefore === null ? null : dayOf(dayNumber(departureStart) - rule.untilDaysBefore);

/** One rule's fee on an order. */
export function ruleFee(rule: Pick<CancellationRule, "feeKind" | "feeValue">, travelers: number, orderTotal: number): number {
  const fee = rule.feeKind === "per_pax" ? rule.feeValue * travelers : rule.feeKind === "per_order" ? rule.feeValue : (orderTotal * rule.feeValue) / 100;
  return Math.round(fee * 100) / 100;
}

export interface CancelFeeLine {
  component: CancelComponent;
  /** The rule that holds today; null = no rule covers today (a gap in the windows). */
  rule: CancellationRule | null;
  fee: number | null;
  /** The last day today's fee holds (yyyy-mm-dd); null = up to the departure. */
  until: string | null;
  /** The rule that comes after it. */
  next: CancellationRule | null;
}

export interface CancelFeeToday {
  daysLeft: number;
  lines: CancelFeeLine[];
  /** The sum of the parts that have a rule today. */
  total: number;
  /** A part had no rule covering today - the total leaves it out. */
  incomplete: boolean;
}

/** What cancelling an order costs today, part by part. No rules = null. */
export function cancellationFeeToday(args: {
  rules: readonly CancellationRule[];
  departureStart: string;
  today: string;
  travelers: number;
  orderTotal: number;
}): CancelFeeToday | null {
  if (args.rules.length === 0) return null;
  const left = daysLeft(args.today, args.departureStart);
  const lines: CancelFeeLine[] = [];
  for (const component of CANCEL_COMPONENTS) {
    const windows = sortRules(args.rules.filter((r) => r.component === component));
    if (windows.length === 0) continue;
    const at = windows.findIndex((r) => r.untilDaysBefore === null || left >= r.untilDaysBefore);
    const rule = at >= 0 ? windows[at] : null;
    lines.push({
      component,
      rule,
      fee: rule ? ruleFee(rule, args.travelers, args.orderTotal) : null,
      until: rule ? ruleUntil(rule, args.departureStart) : null,
      next: at >= 0 ? (windows[at + 1] ?? null) : null,
    });
  }
  const total = Math.round(lines.reduce((sum, l) => sum + (l.fee ?? 0), 0) * 100) / 100;
  return { daysLeft: left, lines, total, incomplete: lines.some((l) => l.fee === null) };
}

/** A rule's fee in words: "$100 per passenger", "25% of the order". */
export function ruleFeeText(rule: Pick<CancellationRule, "feeKind" | "feeValue">, money: (n: number) => string): string {
  if (rule.feeKind === "percent") return `${rule.feeValue}% of the order`;
  return `${money(rule.feeValue)} ${CANCEL_FEE_KIND_LABELS[rule.feeKind]}`;
}
