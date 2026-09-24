// Nightly price-light pass (spec §6.2): snapshot + price-drop tag for every
// live future event, refresh the LiveTickets table listings, then match
// everything, recompute lights, revalidate main once if anything changed, and
// mail a summary.
//
// Two passes over the same event set, both sharing one wall-clock budget
// (`options.budgetMs`, measured from the top of this function) so the whole
// run - LiveTickets refresh included - always fits inside the cron's
// maxDuration:
//  1. Snapshot + tag - least-recently-checked events first, SNAPSHOT_CONCURRENCY
//     at a time, and it stops early enough to leave pass 2 at least
//     MATCH_RESERVE_MS. It's one read + one upsert per event; a cutoff records
//     how many were skipped in `snapshotsRemaining` rather than silently
//     dropping the tail.
//  2. Match + recompute lights - same order, MATCH_CONCURRENCY events at a
//     time, same shared budget, so nothing is stranded behind a backlog when
//     time runs out.
// Both passes used to run one event at a time: pass 1 alone ate most of the
// window and pass 2 reached ~60 of 433 events a night, so a light went ~8 days
// between checks (2026-09-24).
// FOLLOW-UP runs (`followUp`, vercel.json `?followup=1`, later the same night): the same
// least-recently-checked queue, but no LiveTickets refresh and no second snapshot for an
// event pass 1 already wrote today - so nearly the whole window goes to the lights the
// first run did not reach. A follow-up mails only when a light moved to/from red or
// something failed; the steady-state summary is the first run's job.
// `writeSnapshotAndTag` and `recomputeEventLights` (via `matchAllForEvent`)
// both throw on write failure, so each pass wraps every event in its own
// try/catch - one event's DB failure never stops the batch.
import { supabase } from "@/lib/supabase-server";
import { appOrigin, sendMail } from "@/lib/email";
import { fetchPaged } from "@/lib/supabase-paged";
import { LIGHT_EVENT_COLUMNS, loadEventForLight, writeSnapshotAndTag, type LightEvent } from "@/lib/services/price-light-store";
import { openPriceLightTask } from "@/lib/services/price-light-tasks";
import { logAudit } from "@/lib/audit";
import { priceAdviceFacts } from "@/lib/services/price-advice";
import { wordAdvice } from "@/lib/services/price-advisor";
import { matchAllForEvent, type AiBudget } from "@/lib/services/price-light-match";
import { PRICE_ADVISOR_AGENT, PRICE_LIGHT_AGENT, agentEnabled, loadAgentMemory } from "@/lib/agents";
import { newBudget, type AgentBudget } from "@/lib/agents/switch";
import { AI_CALLS_PER_RUN, aiEnabled } from "@/lib/services/price-light-judge";
import { loadJudgeMemory } from "@/lib/services/price-light-memory";
import { runCrawl } from "@/lib/services/price-light-crawl";
import { LIGHTS, SCOPES, type Light, type LightDetail, type Scope } from "@/types/price-light.types";

/**
 * Rule C (2026-09-17): a scope that TURNED red tonight gets an unassigned task with the price
 * advisor's facts in it - a red light nobody has looked at is the failure this screen exists to
 * prevent. Only a transition opens one (a scope that was already red yesterday does not: on the
 * day this shipped 225 ticket lights were red, and 225 tasks overnight would have buried /tasks),
 * a muted event is skipped, and the ceiling keeps one bad night - a competitor's price collapse,
 * a parsing bug - from flooding the board. `openPriceLightTask` dedupes per (event, scope).
 */
export const AUTO_RED_TASKS_PER_RUN = 15;

// LiveTickets refresh is a table read (no crawling), so it should finish in
// seconds - but it defaults to the crawler's 240s budget, which alone would
// blow past this cron's 300s maxDuration before pass 1 even starts. Cap it.
const LIVETICKETS_REFRESH_BUDGET_MS = 60_000;
const REVALIDATE_TIMEOUT_MS = 10_000;
// Live future events can outgrow PostgREST's 1000-row page cap - never trust
// a single unpaged read for this table.
const EVENTS_LOAD_MAX_ROWS = 20_000;
/** Pass 1 is a read + an upsert per event - plain DB round trips, safe to overlap. */
export const SNAPSHOT_CONCURRENCY = 8;
/** Pass 2 events in flight at once - same as price-light-ours' OUR_OFFER_CONCURRENCY. Each one
 *  already fans out over its competitors, and the AI ceiling is the shared run-wide `aiBudget`
 *  (`takeBudget` decrements synchronously, so parallel events can never overspend it). */
