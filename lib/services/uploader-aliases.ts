/**
 * The tour uploader's alias store (Alon's round 2, spec 3.1): what a person confirmed once - "Roma is our רומא",
 * "Man Utd is this team" - kept in `uploader_aliases` and reused by the code on every later run, so the same
 * question is never asked twice. The matching rules are pure elsewhere; this file only reads and writes the table.
 *
 * Keys are `normalizeName` (lib/on-tour.ts), the form every lookup compares. A city alias points at a `locations`
 * name; a team alias also carries the `football_teams` id it resolves to.
 *
 * Migration 20261028114031_uploader_alon_round_2.sql. Before it is applied a read answers "no aliases" and a write
 * answers false (logged) - the build simply asks its question again.
 */
// No "server-only" here, on purpose: the search (lib/services/uploader-search.ts) imports this file and
// scripts/uploader-dryrun.ts loads the search under tsx, where that package throws. Like the search, it is
// imported by server code only and reads through the service-role client.
import { normalizeName } from "@/lib/on-tour";
import { loadLocations } from "@/lib/services/nearest-location";
import { buildEquivalence, type Equivalence } from "@/lib/uploader/equivalence";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";

// `uploader_aliases` is newer than types/database.types.ts - one boundary cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type UploaderAlias = {
  kind: "city" | "team";
  from_name: string;
  from_key: string;
  to_name: string;
  to_key: string;
  team_id: number | null;
};

type DbError = { message: string; code?: string } | null;

// Same line as uploader-store's `logDb`; not imported from there - the store reaches the search, the search reaches
// this file (`loadEquivalence`), and an import back would close a cycle.
const logDb = (what: string, error: unknown): void => console.error(`uploader: ${what} failed`, JSON.stringify(error));

/** The table is not there yet (the migration has not run): a missing relation, or PostgREST's schema cache without it. */
const isMissingTable = (error: DbError): boolean => error?.code === "42P01" || error?.code === "PGRST205";

/** More than this many confirmed aliases is not a state this table reaches by hand; past it a read fails loudly, never half-answers. */
const ALIASES_MAX = 5000;

type AliasRow = UploaderAlias & { id: string };

const isKnownKind = (kind: unknown): kind is UploaderAlias["kind"] => kind === "city" || kind === "team";

/**
 * Every confirmed alias. A missing table is `[]` (nothing learned yet); any other failure THROWS - an empty list
 * from a failed read would send the uploader back to asking what a person already answered.
 */
export async function loadAliases(): Promise<UploaderAlias[]> {
  const { rows, truncated, error } = await fetchPaged<AliasRow>(
    () => db.from("uploader_aliases").select("id,kind,from_name,from_key,to_name,to_key,team_id").order("id", { ascending: true }),
    ALIASES_MAX,
  );
  if (error) {
    if (isMissingTable(error as DbError)) return [];
    logDb("uploader_aliases read", error);
    throw new Error(`uploader_aliases read failed: ${error.message}`);
  }
  if (truncated) {
    logDb("uploader_aliases read", { message: `more than ${ALIASES_MAX} rows` });
    throw new Error(`uploader_aliases read failed: more than ${ALIASES_MAX} rows`);
  }
  // `kind` has no CHECK in the table: a row of a kind this build does not know is left out, so the type stays true.
  return rows
    .filter((row) => isKnownKind(row.kind))
    .map((row) => ({
      kind: row.kind,
      from_name: row.from_name,
      from_key: row.from_key,
      to_name: row.to_name,
      to_key: row.to_key,
      team_id: row.team_id ?? null,
    }));
}

/**
 * Remembers one confirmed alias (upsert on `(kind, from_key)`: confirming the same spelling again re-points it).
 * Refuses a spelling that normalizes to nothing or to the same key as its target - that is no alias. False on a
 * refusal or a failed write (logged); never throws, a lesson that could not be saved must not fail the answer it came with.
 */
export async function recordAlias(input: {
  kind: UploaderAlias["kind"];
  from_name: string;
  to_name: string;
  team_id?: number | null;
  created_by: string | null;
}): Promise<boolean> {
  const from_name = input.from_name.trim();
  const to_name = input.to_name.trim();
  const from_key = normalizeName(from_name);
  const to_key = normalizeName(to_name);
  if (from_key === "" || to_key === "" || from_key === to_key) return false;
  const { error } = (await db.from("uploader_aliases").upsert(
    {
      kind: input.kind,
      from_name,
      from_key,
      to_name,
      to_key,
      team_id: input.team_id ?? null,
      created_by: input.created_by,
    },
    { onConflict: "kind,from_key" },
  )) as { error: DbError };
  if (error) {
    logDb(`uploader_aliases ${input.kind} write`, error);
    return false;
  }
  return true;
}

/**
 * The run's equivalence rule (`buildEquivalence`, spec 3.2): the `locations` names + their aliases and every confirmed
 * alias, read side by side. Both reads THROW on a failure (`loadLocations`, `loadAliases`): a search that paired its
 * shows by an empty rule would split every "Roma" / "Rome" and ask the same questions again - it fails instead
 * (`search_failed`), never half-answers. A missing `uploader_aliases` table is "nothing learned yet".
 */
export async function loadEquivalence(): Promise<Equivalence> {
  const [locations, aliases] = await Promise.all([loadLocations(), loadAliases()]);
  return buildEquivalence(locations, aliases);
}
