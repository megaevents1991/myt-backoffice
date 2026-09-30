/**
 * Soft delete in the forms area: `form_responses.is_deleted` (migration
 * 20260930120000) hides a response, `form_invites.is_deleted` (20260930150000)
 * a trip link the user did not need. Until a column's migration has run, a
 * filter on it fails (42703 raw, PGRST204 from the schema cache) - read without
 * it rather than break the whole forms area (or every trip link) for the
 * minutes between a deploy and its migration, or for as long as a failed
 * migration run stays unfixed.
 *
 * `run(true)` must apply the `is_deleted is null` filter, `run(false)` must not.
 */
export async function liveRowsQuery(
  run: (filterDeleted: boolean) => PromiseLike<LiveQueryResult>,
): Promise<LiveQueryResult> {
  const res = await run(true);
  const code = res.error?.code;
  if (code === "42703" || code === "PGRST204") return run(false);
  return res;
}

/**
 * The forms actions query through an untyped client (`supabase as any` - the
 * forms tables predate the generated types), so rows stay `any` here too and
 * each caller casts them at its own boundary, as before.
 */
export type LiveQueryResult = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /** Set on a `{ count: "exact" }` select. */
  count?: number | null;
  error: { code?: string; message?: string } | null;
};

/** House soft-delete convention: "MM-DD-YYYY". */
export function softDeleteStamp(now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${now.getFullYear()}`;
}
