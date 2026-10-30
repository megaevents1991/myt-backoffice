/**
 * The hourly check behind "a date opened on a tour a card waits for" (Alon 30.10). The rules and one tick are pure in
 * lib/tours/waitlist-dates.ts; this file is their reads and writes. Session-free: the cron toursWaitlistDates calls it.
 * Until the company's number is connected and the template approved, a card still moves and prints why no message went
 * out, and the rep has the text ready for their own WhatsApp.
 *
 * `dryRun` = the full report (case numbers and date codes only), no write, no send, no mail.
 * `TOURS_WAITLIST_WHATSAPP=off` stops the sends and leaves the cards moving.
 */
import { randomBytes } from "node:crypto";
import { logAudit } from "@/lib/audit";
import type { Company } from "@/lib/company";
import { sendMail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { companyById, listTemplates } from "@/lib/services/whatsapp-db";
import { resolveSender, sendTemplate } from "@/lib/services/whatsapp-cloud";
import { fetchPaged } from "@/lib/supabase-paged";
import { supabaseTyped } from "@/lib/supabase-server";
import { readCaseStatuses } from "@/lib/tours/case-seats";
import { DATE_OPENED_STATUS, WAITLIST_STATUS, phoneKey, splitName, statusOf, whatsappPhone, type RouteCard } from "@/lib/tours/cases";
import { companyAudit } from "@/lib/tours/company-kit";
import { toursDb } from "@/lib/tours/db";
import { todayIso } from "@/lib/tours/deadlines";
import {
  WAITLIST_TEMPLATE_DEFAULT,
  WAITLIST_TEMPLATE_LANGUAGE,
  approvedTemplateBlock,
  hasOtherOpenCard,
  isKnownContact,
  isMorningTick,
  runWaitlistTick,
  siteDateOf,
  type DateOpenedNote,
  type SiteDate,
  type SiteDateRow,
  type TickDeps,
  type TickResult,
  type WaitingCard,
} from "@/lib/tours/waitlist-dates";
import type { Json } from "@/types/database.types";

const SCOPE = "tours-waitlist-dates";
/** A tick's share of the route's 60 s; past it the rest wait for the next hour. */
const BUDGET_MS = 45_000;
/** A list of ids in a filter travels in the URL: keep it short. */
const IN_CHUNK = 100;
const DATES_MAX = 5_000;
const CARDS_MAX = 5_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const chunk = <T,>(rows: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};
const templateName = (): string => process.env.NEXT_SECRET_WHATSAPP_WAITLIST_TEMPLATE?.trim() || WAITLIST_TEMPLATE_DEFAULT;

const DATE_COLUMNS =
  "id, code, package_id, start_date, sale_status, legacy_product_id, site_id, waitlist:data->waitlist, price_offer:data->priceOffer, price_regular:data->priceRegular, packages(name, slug, is_active, is_deleted, path:data->>path, stub:data->stub)";

/**
 * Every date the site could show: published, not deleted, not past - with its seats and its double-room price. It reads
 * in pages and THROWS past the cap: a date missing from this list would read as closed, and come back later as "opened".
 */
async function readSiteDates(company: Company, today: string): Promise<SiteDate[]> {
  const { rows, truncated, error } = await fetchPaged<SiteDateRow>(
    () =>
      toursDb()
        .from("departures")
        .select(DATE_COLUMNS)
        .eq("company_id", company.id)
        .eq("is_published", true)
        .is("is_deleted", null)
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .order("id", { ascending: true }),
    DATES_MAX,
  );
  if (error) throw new Error(`departures: ${error.message}`);
  if (truncated) throw new Error(`departures: more than ${DATES_MAX} upcoming dates`);

  const priced = new Set<string>();
  const seats = new Map<string, { allocated: number; remaining: number }>();
  await Promise.all(
    chunk(rows.map((d) => d.id), IN_CHUNK).map(async (part) => {
      const [prices, stats] = await Promise.all([
        // the site prices a date by its double room (mega-family lib/data/departures.mjs: matrix["adult:2"]): one row a date
        toursDb().from("departure_prices").select("departure_id, price").eq("company_id", company.id).eq("pax_type", "adult").eq("room_position", 2).in("departure_id", part),
        toursDb().from("departure_stats").select("departure_id, allocated_seats, remaining").eq("company_id", company.id).in("departure_id", part),
      ]);
      if (prices.error) throw new Error(`departure_prices: ${prices.error.message}`);
      if (stats.error) throw new Error(`departure_stats: ${stats.error.message}`);
      for (const p of prices.data ?? []) if (p.price != null) priced.add(p.departure_id);
      for (const s of stats.data ?? []) if (s.departure_id) seats.set(s.departure_id, { allocated: s.allocated_seats ?? 0, remaining: s.remaining ?? 0 });
    }),
  );
  return rows.map((row) => siteDateOf(row, { doublePriced: priced.has(row.id), seats: seats.get(row.id) ?? { allocated: 0, remaining: 0 } }));
}

type CardRow = {
  id: string;
  case_no: number;
  package_id: string | null;
  departure_id: string | null;
  waitlist_since: string | null;
  first_name: string | null;
  name: string | null;
  phone: string | null;
  customer_id: string | null;
  link_token: string | null;
  no_auto_message: boolean | null;
};

/** What the block rules read about the customers behind these cards. A failed read throws: never send past an opt-out. */
async function customerFacts(company: Company, rows: readonly CardRow[], today: string) {
  const customers = new Map<string, { consent: string; phoneKeys: string[]; lastInAt: string | null }>();
  const optedOut = new Set<string>();
  const others = new Map<string, (RouteCard & { customerId: string })[]>();
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((id): id is string => !!id))];
  const keys = [...new Set(rows.map((r) => phoneKey(r.phone)).filter(Boolean))];

  await Promise.all([
    ...chunk(customerIds, IN_CHUNK).map(async (part) => {
      const { data, error } = await supabaseTyped.from("customers").select("id, wa_consent, phone_keys, wa_last_in_at").in("id", part);
      if (error) throw new Error(`customers: ${error.message}`);
      for (const c of data ?? []) customers.set(c.id, { consent: c.wa_consent, phoneKeys: c.phone_keys ?? [], lastInAt: c.wa_last_in_at });
    }),
    // by number, deleted rows too: a merge leaves the opt-out on the merged row, a move carries the phone to another customer
    ...chunk(keys, IN_CHUNK).map(async (part) => {
      const { data, error } = await supabaseTyped.from("customers").select("phone_keys").eq("company_id", company.id).eq("wa_consent", "opted_out").overlaps("phone_keys", part);
      if (error) throw new Error(`customers: ${error.message}`);
      for (const c of data ?? []) for (const k of c.phone_keys ?? []) optedOut.add(k);
    }),
    ...chunk(customerIds, IN_CHUNK).map(async (part) => {
      const { data, error } = await supabaseTyped
        .from("leads")
        .select("id, customer_id, package_id, status, to_file, departure_id, created_at")
        .eq("company_id", company.id)
        .in("customer_id", part)
        .neq("status", WAITLIST_STATUS)
        .is("is_deleted", null);
      if (error) throw new Error(`leads: ${error.message}`);
      const depIds = [...new Set((data ?? []).map((l) => l.departure_id).filter((id): id is string => !!id))];
      const starts = new Map<string, string>();
      for (const ids of chunk(depIds, IN_CHUNK)) {
        const { data: deps, error: depError } = await toursDb().from("departures").select("id, start_date").eq("company_id", company.id).in("id", ids);
        if (depError) throw new Error(`departures: ${depError.message}`);
        for (const d of deps ?? []) starts.set(d.id, d.start_date);
      }
      for (const l of data ?? []) {
        if (!l.customer_id) continue;
        const list = others.get(l.customer_id) ?? [];
        list.push({ id: l.id, customerId: l.customer_id, packageId: l.package_id, status: l.status, toFile: !!l.to_file, departureStart: l.departure_id ? (starts.get(l.departure_id) ?? null) : null, createdAt: l.created_at });
        others.set(l.customer_id, list);
      }
    }),
  ]);
  const statuses = others.size ? await readCaseStatuses(company) : [];
  return (r: CardRow) => {
    const customer = r.customer_id ? customers.get(r.customer_id) : undefined;
    return {
      consent: optedOut.has(phoneKey(r.phone)) ? "opted_out" : (customer?.consent ?? null),
      customerPhoneKeys: customer?.phoneKeys ?? null,
      otherCardOnTour: r.customer_id ? hasOtherOpenCard({ id: r.id, packageId: r.package_id }, others.get(r.customer_id) ?? [], statuses, today) : false,
      knownContact: isKnownContact(customer?.consent ?? null, customer?.lastInAt ?? null),
    };
  };
}

