import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { kindOf } from "@/lib/services/price-light";
import { OPEN_TASK_STATUSES } from "@/types/task.types";
import { weeksSince } from "./week";
import type { RuleGenerator } from "./types";
import type { RuleMatch } from "@/types/task-rule.types";
import type { LightDetail, Scope } from "@/types/price-light.types";

// Typed against types/database.types.ts (npm run db:types).
const db = supabaseTyped;

export interface LightRow {
  id: number;
  name: string;
  light_package: string | null;
  light_ticket: string | null;
  light_red_since: string | null;
  vertical: string | null;
  gap_usd: number | null;
  silenced: boolean;
}

/** Pure: which red events this rule wants. Exported for the self-test. */
export function filterLightCandidates(rows: LightRow[], match: RuleMatch, now: Date): LightRow[] {
  return rows.filter((row) => {
    // Scope defaults to "package" - the same default candidates() uses to read
    // the gap and the vertical, so the filter and the numbers never disagree.
    const red = match.scope === "ticket" ? row.light_ticket === "red" : row.light_package === "red";
    if (!red) return false;
    if (row.silenced) return false;
    if (match.vertical && row.vertical !== match.vertical) return false;
    if (match.min_gap_usd != null && (row.gap_usd ?? 0) < match.min_gap_usd) return false;
    if (match.min_weeks_red != null) {
      const weeks = weeksSince(row.light_red_since, now);
      // Unknown start = not proven = no task. A quiet week beats a false wave on
      // the first night after the column ships (spec §1.3).
      if (weeks === null || weeks < match.min_weeks_red) return false;
    }
    return true;
  });
}

interface EventLightRow {
  id: number;
  name: string;
  type: string;
  is_test: boolean | null;
  light_package: string | null;
  light_ticket: string | null;
  light_red_since: string | null;
  light_silenced_until: string | null;
  light_detail: LightDetail | null;
}

interface TagLinkRow {
  event_id: number;
}

interface OpenTaskRow {
  id: string;
  source_ref: { row_id: string | number; kind: string } | null;
}

// A few hundred live future events at current catalog size (mirrors listPriceLight's cap).
const EVENTS_MAX = 5_000;
const TASKS_MAX = 5_000;

/** Every live, future, non-deleted, non-test event - same population `/price-light` computes
 *  its lights over (`is_test` is filtered client-side there too, see listPriceLight). */
async function loadEvents(): Promise<EventLightRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { rows, error, truncated } = await fetchPaged<EventLightRow>(
    () =>
      db
        .from("events")
        .select(
          "id,name,type,is_test,light_package,light_ticket,light_red_since,light_silenced_until,light_detail",
        )
        .is("is_deleted", null)
        .gte("date", today)
        .order("id", { ascending: true }),
    EVENTS_MAX,
  );
  if (error) {
    console.error("task-rules/price-light: events failed", JSON.stringify(error));
    throw new Error("price-light: events load failed");
  }
  if (truncated) console.error(`task-rules/price-light: events truncated at ${EVENTS_MAX}`);
  return rows.filter((e) => !e.is_test);
}

/**
 * Event ids carrying the "football" feed tag - one query for every event id passed, never one
 * per event. This is how ISSTA's coversEvent() (competitor-scrapers/issta.ts) and the matcher
 * (tagSlugsForEvent in price-light-match.ts) decide "football": the vertical is not a column on
 * `events` or in `light_detail`, it is a feed tag.
 */
async function loadFootballEventIds(eventIds: number[]): Promise<Set<number>> {
  if (eventIds.length === 0) return new Set();
  const { data, error } = await db
    .from("event_tag_links")
    .select("event_id,event_tags!inner(slug)")
    .in("event_id", eventIds)
    .eq("event_tags.slug", "football");
  if (error) {
    console.error("task-rules/price-light: tag slugs failed", JSON.stringify(error));
    throw new Error("price-light: tag slugs load failed");
  }
  return new Set((data ?? []).map((r: TagLinkRow) => r.event_id));
}

/** `${row_id}:${scope}` for every currently-open price_light task - one query, no N+1 per row,
 *  so this generator's exclusion agrees with isPending() on /price-light (same query shape as
 *  loadOpenPriceLightTaskKeys in price-light-actions.ts). */
async function loadOpenTaskKeys(): Promise<Set<string>> {
  const { rows, error, truncated } = await fetchPaged<OpenTaskRow>(
    () =>
      db
        .from("tasks")
        .select("id,source_ref")
        .eq("source", "price_light")
        .is("deleted_at", null)
        .in("status", OPEN_TASK_STATUSES)
        .order("id", { ascending: true }),
    TASKS_MAX,
  );
  if (error) {
    console.error("task-rules/price-light: open tasks failed", JSON.stringify(error));
    throw new Error("price-light: open tasks load failed");
  }
  if (truncated) console.error(`task-rules/price-light: open tasks truncated at ${TASKS_MAX}`);
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.source_ref) keys.add(`${row.source_ref.row_id}:${row.source_ref.kind}`);
  }
  return keys;
}

export const priceLightGenerator: RuleGenerator = {
  domain: "price_light",
  label: "רמזור",
  screenUrl: "/price-light?f=pending",
  digestTitle: (count) => `סקירת רמזור שבועית — ${count} אדומים ממתינים להחלטה`,
  async candidates(match) {
    const scope: Scope = match.scope === "ticket" ? "ticket" : "package";
    const [events, openTaskKeys] = await Promise.all([loadEvents(), loadOpenTaskKeys()]);
    const footballIds = await loadFootballEventIds(events.map((e) => e.id));
    const now = new Date();

    const rows: LightRow[] = events.map((row) => {
      const detail = row.light_detail?.[scope];
      const silencedUntil = row.light_silenced_until ? new Date(row.light_silenced_until) : null;
      return {
        id: row.id,
        name: row.name,
        light_package: row.light_package,
        light_ticket: row.light_ticket,
        light_red_since: row.light_red_since,
        // "vertical" is not a column - it is football-tagged sports, or kindOf()'s
        // sports/music split for everything else (see kindOf() in price-light.ts).
        vertical: footballIds.has(row.id) ? "football" : kindOf({ type: row.type }),
        gap_usd: detail?.diff_usd ?? null,
        silenced: !!silencedUntil && silencedUntil > now,
      };
    });

    return filterLightCandidates(rows, match, now)
      // A red with an open price_light task for this scope is not "pending" on
      // /price-light (isPending() in price-light-client.tsx) - exclude it here too,
      // or the weekly digest count and the screen would disagree.
      .filter((row) => !openTaskKeys.has(`${row.id}:${scope}`))
      .map((row) => ({
        key: `${scope}:events:${row.id}`,
        title: `רמזור אדום: ${row.name}`,
        description: `פער $${row.gap_usd ?? "?"} מול המתחרים · אדום מאז ${row.light_red_since?.slice(0, 10) ?? "לא ידוע"}`,
        sourceRef: {
          kind: scope,
          table: "events",
          row_id: row.id,
          label: row.name,
          url: `/events/${row.id}#fix-price`,
        },
      }));
  },
};
