"use server";

/**
 * The daily exchange rate a tours company types in by hand (functional spec 5.7).
 * One rate per company, day and currency, always "1 unit of the currency in shekels".
 * When today's rate was not entered, the last one entered stays in force - the
 * screen says so loudly.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { isDateOnly, todayIso } from "@/lib/tours/deadlines";
import { CURRENCIES, type CompanyExchangeRate, type TourCurrency } from "@/types/tours.types";
import type { ToursResult } from "@/lib/actions/tours-flight-actions";
import { dbFail as databaseFail, plainFail as fail } from "@/lib/tours/action-kit";

const dbFail = (where: string, error: unknown) => databaseFail("tours-rates-actions", where, error);

export interface TourRateStatus {
  currency: TourCurrency;
  /** Today's rate, when it was entered. */
  today: number | null;
  /** The newest rate on or before today - the one in force. null = never entered. */
  inForce: { rate: number; rate_date: string } | null;
}

export interface TourRateHistoryRow extends CompanyExchangeRate {
  entered_by_name: string | null;
}

export interface TourRatesData {
  /** `yyyy-mm-dd` in the operators' timezone. */
  today: string;
  currencies: TourRateStatus[];
  /** Currencies with no rate for today. */
  missingToday: TourCurrency[];
  /** Newest first, capped at HISTORY_MAX rows. */
  history: TourRateHistoryRow[];
  historyTruncated: boolean;
}

const HISTORY_MAX = 300;

export async function getTourRates(): Promise<ToursResult<TourRatesData>> {
  const { company } = await requireCompany("tours");
  const today = todayIso();

  // The rate in force per currency: one tiny query each, so a long history never hides it.
  const latest = await Promise.all(
    CURRENCIES.map((currency) =>
      supabaseTyped
        .from("company_exchange_rates")
        .select("rate_date,rate_to_ils")
        .eq("company_id", company.id)
        .eq("currency", currency)
        .lte("rate_date", today)
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  const failed = latest.find((r) => r.error);
  if (failed?.error) return dbFail("latest", failed.error);

  const currencies: TourRateStatus[] = CURRENCIES.map((currency, i) => {
    const row = latest[i].data;
    return {
      currency,
      today: row && row.rate_date === today ? Number(row.rate_to_ils) : null,
      inForce: row ? { rate: Number(row.rate_to_ils), rate_date: row.rate_date } : null,
    };
  });

  const { data: history, error } = await supabaseTyped
    .from("company_exchange_rates")
    .select("*")
    .eq("company_id", company.id)
    .order("rate_date", { ascending: false })
    .order("currency", { ascending: true })
    .limit(HISTORY_MAX + 1);
  if (error) return dbFail("history", error);
  const rows = history ?? [];

  const userIds = [...new Set(rows.map((r) => r.entered_by).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await supabaseTyped
      .from("user_profiles")
      .select("id,display_name,email")
      .in("id", userIds);
    if (usersError) console.error("tours-rates-actions: users read failed", JSON.stringify(usersError));
    for (const u of users ?? []) names.set(u.id, u.display_name?.trim() || u.email);
  }

  return {
    success: true,
    data: {
      today,
      currencies,
      missingToday: currencies.filter((c) => c.today === null).map((c) => c.currency),
      history: rows
        .slice(0, HISTORY_MAX)
        .map((r) => ({ ...r, entered_by_name: r.entered_by ? (names.get(r.entered_by) ?? null) : null })),
      historyTruncated: rows.length > HISTORY_MAX,
    },
  };
}

/** Enters (or corrects) the rate of one currency for one day. The day defaults to today. */
export async function saveTourRate(input: {
  currency: string;
  rate: number;
  date?: string | null;
}): Promise<ToursResult> {
  const { session, company } = await requireCompany("tours");
  if (!(CURRENCIES as readonly string[]).includes(input.currency)) return fail("מטבע לא מוכר");
  if (typeof input.rate !== "number" || !Number.isFinite(input.rate) || input.rate <= 0) {
    return fail("השער חייב להיות מספר גדול מאפס");
  }
  if (input.rate > 100) return fail("השער נראה שגוי: הזינו כמה שקלים שווה יחידה אחת של המטבע");
  const today = todayIso();
  const date = input.date || today;
  if (!isDateOnly(date)) return fail("תאריך לא תקין");
  if (date > today) return fail("אי אפשר להזין שער לתאריך עתידי");

  const rate = Math.round(input.rate * 10_000) / 10_000;
  const { error } = await supabaseTyped.from("company_exchange_rates").upsert(
    {
      company_id: company.id,
      rate_date: date,
      currency: input.currency,
      rate_to_ils: rate,
      entered_by: session.sub,
    },
    { onConflict: "company_id,rate_date,currency" },
  );
  if (error) return dbFail("save", error);

  await logAudit({
    action: "tours.rate.save",
    entityType: "company_exchange_rate",
    entityId: `${date}:${input.currency}`,
    changes: { currency: input.currency, rate_date: date, rate_to_ils: rate },
    metadata: { company_id: company.id },
  });
  return { success: true, data: null };
}
