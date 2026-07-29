# Dynamic Forms (טפסים) — Design Spec

**Date:** 2026-07-29
**Repo:** `myt-backoffice`
**Cross-project impact:** none (new tables only; `../myt-main` untouched)

## Goal

A Google-Forms / Monday-style form builder inside the backoffice. Staff build a
bilingual (English + Hebrew) questionnaire, publish it, send it to clients — either
as a shared public link or as per-recipient emailed links — and read every answer
back in the dashboard.

Primary use case: **trip intake questionnaire.** General questions about a client's
trip (destination, dates, party size, budget, event interest, preferences) so sales
can follow up with a proposal. Not document collection — no file upload in scope.

## Scope

**In v1**

- Form builder with 13 field types, drag-free reordering, live preview
- Full EN + HE authoring on every user-visible string
- Public fill page on the backoffice domain, RTL when Hebrew
- Two delivery modes: shared public link, and per-recipient tokenized invite link
- Email invites sent from the backoffice (ZeptoMail SMTP, already in use)
- Results: response table + row drawer, per-question summary charts, invite status,
  `.xlsx` export

**Out of scope (v2)**

- File upload fields
- Conditional / branching logic (show field X if answer Y)
- Response editing after submit
- Public form hosted on the main app domain
- Multi-page forms

## Data model

One migration: `supabase/migrations/<ts>_forms.sql`. Four tables.

### `forms`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `title_en` / `title_he` | text | `title_en` required |
| `description_en` / `description_he` | text | shown under the title on the fill page |
| `slug` | text unique | public URL segment, auto-derived from `title_en`, editable |
| `status` | text | `draft` \| `live` \| `closed` |
| `default_lang` | text | `en` \| `he` |
| `allow_multiple` | boolean | governs invite links only — allows more than one submission per token. The shared public link is always multi-submit. |
| `thank_you_en` / `thank_you_he` | text | post-submit message |
| `created_by` | text | admin email from session |
| `created_at` / `updated_at` | timestamptz | |
| `is_deleted` | text | `"MM-DD-YYYY"` soft delete, house convention |

Indexes: unique on `slug`, index on `status`.

### `form_fields`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `form_id` | uuid fk → `forms` | `on delete cascade` |
| `type` | text | see field types below |
| `position` | int | 0-based ordering |
| `label_en` / `label_he` | text | `label_en` required |
| `help_en` / `help_he` | text | small grey helper text |
| `placeholder_en` / `placeholder_he` | text | text-ish inputs only |
| `required` | boolean | default `false` |
| `options` | jsonb | `[{ value, label_en, label_he }]` for choice fields |
| `config` | jsonb | `{ max: 5 }` rating, `{ min, max, step }` scale/number, `{ rows }` long_text |

Index on `(form_id, position)`.

### `form_responses`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `form_id` | uuid fk → `forms` | |
| `invite_id` | uuid fk → `form_invites` | nullable — null for public-link submissions |
| `answers` | jsonb | `{ "<field_id>": value }` |
| `lang` | text | language the respondent actually used |
| `ip` | text | for rate limiting |
| `user_agent` | text | |
| `submitted_at` | timestamptz | |

Index on `(form_id, submitted_at desc)` and on `(form_id, ip, submitted_at)` for the
rate-limit query.

Answers are stored as one `jsonb` blob rather than a row-per-answer table. One query
renders a response, the results table is a straight map over rows, and export is
trivial. Trade-off accepted: no per-answer indexing or SQL aggregation across answers.
Summary stats are computed in JS over the fetched rows, which is fine at this volume.

### `form_invites`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `form_id` | uuid fk → `forms` | |
| `token` | text unique | 32-char hex, `crypto.randomBytes(16).toString("hex")` |
| `recipient_name` / `recipient_email` / `recipient_phone` | text | |
| `lang` | text | language for the email and the prefilled `?lang=` |
| `prefill` | jsonb | `{ "<field_id>": value }` seeded into the form |
| `reservation_id` / `event_id` | uuid | nullable optional links to existing records |
| `sent_at` / `opened_at` / `submitted_at` | timestamptz | nullable |
| `send_error` | text | last SMTP failure, nullable |
| `created_at` | timestamptz | |

Index on `token` (unique) and `(form_id, created_at desc)`.

## Field types

```ts
type FormFieldType =
  | "short_text" | "long_text" | "number" | "email" | "phone" | "date"
  | "select" | "radio" | "checkbox" | "yes_no" | "rating" | "scale" | "section";
```

Stored answer shape per type:

| type | value in `answers` |
| --- | --- |
| `short_text`, `long_text`, `email`, `phone`, `select`, `radio` | `string` |
| `number`, `rating`, `scale` | `number` |
| `date` | `string` — `"YYYY-MM-DD"` |
| `checkbox` | `string[]` |
| `yes_no` | `boolean` |
| `section` | never stored — display-only block |

`rating` renders stars (`config.max`, default 5). `scale` renders a 1–N button row
(`config.min`/`config.max`, default 1–10) — covers NPS.

## Bilingual approach

No i18n library. Every user-visible string is a column pair (`*_en` / `*_he`), which
matches how RTL is already handled ad hoc in `app/portal/layout.tsx` and
`lib/quote-pdf-template.ts`.

- **Builder:** each label/help/placeholder input is a two-tab control — `EN` and `עב`.
  Only `*_en` is required; a missing Hebrew string falls back to the English one at
  render time.
- **Fill page:** language resolves as `?lang=` → invite `lang` → `form.default_lang`.
  A toggle in the header switches it. Hebrew sets `dir="rtl"` on the form container
  plus `text-right` on inputs.
- **Static UI chrome** on the fill page (Submit, Required, validation messages) lives
  in a small `FILL_STRINGS` const in the renderer — roughly 12 keys, both languages.

## Builder — `/forms/[id]/edit`

Two columns.

**Left — field list.** One card per field showing type icon, `label_en`, required
badge. Card actions: `↑` `↓` reorder, duplicate, delete. Expanding a card reveals its
editor (label/help/placeholder EN+HE tabs, required toggle, type-specific config,
options editor for choice fields). An "Add field" dropdown at the bottom lists the 13
types.

Reordering is `↑`/`↓` buttons rather than drag-and-drop — the repo has no dnd
dependency and this needs no new one.

**Right — live preview.** The exact public renderer component, with an EN/HE toggle
so Hebrew layout is verified while authoring.

**Header —** title EN/HE, slug (editable, uniqueness-checked), status select
(draft/live/closed), Save, and a "Copy public link" button once live.

Draft state lives in one `useState` object; Save writes the form row and replaces the
whole `form_fields` set in a single action (delete-then-insert inside one call,
columns mapped explicitly — same pattern as `replaceOfflineHotelRooms` in
`lib/actions/offline-hotel-room-actions.ts`).

## Public fill page — `app/f/[slug]` and `app/f/i/[token]`

The only unauthenticated page in the app.

- `middleware.ts` gains an exception before the session check:
  `pathname === "/f" || pathname.startsWith("/f/")`.
- `/f/[slug]` — shared public link. `/f/i/[token]` — invite link: stamps `opened_at`,
  seeds `prefill`, and posts back with `invite_id`.
- Server component loads form + fields, renders a `"use client"` renderer.
- `status !== "live"` or soft-deleted → 404 for `draft`, a plain "this form is closed"
  page for `closed`.
- Submit is a server action, not an API route (repo convention).
- On success, replaces the form with `thank_you_*` text.

### Submit security

The submit action is reachable by anyone, so it is treated as a public endpoint:

- **Never trusts identity from the client.** It receives `slug` or `token` plus the
  answer map. `form_id` and `invite_id` are resolved server-side from that
  slug/token; both are ignored if sent by the client.
- **Re-checks publish state** — rejects unless `status = 'live'` and `is_deleted` is
  null, regardless of what the page rendered.
- **Whitelists field ids.** Answers whose key is not a field of this form are dropped,
  never stored. No object spreading into the row — columns mapped explicitly.
- **Validates with a zod schema built from the field definitions** — required checks,
  type coercion, email/date format, choice values restricted to the stored `options`,
  numbers clamped to `config.min`/`config.max`, string length capped (500 short /
  5000 long), and a cap on total answers per submission.
- **Rate limit:** counts existing `form_responses` for this `(form_id, ip)` in the
  last hour and rejects past a threshold (default 10). A DB count is used rather than
  an in-memory map because Vercel serverless instances do not share memory.
- **Honeypot:** a visually hidden input; if filled, the action returns the normal
  success screen and discards the submission.
- **Invite reuse:** if the invite already has `submitted_at` and the form is not
  `allow_multiple`, show "already submitted" instead of the form.
- No response data is ever readable from a public route.

## Invites and email — `/forms/[id]/invites`

- **Compose:** either paste one `name, email` pair per line, or add rows manually.
  Each row carries a language (`en`/`he`). Optional `reservation_id` / `event_id`.
- **Send:** an admin-guarded server action creates one `form_invites` row per
  recipient with a fresh token, sends the email, then stamps `sent_at` — or
  `send_error` on failure. Sends run sequentially with per-recipient try/catch so one
  bad address cannot abort the batch.
