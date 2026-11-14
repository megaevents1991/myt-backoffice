import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { logAudit } from "@/lib/audit";
import { DEFAULT_FROM, appOrigin, sendMail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { eventSiteUrl } from "@/lib/site";
import { siteCardPrice, type SiteCardPriceEvent } from "@/lib/package-price";
import { minAvailableTicketUsd } from "@/lib/services/price-light";
import { isMissingColumn } from "@/lib/services/reservation-follow-ups";
import {
  FEED_BASELINE_DAYS, FEED_JUMP_MIN_USD, FEED_PRICE_CEILING_USD, feedPriceVerdict, holdReasonText, needsAlert,
  nextGuard, parseFeedPriceGuard, storedGuard, usd, type FeedPriceGuard, type FeedPriceHold,
} from "@/lib/feed/price-guard";

/**
 * The feed's abnormal-price guard - the I/O around lib/feed/price-guard.ts (rules + why there).
 *
 * One pass: read every listed future event's price, judge the suspicious ones against their
 * snapshots, and
 *   - HOLD a new one: `feed_price_guard.hold`, `campaign_image_url` + `campaign_input_hash` cleared
 *     (both of main's feeds leave an event with no creative out), `campaign_skip_reason` = why;
 *   - KEEP a held one out (a stale editor save or anything else that put the picture back is undone);
 *   - RELEASE one whose price is normal again (hash cleared, so the next creative run draws it anew);
 *   - mail staff once about every hold of an event still on sale.
 * Run before every feed publish (publishMetaFeeds), at the top of every creative run
 * (runCampaignCreatives) and for the one event of "push to feed now" / the forced redraw - so every
 * path that draws or publishes passes it. `dryRun` writes and mails nothing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const GUARD_EVENT_COLUMNS =
  "id,name,date,location,tags,tickets_and_rates,base_flight_price,base_hotel_price,event_additional_markup," +
  "markup_ticket,markup_flight,markup_hotel,package_mode,ticket_only_markup,ready_package_token,ready_package_mode," +
  "ready_package_price_usd,campaign_image_url,campaign_skip_reason";

type GuardEventRow = SiteCardPriceEvent & {
  id: number;
  name: string | null;
  date: string;
  location: { name?: string | null } | null;
  tags: string | null;
  campaign_image_url: string | null;
  campaign_skip_reason: string | null;
};

export type FeedGuardSummary = {
  /** false = the column is not there yet (a deploy ahead of its migration) - nothing was checked. */
  ready: boolean;
  checked: number;
  candidates: number;
  /** Held this pass. */
  held: number[];
  /** Still held. */
  kept: number[];
  /** Back to a normal price this pass. */
  released: number[];
  /** Staff were mailed about these. */
  alerted: number[];
  /** Every event held after the pass -> the reason it prints. */
  holds: Map<number, string>;
  alertError?: string;
  ms: number;
};

const followsCheapestTicket = (e: SiteCardPriceEvent): boolean =>
  !(e.ready_package_token && e.ready_package_mode === "live" && Number(e.ready_package_price_usd) > 0);

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

