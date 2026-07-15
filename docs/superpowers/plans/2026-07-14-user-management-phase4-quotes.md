# User Management Phase 4 (הצעת מחיר / Quote PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Agents/affiliates create branded Hebrew price quotes: pick event → price prefilled from the package-price chain → edit line items → save → download RTL PDF with their logo. Quotes stored in `quotes` table + private `quotes` bucket.

**Architecture:** Shared `computePackagePrice` extracted from creative-actions into `lib/package-price.ts`. New `lib/actions/quote-actions.ts` (partner-guarded, partner_code-scoped, audited). PDF via existing `@sparticuz/chromium` + `playwright-core` pattern (`app/api/validate-airline/route.ts` is the reference): render HTML template → `page.pdf()` → upload to `quotes` bucket → signed URL. Route `POST /api/quotes/[id]/pdf` with ownership check.

## Global Constraints

- **No commits by agents.** Dor commits.
- **No test suite.** `npx tsc --noEmit` = 32 pre-existing baseline, ZERO new. No DB/dev-server/chromium execution during tasks.
- **Isolation:** quote actions guard `requirePartner()`; every read/write scoped to session `partner_code`; the PDF route accepts staff too but partners only for their OWN quote (`quote.partner_tracking_code === session.partner_code`).
- Audit: `quote_created` on create, `pdf_generated` on PDF render — via existing `logAudit`. Both strings + entity `quote` must ALSO be added to the `/audit-log` filter lists.
- Quotes currency USD; `line_items` = `[{ label, qty, unit_price }]`; `total` = sum(qty × unit_price).
- Price prefill = `computePackagePrice(event)` — extracted, NOT duplicated; creative-actions refactored to import it (behavior identical).
- Hebrew RTL everywhere partner-facing.
- `params` is a Promise in Next 15 route handlers — `const { id } = await params`.

---

### Task 1: Extract package price + `lib/actions/quote-actions.ts`

**Files:**
- Create: `lib/package-price.ts` — move `computePackagePrice` (creative-actions.ts:129-160) verbatim into a plain server module (NO "use server"), export it + its event-arg type (name it `PackagePriceEvent`).
- Modify: `lib/actions/creative-actions.ts` — delete the local copy, `import { computePackagePrice } from "@/lib/package-price";`. Zero behavior change.
- Create: `lib/actions/quote-actions.ts`

**Interfaces (produced):**
```ts
export interface QuoteEventOption { id: number; name: string; date: string | null; location: string | null; suggested_price: number | null }
export interface QuoteLineItem { label: string; qty: number; unit_price: number }
export interface PortalQuote { id: number; created_at: string; customer_name: string | null; title: string | null; total: number | null; valid_until: string | null; status: string; pdf_storage_path: string | null; event_id: number | null }
export async function getQuoteEvents(): Promise<QuoteEventOption[]>            // future, non-deleted events; suggested_price via computePackagePrice
export async function getPortalQuotes(): Promise<PortalQuote[]>                // own quotes, newest first
export async function createQuote(input: { event_id?: number | null; customer_name: string; title: string; line_items: QuoteLineItem[]; notes?: string | null; valid_until?: string | null }): Promise<{ ok: true; id: number } | { ok: false; error: string }>
```

`createQuote` rules (exact):
- `const session = await requirePartner();`
- Validate: `customer_name` and `title` non-empty; `line_items` non-empty array; every item `label` non-empty, `qty` positive finite integer ≤ 999, `unit_price` finite ≥ 0 (reject otherwise — never trust client math).
- `total` computed SERVER-side: `line_items.reduce((s, i) => s + i.qty * i.unit_price, 0)`, rounded to 2 decimals.
- Insert explicit columns: `created_by: session.sub, partner_tracking_code: session.partner_code, event_id, customer_name, title, line_items, currency: "USD", total, notes, valid_until, status: "final"`. Use `.select("id").single()` to return the new id.
- `await logAudit({ action: "quote_created", entityType: "quote", entityId: <new id>, changes: { customer_name, title, total, event_id } });`
- Error → `console.error(JSON.stringify)` + `{ ok: false, error: "..." }`.

`getQuoteEvents` (exact): select `id,name,date,location,base_flight_price,base_hotel_price,tickets_and_rates,event_additional_markup` from `events`, `.is("is_deleted", null)` (soft-delete column — verify actual null-representation used by other queries in the repo, e.g. events dashboard, and match it), `.gte("date", new Date().toISOString().slice(0,10))`, order by date asc, limit 300. Map to `QuoteEventOption` with `suggested_price: computePackagePrice(event)`.

- [ ] Step 1: create lib/package-price.ts (verbatim move) + refactor creative-actions import.
- [ ] Step 2: create quote-actions.ts per above.
- [ ] Step 3: `npx tsc --noEmit` → 32 baseline, zero new. grep quote-actions.ts for forbidden reservation columns → zero (n/a but keep the habit).

---

### Task 2: PDF template + render route

**Files:**
- Create: `lib/quote-pdf-template.ts` — `renderQuoteHtml(args): string`
- Create: `app/api/quotes/[id]/pdf/route.ts`
- Modify: `vercel.json` — add `"app/api/quotes/[id]/pdf/route.ts": { "memory": 1024, "maxDuration": 30 }` under `functions`.