/** The cards on the list, the longest wait first. In pages, and past the cap it THROWS rather than skip someone. */
async function readWaitingCards(company: Company, today: string): Promise<WaitingCard[]> {
  const { rows, truncated, error } = await fetchPaged<CardRow>(
    () =>
      supabaseTyped
        .from("leads")
        .select("id, case_no, package_id, departure_id, waitlist_since, first_name, name, phone, customer_id, link_token, no_auto_message")
        .eq("company_id", company.id)
        .eq("status", WAITLIST_STATUS)
        .not("to_file", "is", true)
        .is("is_deleted", null)
        .order("waitlist_since", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true }),
    CARDS_MAX,
  );
  if (error) throw new Error(`leads: ${error.message}`);
  if (truncated) throw new Error(`leads: more than ${CARDS_MAX} cards on the waiting list`);
  if (rows.length === 0) return [];
  const facts = await customerFacts(company, rows, today);
  return rows.map((r) => ({
    id: r.id,
    caseNo: r.case_no,
    packageId: r.package_id,
    departureId: r.departure_id,
    waitlistSince: r.waitlist_since,
    firstName: r.first_name ?? splitName(r.name).first,
    phone: r.phone,
    customerId: r.customer_id,
    linkToken: r.link_token,
    burstHeld: !!r.no_auto_message,
    ...facts(r),
  }));
}

