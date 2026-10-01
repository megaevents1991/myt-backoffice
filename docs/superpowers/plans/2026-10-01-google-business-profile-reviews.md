# Google reviews, live and free - Google Business Profile API

Date: 2026-10-01 · Status: PLAN, nothing built · Decision: Dor picked this route (option 2)

---

## בקצרה (לדור)

**מה המטרה:** כל ביקורת חדשה בגוגל מופיעה באתר תוך דקות, עם המספר והדירוג האמיתיים של גוגל,
בלי Elfsight ובלי תשלום.

**איך:** ה-API הרשמי של גוגל לפרופיל העסק (Google Business Profile API). הוא **חינמי**, מחזיר את
**כל** הביקורות כולל תגובות הבעלים ותאריך מדויק, ויודע לשלוח לנו **התראה ברגע שנכתבת ביקורת**.

**מה עוצר אותנו היום:** גוגל צריכה לאשר לפרויקט שלנו גישה ל-API (טופס; ימים עד שבועות). עד
האישור כל קריאה נכשלת. לכן הצעד הראשון הוא להגיש את הבקשה.

### הצ'קליסט שלך (לפי הסדר)

- [ ] **1. מי הבעלים של הפרופיל?** להיכנס ל-business.google.com עם החשבון שמנהל את "Mega Events –
      חבילות להופעות ואירועי ספורט בחו״ל" ולוודא שהחשבון שנחבר הוא Owner או Manager.
      אם לא - לבקש מהבעלים להוסיף אותך (Users → Add → Manager).
- [ ] **2. פרויקט ב-Google Cloud** (console.cloud.google.com) על אותו חשבון: New Project, למשל
      `mega-events-reviews`. לרשום את ה-Project Number.
- [ ] **3. להגיש בקשת גישה ל-API** - "Google Business Profile API – Application for Basic API
      Access" (מחפשים בגוגל בשם הזה; הטופס מבקש Project Number, כתובת אתר ומייל של בעל הפרופיל).
      **זה הצעד הארוך - להגיש היום.** מחכים למייל אישור.
- [ ] **4. אחרי האישור - להדליק APIs** (APIs & Services → Library): My Business API (ביקורות),
      My Business Account Management API, My Business Business Information API,
      My Business Notifications API, Cloud Pub/Sub API.
- [ ] **5. מסך הסכמה + OAuth client** (APIs & Services → OAuth consent screen / Credentials):
      אם `mega-events.co.il` הוא Google Workspace - User type **Internal** (הכי פשוט). אחרת
      External + **Publish app** (במצב Testing הטוקן פג אחרי 7 ימים). Client מסוג Desktop app.
- [ ] **6. להריץ פעם אחת את סקריפט החיבור** (נכתוב אותו - שלב B) ולאשר בדפדפן.
- [ ] **7. להדביק ב-Vercel של הבקאופיס** את חמשת הערכים שהסקריפט מדפיס, ו-Redeploy.
- [ ] **8. לומר ל-Claude "המשך ביקורות גוגל"** - ריצת בדיקה (dry run), ואז ריצה אמיתית.

### כמה זה עולה

| רכיב | עלות |
| --- | --- |
| Google Business Profile API (ביקורות, פרטי פרופיל, התראות) | חינם, בלי כרטיס אשראי |
| Cloud Pub/Sub (ההתראה בזמן אמת) | חינם בנפח שלנו (10GB ראשונים בחודש חינם; אנחנו בקילובייטים). ייתכן שידרוש חשבון Billing פעיל בפרויקט - לבדוק בקונסול |
| Vercel cron + הפונקציה | כלול במה שכבר יש |
| Elfsight | לא נדרש יותר |

### מה קורה עד אז

- ה-cron ממשיך לקרוא מ-Elfsight (קפוא מ-04.09). הוא כבר לא דורס את המספר, ובאנר אדום בדשבורד
  אומר שהמקור ישן.
- ביקורות חדשות לא ייכנסו לבד. אפשר להוסיף ידנית (כמו שנעשה ב-01.10), או לשים בינתיים מפתח
  Places API (ראו "Bridge until the approval" למטה).

---

## Why (what happened)

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
count was derived from the feed's own length. Elfsight is someone else's paid account (we have
no access to it) and an unofficial endpoint - it can freeze or close again at any time.