function alertRecipients(): string {
  const explicit = (process.env.NEXT_SECRET_FEED_PRICE_ALERT_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = explicit.length ? explicit : [DEFAULT_FROM, process.env.NEXT_SECRET_ADMIN_EMAIL?.trim() ?? ""];
  return [...new Set(list.filter(Boolean))].join(", ");
}

/** The held / approved rows. null = the column does not exist yet. */
async function readGuards(ids?: number[]): Promise<Map<number, FeedPriceGuard> | null> {
  let q = db.from("events").select("id,feed_price_guard").not("feed_price_guard", "is", null);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.limit(5000);
  if (error) {
    if (isMissingColumn(error)) return null;
    throw new Error(`feed price guard read failed: ${error.message ?? JSON.stringify(error)}`);
  }
  const map = new Map<number, FeedPriceGuard>();
  for (const row of (data ?? []) as { id: number; feed_price_guard: unknown }[]) {
    map.set(row.id, parseFeedPriceGuard(row.feed_price_guard));
  }
  return map;
}

async function readEvents(today: string, ids?: number[]): Promise<GuardEventRow[]> {
  const { rows, error } = await fetchPaged<GuardEventRow>(() => {
    let q = db
      .from("events")
      .select(GUARD_EVENT_COLUMNS)
      .is("is_deleted", null)
      .eq("is_hidden", false)
      .gte("date", today)
      .order("id", { ascending: true });
    if (ids) q = q.in("id", ids);
    return q;
  }, 10_000);
  if (error) throw new Error(`feed price guard events read failed: ${error.message}`);
  return rows;
}

/** The cheapest ticket of each of the last FEED_BASELINE_DAYS days before today, per event. */
async function readHistory(ids: number[], today: string): Promise<Map<number, number[]>> {
  const since = isoDay(new Date(Date.parse(`${today}T00:00:00.000Z`) - FEED_BASELINE_DAYS * 86_400_000));
  const out = new Map<number, number[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("event_price_snapshots")
        .select("event_id,day,min_ticket")
        .in("event_id", chunk)
        .gte("day", since)
        .lt("day", today)
        .order("event_id", { ascending: true })
        .order("day", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`feed price guard snapshots read failed: ${error.message}`);
      const page = (data ?? []) as { event_id: number; min_ticket: number | null }[];
      for (const row of page) {
        if (row.min_ticket == null) continue;
        const list = out.get(row.event_id) ?? [];
        list.push(Number(row.min_ticket));
        out.set(row.event_id, list);
      }
      if (page.length < 1000) break;
    }
  }
  return out;
}

async function updateEventRow(id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("events").update(patch).eq("id", id);
  if (error) throw new Error(`feed price guard write for event ${id} failed: ${error.message ?? JSON.stringify(error)}`);
}

const dmy = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

function alertMail(rows: { event: GuardEventRow; hold: FeedPriceHold }[]): { subject: string; html: string } {
  const first = rows[0].event;
  const subject =
    rows.length === 1
      ? `מחיר חריג: ${(first.name ?? "").trim()} ${dmy(first.date)} ירד מהפיד של מטא`
      : `מחיר חריג: ${rows.length} אירועים ירדו מהפיד של מטא`;
  const items = rows
    .map(({ event, hold }) => {
      const why =
        hold.reason === "ceiling"
          ? `מעל התקרה של ${usd(FEED_PRICE_CEILING_USD)} לנוסע`
          : `הכרטיס הזול קפץ ל-${usd(hold.ticket_usd ?? 0)} (רגיל ~${usd(hold.baseline_usd ?? 0)})`;
      const ticket = hold.ticket_usd != null ? ` · הכרטיס הזול שבמכירה ${usd(hold.ticket_usd)}` : "";
      return (
        `<li style="margin-bottom:12px"><b>${escapeHtml((event.name ?? "").trim())}</b> · ` +
        `${escapeHtml(dmy(event.date))} · ${escapeHtml((event.location?.name ?? "").trim())}<br>` +
        `מחיר באתר ${usd(hold.card_usd)} לנוסע${ticket}<br>${escapeHtml(why)}<br>` +
        `<a href="${escapeHtml(`${appOrigin()}/events/${event.id}`)}">לעורך האירוע</a> · ` +
        `<a href="${escapeHtml(eventSiteUrl(event.id))}">לאירוע באתר</a></li>`
      );
    })
    .join("");
  const html =
    `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px">` +
    `<p>המחיר של האירועים האלה נראה חריג, ולכן הם ירדו מהפיד של מטא (המודעות לא יציגו אותם):</p>` +
    `<ul>${items}</ul>` +
    `<p>מה עושים:<br>` +
    `• אם זה הכרטיס היחיד שנשאר - לסמן Sold בעורך האירוע.<br>` +
    `• אם המחיר נכון ורוצים לפרסם אותו - "המחיר נכון" בעורך האירוע, ליד "העלה לפיד עכשיו".<br>` +
    `• כשהמחיר חוזר לרגיל, האירוע חוזר לפיד לבד.</p>` +
    `<p style="color:#888">חריג = מעל ${usd(FEED_PRICE_CEILING_USD)} לנוסע, או כרטיס זול שקפץ פי 2.5 ובלפחות ` +
    `${usd(FEED_JUMP_MIN_USD)} מעל הרגיל שלו ב-${FEED_BASELINE_DAYS} הימים האחרונים.</p></div>`;
  return { subject, html };
}

