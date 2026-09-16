// lib/tasks/mentions.ts
// Pure helper for pruning stale mention IDs at send time.

/** Prunes mention IDs whose inserted @<label> no longer appears in the body text.
 *  Uses Unicode-aware lookarounds with the `u` flag to correctly handle names in
 *  any script (Hebrew, Arabic, Cyrillic, etc.), checking that the mention is not
 *  glued to a letter/number on either side. Handles edge cases like one label
 *  being a prefix of another (e.g. "@Dor" vs "@Doron", "@דור" vs "@דורון"). */
export function mentionsStillInBody(
  body: string,
  picked: Array<{ id: string; label: string }>
): string[] {
  return picked
    .filter(({ label }) => {
      // Search for the mention in the body, as it was inserted: "@<label>"
      // followed by a word boundary (space, punctuation, end of text, etc).
      // Unicode lookarounds ensure Hebrew, Arabic, and other scripts work correctly.
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // (?<![...]) = negative lookbehind (not preceded by)
      // (?![...])  = negative lookahead (not followed by)
      // \p{L} = any letter in any script (with `u` flag)
      // \p{N} = any digit in any script
      // _ = underscore (keeps _ part of a "word" so @name_here is one unit)
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])@${escaped}(?![\\p{L}\\p{N}_])`, "u");
      return pattern.test(body);
    })
    .map(({ id }) => id);
}