**Done the same day (not part of this plan):** the five newest reviews were read by hand from the
public Google Maps page and inserted (76 rows); the profile summary was set to 84 / 5.0; the cron
takes its summary from the mirror and never lowers a stored count; a feed whose newest review is
21+ days old lights the dashboard banner. **Eight reviews (roughly 05.09 - 26.09) are still
missing**, and the five inserted ones carry day-precision dates. The first API run fixes both.

## Goal

1. Every review of the profile - text, rating, exact time, owner reply - comes from Google.
2. **Live:** a new review is on the site within minutes, not the next morning.
3. The count and the rating are Google's own numbers.
4. A review Google removed leaves the site.
5. A mirror that falls behind is reported, never silent.
6. No paid service.

## The API

Google Business Profile - the only official way to list ALL reviews of a profile. Free.

- **Reviews:** `GET https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews`
  - `pageSize` up to 50, `pageToken`, `orderBy=updateTime desc`
  - each review: `reviewId`, `reviewer.displayName`, `reviewer.profilePhotoUrl`,
    `starRating` (`ONE`..`FIVE`), `comment`, `createTime`, `updateTime`,
    `reviewReply.comment`, `reviewReply.updateTime`
  - the answer also carries `averageRating` and `totalReviewCount` - the truth for the summary
- **Finding the ids (once):**
  - accounts: `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`
  - locations: `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations?readMask=name,title,metadata`
    (`metadata.placeId` must equal `ChIJ4_iJNrNJZWoRHYuKTpYGzDE`)
- **Live notifications:** My Business Notifications API -
  `PATCH https://mybusinessnotifications.googleapis.com/v1/accounts/{accountId}/notificationSetting`
  with a Pub/Sub topic and `notificationTypes: ["NEW_REVIEW", "UPDATED_REVIEW"]`. Google publishes
  a message to the topic the moment a review is written or edited.
- **Auth:** OAuth 2.0, scope `https://www.googleapis.com/auth/business.manage`, consented by a
  Google account that is **Owner or Manager** of the profile. A service account cannot hold that
  role, so the server keeps a **refresh token**.

To verify while building (not checked on 2026-10-01): the exact `reviewId` format; whether
`business.manage` needs app verification for an External consent screen; whether Pub/Sub needs an
active billing account on the project.

## How "live" works

```
customer writes a review
        │
Google ─┴─► Pub/Sub topic ──push──► POST /api/google-reviews/notify   (backoffice)
                                            │  verifies Google's signed token
                                            ▼
                                   syncGoogleReviews()  (source "gbp")
                                            │  upsert, summary, removed
                                            ▼
                              new or changed rows?  ──► main /api/revalidate?path=/
                                                         (homepage + hubs show it at once)
```

- **Push** is the fast path: seconds to a minute.
- **Cron** stays as the net, moved from daily to **hourly** (`0 * * * *`) - one cheap listing call;
  it catches a missed push, a removed review (no notification exists for that) and token trouble.
- **Revalidation** is the piece missing today even with a working source: the cron writes the
  table but main's pages are ISR (one hour). A run that inserted or changed a row calls main's
  revalidate for `/` (and the `/c` layout), so "live" is real on the site, not only in the table.

## Build

Everything sits behind the env switch: without the five variables the cron keeps reading Elfsight
exactly as now, so A-D can merge before Google's approval arrives.

### A. Schema - one migration

- `google_reviews.gbp_review_id text` (nullable, unique where not null) - Google's API id, kept
  beside `review_key` (the Maps id the mirror is keyed by today) so nothing is re-keyed.
- `google_reviews.removed_at timestamptz` (nullable) - a review Google no longer lists.
- main's read (`lib/googleReviews.ts`) adds `.is("removed_at", null)` - deploy backoffice
  (migration) first, then main.

### B. Connect script - `scripts/gbp-connect.mjs`

