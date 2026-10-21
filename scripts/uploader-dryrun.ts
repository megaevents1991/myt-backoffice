/**
 * Tour uploader (agent #3) - READ-ONLY dry run of the search against the real database:
 * `resolveSubject` + `findShows` for one subject, printed as tables (shows, questions, what was
 * left out, the existing events a show already is, XS2Event / P1 information). Never builds,
 * never writes, never calls a supplier API or the AI.
 *
 *   npx tsx scripts/uploader-dryrun.ts "<name_en>" [artist|team|competition] [--he "<name_he>"] [--from YYYY-MM-DD --to YYYY-MM-DD] [--all]
 *
 * `--all` = home and away games (a team run is home-only by default, like the plan). Loads
 * .env.local itself when the Supabase env is not already set.
 *
 * Before migration 20261021115818 is applied, prod has no `events.is_hidden`: the script then
 * reads the duplicates WITHOUT that column (every event read as listed) and says so - a stand-in
 * that lives here only; the service never falls back.
 */
import type { ExistingEvent } from "@/lib/uploader/shows";
import type { SubjectKind, UploaderPlan } from "@/types/uploader.types";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: the read below fails with the missing-env message.
  }
}

const KINDS: SubjectKind[] = ["artist", "team", "competition"];

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const pad = (v: unknown, n: number): string => {
  const s = v === null || v === undefined ? "-" : String(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
};

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && all[i - 1] !== "--all"));
  const name = positional[0];
  const kind = (positional[1] ?? "artist") as SubjectKind;
  if (!name || !KINDS.includes(kind)) {
    console.error('usage: npx tsx scripts/uploader-dryrun.ts "<name_en>" [artist|team|competition] [--he "<name_he>"] [--from YYYY-MM-DD --to YYYY-MM-DD] [--all]');
    process.exit(1);
  }

  const { emptyPlan } = await import("@/lib/uploader/plan");
  const { existingEventFor, showKey } = await import("@/lib/uploader/shows");
  const search = await import("@/lib/services/uploader-search");
  const { supabase } = await import("@/lib/supabase-server");

  const base = emptyPlan();
  const plan: UploaderPlan = {
    ...base,
    subject: { kind, name_en: name, name_he: arg("--he") },
    scope: { ...base.scope, date_from: arg("--from"), date_to: arg("--to"), home_only: !process.argv.includes("--all") },
  };

  const t0 = Date.now();
  const { subject, rows, teamsHe, competitionName } = await search.resolveSubject(plan);
  const page = rows.artist
    ? `artists#${rows.artist.id} "${rows.artist.name}" (cut-out: ${rows.artist.art_image_url ? "yes" : "no"}, event gallery: ${rows.artist.event_gallery.length}, /c/ twin: ${rows.artist.hasTwin ? "yes" : "no"})`
    : rows.team
      ? `football_teams#${rows.team.id} "${rows.team.name}" (crest: ${rows.team.logo_url || rows.team.crestInLibrary ? "yes" : "no"}, /c/ twin: ${rows.team.hasTwin ? "yes" : "no"})`
      : kind === "competition"
        ? `TixStock category: ${competitionName ?? "NONE FOUND"}`
        : "NO PAGE";
  console.log(`\nSUBJECT  ${kind} "${subject.name_en}" | he: ${subject.name_he ?? "-"} | aliases: ${subject.aliases.join(", ") || "-"}`);
  console.log(`PAGE     ${page}`);
  console.log(`TEAMS_HE ${Object.keys(teamsHe).length} Hebrew team names`);
  console.log(`SCOPE    ${plan.scope.date_from ?? "today+3"} .. ${plan.scope.date_to ?? "open"} | home_only: ${plan.scope.home_only}`);

  // Pre-migration prod has no events.is_hidden: findShows would (rightly) fail on it.
  const probe = await supabase.from("events").select("is_hidden").limit(1);
  const preMigration = probe.error?.code === "42703";
  const found = await search.findCandidates(plan, subject);
  let existing: ExistingEvent[];
  if (!preMigration) {
    existing = (await search.findShows(plan, subject)).existing;
  } else {
    console.log("\n!! prod predates migration 20261021115818 (no events.is_hidden) - duplicates read WITHOUT it, every event read as listed (script stand-in only)");
    const { latin, hebrew } = search.subjectPatterns(subject, found.clubs);
    const terms = [...latin.map((p) => `name_english.ilike.${p}`), ...hebrew.map((p) => `name.ilike.${p}`)];
    let q = supabase.from("events").select("id,name_english,date,location,tickets_and_rates").is("is_deleted", null).not("is_test", "is", true).gte("date", found.window.from);
    if (found.window.to !== null) q = q.lt("date", found.window.to);
    const { data, error } = await q.or(terms.join(",")).order("id").limit(1000);
    if (error) throw new Error(`events read failed: ${JSON.stringify(error)}`);
    existing = ((data ?? []) as { id: number; name_english: string | null; date: string; location: { city_iata?: string } | null; tickets_and_rates: { eid?: string | number }[] | null }[]).map((r) => ({
      id: r.id,
      name_english: r.name_english,
      date: r.date,
      city_iata: r.location?.city_iata ?? null,
      eids: [...new Set((r.tickets_and_rates ?? []).map((t) => (t.eid === undefined || t.eid === null ? "" : String(t.eid))).filter((e) => e !== ""))],
      is_hidden: false,
    }));
  }

  console.log(`\nSHOWS (${found.shows.length})`);
  console.log(`${pad("date", 11)}${pad("city", 14)}${pad("venue", 28)}${pad("name", 36)}${pad("tixstock id · tickets", 36)}${pad("live id · sellable", 20)}${pad("home / away", 40)}${pad("exists", 10)}fallback`);
  for (const s of found.shows) {
    const dup = existingEventFor(s, existing);
    const tix = s.suppliers.tixstock ? `${s.suppliers.tixstock.event_id} · ${s.suppliers.tixstock.ticket_count ?? "?"}` : "-";
    const live = s.suppliers.livetickets ? `${s.suppliers.livetickets.event_id} · ${s.suppliers.livetickets.sellable}` : "-";
    const sides = s.home_team ? `${s.home_team} / ${s.away_team ?? "?"}` : "-";
    const fb = found.fallback.get(showKey(s.country_code, s.city, s.date, s.home_team));
    console.log(`${pad(s.date, 11)}${pad(s.city, 14)}${pad(s.venue, 28)}${pad(s.name_english, 36)}${pad(tix, 36)}${pad(live, 20)}${pad(sides, 40)}${pad(dup ? `#${dup.id}` : "", 10)}${fb ? fb.join("+") : ""}`);
  }

  console.log(`\nQUESTIONS (${found.questions.length})`);
  for (const { show, question } of found.questions) {
    console.log(`- ${question.kind} [${question.key}] ${question.text}`);
    for (const o of question.options) console.log(`    · ${o.key} = ${o.label}`);
    const dup = existingEventFor(show, existing);
    if (dup) console.log(`    (already on events: #${dup.id})`);
  }

  console.log(`\nEXCLUDED (${found.excluded.length})`);
  for (const e of found.excluded) {
    const info = found.excludedInfo[`${e.row}:${e.id}`];
    console.log(`- ${pad(e.reason, 18)}${pad(e.row, 12)}${pad(e.id, 28)}${info ? `${info.date} ${info.city} · ${info.name}` : ""}`);
  }

  console.log(`\nEXISTING EVENTS READ (${existing.length}) - window ${found.window.from} .. ${found.window.to ?? "open"}`);
  for (const e of existing) console.log(`- #${pad(e.id, 6)}${pad(e.date, 12)}${pad(e.city_iata, 5)}${pad(e.is_hidden ? "hidden" : "listed", 8)}${pad(e.name_english, 50)}eids: ${e.eids.join(", ")}`);

  const showKeys = new Set([...found.shows, ...found.questions.map((q) => q.show)].map((s) => showKey(s.country_code, s.city, s.date, s.home_team)));
  const loose = [...found.fallback].filter(([k]) => !showKeys.has(k));
  console.log(`\nFALLBACK on a show: ${found.fallback.size - loose.length} · only XS2Event / P1 (${loose.length}):`);
  for (const [k, sources] of loose) console.log(`- ${k}: ${sources.join("+")}`);

  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s - read only, nothing written`);
}

main().catch((e) => {
  console.error("dry run failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