export const MATCH_CONCURRENCY = 3;
/** Wall-clock pass 1 must leave for pass 2: the snapshots are nice to have, the lights are the job. */
export const MATCH_RESERVE_MS = 150_000;

/**
 * Run `work` over `items` in order, `concurrency` at a time, starting a new item only while
 * `keepGoing()` - the budget is checked before every START, as the old sequential loops did.
 * Returns how many items were started (the rest are what the budget left for the next run).
 * `work` must not throw: each pass wraps its own event in try/catch.
 */
async function runPool<T>(items: T[], concurrency: number, keepGoing: () => boolean, work: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && keepGoing()) {
      const item = items[next++];
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return next;
}

// New tables/columns predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface NightlySummary {
  scanned: number;
  snapshots: number;
  tagged: number;
  cleared: number;
  matched: number;
  lightChanges: { eventId: number; name: string; scope: Scope; from: Light | null; to: Light | null }[];
  /**
   * Resulting light per scope for EVERY event pass 2 processed (not only the ones
   * that moved) - `after`, keyed by scope then light. This is the "184 red tonight"
   * number `lightChanges` alone can't show, since most events never move.
   */
  lightCounts: { package: Record<Light, number>; ticket: Record<Light, number> };
  errors: { eventId: number; note: string }[];
  remaining: number;
  /** Events pass 1 (snapshot + tag) never reached before the shared budget ran out. */
  snapshotsRemaining: number;
  /** Judge calls this run actually spent, out of AI_CALLS_PER_RUN (0 on a dry run - never calls the AI). */
  aiCalls: number;
  /** Price-advisor calls this run actually spent, out of PRICE_ADVISOR_AGENT.callsPerRun (0 on a
   *  dry run and 0 while the agent is off - openAutoRedTasks itself never runs on a dry run). */
  advisorCalls: number;
  /** Tasks opened for scopes that turned red this run (0 on a dry run), and how many more hit the ceiling. */
  autoTasks: number;
  autoTasksSkipped: number;
  dryRun: boolean;
  /** A later run the same night (see the header): skipped the refresh and today's done snapshots. */
  followUp: boolean;
}

/** Never throws: a task that failed to open must not cost the event its light or the run its mail. */
async function openAutoRedTasks(
  eventId: number,
  scopes: Scope[],
  detail: LightDetail,
  summary: NightlySummary,
  advisorBudget: AgentBudget,
  advisorMemory: string | null,
): Promise<void> {
  try {
    // Re-read: the event in hand was loaded before tonight's recompute wrote its lights.
    const event = await loadEventForLight(eventId);
    if (!event || event.is_deleted) return;
    if (event.light_silenced_until && Date.parse(event.light_silenced_until) > Date.now()) return;
    const liveTicketsUsd = detail.ticket?.per_competitor?.livetickets?.normalized_usd ?? null;
    for (const scope of scopes) {
      const scopeDetail = detail[scope];
      if (!scopeDetail) continue;
      if (summary.autoTasks >= AUTO_RED_TASKS_PER_RUN) { summary.autoTasksSkipped += 1; continue; }
      // Take the slot BEFORE the awaits below and give it back unless a task was really opened -
      // events run in parallel (MATCH_CONCURRENCY), and a check here with the count after the
      // awaits would let two events pass the same last slot.
      summary.autoTasks += 1;
      let opened: Awaited<ReturnType<typeof openPriceLightTask>> | null = null;
      try {
        // `alt` = other travel days / suppliers quoted by the 02:40 pass (price-alternatives.ts). A
        // scope that turned red only tonight has none yet - its task gets the three older facts, and
        // the /price-light comparison shows the rest once they are quoted.
        const facts = priceAdviceFacts({ event, scope, detail: scopeDetail, liveTicketsUsd, alt: event.light_detail?.ours?.alt ?? null });
        const worded = await wordAdvice({ eventName: event.name, scope, facts, budget: advisorBudget, memory: advisorMemory });
        if (worded.ai) {
          // A source for the AI Factory log (spec: item 4) - the advisor has no per-call storage of
          // its own yet, so this audit row is the only trail one AI-worded suggestion leaves.
          await logAudit({
            action: "agent.advice", entityType: "event", entityId: eventId,
            metadata: { agent: "price-advisor", event_id: eventId, scope, cost_usd: worded.cost_usd },
          });
        }
        opened = await openPriceLightTask(event, scope, scopeDetail, [], { id: null }, worded.text);
        if (!opened.ok) summary.errors.push({ eventId, note: `auto task (${scope}): ${opened.error}` });
      } finally {
        if (!(opened?.ok && !opened.existed)) summary.autoTasks -= 1;
      }
    }
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    console.error(`price-light-nightly: auto task ${eventId} failed`, note);
    summary.errors.push({ eventId, note: `auto task: ${note}` });
  }
}

