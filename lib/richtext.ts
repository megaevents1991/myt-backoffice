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

// ---------------------------------------------------------------------------
// HTML <-> Contentful rich-text doc. Supported set (everything the existing
// blog posts use, verified against the DB): heading-1..3, paragraph,
// unordered-list, ordered-list, list-item, blockquote, hyperlink + marks
// bold/italic. DOM-free on purpose — same code runs in the browser (BlogForm)
// and in node (round-trip tests).
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

type RichNode = {
  nodeType: string;
  data: Record<string, unknown>;
  content?: RichNode[];
  value?: string;
  marks?: { type: string }[];
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const BLOCK_TAG: Record<string, string> = {
  h1: "heading-1",
  h2: "heading-2",
  h3: "heading-3",
  p: "paragraph",
  ul: "unordered-list",
  ol: "ordered-list",
  li: "list-item",
  blockquote: "blockquote",
};
const NODE_TAG: Record<string, string> = {
  "heading-1": "h1",
  "heading-2": "h2",
  "heading-3": "h3",
  paragraph: "p",
  "unordered-list": "ul",
  "ordered-list": "ol",
  "list-item": "li",
  blockquote: "blockquote",
};

/** Contentful doc -> HTML string (for the editor). Unknown nodes render their text. */
export function richDocToHtml(doc: any): string {
  if (!doc || !Array.isArray(doc.content)) return "";

  const inline = (nodes: RichNode[]): string =>
    (nodes || [])
      .map((n) => {
        if (n.nodeType === "text") {
          let out = escapeHtml(n.value ?? "");
          const marks = (n.marks || []).map((m) => m.type);
          if (marks.includes("italic")) out = `<em>${out}</em>`;
          if (marks.includes("bold")) out = `<strong>${out}</strong>`;
          return out;
        }
        if (n.nodeType === "hyperlink") {
          const uri = String((n.data as any)?.uri ?? "");
          return `<a href="${escapeAttr(uri)}">${inline(n.content || [])}</a>`;
        }
        return inline(n.content || []);
      })
      .join("");

  const block = (n: RichNode): string => {
    const tag = NODE_TAG[n.nodeType];
    const kids = n.content || [];
    if (n.nodeType === "unordered-list" || n.nodeType === "ordered-list")
      return `<${tag}>\n${kids.map(block).join("\n")}\n</${tag}>`;
    if (n.nodeType === "list-item") {
      // single-paragraph items flatten to inline <li> (standard HTML shape)
      if (kids.length === 1 && kids[0].nodeType === "paragraph")
        return `<li>${inline(kids[0].content || [])}</li>`;
      return `<li>\n${kids.map(block).join("\n")}\n</li>`;
    }
    if (n.nodeType === "blockquote")
      return `<blockquote>\n${kids.map(block).join("\n")}\n</blockquote>`;
    if (tag) return `<${tag}>${inline(kids)}</${tag}>`;
    // unknown block (hr, embedded-*) — keep its text so nothing is lost silently
    const text = inline(kids);
    return text ? `<p>${text}</p>` : "";
  };

  return (doc.content as RichNode[]).map(block).filter(Boolean).join("\n");
}

// -- HTML -> doc -------------------------------------------------------------

type HtmlEl = { tag: string; href?: string; children: (HtmlEl | string)[] };

/** Tags whose entire content is dropped. */
const DROP_WITH_CONTENT = ["script", "style", "iframe", "head", "title", "noscript", "svg"];
/** Void tags (no closing tag) — none map to our node set. */
const VOID_TAGS = ["br", "img", "hr", "meta", "link", "input", "source", "col", "area", "base", "embed", "track", "wbr"];
const KNOWN_TAGS = ["h1", "h2", "h3", "p", "ul", "ol", "li", "blockquote", "a", "strong", "b", "em", "i"];

/** Minimal forgiving HTML parser: whitelist tree, unknown tags unwrapped. */
function parseHtml(html: string): HtmlEl {
  let src = (html || "").replace(/<!--[\s\S]*?-->/g, "");
  for (const t of DROP_WITH_CONTENT) {
    src = src.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}>`, "gi"), "");
    src = src.replace(new RegExp(`<${t}\\b[^>]*\\/?>`, "gi"), "");
  }
  const root: HtmlEl = { tag: "#root", children: [] };
  const stack: HtmlEl[] = [root];
  const top = () => stack[stack.length - 1];

  const tokens = src.match(/<[^>]+>|[^<]+/g) || [];
  for (const tok of tokens) {
    if (tok[0] !== "<") {
      const text = decodeEntities(tok);
      if (text) top().children.push(text);
      continue;
    }
    const close = /^<\s*\//.test(tok);
    const name = (tok.match(/^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/) || [])[1]?.toLowerCase();
    if (!name) continue;
    if (VOID_TAGS.includes(name)) {
      if (name === "br") top().children.push(" ");
      continue;
    }
    if (!KNOWN_TAGS.includes(name)) continue; // unknown → unwrap (children attach to parent)
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el: HtmlEl = { tag: name, children: [] };
    if (name === "a") {
      const href = (tok.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[2] ??
        (tok.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[3] ??
        (tok.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[4];
      el.href = href ? decodeEntities(href) : "";
    }
    top().children.push(el);
    if (!/\/\s*>$/.test(tok)) stack.push(el);
  }
  return root;
}

const textNode = (value: string, marks: string[]): RichNode => ({
  nodeType: "text",
  value,
  marks: marks.map((type) => ({ type })),
  data: {},
});

const isInlineTag = (t: string) => ["a", "strong", "b", "em", "i"].includes(t);

/** HTML string -> Contentful rich-text document. */
export function htmlToRichDoc(html: string): RichNode {
  const collapse = (s: string) => s.replace(/\s+/g, " ");

  const inline = (kids: (HtmlEl | string)[], marks: string[]): RichNode[] => {
    const out: RichNode[] = [];
    for (const k of kids) {
      if (typeof k === "string") {
        const v = collapse(k);
        if (v) out.push(textNode(v, marks));
        continue;
      }
      if (k.tag === "strong" || k.tag === "b")
        out.push(...inline(k.children, marks.includes("bold") ? marks : [...marks, "bold"]));
      else if (k.tag === "em" || k.tag === "i")
        out.push(...inline(k.children, marks.includes("italic") ? marks : [...marks, "italic"]));
      else if (k.tag === "a")
        out.push({
          nodeType: "hyperlink",
          data: { uri: k.href ?? "" },
          content: inline(k.children, marks),
        });
      else out.push(...inline(k.children, marks)); // block tag misnested inline — keep text
    }
    return out;
  };

  // merge adjacent text nodes with identical marks; trim block edges
  const tidy = (nodes: RichNode[]): RichNode[] => {
    const merged: RichNode[] = [];
    for (const n of nodes) {
      const prev = merged[merged.length - 1];
      if (
        n.nodeType === "text" &&
        prev?.nodeType === "text" &&
        JSON.stringify(prev.marks) === JSON.stringify(n.marks)
      )
        prev.value = (prev.value ?? "") + (n.value ?? "");
      else merged.push(n);
    }
    const first = merged[0];
    if (first?.nodeType === "text") first.value = (first.value ?? "").replace(/^\s+/, "");
    const last = merged[merged.length - 1];
    if (last?.nodeType === "text") last.value = (last.value ?? "").replace(/\s+$/, "");
    return merged.filter((n) => n.nodeType !== "text" || (n.value ?? "") !== "");
  };

  const hasText = (nodes: RichNode[]): boolean =>
    nodes.some((n) =>
      n.nodeType === "text" ? (n.value ?? "").trim() !== "" : hasText(n.content || [])
    );

  /** Children of a block container -> block nodes (loose inline runs → paragraphs). */
  const blockify = (kids: (HtmlEl | string)[]): RichNode[] => {
    const out: RichNode[] = [];
    let run: (HtmlEl | string)[] = [];
    const flush = () => {
      const content = tidy(inline(run, []));
      run = [];
      if (hasText(content))
        out.push({ nodeType: "paragraph", data: {}, content });
    };
    for (const k of kids) {
      const isBlock = typeof k !== "string" && BLOCK_TAG[k.tag] !== undefined;
      if (!isBlock) {
        run.push(k);
        continue;
      }
      flush();
      const el = k as HtmlEl;
      if (el.tag === "ul" || el.tag === "ol") {
        const items = el.children
          .filter((c): c is HtmlEl => typeof c !== "string" && c.tag === "li")
          .map((li) => {
            const inner = blockify(li.children);
            return {
              nodeType: "list-item",
              data: {},
              content: inner.length
                ? inner
                : [{ nodeType: "paragraph", data: {}, content: [] }],
            } as RichNode;
          });
        if (items.length)
          out.push({ nodeType: BLOCK_TAG[el.tag], data: {}, content: items });
      } else if (el.tag === "blockquote") {
        const inner = blockify(el.children);
        if (inner.length)
          out.push({ nodeType: "blockquote", data: {}, content: inner });
      } else {
        const content = tidy(inline(el.children, []));
        if (hasText(content))
          out.push({ nodeType: BLOCK_TAG[el.tag], data: {}, content });
      }
    }
    flush();
    return out;
  };

  return {
    nodeType: "document",
    data: {},
    content: blockify(parseHtml(html).children),
  };
}
