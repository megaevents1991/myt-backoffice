/**
 * Loose, token-based matching for every search box in the backoffice.
 *
 * A plain `includes()` only finds text that appears verbatim, so searching
 * "real madrid champion" for "Real Madrid vs Arsenal - UEFA Champions League"
 * returns nothing: the words are all there, just not in that order and not
 * adjacent. Provider feeds name the same fixture a dozen different ways, so
 * verbatim matching is the wrong tool.
 *
 * The rule here: every word you typed must appear somewhere in the row, in any
 * order, and a word may match the start of a longer one ("champion" finds
 * "Champions"). Everything else - punctuation, accents, Hebrew niqqud, double
 * spaces - is normalised away first.
 */

/** Lowercase, strip accents/niqqud, and reduce punctuation to single spaces. */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Combining marks: cafe with accents -> cafe, Hebrew niqqud dropped.
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The words of a query, normalised. An empty query yields no tokens. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeForSearch(query);
  return normalized ? normalized.split(" ") : [];
}

/**
 * Does this row satisfy the query? Pass every field worth searching; they are
 * matched as one combined haystack, so "madrid arsenal" can take one word from
 * the event name and another from the venue.
 */
export function matchesSearch(query: string, ...fields: unknown[]): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;

  const haystack = normalizeForSearch(
    fields.filter((field) => field !== null && field !== undefined).join(" "),
  );
  if (!haystack) return false;

  // Word-start matching keeps "champion" -> "Champions" while stopping
  // "real" from matching the middle of "unreal".
  const words = haystack.split(" ");
  return tokens.every((token) => words.some((word) => tokenHitsWord(token, word)));
}

function tokenHitsWord(token: string, word: string): boolean {
  if (word.startsWith(token)) return true;
  // Nicknames and typos: "barca" is not a prefix of "barcelona" (bar-CA vs
  // bar-CE), and "marid" is a slipped "madrid". Allow a token to match as an
  // in-order subsequence - but only for tokens of 4+ characters that agree on
  // the first two, so short tokens cannot latch onto everything.
  if (token.length < 4) return false;
  if (token[0] !== word[0] || token[1] !== word[1]) return false;
  let at = 0;
  for (const char of word) {
    if (char === token[at]) at += 1;
    if (at === token.length) return true;
  }
  return false;
}