export async function runFeedPriceGuard(
  options: { ids?: number[]; dryRun?: boolean; now?: Date } = {},
): Promise<FeedGuardSummary> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const today = isoDay(now);
  const dryRun = options.dryRun === true;
  const summary: FeedGuardSummary = {
    ready: true, checked: 0, candidates: 0, held: [], kept: [], released: [], alerted: [], holds: new Map(), ms: 0,
  };

  let guards = await readGuards(options.ids);
  if (!guards) {
    summary.ready = false;
    // Before the migration nothing can be stored: a real pass stops here; a dry run still judges.
    if (!dryRun) {
      summary.ms = Date.now() - started;
      return summary;
    }
    guards = new Map();
  }
  const events = await readEvents(today, options.ids);
  summary.checked = events.length;

  const priced = events.map((event) => ({
    event,
    cardUsd: siteCardPrice(event),
    ticketUsd: minAvailableTicketUsd(event as unknown as Parameters<typeof minAvailableTicketUsd>[0]),
    guard: guards.get(event.id) ?? { hold: null, approved: null },
  }));
  const candidates = priced.filter(
    (p) =>
      p.guard.hold ||
      p.guard.approved ||
      (p.cardUsd != null && p.cardUsd > FEED_PRICE_CEILING_USD) ||
      (p.ticketUsd ?? 0) >= FEED_JUMP_MIN_USD,
  );
  summary.candidates = candidates.length;
  const history = candidates.length ? await readHistory(candidates.map((p) => p.event.id), today) : new Map();

  const toAlert: { event: GuardEventRow; hold: FeedPriceHold; guard: FeedPriceGuard }[] = [];
  for (const p of candidates) {
    const { event, cardUsd, ticketUsd, guard } = p;
    const verdict = feedPriceVerdict({
      cardUsd,
      ticketUsd,
      ticketDriven: followsCheapestTicket(event),
      history: history.get(event.id) ?? [],
      guard,
    });
    const step = nextGuard(guard, verdict, { now: nowIso, cardUsd, ticketUsd });
    const stored = storedGuard(step.next);

    if (step.change === "hold" || step.change === "keep") {
      const hold = step.next.hold as FeedPriceHold;
      const reason = holdReasonText(hold);
      summary.holds.set(event.id, reason);
      (step.change === "hold" ? summary.held : summary.kept).push(event.id);
      if (!dryRun) {
        const patch: Record<string, unknown> = {};
        if (step.change === "hold" || JSON.stringify(stored) !== JSON.stringify(storedGuard(guard))) {
          patch.feed_price_guard = stored;
        }
        if (event.campaign_image_url) {
          patch.campaign_image_url = null;
          patch.campaign_input_hash = null;
        }
        if (event.campaign_skip_reason !== reason) patch.campaign_skip_reason = reason;
        // A failed hold THROWS: the caller (a publish) must not ship the event at that price.
        if (Object.keys(patch).length) await updateEventRow(event.id, patch);
        if (step.change === "hold") {
          await logAudit({
            action: "feed.price_held",
            entityType: "event",
            entityId: event.id,
            metadata: {
              reason: hold.reason,
              card_usd: hold.card_usd,
              ticket_usd: hold.ticket_usd,
              baseline_usd: hold.baseline_usd,
              creative_was: event.campaign_image_url,
            },
          });
        }
      }
      if (needsAlert(step.next, (event.tags ?? "") === "Sold")) toAlert.push({ event, hold, guard: step.next });
    } else if (step.change === "release") {
      summary.released.push(event.id);
      if (!dryRun) {
        try {
          // The hash goes too, so the next creative run draws the event at its normal price.
          await updateEventRow(event.id, { feed_price_guard: stored, campaign_input_hash: null, campaign_skip_reason: null });
          await logAudit({
            action: "feed.price_released",
            entityType: "event",
            entityId: event.id,
            metadata: { card_usd: cardUsd, ticket_usd: ticketUsd },
          });
        } catch (e) {
          // Released late is harmless - it stays out one pass longer.
          console.error("[feed-price-guard] release failed:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  if (toAlert.length) {
    if (dryRun) {
      summary.alerted = toAlert.map((a) => a.event.id);
    } else {
      try {
        const mail = alertMail(toAlert);
        await sendMail({ to: alertRecipients(), subject: mail.subject, html: mail.html });
        for (const a of toAlert) {
          const next = { ...a.guard, hold: { ...(a.guard.hold as FeedPriceHold), alerted_at: nowIso } };
          try {
            await updateEventRow(a.event.id, { feed_price_guard: storedGuard(next) });
            summary.alerted.push(a.event.id);
          } catch (e) {
            console.error("[feed-price-guard] alert stamp failed:", e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        // Not stamped - the next pass mails again.
        summary.alertError = e instanceof Error ? e.message : String(e);
        console.error("[feed-price-guard] alert mail failed:", summary.alertError);
      }
    }
  }

  summary.ms = Date.now() - started;
  if (summary.held.length || summary.released.length || summary.alerted.length || summary.alertError) {
    console.log(
      `[feed-price-guard] checked=${summary.checked} candidates=${summary.candidates} held=${summary.held.join(",") || "-"} ` +
        `kept=${summary.kept.join(",") || "-"} released=${summary.released.join(",") || "-"} alerted=${summary.alerted.join(",") || "-"}` +
        `${dryRun ? " (dry run)" : ""} ${summary.ms}ms`,
    );
  }
  return summary;
}

/** One event's stored hold, for a draw that did not run the pass (null = not held, or no column yet). */
export async function storedHoldReason(eventId: number): Promise<string | null> {
  const { data, error } = await db.from("events").select("feed_price_guard").eq("id", eventId).maybeSingle();
  if (error) {
    if (!isMissingColumn(error)) console.error("[feed-price-guard] hold read failed:", JSON.stringify(error));
    return null;
  }
  const hold = parseFeedPriceGuard((data as { feed_price_guard?: unknown } | null)?.feed_price_guard).hold;
  return hold ? holdReasonText(hold) : null;
}

export type ApproveHoldResult =
  | { ok: true; cardUsd: number; heldReason: string }
  | { ok: false; kind: "not_ready" | "not_found" | "not_held" | "no_price"; error: string };

/**
 * "The price is right" (the editor, an admin): lift the event's hold and approve its CURRENT card
 * price - the guard lets that price through while it moves less than FEED_APPROVAL_TOLERANCE. The
 * hash is cleared, so the next draw prints it; the caller then pushes the event to the feed.
 */
export async function approveFeedPriceHold(eventId: number, by: string): Promise<ApproveHoldResult> {
  const { data, error } = await db
    .from("events")
    .select(`${GUARD_EVENT_COLUMNS},feed_price_guard`)
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return { ok: false, kind: "not_ready", error: "The price check is not installed yet" };
    throw new Error(`feed price approval read failed: ${error.message ?? JSON.stringify(error)}`);
  }
  if (!data) return { ok: false, kind: "not_found", error: "Event not found" };
  const row = data as GuardEventRow & { feed_price_guard: unknown };
  const guard = parseFeedPriceGuard(row.feed_price_guard);
  if (!guard.hold) return { ok: false, kind: "not_held", error: "האירוע לא מוחזק מחוץ לפיד" };
  const cardUsd = siteCardPrice(row);
  if (cardUsd == null) return { ok: false, kind: "no_price", error: "אין לאירוע מחיר כרגע" };
  const heldReason = holdReasonText(guard.hold);
  await updateEventRow(eventId, {
    feed_price_guard: storedGuard({ hold: null, approved: { card_usd: cardUsd, by, at: new Date().toISOString() } }),
    campaign_input_hash: null,
    campaign_skip_reason: null,
  });
  await logAudit({
    action: "feed.price_approved",
    entityType: "event",
    entityId: eventId,
    metadata: { card_usd: cardUsd, held: guard.hold },
  });
  return { ok: true, cardUsd, heldReason };
}
