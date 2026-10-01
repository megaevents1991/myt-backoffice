# Google reviews from Google itself - Business Profile API

Date: 2026-10-01 · Status: PLAN, nothing built · Owner of the decision: Dor

## Why

The site's "לקוחות משתפים" reads our own mirror (`google_reviews` / `google_review_sources`),
filled by the daily `googleReviewsSync` cron. With no Google key the cron reads **Elfsight's
public feed** for our Place ID. On 2026-10-01 Google showed **84** reviews and the site **71**:

| Layer | State that day |
| --- | --- |
| Google profile | 84 reviews, 5.0 |
| Elfsight feed | 71, newest 2026-09-04 - frozen |
| Cron | ran 04:01 UTC, no error |
| Mirror | 71 rows, `review_count` 71 |

The cron was healthy; its **source** had stopped refreshing, and nothing could notice because the
count was derived from the feed's own length. Elfsight is someone else's account (we have no
access to it) and an unofficial endpoint - it can freeze or close again at any time.

**Done the same day (not part of this plan):** the five newest reviews were read by hand from the
public Google Maps page and inserted (76 rows; the signed-out page shows five, the search dialog
answered with a CAPTCHA and was left alone); the profile summary was set to 84 / 5.0; the cron now
takes its summary from the mirror and never lowers a stored count; a feed whose newest review is
21+ days old lights the dashboard banner. **Eight reviews (roughly 05.09 - 26.09) are still
missing** and the five inserted ones carry day-precision dates.

## Goal

Every review of the Mega Events profile - text, rating, exact time, owner reply - arrives from
Google's own API within a day, the count and rating are Google's, a removed review leaves the
site, and a mirror that falls behind is reported.

## The API

Google Business Profile ("My Business") - the only official way to list ALL reviews of a profile.

- **Reviews:** `GET https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews`
  - `pageSize` up to 50, `pageToken`, `orderBy=updateTime desc`
  - each review: `reviewId`, `reviewer.displayName`, `reviewer.profilePhotoUrl`,
    `starRating` (`ONE`..`FIVE`), `comment`, `createTime`, `updateTime`,
    `reviewReply.comment`, `reviewReply.updateTime`
  - the list also returns `averageRating` and `totalReviewCount` - the truth for the summary
- **Finding the ids (once):**
  - accounts: `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`
  - locations: `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations?readMask=name,title,metadata`
    (`metadata.placeId` must equal `ChIJ4_iJNrNJZWoRHYuKTpYGzDE`)
- **Auth:** OAuth 2.0, scope `https://www.googleapis.com/auth/business.manage`, consented by a
  Google account that is **Owner or Manager** of the profile. A service account cannot hold that
  role, so the cron uses a stored **refresh token**.

Check at build time (not verified today): the exact `reviewId` format, and whether
`business.manage` needs Google's app verification for our consent-screen type.

## What only people can do (before any code)

| # | Who | Action | Time |
| --- | --- | --- | --- |
| 1 | Dor | Confirm which Google account owns / manages the Mega Events Business Profile, and get Owner or Manager on it for the account we will connect | minutes - days |
| 2 | Dor | Google Cloud project (ours), enable: My Business API (v4), Account Management API, Business Information API | 10 min |
| 3 | Dor | Submit Google's **Business Profile API access request** for that project. Until approved the quota is 0 and every call fails | Google: days to weeks |
| 4 | Dor | OAuth consent screen + OAuth client (type "Web application" or "Desktop"). If the screen stays in **Testing**, refresh tokens die after 7 days - it must be Internal (Workspace) or published | 15 min |
| 5 | Dor | Run the connect script once (step B below), approve in the browser, paste five values into Vercel | 10 min |

Step 3 is the long pole - **submit it first**; everything else can wait for the approval.

## Build (after approval)

### A. Schema - one migration

- `google_reviews.gbp_review_id text` (nullable, unique where not null) - Google's API id, kept
  beside `review_key` (the Maps id the mirror is keyed by today) so nothing is re-keyed.
- `google_reviews.removed_at timestamptz` (nullable) - a review Google no longer lists.
- No change to `google_review_sources`.
- main's read (`lib/googleReviews.ts`) adds `.is("removed_at", null)` - deploy backoffice
  (migration) first, then main.

### B. Connect script - `scripts/gbp-connect.mjs`

Local, run once by Dor: opens the consent URL, catches the code on a loopback port, exchanges it,
lists accounts and locations, and prints the five values to paste into Vercel. It writes nothing
to the repo and never prints the client secret back.