function depsFor(company: Company, now: Date, today: string): TickDeps {
  const watch = () => toursDb().from("departure_open_watch");
  return {
    readDates: () => readSiteDates(company, today),
    readWatch: async () => {
      const { data, error } = await watch().select("departure_id, open_seen_at").eq("company_id", company.id);
      if (error) throw new Error(`departure_open_watch: ${error.message}`);
      return new Map((data ?? []).map((r) => [r.departure_id, r.open_seen_at]));
    },
    stamp: async (ids) => {
      const rows = ids.map((id) => ({ departure_id: id, company_id: company.id, open_seen_at: now.toISOString() }));
      const { error } = await watch().upsert(rows, { onConflict: "departure_id", ignoreDuplicates: true });
      if (error) throw new Error(`departure_open_watch: ${error.message}`);
    },
    clear: async (ids) => {
      for (const part of chunk(ids, IN_CHUNK)) {
        const { error } = await watch().delete().eq("company_id", company.id).in("departure_id", part);
        if (error) throw new Error(`departure_open_watch: ${error.message}`);
      }
    },
    readCards: () => readWaitingCards(company, today),
    hasStatus: async () => !!statusOf(DATE_OPENED_STATUS, await readCaseStatuses(company)),
    movedLastHour: async () => {
      const { count, error } = await supabaseTyped
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .gte("date_opened->>at", new Date(now.getTime() - HOUR_MS).toISOString());
      if (error) throw new Error(`leads: ${error.message}`);
      return count ?? 0;
    },
    firstContactsLastDay: async () => {
      const { count, error } = await supabaseTyped
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("date_opened->>firstContact", "true")
        .eq("date_opened->>whatsapp", "sent")
        .gte("date_opened->>at", new Date(now.getTime() - DAY_MS).toISOString());
      if (error) throw new Error(`leads: ${error.message}`);
      return count ?? 0;
    },
    senderProblem: async () => {
      if (process.env.TOURS_WAITLIST_WHATSAPP === "off") return "Sending this message is switched off.";
      const sender = await resolveSender(company);
      return "error" in sender ? sender.error : null;
    },
    templateProblem: async () => approvedTemplateBlock(await listTemplates(company.id), templateName()),
    newToken: () => randomBytes(24).toString("base64url"),
    claim: async (card, move) => {
      const { data, error } = await supabaseTyped
        .from("leads")
        .update({ status: DATE_OPENED_STATUS, follow_up_date: move.followUpDate, link_token: move.token, date_opened: move.note as unknown as Json })
        .eq("company_id", company.id)
        .eq("id", card.id)
        .eq("status", WAITLIST_STATUS)
        .is("is_deleted", null)
        .select("id");
      if (error) throw new Error(`leads: ${error.message}`);
      return (data ?? []).length > 0;
    },
    send: async (card, params) => {
      const to = whatsappPhone(card.phone);
      if (!to) return { ok: false, error: "The card has no valid phone number." };
      const answer = await sendTemplate(company, {
        to,
        template: templateName(),
        language: WAITLIST_TEMPLATE_LANGUAGE,
        params,
        origin: "automation",
        customerId: card.customerId,
        caseId: card.id,
      });
      return answer.ok ? { ok: true } : { ok: false, error: answer.error };
    },
    record: async (card, note: DateOpenedNote) => {
      const { error } = await supabaseTyped
        .from("leads")
        .update({ date_opened: note as unknown as Json, ...(note.whatsapp === "sent" ? { link_sent_at: note.at } : {}) })
        .eq("company_id", company.id)
        .eq("id", card.id);
      if (error) throw new Error(`leads: ${error.message}`);
    },
    audit: async (card, note: DateOpenedNote) => {
      await logAudit({
        action: "tours_case.date_opened",
        entityType: "tours_case",
        entityId: card.id,
        metadata: { ...companyAudit(company), case_no: card.caseNo, departure_id: note.departureId, whatsapp: note.whatsapp, why: note.why },
      });
    },
  };
}