- **Email transport:** `lib/email.ts` — a new shared helper exposing `sendMail()`
  around the existing ZeptoMail config (`smtp.zeptomail.com:587`, from
  `alon@mega-events.co.il`) currently duplicated inline in three cron routes.
  Migrating those three routes onto the helper is an optional follow-up, not part of
  this work.
- **Email body:** short HTML in the recipient's language with a single button linking
  to `/f/i/<token>?lang=<lang>`; `dir="rtl"` for Hebrew.
- **Invite table:** recipient, language, status (`sent` → `opened` → `filled`), plus
  per-row copy-link and resend actions.

## Results — `/forms/[id]/responses`

Three tabs.

1. **Table** — one row per submission (date, respondent if from an invite, then a
   column per field). Horizontal scroll for wide forms; clicking a row opens a drawer
   with every question and answer laid out vertically. Matches the existing
   offline-flights table + drawer pattern.
2. **Summary** — per question: `recharts` horizontal bar counts for
   `select`/`radio`/`checkbox`/`yes_no`; average plus distribution for
   `rating`/`scale`; the 5 most recent values with a link to the table for free-text.
   Computed in JS from the fetched rows.
3. **Invites** — the invite table described above, with sent/opened/filled counts.

`Export .xlsx` builds one sheet, header row from `label_en`, one row per response,
using the existing `exceljs` export pattern from offline-flights.

## Forms list — `/forms`

Table of non-deleted forms: title, status badge, field count, response count, created
date. Actions: edit, responses, copy link, duplicate, soft-delete. "New form" creates
a draft and jumps to the builder.

## Auth and audit

- Every dashboard page and every mutating action except the public submit calls
  `requireAdmin()` (`lib/auth/guards.ts`).
- `logAudit` (`lib/audit.ts`) records form `create` / `update` / `delete`, status
  changes to `live`, and invite sends — same usage as `lib/actions/coupon-actions.ts`.

## Files

**New**

```
supabase/migrations/<ts>_forms.sql
types/form.types.ts
lib/email.ts
lib/forms/validation.ts              # field defs -> zod schema, shared by fill + submit
lib/actions/form-actions.ts          # form + field CRUD, publish, duplicate, soft-delete
lib/actions/form-invite-actions.ts   # create invites, send email, resend
lib/actions/form-response-actions.ts # public submit (unauth) + response reads (admin)
app/(dashboard)/forms/page.tsx
app/(dashboard)/forms/forms-client.tsx
app/(dashboard)/forms/[id]/edit/page.tsx
app/(dashboard)/forms/[id]/edit/form-builder.tsx
app/(dashboard)/forms/[id]/edit/field-editor.tsx
app/(dashboard)/forms/[id]/responses/page.tsx
app/(dashboard)/forms/[id]/responses/responses-client.tsx
app/(dashboard)/forms/[id]/invites/page.tsx
app/(dashboard)/forms/[id]/invites/invites-client.tsx
app/f/[slug]/page.tsx
app/f/i/[token]/page.tsx
app/f/form-renderer.tsx              # shared by public pages and builder preview
```

**Modified**

```
middleware.ts          # allow /f/*
components/sidebar.tsx # "Forms / טפסים" entry
CLAUDE.md              # document the new tables + public route
```

No new dependencies: `zod`, `recharts`, `exceljs`, `nodemailer` are all present.

## Build order

1. Migration + `types/form.types.ts`
2. `lib/actions/form-actions.ts` + forms list page
3. `form-renderer.tsx` + `lib/forms/validation.ts`
4. Builder page (uses the renderer for preview)
5. Public fill pages + middleware exception + public submit action
6. Results table + drawer + `.xlsx` export
7. `lib/email.ts` + invites page + send action
8. Summary tab (recharts)

Steps 1–6 are a usable product on their own; 7–8 complete it.

## Verification

No test suite in this repo. Verified by running the dev server and walking:

- Build a form with every field type, both languages → save → reload → fields and
  Hebrew strings persist in order.
- Publish → open the public link in a logged-out browser → it renders without
  redirecting to login; Hebrew toggle flips the layout to RTL.
- Submit with a required field empty → blocked client-side; submit valid → thank-you
  screen and the row appears in the results table.
- Submit with a forged `field_id` and a forged `form_id` → both ignored, no bad row.
- Draft and closed forms → 404 / closed page on the public URL.
- Send an invite to a real address → email arrives, link opens prefilled, `opened_at`
  and then `submitted_at` populate.
- Export `.xlsx` → opens in Excel with one row per response.
- `npx tsc --noEmit` clean (the real type gate — the build ignores TS errors).