function emptyLightCounts(): Record<Light, number> {
  return Object.fromEntries(LIGHTS.map((l) => [l, 0])) as Record<Light, number>;
}

export async function runPriceLightNightly(options: { dryRun: boolean; budgetMs: number; followUp?: boolean }): Promise<NightlySummary> {
  const followUp = options.followUp === true;
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const summary: NightlySummary = {
    scanned: 0, snapshots: 0, tagged: 0, cleared: 0, matched: 0,
    lightChanges: [], lightCounts: { package: emptyLightCounts(), ticket: emptyLightCounts() },
    errors: [], remaining: 0, snapshotsRemaining: 0, aiCalls: 0, advisorCalls: 0, autoTasks: 0, autoTasksSkipped: 0, dryRun: options.dryRun,
    followUp,
  };

  // LiveTickets listings are a table read - refresh them every night before matching.
  // Budgeted well under the crawler's 240s default so it can never eat the whole
  // 300s cron window on its own before pass 1 gets a chance to run (finding I3).
  if (!followUp) try {
    await runCrawl("livetickets", options.dryRun ? "dry_run" : "schedule", {
      dryRun: options.dryRun, budgetMs: LIVETICKETS_REFRESH_BUDGET_MS,
    });
  } catch (e) {
    console.error("price-light-nightly: livetickets refresh failed", e instanceof Error ? e.message : e);
  }

  // Every live future event - is_deleted null, date >= today. Paged: PostgREST caps a
  // single response at 1000 rows, and this table only grows. `id` (not `date`) is the
  // secondary sort key because it's the only column guaranteed unique, which is what a
  // stable page boundary across repeated `.range()` calls needs.
  const { rows, truncated, error } = await fetchPaged<LightEvent>(
    () =>
      db
        .from("events")
        .select(LIGHT_EVENT_COLUMNS)
        .is("is_deleted", null)
        .gte("date", today)
        .order("light_checked_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true }),
    EVENTS_LOAD_MAX_ROWS,
  );
  if (error) {
    console.error("price-light-nightly: events load failed", JSON.stringify(error));
    return summary;
  }
  if (truncated) console.error("price-light-nightly: events load hit the paging cap - raise it");
  const events = rows.filter((e) => !e.is_test);
  // A follow-up leaves out what the first run already snapshotted today (a failed read = none
  // done: at worst an event is re-snapshotted, an idempotent upsert on (event_id, day)).
  const snapshotDone = followUp ? await snapshottedOn(today) : new Set<number>();
  const toSnapshot = events.filter((e) => !snapshotDone.has(e.id));

  // Pass 1: snapshot + price-drop tag, least-recently-checked first, cut off by the
  // shared budget - a run with enough events (plus the LiveTickets refresh above) could
  // otherwise blow past the cron's maxDuration before ever reaching pass 2 or the summary
  // email (finding I3). Anything not reached here is recorded, never silently dropped.
  // Stops by `budgetMs - MATCH_RESERVE_MS` (never below zero): pass 2 always gets its share.
  const snapshotDeadlineMs = Math.max(0, options.budgetMs - MATCH_RESERVE_MS);
  const snapshotStarted = await runPool(toSnapshot, SNAPSHOT_CONCURRENCY, () => Date.now() - start <= snapshotDeadlineMs, async (event) => {
    summary.scanned += 1;
    try {
      const snap = await writeSnapshotAndTag(event, today, { dryRun: options.dryRun });
      summary.snapshots += 1;
      if (snap.tagged) summary.tagged += 1;
      if (snap.cleared) summary.cleared += 1;
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      console.error(`price-light-nightly: snapshot ${event.id} failed`, note);
      summary.errors.push({ eventId: event.id, note: `snapshot: ${note}` });
    }
  });
  summary.snapshotsRemaining = toSnapshot.length - snapshotStarted;

  // Pass 2: match every competitor + recompute lights, least-recently-checked
  // first (the query order above), budgeted. ONE AI budget for the whole pass -
  // a judge call is ~12s the wall-clock check between events cannot see, so
  // without a ceiling a handful of AI-heavy events would eat the entire window
  // and strand everything behind them. A dry run passes `judge: null`: a report
  // must never spend money, and a dry run is exactly what gets pointed at prod.
  const aiBudget: AiBudget = newBudget(PRICE_LIGHT_AGENT);
  // The agent's memory - house rules generated from the engine's constants plus the notes staff
  // wrote when they overrode a light. Loaded ONCE for the whole pass (one audit-log read, not
  // one per event) and skipped entirely when nothing will call the AI anyway.
  const aiMemory = options.dryRun || !aiEnabled() ? null : await loadJudgeMemory();
  // Agent #2 (the price advisor) shares the same shape: one run-wide budget, one memory load,
  // skipped whenever nothing will call it - openAutoRedTasks itself never runs on a dry run
  // (see below), so building this unconditionally here just mirrors aiBudget/aiMemory above.
  const advisorBudget: AgentBudget = newBudget(PRICE_ADVISOR_AGENT);
  const advisorMemory = options.dryRun || !agentEnabled(PRICE_ADVISOR_AGENT) ? null : await loadAgentMemory(PRICE_ADVISOR_AGENT);
  const matchStarted = await runPool(events, MATCH_CONCURRENCY, () => Date.now() - start <= options.budgetMs, async (event) => {
    try {
      const result = await matchAllForEvent(event.id, "nightly", {
        dryRun: options.dryRun,
        judge: options.dryRun ? null : undefined,
        aiBudget,
        aiMemory,
      });
      if (!result) return;
      summary.matched += result.outcomes.filter((o) => o.wrote).length;
      const { before, after } = result.lights;
      if (after.package) summary.lightCounts.package[after.package] += 1;
      if (after.ticket) summary.lightCounts.ticket[after.ticket] += 1;
      // `changed` is a cheap early-out (both scopes unmoved -> skip entirely); once it's
      // true, compare each scope on its own so a package-only or ticket-only move doesn't
      // get attributed to the wrong scope (or both scopes logged when only one moved).
      if (result.lights.changed) {
        if (before.package !== after.package) {
          summary.lightChanges.push({ eventId: event.id, name: event.name, scope: "package", from: before.package, to: after.package });
        }
        if (before.ticket !== after.ticket) {
          summary.lightChanges.push({ eventId: event.id, name: event.name, scope: "ticket", from: before.ticket, to: after.ticket });
        }
        if (!options.dryRun) {
          const turnedRed = SCOPES.filter((scope) => after[scope] === "red" && before[scope] !== "red");
          if (turnedRed.length) await openAutoRedTasks(event.id, turnedRed, result.lights.detail, summary, advisorBudget, advisorMemory);
        }
      }
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      console.error(`price-light-nightly: match ${event.id} failed`, note);
      summary.errors.push({ eventId: event.id, note: `match: ${note}` });
    }
  });
  summary.remaining = events.length - matchStarted;
  summary.aiCalls = AI_CALLS_PER_RUN - aiBudget.remaining;
  summary.advisorCalls = PRICE_ADVISOR_AGENT.callsPerRun - advisorBudget.remaining;

  if (!options.dryRun) {
    if (summary.lightChanges.length || summary.tagged || summary.cleared) await revalidateMain();
    await sendSummaryEmail(summary);
  }
  return summary;
}

/** Event ids that already have a snapshot row for `day`. Paged by hand - the table has no `id`. */
async function snapshottedOn(day: string): Promise<Set<number>> {
  const done = new Set<number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("event_price_snapshots").select("event_id")
      .eq("day", day).order("event_id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { console.error("price-light-nightly: today's snapshots read failed", JSON.stringify(error)); return new Set(); }
    for (const r of (data ?? []) as { event_id: number }[]) done.add(r.event_id);
    if (!data || data.length < PAGE) return done;
  }
}

async function revalidateMain(): Promise<void> {
  // Mirrors app/api/revalidate/route.ts's target list and settle semantics exactly
  // (that route is customer-facing and stays untouched here): primary + parallel
  // targets, deduplicated, each fetched independently via Promise.allSettled so one
  // target's failure never blocks the other. This function never throws.
  const hotelServiceUrl = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const revalidationSecret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!hotelServiceUrl || !revalidationSecret) return;
  const parallelServiceUrl =
    process.env.NEXT_SECRET_PARALLEL_HOTEL_SERVICE_URL || "https://mondial2026.mega-events.co.il";

  const targets = [
    { name: "primary", baseUrl: hotelServiceUrl },
    { name: "parallel", baseUrl: parallelServiceUrl },
  ].filter(
    (target, index, allTargets) => allTargets.findIndex((candidate) => candidate.baseUrl === target.baseUrl) === index,
  );

  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const url = `${target.baseUrl.replace(/\/$/, "")}/api/revalidate?secret=${encodeURIComponent(revalidationSecret)}`;
      // Bounded: this runs at the very end of a budget that is only checked between events, so an
      // unbounded wait here could carry the function past maxDuration and lose the summary email.
      const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`${response.status}`);
    }),
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(
        `price-light-nightly: revalidate ${targets[i].name} failed`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
    }
  });
}

