// lib/tasks/mentions.ts
// Pure helper for pruning stale mention IDs at send time.

/** Prunes mention IDs whose inserted @<label> no longer appears in the body text.
 *  Handles edge cases like one label being a prefix of another by requiring the
 *  full label to be surrounded by word boundaries. */
export function mentionsStillInBody(
  body: string,
  picked: Array<{ id: string; label: string }>
): string[] {
  return picked
    .filter(({ label }) => {
      // Search for the mention in the body, as it was inserted: "@<label> "
      // Use a regex to find it with word boundary on both sides to avoid
      // matching a prefix of another mention (e.g. "@Dor" vs "@Doron")
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\B@${escaped}\\b`);
      return pattern.test(body);
    })
    .map(({ id }) => id);
}
