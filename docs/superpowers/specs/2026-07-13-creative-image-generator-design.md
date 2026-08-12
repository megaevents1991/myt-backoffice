# Creative Image Generator - Design Spec

**Date:** 2026-07-13
**Repos touched:** `myt-backoffice` (feature), `myt-main` (sitemap fix rider)
**Origin:** Marketing spec (Hebrew) - auto-generate match creative images in the backoffice for site pages, paid campaigns, and social.

---

## 1. Purpose

A backoffice page that generates ready-to-post match creatives (two team logos + VS, date/time, stadium/city, price) from a fixed brand template - no manual design work per match. Output serves paid campaigns, social posts, and optionally the event card on the main site.

## 2. Decisions log (approved by Dor)

| #   | Decision            | Choice                                                                                                                                                                                                                                                                                            |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Output handling     | **Option C:** always auto-save both sizes to Supabase Storage (`creatives` bucket) + download buttons + copy-URL. Checkbox (default ON) "set as event card" writes the 1080×1080 URL to `events.card_image_url` for a selected event. Checkbox is the guard against overwriting curated card art. |
| D2  | Ticket-only variant | **Option A:** same template, `mode=ticket` swaps the price label (e.g. "כרטיסים החל מ-€99") and hides package wording. A visually distinct variant can be added later - the template is a React component, no migration needed.                                                                   |
| D3  | Render engine       | **Native satori** via `ImageResponse` from `next/og` (built into Next 15). No Bannerbear/Cloudinary, no new heavy deps, $0/month.                                                                                                                                                                 |
| D4  | Sitemap fixes       | Bundled into this effort as a rider on the main app (see §8).                                                                                                                                                                                                                                     |

## 3. Existing infrastructure reused (spec §2 is mostly already built)

- **`football_teams` table + Templates (תבניות) CRUD** - team store exists ([lib/actions/football-actions.ts](../../lib/actions/football-actions.ts), CRUD factory `template-crud.ts`).
- **Supabase Storage upload flow** - [lib/actions/storage-actions.ts](../../lib/actions/storage-actions.ts) (public-bucket browsing + upload already used for card/gallery art).
- **`locations` table** - stadium/city source for the location dropdown.

### New (additive, safe) schema changes

1. `football_teams.logo_url text null` - club logo (transparent PNG). Distinct from `image_url` (photo) and `art_image_url` (blob cut-out). Additive column; main app unaffected until it opts in.
2. New **public** Storage bucket `creatives` with folders:
   - `creatives/logos/` - normalized club logos
   - `creatives/output/` - generated images
   - `creatives/assets/` - background(s), overlay art, brand font file(s)

No changes to shared types consumed by main (`Person` gets optional `logo_url` - additive; run `/sync-types` note only if main adopts it).

## 4. Logo intake rules (spec §2 fidelity)