async function sendSummaryEmail(s: NightlySummary): Promise<void> {
  const redMoves = s.lightChanges.filter((c) => c.from === "red" || c.to === "red");
  // Most nights nothing "changes" (a red event just stays red) - counting only moves
  // is exactly the blind spot that hid 184 red tickets behind an all-`na` package scope
  // on the first live run. Gate on the CURRENT red count too, so a steady-state red
  // catalog still gets a nightly email instead of going silent.
  const redNow = s.lightCounts.package.red + s.lightCounts.ticket.red;
  if (!s.tagged && !s.cleared && redMoves.length === 0 && s.errors.length === 0 && redNow === 0) return;
  // The first run already mailed tonight's steady state; a follow-up speaks only for news.
  if (s.followUp && redMoves.length === 0 && s.errors.length === 0) return;
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (!to) return;
  const countsLine = (scope: "package" | "ticket") =>
    LIGHTS.map((l) => `${l} ${s.lightCounts[scope][l]}`).join(" · ");
  try {
    await sendMail({
      to,
      subject: `Price light${s.followUp ? " (follow-up)" : ""}: ${redNow} red now (${redMoves.length} changes) · ${s.tagged} new price-drop tags · ${s.errors.length} errors`,
      html: [
        `<p><a href="${appOrigin()}/events">Events</a> · scanned ${s.scanned} · ${s.remaining} left for tomorrow` +
          (s.snapshotsRemaining ? ` · ${s.snapshotsRemaining} snapshots not reached` : "") +
          ` · AI ${s.aiCalls}/${AI_CALLS_PER_RUN} calls` +
          ` · advisor ${s.advisorCalls}/${PRICE_ADVISOR_AGENT.callsPerRun} calls` +
          (s.autoTasks || s.autoTasksSkipped
            ? ` · <a href="${appOrigin()}/tasks">${s.autoTasks} משימות נפתחו</a>` + (s.autoTasksSkipped ? ` (${s.autoTasksSkipped} מעבר לתקרה)` : "")
            : "") +
          `</p>`,
        `<p>package: ${countsLine("package")}<br/>ticket: ${countsLine("ticket")}</p>`,
        redMoves.length
          ? `<ul>${redMoves.map((c) => `<li>#${c.eventId} ${c.name} (${c.scope}): ${c.from ?? "—"} → ${c.to ?? "—"}</li>`).join("")}</ul>`
          : "",
        s.errors.length ? `<p><b>Errors</b></p><ul>${s.errors.map((e) => `<li>#${e.eventId}: ${e.note}</li>`).join("")}</ul>` : "",
      ].join(""),
    });
  } catch (e) {
    console.error("price-light-nightly: mail failed", e instanceof Error ? e.message : e);
  }
}
