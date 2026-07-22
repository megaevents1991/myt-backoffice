# Blog rich HTML body + paste-to-fill — design

Date: 2026-07-22. Approved by Dor (chat).

## Problem

Blog body (`blog_posts.main_content`, Contentful-doc jsonb) is edited as a plain
textarea: `richDocToText` flattens headings/lists/links on load, `textToRichDoc`
saves paragraphs only. Editors can't paste or keep rich article HTML
(h1/h2/p/ul/ol/a/strong), and structure of migrated Contentful posts is destroyed
on first admin edit.

## Decisions

- **Storage unchanged**: `main_content` stays a Contentful rich-text document.
  Main app (`app/blog/[slug]/page.tsx`) already renders the needed node set via
  `documentToReactComponents` defaults + `prose` — zero main-app changes.
- **Supported node set** (all existing posts verified to use only these):
  `heading-1..3, paragraph, unordered-list, ordered-list, list-item, blockquote,
  hyperlink` + marks `bold, italic`.
- **Editor**: TipTap (Visual tab, default) + raw-HTML tab (advanced), per Dor:
  "שניהם".

## Components

1. **`lib/richtext.ts`** — add `richDocToHtml(doc)` and `htmlToRichDoc(html)`.
   DOM-free tag tokenizer (runs in browser + node tests). Tag whitelist above;
   `script/style/iframe` dropped with content; unknown tags unwrapped to text;
   entities decoded/encoded. Round-trip lossless for the supported set.
   Existing `textToRichDoc/richDocToText` stay (PersonForm bio untouched).
2. **`components/templates/RichBodyEditor.tsx`** — client component.
   Props: `value: string` (HTML), `onChange(html)`. Tabs Visual/HTML, synced on
   switch. TipTap StarterKit + Link, RTL. Toolbar: H1/H2/H3, bold, italic,
   bullet list, ordered list, blockquote, link.
3. **`BlogForm`** — `main_content` leaves RHF: local `bodyHtml` state, init from
   `richDocToHtml(initial.main_content)`; joins the extras dirty-JSON; save maps
   `htmlToRichDoc(bodyHtml)` (empty → null).
4. **Auto-fill box** — top of BlogForm: textarea "Paste full HTML" + Fill button.
   First `<h1>` → Title (+ SEO title if empty) and removed from body (page
   renders the title as h1 already); first `<p>` text → Preview text (~200 chars,
   only if empty); rest → body editor. Confirm before overwriting non-empty
   title/body. Fill only — save stays manual, all fields editable after.

## Testing

- Node round-trip script: 4 real posts doc→HTML→doc deep-equal (normalized);
  Dor's sample article HTML→doc→HTML stable; hostile input (`<script>`) stripped.
- `tsc --noEmit` clean on touched files.

## Out of scope

Artists/football bio editor, images in body, main-app renderer changes.