- Upload field added to the football team form in Templates CRUD.
- **PNG only** (satori's SVG-in-`<img>` support is unreliable - SVG uploads rejected with a clear error message; transparent background is the admin's responsibility, MIME/extension validated).
- **No pre-resize needed:** the template renders each logo inside a fixed bounding box with `object-fit: contain`, which guarantees visual uniformity regardless of source dimensions (replaces the spec's 400×400 resize requirement with a simpler, lossless equivalent).

## 5. Generator UI - `app/(dashboard)/creative-generator/page.tsx`

Dedicated dashboard page (spec allowed "event form or dedicated page" - dedicated is simpler; a shortcut button from the event edit page can be added later).

Form inputs (client component):

| Field                      | Source                                                                     | Notes                                      |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Home team                  | select from `football_teams` (has `logo_url`)                              | pulls logo 1                               |
| Away team                  | same                                                                       | pulls logo 2                               |
| Date                       | date picker, rendered as `DD.MM.YYYY`                                      |                                            |
| Time (optional)            | time input                                                                 | omitted from image when empty              |
| Location                   | select from `locations` (stadium + city)                                   | free-text fallback allowed                 |
| Mode                       | package / ticket-only                                                      | D2                                         |
| Price                      | number + currency symbol                                                   | rendered as "החל מ-€499" or ticket wording |
| Attach to event (optional) | event select + checkbox "set as event card" (default ON when event chosen) | D1                                         |

**Live preview:** `<img>` pointing at the render route with current form values as query params - updates on change, zero extra code for preview.

**"צור תמונה" button** → server action:

1. Fetches both sizes from the render route server-side.
2. Uploads PNGs to `creatives/output/{event-or-match-slug}-{size}.png`.
3. Returns public URLs → UI shows download buttons + copy-URL per size.
4. If attach-checkbox on: updates `events.card_image_url` (1080×1080 URL) via explicit-column update, then hits main's `/api/revalidate`.

## 6. Render engine - `app/api/creative/route.tsx`

- `ImageResponse` (from `next/og`) rendering `components/creative/MatchTemplate.tsx`.
- Query params: `home`, `away` (team ids), `date`, `time?`, `loc`, `price`, `cur`, `mode` (`package`|`ticket`), `size` (`square` 1080×1080 | `banner` 1200×628).
- **Auth:** middleware skips `/api/*` entirely (verified in [middleware.ts:44](../../middleware.ts)), so the route checks the `session` cookie itself and returns 401 without it. (Live preview from the dashboard sends cookies automatically.)
- Template layers (per marketing spec §4):
  - **Background:** fixed brand background from `creatives/assets/bg-default.png`. Variable backgrounds = later enhancement (asset picker), not v1.
  - **Fixed overlay:** Mega Events logo, slogan, text-shadow treatment.
  - **Dynamic:** logo 1 right, logo 2 left, "VS" element between; bounding boxes for date, location, price.
  - **Font:** brand font file(s) (TTF/OTF incl. Hebrew glyphs) loaded from `creatives/assets/` and passed to `ImageResponse`. One template component serves both sizes via layout scaling.
- Output: **PNG only in v1** (satori emits PNG). Marketing spec said "JPG or PNG" - PNG satisfies it; JPG conversion via `sharp` can be added later if file size matters for a channel.
- Wrapped in try/catch, logs before 500 (project standard).

## 7. Scope boundaries (v1)

- Football matches only (two teams + VS). Music/artist creatives = future template.
- One background, one template. Template changes = code edit (acceptable: template is a single React component).
- No image history UI - generated files are browsable via the existing storage browser; regenerating with same slug overwrites.

## 8. Rider: sitemap fixes (myt-main)

[app/sitemap.xml/route.ts](../../../myt-main/app/sitemap.xml/route.ts) issues:

1. **Fake `lastmod`** - every URL stamped `new Date()` per generation; Google learns to ignore it. Fix: use the event's real `updated_at` (or event date) for `/order/{id}` pages; a fixed deploy-era date for static pages.
2. **Expired events** - verify `getCachedEvents()` excludes past events from the sitemap; filter if not.
3. (Backlog, not this effort): slugged event URLs (`/order/real-madrid-vs-barcelona-610`) - main SEO lever, separate project.

No type or schema changes; ~1 hour, separate branch/PR from the generator.

## 9. Prerequisites from marketing/designer

- Brand font file(s) - TTF/OTF with Hebrew support.
- Background image asset + Mega Events overlay logo (high-res PNG) + slogan text.
- Club logo PNGs (transparent) for initial teams.

Until real assets arrive, development proceeds with placeholder assets - swap is a storage upload, no code change.

## 10. Rollout & branch safety

- **Backoffice feature:** branch `feat/creative-generator`. Zero customer-facing risk while unattached - new page + new route + additive column + new bucket. The only write that touches the live site is `card_image_url`, and only when the admin checks the attach box.
- **Main sitemap fix:** branch `fix/sitemap-lastmod`. Customer-facing but read-only SEO metadata; low risk, still PR'd separately so it ships independently.

## 11. Estimate

- Generator (backoffice): ~2–3 days including template polish against real assets.
- Sitemap rider (main): ~1 hour.

---

## V2 addendum (2026-07-14, approved by Dor): Event-first auto-generation

Dor's direction: the CMO spec was manual-first; the real goal is **pick an event → everything auto-fills** (editable afterwards).

- New server action `getCreativeDefaults(eventId)` ([lib/actions/creative-actions.ts](../../lib/actions/creative-actions.ts)):
  - Date+time from `event.date` (UTC; midnight = no time).
  - Location from `event.location.name`.
  - **Price = final customer package price**, replicating main's `computePackagePrice`: flight + hotel + min available ticket + markups (composed per-component or legacy 175) + `event_additional_markup`. Currency `$`.
  - **Kind detection:** name splitting decides (type is unreliable - most rows are `tx_event`): "A - B"/"A vs B" → match; otherwise probe `artists` table → artist show.
  - **Match:** both sides matched against `football_teams` by Hebrew/English name (exact, then containment). Unmatched → warning + manual pick.
  - **Artist:** image chain `event.art_image_url` → matched artist `art_image_url`/`image_url` → `event.card_image_url`.
  - Warnings array surfaces every gap (no tickets → no price, missing images, unmatched teams).
- Team images now use a **fallback chain** `logo_url → art_image_url → image_url` (was logo-only).
- New **artist template** (single centered image + name) beside the VS match template; `CreativeParams` became a discriminated union (`kind: "match" | "artist"`), threaded through route + action + form.
- Form: event select on top (auto-fill + auto-attach), everything below editable; manual flow still works without an event.