export interface WaitlistDatesSummary {
  dryRun: boolean;
  today: string;
  companies: ({ slug: string } & TickResult)[];
  errors: string[];
}

/** A card stuck on the list reaches nobody by itself: one mail a morning while anything is wrong. Never fails the run. */
async function mailFailures(summary: WaitlistDatesSummary): Promise<void> {
  const lines = [...summary.errors, ...summary.companies.flatMap((c) => [c.problem, ...c.errors].filter(Boolean).map((line) => `${c.slug}: ${line}`))];
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (lines.length === 0 || !to) return;
  try {
    await sendMail({
      to,
      subject: `Waiting-list check: ${lines.length} problem(s)`,
      html: `<p>The hourly check of the tours waiting lists has problems, so cards may be sitting on the list:</p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
    });
  } catch (e) {
    console.error(`${SCOPE}: failure mail not sent:`, e instanceof Error ? e.message : e);
  }
}

export async function runWaitlistDates(options: { dryRun: boolean; now?: Date }): Promise<WaitlistDatesSummary> {
  const now = options.now ?? new Date();
  const today = todayIso();
  const summary: WaitlistDatesSummary = { dryRun: options.dryRun, today, companies: [], errors: [] };
  const { data, error } = await supabaseTyped.from("companies").select("id").contains("product_types", ["tours"]);
  if (error) throw new Error(`companies: ${error.message}`);
  const deadline = Date.now() + BUDGET_MS;
  for (const { id } of data ?? []) {
    try {
      const company = await companyById(id);
      if (!company) continue;
      const result = await runWaitlistTick(depsFor(company, now, today), { now, today, siteUrl: company.siteUrl, dryRun: options.dryRun, deadline });
      summary.companies.push({ slug: company.slug, ...result });
    } catch (e) {
      // one company failing never holds up the next, and the migration not applied yet lands here too
      const message = e instanceof Error ? e.message : "failed";
      console.error(`${SCOPE}: company ${id} failed:`, message);
      summary.errors.push(`${id}: ${message}`);
    }
  }
  if (!options.dryRun && isMorningTick(now)) await mailFailures(summary);
  return summary;
}
