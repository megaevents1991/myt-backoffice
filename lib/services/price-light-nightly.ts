// Nightly price-light pass (spec §6.2): snapshot + price-drop tag for every
// live future event, refresh the LiveTickets table listings, then match
// everything, recompute lights, revalidate main once if anything changed, and
// mail a summary.
//
// Two passes over the same event set, both sharing one wall-clock budget
// (`options.budgetMs`, measured from the top of this function) so the whole
// run - LiveTickets refresh included - always fits inside the cron's
// maxDuration:
//  1. Snapshot + tag - least-recently-checked events first, cut off by the
//     shared budget. It's one read + one upsert per event; a cutoff records
//     how many were skipped in `snapshotsRemaining` rather than silently
//     dropping the tail.
//  2. Match + recompute lights - same order, same shared budget, so nothing
//     is stranded behind a backlog when time runs out.
// `writeSnapshotAndTag` and `recomputeEventLights` (via `matchAllForEvent`)
// both throw on write failure, so each pass wraps every event in its own
// try/catch - one event's DB failure never stops the batch.
import { supabase } from "@/lib/supabase-server";
import { appOrigin, sendMail } from "@/lib/email";
import { fetchPaged } from "@/lib/supabase-paged";
import { LIGHT_EVENT_COLUMNS, writeSnapshotAndTag, type LightEvent } from "@/lib/services/price-light-store";
import { matchAllForEvent, type AiBudget } from "@/lib/services/price-light-match";
import { PRICE_LIGHT_AGENT } from "@/lib/agents";
import { newBudget } from "@/lib/agents/switch";
import { AI_CALLS_PER_RUN, aiEnabled } from "@/lib/services/price-light-judge";
import { loadJudgeMemory } from "@/lib/services/price-light-memory";
import { runCrawl } from "@/lib/services/price-light-crawl";
import { LIGHTS, type Light, type Scope } from "@/types/price-light.types";

// LiveTickets refresh is a table read (no crawling), so it should finish in
// seconds - but it defaults to the crawler's 240s budget, which alone would
// blow past this cron's 300s maxDuration before pass 1 even starts. Cap it.
const LIVETICKETS_REFRESH_BUDGET_MS = 60_000;
// Live future events can outgrow PostgREST's 1000-row page cap - never trust
// a single unpaged read for this table.
const EVENTS_LOAD_MAX_ROWS = 20_000;

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
  dryRun: boolean;
}

function emptyLightCounts(): Record<Light, number> {
  return Object.fromEntries(LIGHTS.map((l) => [l, 0])) as Record<Light, number>;
}

export async function runPriceLightNightly(options: { dryRun: boolean; budgetMs: number }): Promise<NightlySummary> {
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const summary: NightlySummary = {
    scanned: 0, snapshots: 0, tagged: 0, cleared: 0, matched: 0,
    lightChanges: [], lightCounts: { package: emptyLightCounts(), ticket: emptyLightCounts() },
    errors: [], remaining: 0, snapshotsRemaining: 0, aiCalls: 0, dryRun: options.dryRun,
  };

  // LiveTickets listings are a table read - refresh them every night before matching.
  // Budgeted well under the crawler's 240s default so it can never eat the whole
  // 300s cron window on its own before pass 1 gets a chance to run (finding I3).
  try {
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

  // Pass 1: snapshot + price-drop tag, least-recently-checked first, cut off by the
  // shared budget - a run with enough events (plus the LiveTickets refresh above) could
  // otherwise blow past the cron's maxDuration before ever reaching pass 2 or the summary
  // email (finding I3). Anything not reached here is recorded, never silently dropped.
  for (const [index, event] of events.entries()) {
    if (Date.now() - start > options.budgetMs) {
      summary.snapshotsRemaining = events.length - index;
      break;
    }
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
  }

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
  for (const [index, event] of events.entries()) {
    if (Date.now() - start > options.budgetMs) {
      summary.remaining = events.length - index;
      break;
    }
    try {
      const result = await matchAllForEvent(event.id, "nightly", {
        dryRun: options.dryRun,
        judge: options.dryRun ? null : undefined,
        aiBudget,
        aiMemory,
      });
      if (!result) continue;
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
      }
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      console.error(`price-light-nightly: match ${event.id} failed`, note);
      summary.errors.push({ eventId: event.id, note: `match: ${note}` });
    }
  }
  summary.aiCalls = AI_CALLS_PER_RUN - aiBudget.remaining;

  if (!options.dryRun) {
    if (summary.lightChanges.length || summary.tagged || summary.cleared) await revalidateMain();
    await sendSummaryEmail(summary);
  }
  return summary;
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
      const response = await fetch(url, { method: "GET" });
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
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (!to) return;
  const countsLine = (scope: "package" | "ticket") =>
    LIGHTS.map((l) => `${l} ${s.lightCounts[scope][l]}`).join(" · ");
  try {
    await sendMail({
      to,
      subject: `Price light: ${redNow} red now (${redMoves.length} changes) · ${s.tagged} new price-drop tags · ${s.errors.length} errors`,
      html: [
        `<p><a href="${appOrigin()}/events">Events</a> · scanned ${s.scanned} · ${s.remaining} left for tomorrow` +
          (s.snapshotsRemaining ? ` · ${s.snapshotsRemaining} snapshots not reached` : "") +
          ` · AI ${s.aiCalls}/${AI_CALLS_PER_RUN} calls</p>`,
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
