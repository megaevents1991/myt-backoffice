# Creative Generator fixes + Users page improvements - Design

Date: 2026-07-15. Approved by Dor in-session.

## Problem

1. **Creative generator Match path is broken** - a half-finished `football_logos` refactor
   changed `lib/creative/input.ts` to expect `homeRef`/`awayRef` subject refs
   (`"team:<id>"` / `"logo:<id>"`), but `creative-form.tsx`, `app/api/creative/route.ts`
   and the `getCreativeDefaults` return objects still use numeric `homeId`/`awayId`.
   Backend for the logo library (migration, `football-logo-actions.ts`, types) exists
   but was never wired to UI.
2. Home/away team pickers are plain `Select`s - unusable with many teams.
3. No control over image/background sizing in the rendered creative.
4. Users page: password typed blind, partner picker is a plain `Select`, phone is a free
   text field, and agent/affiliate users have no contract attachment.

## A. Creative generator

### A1 - Fix Match + finish logos refactor

- `getCreativeDefaults` (creative-actions.ts): return `homeRef`/`awayRef` strings
  (`"team:<id>"`, null when not matched) per its declared type. Artist branch returns
  `homeRef: null, awayRef: null`. Name-matching runs over `football_teams` **and**
  `football_logos` (logos map to `"logo:<id>"`).
- `creative-form.tsx`: state becomes `homeRef`/`awayRef` strings; sends
  `{ homeRef, awayRef }` to `generateCreative`; preview URL `home`/`away` carry refs.
- `app/api/creative/route.ts`: `home`/`away` read as strings, validated with
  `parseSubjectRef` (bare numbers remain valid legacy team ids).

### A2 - Searchable home/away comboboxes + logo manager

- Replace both team `Select`s with Popover+Command comboboxes (same pattern as the
  event picker in the same form). Two groups: teams (CMS `football_teams`) and logos
  (`football_logos`). Search by Hebrew + English name; rows show a logo thumbnail.
- Page fetches `getFootballLogos()` and passes to the form.
- New `logo-manager.tsx` dialog on the page: upload (English/Hebrew name +
  PNG/SVG/WebP/JPG ≤2MB), rename, delete - uses existing `football-logo-actions.ts`.

### A3 - Zoom / position controls (rendered into the PNG)

- `CreativeInput` (MatchTemplate.tsx) gains optional `imgScale` (0.5–2, default 1),
  `imgOffsetX`/`imgOffsetY` (−50..50 % of card, default 0), `bgScale` (0.5–2, default 1).
- Rendering: subject images get scaled dimensions + px offsets inside their
  overflow-hidden cards (both match cards get the same transform; artist single image;
  wide stadium-panel logos too). Backgrounds (card photo, blob svg, panel photo) scale
  around center. No CSS `transform` - plain satori-safe width/height/left/top math.
- Plumbing: form sliders (art-blob-picker pattern) → preview query params
  `iscale`/`ix`/`iy`/`bgscale` → route → `BaseParams` (input.ts) → template. Also sent
  in `generateCreative` params. All-neutral defaults keep current output byte-identical.

## B. Users page

### B1 - Password visibility toggle

- New `components/ui/password-input.tsx`: Input + Eye/EyeOff toggle button.
  Used in the create-user dialog and the reset-password dialog.

### B2 - Partner searchable combobox

- Replace the partner `Select` with Popover+Command combobox; search by Hebrew name
  and tracking code.

### B3 - Smart phone input

- New dependency `react-phone-number-input`; wrapper `components/phone-input.tsx`
  styled like shadcn Input. Country flag dropdown, default IL, auto-format,
  `isValidPhoneNumber` validation on submit (when non-empty), stores E.164 in the
  existing `user_profiles.phone` column.

### B4 - Contract attachment (agent/affiliate only)

- Migration `user_contracts`: `alter table user_profiles add column contract_url text;`
  - **private** storage bucket `user-contracts` (sensitive docs - signed URLs only).
- `user-actions.ts`: `PROFILE_COLUMNS` += `contract_url`; `createUser` returns the new
  user id; new actions `uploadUserContract(userId, FormData)` (PDF/DOC/DOCX/JPG/PNG,
  ≤10MB, replaces the previous file, audit-logged), `getContractDownloadUrl(userId)`
  (short-lived signed URL), `removeUserContract(userId)`.
- UI: file picker in the create/edit dialog when the role is agent/affiliate; on create,
  the contract uploads after the user is created (toast warns if that second step
  fails). Users table shows a contract download action for partner rows that have one.
- `UserProfile` type += `contract_url: string | null`.

## Cross-project impact

None. `user_profiles` and `football_logos` are backoffice-only tables; no shared type
in `types/app.types.ts` changes; the main app reads neither table.

## Order of work

A1 (bug) → A2 → B1–B4 → A3 (render-engine risk last).