```
NEXT_SECRET_GBP_CLIENT_ID=
NEXT_SECRET_GBP_CLIENT_SECRET=
NEXT_SECRET_GBP_REFRESH_TOKEN=
NEXT_SECRET_GBP_ACCOUNT_ID=
NEXT_SECRET_GBP_LOCATION_ID=
```

### C. Source - `lib/services/google-reviews-sync.ts`

- New source `"gbp"`, chosen when the five variables are set. Order: **gbp > places > elfsight**.
- `fetchFromBusinessProfile()`: refresh token -> access token, page through the reviews
  (`pageSize 50`, sequential), map to `GoogleReviewRow`.
- Mapping: `starRating` enum -> 1..5, `comment` -> `text` (+ escaped `text_html`),
  `createTime` -> `published_at`, `reviewReply` -> `reply_text` / `reply_at`,
  `profilePhotoUrl` -> `author_photo_url`. A review with no comment is kept (it counts).
- Summary straight from the response: `averageRating`, `totalReviewCount`.

### D. Adoption - matching what is already mirrored (pure, selftested)

The 76 rows are keyed by the Maps id; the API's id may be a different string. One pure function
`matchMirrorRow(apiReview, mirrorRows)`, in this order:

1. `gbp_review_id` equal - already adopted
2. `review_key` equal to the API id - same id format after all
3. same `author_name` and same `rating`, and (publish day within 3 days **or** the first 40
   characters of the text equal) - covers the five hand-inserted rows with day-precision dates
4. otherwise a new review -> insert with `review_key = gbp:<reviewId>`

On a match the row keeps its `review_key`, gains `gbp_review_id`, and its `published_at`, text,
reply and photo are overwritten with Google's values. Two mirror rows matching one API review is
reported in the run result and neither is touched.

Selftest in `scripts/google-reviews-selftest.ts`: exact id, author+day, author+text, a namesake
with another rating, the ambiguous pair.

### E. Removed reviews

With the full list in hand, a mirrored row for this place that is in no page of the answer gets
`removed_at = now` (and is cleared if it comes back). Only after a COMPLETE listing - a failed or
truncated run marks nothing. `is_hidden` (staff's own hide) is untouched.

### F. The alarm becomes exact

- After a run: `totalReviewCount` vs live mirrored rows. A difference is written to `sync_error`
  ("Google lists 91, the mirror holds 88") and the dashboard banner shows it.
- Token trouble (`invalid_grant`) gets its own message: "reconnect the Google account
  (scripts/gbp-connect.mjs)".
- The 21-day quiet-feed warning stays for the Elfsight fallback only.

### G. Docs

CLAUDE.md (`googleReviewsSync` bullet + the env block), `/guide` if the banner wording is
described there, this plan marked done.

## Order of work

1. Dor: steps 1-3 (submit the access request today).
2. Code A-D behind the env switch - mergeable before the approval lands; without the variables the
   cron keeps reading Elfsight exactly as now.
3. Approval arrives -> Dor: steps 4-5 -> first run with `?dry_run=1` (to add: counts what it would
   adopt / insert / mark removed, zero writes) -> real run -> compare with the Google profile.
4. E-F on, then G.

Code is about one working session; the calendar time is Google's approval.

## Risks

| Risk | Answer |
| --- | --- |
| Approval is slow or refused | The Elfsight fallback and the quiet-feed banner stay. Stop-gap: a Places API key (`NEXT_SECRET_GOOGLE_PLACES_API_KEY`, already supported) gives Google's live count and rating daily and five reviews a call, no approval needed |
| Refresh token expires (consent screen in Testing, password change, access revoked) | Own banner message + reconnect script; nothing on the site breaks, it only stops updating |
| The connected account loses its role on the profile | Same as above - 403, reported |
| Adoption mismatches a review | Dry run first; ambiguous pairs are reported, never guessed |
| A review Google removed stays on the site | Step E |

## Open questions for Dor

1. Which Google account owns the profile today - and can ours be made Manager?
2. Is `mega-events.co.il` a Google Workspace domain (makes the consent screen "Internal", no
   verification, tokens do not expire weekly)?
3. Until the approval: add the Places key as a stop-gap, or wait?
4. The eight still-missing September reviews: read them once from Maps in a signed-in browser
   (yours, with the Claude extension), or leave them for the API's first run?
