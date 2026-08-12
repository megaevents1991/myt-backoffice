/**
 * PostgREST hard-caps every response (max-rows, 1000 on this project), so a
 * plain `.limit(5000)` silently returns the first 1000 rows and nothing else.
 * Page with `.range()` until `max` rows, a short page, or an error.
 * `truncated` means the cap cut real data - callers surface that, never hide it.
 * Rows are deduped by `id` so a concurrent insert can't double-count a row
 * that slid across a page boundary mid-pagination.
 */
export async function fetchPaged<T extends { id: number | string }>(
  makeQuery: () => {
    range: (
      from: number,
      to: number,
    ) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  },
  max: number,
): Promise<{
  rows: T[];
  truncated: boolean;
  error: { message: string } | null;
}> {
  const rows: T[] = [];
  const seen = new Set<number | string>();
  let offset = 0;
  while (offset < max) {
    const want = Math.min(1000, max - offset);
    const res = await makeQuery().range(offset, offset + want - 1);
    if (res.error) return { rows, truncated: false, error: res.error };
    const page = (res.data ?? []) as T[];
    offset += page.length;
    for (const row of page) {
      if (row.id != null) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      rows.push(row);
    }
    if (page.length < want) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}
