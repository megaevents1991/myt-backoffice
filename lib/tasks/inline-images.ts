// Pictures INSIDE a task comment (Alon 06.10: "could not put a screenshot under the line I
// wrote"). A comment's pictures are still its `attachments` - what is new is a marker in the
// text, "[תמונה 2]", saying WHERE picture 2 of that comment is drawn. The marker is plain,
// readable Hebrew on purpose: mails and notifications quote the comment as text, and there it
// simply reads "[תמונה 2]". Pure - no React, no DB (scripts/task-thread-selftest.ts).

/** "[תמונה 2]" - the second attachment of the comment, drawn at this spot. */
export const imageToken = (n: number): string => `[תמונה ${n}]`;

const TOKEN = /\[תמונה (\d+)\]/g;

/**
 * The text with a picture's marker put at `cursor`, on a line of its own (a
 * picture between two halves of a sentence would split the sentence), and the
 * position right after it - where the writer goes on typing.
 */
export function insertImageToken(
  body: string,
  cursor: number,
  n: number,
): { body: string; cursor: number } {
  const at = Math.max(0, Math.min(body.length, Math.floor(cursor)));
  const before = body.slice(0, at);
  const after = body.slice(at);
  const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const tail = after.startsWith("\n") ? "" : "\n";
  const inserted = `${lead}${imageToken(n)}${tail}`;
  // Past the line break that follows the marker - ours, or the one that was already there.
  return { body: before + inserted + after, cursor: before.length + inserted.length + (tail ? 0 : 1) };
}

/** The text without picture `n`'s marker (the picture was removed) - and without the line it stood on. */
export function removeImageToken(body: string, n: number): string {
  const token = imageToken(n).replace(/[[\]]/g, "\\$&");
  return body
    .replace(new RegExp(`(^|\\n)[ \\t]*${token}[ \\t]*(?=\\n|$)`, "g"), "")
    .replace(new RegExp(token, "g"), "")
    .replace(/^\n+/, "");
}

/**
 * Markers rewritten in one pass from the numbers the composer handed out to the
 * pictures' final positions in the comment (`renumber.get(label)` = 1-based
 * position). A marker whose number is not in the map is left as typed.
 */
export function renumberImageTokens(body: string, renumber: Map<number, number>): string {
  return body.replace(TOKEN, (whole, raw: string) => {
    const next = renumber.get(Number(raw));
    return next ? imageToken(next) : whole;
  });
}

export type BodyPart =
  | { kind: "text"; text: string }
  /** `index` = position in the comment's attachments (0-based). */
  | { kind: "image"; index: number };

/**
 * A comment's text cut at its picture markers. Only a marker that names one of
 * the comment's own PICTURES becomes a picture - any other "[תמונה N]" stays
 * text. A picture is drawn once: a marker repeated further down stays text.
 * `inlined` = the attachments drawn inside the text (the rest keep their place
 * in the row under the comment).
 */
export function splitInlineImages(
  body: string,
  isImage: boolean[],
): { parts: BodyPart[]; inlined: Set<number> } {
  const parts: BodyPart[] = [];
  const inlined = new Set<number>();
  let last = 0;
  const push = (text: string) => {
    // The marker sits on its own line - the breaks around it are layout, not text.
    const trimmed = text.replace(/^\n/, "").replace(/\n$/, "");
    if (trimmed.trim()) parts.push({ kind: "text", text: trimmed });
  };
  for (const match of body.matchAll(TOKEN)) {
    const index = Number(match[1]) - 1;
    if (!isImage[index] || inlined.has(index)) continue;
    push(body.slice(last, match.index));
    parts.push({ kind: "image", index });
    inlined.add(index);
    last = (match.index ?? 0) + match[0].length;
  }
  push(body.slice(last));
  return { parts, inlined };
}