**`renderQuoteHtml` (exact contract):**
```ts
export function renderQuoteHtml(args: {
  quote: { id: number; created_at: string; customer_name: string | null; title: string | null; line_items: { label: string; qty: number; unit_price: number }[]; total: number | null; notes: string | null; valid_until: string | null };
  partner: { name_hebrew: string | null; logo_url: string | null; email: string | null; phone: string | null };
}): string
```
Self-contained HTML document: `<html dir="rtl" lang="he">`, inline CSS only (no external fetches except the logo `<img src>`; guard with `onerror="this.style.display='none'"`), system font stack (`font-family: 'Segoe UI', Arial, 'Noto Sans Hebrew', sans-serif` — Hebrew renders via system fonts in chromium). Layout: header (partner logo right, partner name + contact left/below), title `הצעת מחיר #<id>`, meta rows (תאריך, לקוח, בתוקף עד), items table (פריט / כמות / מחיר ליחידה / סה"כ) with USD formatting, bold total row (סה"כ לתשלום), notes section (הערות) when present, footer line (`הצעה זו אינה מהווה התחייבות. המחירים בדולר ארה"ב.`). **Escape ALL interpolated strings** (helper `esc()` replacing `&<>"'`) — quote fields are user input going into HTML.

**Route (exact skeleton):**
```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { renderQuoteHtml } from "@/lib/quote-pdf-template";
import { STAFF_ROLES } from "@/types/auth.types";

export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const quoteId = Number(id);
  if (!Number.isFinite(quoteId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // fetch quote (explicit columns), then partner + logo
  // AUTH: staff pass; partner must own it:
  //   if (!STAFF_ROLES.includes(session.role) && quote.partner_tracking_code !== session.partner_code) 404
  // (404, not 403 — don't confirm foreign quote ids)
  ...
  const html = renderQuoteHtml({ quote, partner });

  // Chromium pattern from app/api/validate-airline/route.ts:
  //   const chromium = require("@sparticuz/chromium");
  //   const playwright = require("playwright-core");
  //   dev fallback: in NODE_ENV==="development" try playwright.chromium.launch({ channel: "chrome", headless: true })
  //     and if launch throws, return the HTML itself as a downloadable text/html response (so the flow is testable without chromium)
  //   prod: launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true })
  // const page = await browser.newPage();
  // await page.setContent(html, { waitUntil: "networkidle" });
  // const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" } });
  // await browser.close();  (in finally)

  // upload: path `quote-${quoteId}.pdf` to bucket "quotes", upsert: true, contentType application/pdf
  // update quotes.pdf_storage_path = path
  // signed URL: supabase.storage.from("quotes").createSignedUrl(path, 60 * 60)
  // await logAudit({ action: "pdf_generated", entityType: "quote", entityId: quoteId });
  // return NextResponse.json({ ok: true, url: signedUrl });
}
```
Everything in try/catch; failures → `console.error` + 500 `{ error: "PDF generation failed" }` (quote row survives; UI offers retry — per spec).

- [ ] Step 1: template file. Step 2: route. Step 3: vercel.json entry. Step 4: tsc 32 baseline zero new.

---

### Task 3: Portal quotes UI + nav + audit filter strings

**Files:**
- Create: `app/portal/quotes/page.tsx` (server: staff-gate pattern like other portal pages; `getPortalQuotes()`)
- Create: `app/portal/quotes/quotes-client.tsx` (client: list table + "הצעה חדשה" button linking to /portal/quotes/new; per-row "הורד PDF" button → `fetch("/api/quotes/{id}/pdf", { method: "POST" })` → open returned url in new tab; useTransition pending; toast on error "יצירת ה-PDF נכשלה, נסה שוב")
- Create: `app/portal/quotes/new/page.tsx` (server: staff-gate; `getQuoteEvents()` → client form)
- Create: `app/portal/quotes/new/quote-form.tsx` (client)
- Modify: `app/portal/portal-nav.tsx` — add link `הצעות מחיר` → `/portal/quotes`
- Modify: `app/(dashboard)/audit-log/audit-client.tsx` — add `quote_created`, `pdf_generated` to ACTIONS list and `quote` to ENTITY_TYPES list.

**Quote form (exact behavior):**
- Event select: searchable — reuse the combobox idiom from creative-generator's event picker if simple, else plain shadcn Select over `QuoteEventOption` (label: `name — date`); selecting an event: sets `title` to `הצעת מחיר — <event name>` (only if title untouched) and REPLACES line items with one row `{ label: "חבילה: <event name>", qty: 1, unit_price: suggested_price ?? 0 }`. "ללא אירוע" option allowed (free-form quote).
- Line items editor: rows of [label Input, qty Input type=number min=1, unit_price Input type=number min=0 step=0.01, remove button]; "הוסף שורה" button; running total displayed (₪ no — USD $).
- Fields: שם לקוח (required), כותרת (required), הערות (Textarea), בתוקף עד (date Input).
- Submit → `createQuote(...)` → on ok: toast + `router.push("/portal/quotes")`; on error toast.
- Table (quotes list): מספר, תאריך, לקוח, כותרת, סה"כ ($), בתוקף עד, סטטוס, PDF button.

- [ ] Step 1: pages + form + client list. Step 2: nav link. Step 3: audit filter strings. Step 4: tsc 32 baseline zero new.

---

## Acceptance checklist (Phase 4)

- [ ] tsc 32 baseline, zero new
- [ ] createQuote: server-side total, input validation, partner-scoped, audited
- [ ] PDF route: ownership check (404 for foreign quote), staff allowed, HTML-escaped template, chromium prod path + dev fallback, uploads to private bucket, signed URL 1h, audited
- [ ] vercel.json function entry present
- [ ] Audit UI filters include quote_created/pdf_generated/quote
- [ ] Manual (post-deploy): agent creates quote → downloads Hebrew RTL PDF with logo