Local, run once by Dor: opens the consent URL, catches the code on a loopback port, exchanges it,
lists accounts and locations, and prints the five values for Vercel. It writes nothing to the repo
and never echoes the client secret. `--notifications` also creates the Pub/Sub topic + push
subscription and registers the notification setting (step G).

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
- Summary straight from the answer: `averageRating`, `totalReviewCount`.
- `?dry_run=1` on the cron route: counts what a run would adopt / insert / mark removed, zero writes.

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
`removed_at = now` (cleared if it comes back). Only after a COMPLETE listing - a failed or
truncated run marks nothing. `is_hidden` (staff's own hide) is untouched.

### F. Site refresh

`syncGoogleReviews` returns `changed` (inserted + content updates + removed). When it is above
zero the caller (cron route, notify route, "Run sync now") calls main's `/api/revalidate` for the
homepage and the `/c` layout - the same call an event save already makes.

### G. Live push - `app/api/google-reviews/notify/route.ts`

- `POST` from a Pub/Sub **push subscription**. Verify the `Authorization: Bearer <OIDC JWT>` Google
  attaches (issuer, audience = our URL, the subscription's service-account email) - no shared
  secret in the URL. Anything else: 401.
- The message is only a signal: the handler runs `syncGoogleReviews()` and answers 204. A failure
  answers 500 so Pub/Sub retries.
- Debounce: a run already in the last 60 seconds is skipped (an edited review fires twice).
- `vercel.json`: the cron goes from `0 4 * * *` to `0 * * * *`.

### H. The alarm becomes exact

- After a run: `totalReviewCount` vs live mirrored rows. A difference is written to `sync_error`
  ("Google lists 91, the mirror holds 88") and the dashboard banner shows it.
- Token trouble (`invalid_grant`) gets its own message: "reconnect the Google account
  (scripts/gbp-connect.mjs)".
- The 21-day quiet-feed warning stays for the Elfsight fallback only.

### I. Docs

CLAUDE.md (`googleReviewsSync` bullet, the env block, the new route), `/guide` if the banner is
described there, this plan marked done.

## Order of work

| Step | Who | What | Waits for |
| --- | --- | --- | --- |
| 1 | Dor | Checklist 1-3: owner access, Cloud project, **submit the access request** | - |
| 2 | Claude | A, C, D, F + selftests, behind the env switch | - (can ship before approval) |
| 3 | Google | Approves the API access | days - weeks |
| 4 | Dor | Checklist 4-7: enable APIs, consent screen, connect script, Vercel values | 3 |
| 5 | Claude + Dor | `?dry_run=1`, read the report, real run, compare with the Google profile (count, newest review, a reply) | 4 |
| 6 | Claude | E, H on; hourly cron | 5 |
| 7 | Claude + Dor | G: Pub/Sub topic + push subscription + notification setting; write a test owner reply and watch it land | 5 |
| 8 | Claude | I | 7 |

The code is about one working session for steps 2 + 6, and a short one for step 7. The calendar
time is Google's approval.

## Acceptance - how we know it works

- A dry run reports: 76 adopted (or 71 + 5), 8 new, 0 ambiguous, 0 removed.
- After the real run: mirror rows = Google's `totalReviewCount`; the five hand-inserted rows carry
  exact timestamps; the homepage shows the count Google shows.
- A new review (or an owner reply) appears on the homepage within two minutes with push on, within
  an hour with push off.
- Revoking the token turns the dashboard banner red with the "reconnect" message within an hour.

## Bridge until the approval (optional)

A **Places API key** (`NEXT_SECRET_GOOGLE_PLACES_API_KEY`, already supported in the code) needs no
approval: Google's live count and rating every run, five reviews per call (Google's pick, not the
newest five). It needs a billing account on the project; one call a day sits inside the free
monthly allowance (check the current allowance in the console before enabling). With it the count
is always true and the banner can compare the count with the mirror - the missing texts still wait
for the Business Profile API.

## Risks

| Risk | Answer |
| --- | --- |
| Approval is slow or refused | The Elfsight fallback and the quiet-feed banner stay; the Places bridge above; manual top-ups |
| Refresh token expires (consent screen in Testing, password change, access revoked) | Own banner message + reconnect script; the site keeps what it has |
| The connected account loses its role on the profile | 403, reported the same way |
| Adoption mismatches a review | Dry run first; ambiguous pairs are reported, never guessed |
| A review Google removed stays on the site | Step E |
| Pub/Sub push never arrives | The hourly cron is the net - worst case one hour |
| Pub/Sub needs billing we do not want | Skip step G: hourly cron + revalidation alone is "within the hour", still free |

## Open questions for Dor

1. Which Google account owns the profile today - and can ours be made Manager?
2. Is `mega-events.co.il` a Google Workspace domain (consent screen "Internal": no verification,
   tokens do not expire weekly)?
3. Places key as a bridge until the approval - yes or wait?
