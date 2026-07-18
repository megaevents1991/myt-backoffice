/**
 * Minimal converters between plain text and the Contentful rich-text document
 * shape stored in `bio` / `main_content`. The customer site renders these via
 * `documentToReactComponents`, so admin-edited content must stay a valid doc.
 * (Migrated entries keep their original formatting; admin edits become plain
 * paragraphs — good enough until a full rich-text editor is added.)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function richDocToText(doc: any): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  return doc.content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((node: any) =>
      Array.isArray(node.content)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? node.content.map((c: any) => c.value || "").join("")
        : ""
    )
    .join("\n\n")
    .trim();
}

export function textToRichDoc(text: string) {
  const paras = (text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    nodeType: "document",
    data: {},
    content: paras.map((p) => ({
      nodeType: "paragraph",
      data: {},
      content: [{ nodeType: "text", value: p, marks: [], data: {} }],
    })),
  };
}
