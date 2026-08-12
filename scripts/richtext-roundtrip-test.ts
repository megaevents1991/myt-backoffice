/**
 * Round-trip test for lib/richtext.ts HTML<->doc converters.
 * Run: node --env-file=.env.local scripts/richtext-roundtrip-test.ts
 *
 * 1. Every real blog post: doc -> HTML -> doc must be equivalent (normalized).
 * 2. Sample article HTML -> doc -> HTML must be stable (idempotent).
 * 3. Hostile input: <script>/<style> stripped.
 */
import { createClient } from "@supabase/supabase-js";
import { richDocToHtml, htmlToRichDoc } from "../lib/richtext.ts";

// Normalize a doc for comparison: sort marks, collapse whitespace in text,
// drop empty text nodes (formatting-only differences, not content).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalize = (n: any): any => {
  if (Array.isArray(n)) return n.map(normalize).filter(Boolean);
  if (!n || typeof n !== "object") return n;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = { nodeType: n.nodeType, data: n.data ?? {} };
  if (n.nodeType === "text") {
    out.value = String(n.value ?? "").replace(/\s+/g, " ");
    out.marks = [...(n.marks ?? [])]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({ type: m.type }))
      .sort((a, b) => a.type.localeCompare(b.type));
    if (out.value === "") return null;
    return out;
  }
  if (n.content) out.content = normalize(n.content);
  // empty paragraphs are Contentful-migration spacer leftovers - render as
  // nothing; the converter intentionally drops them, so comparison does too.
  if (n.nodeType === "paragraph" && (out.content?.length ?? 0) === 0)
    return null;
  return out;
};

// Merge adjacent same-mark text nodes so "a" + "b" == "ab" after normalize.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mergeText = (n: any): any => {
  if (!n || typeof n !== "object" || !Array.isArray(n.content)) return n;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged: any[] = [];
  for (const c of n.content.map(mergeText)) {
    const prev = merged[merged.length - 1];
    if (
      c?.nodeType === "text" &&
      prev?.nodeType === "text" &&
      JSON.stringify(prev.marks) === JSON.stringify(c.marks)
    )
      prev.value += c.value;
    else merged.push(c);
  }
  return { ...n, content: merged };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const canon = (doc: any) => JSON.stringify(mergeText(normalize(doc)));

const SAMPLE = `<h1>אריאנה גרנדה הופעות 2026</h1>
<p>אריאנה גרנדה היא אחת מאמניות הפופ הגדולות בעולם - <strong>מדריך מלא</strong> לישראלים.</p>
<p>עיינו ב<a href="https://www.mega-events.co.il/artists">כל האמנים</a> באתר.</p>
<h2>איך לדעת ראשונים</h2>
<ul>
  <li><strong>הירשמו לעדכונים</strong> - מהאתר הרשמי.</li>
  <li>עקבו אחרי <em>הרשתות החברתיות</em>.</li>
</ul>
<ol>
  <li>אתר שלא ניתן לאמת.</li>
  <li>מחיר נמוך בצורה חשודה.</li>
</ol>
<blockquote><p>ציטוט לדוגמה</p></blockquote>`;

async function main() {
  let failed = 0;

  // -- 1. real posts round-trip ---------------------------------------------
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: posts, error } = await sb
    .from("blog_posts")
    .select("id,slug,main_content");
  if (error) throw error;
  for (const p of posts ?? []) {
    if (!p.main_content) continue;
    const html = richDocToHtml(p.main_content);
    const back = htmlToRichDoc(html);
    const ok = canon(p.main_content) === canon(back);
    console.log(`post ${p.id} (${p.slug}): ${ok ? "OK" : "ROUND-TRIP DIFF"}`);
    if (!ok) {
      failed++;
      const a = mergeText(normalize(p.main_content));
      const b = mergeText(normalize(back));
      for (let i = 0; i < Math.max(a.content.length, b.content.length); i++) {
        const sa = JSON.stringify(a.content[i]);
        const sb2 = JSON.stringify(b.content[i]);
        if (sa !== sb2)
          console.log(`  block ${i}:\n    orig: ${sa}\n    back: ${sb2}`);
      }
    }
  }

  // -- 2. sample HTML idempotence -------------------------------------------
  const doc1 = htmlToRichDoc(SAMPLE);
  const html1 = richDocToHtml(doc1);
  const doc2 = htmlToRichDoc(html1);
  const html2 = richDocToHtml(doc2);
  const stable = canon(doc1) === canon(doc2) && html1 === html2;
  console.log(`sample HTML idempotent: ${stable ? "OK" : "FAIL"}`);
  if (!stable) {
    failed++;
    console.log("--- html1 ---\n" + html1 + "\n--- html2 ---\n" + html2);
  }
  // structure sanity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const types = (doc1 as any).content.map((n: any) => n.nodeType).join(",");
  console.log("sample block types:", types);

  // -- 3. hostile input ------------------------------------------------------
  const dirty = htmlToRichDoc(
    `<p>שלום</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><p onclick="x()">עולם <span>בפנים</span></p>`,
  );
  const dirtyHtml = richDocToHtml(dirty);
  const clean =
    !dirtyHtml.includes("script") &&
    !dirtyHtml.includes("alert") &&
    !dirtyHtml.includes("iframe") &&
    !dirtyHtml.includes("onclick") &&
    dirtyHtml.includes("עולם בפנים");
  console.log(`hostile input stripped: ${clean ? "OK" : "FAIL"}`);
  if (!clean) {
    failed++;
    console.log(dirtyHtml);
  }

  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
