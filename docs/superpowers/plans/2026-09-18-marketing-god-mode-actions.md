# Marketing "God Mode" Dashboard - קובץ פעולות

**תאריך:** 2026-09-18
**מקור:** PRD "מסמך אפיון ראשוני" (Google Doc `1GWpUof1AXba-FI6-nI9UhfP2k1JnhzWbQcW9_pgmKVU`)
**סטטוס:** תכנון בלבד - שום קוד לא נכתב. המיפוי של "מה קיים" נעשה מול הקוד בשני הריפואים ב-18.09.

---

## 1. שורה תחתונה

ה-PRD מתאר 8 מודולים + מנוע התראות. מול הקוד:

- **2 מודולים כבר בנויים ברובם** - C (רמזור מחירים) ו-F (ROI משפיענים). צריך להרחיב, לא לבנות.
- **6 מודולים הם אינטגרציות חדשות** (Meta Ads, Google Ads, Instagram, Search Console, Clarity, Ads Library) - אין היום אף קריאת API לאחת מהן.
- **החסם האמיתי הוא לא ה-API אלא נתוני האמת שלנו.** POAS / Net Profit דורשים הכנסה אמיתית + COGS לכל הזמנה, והיום:
  - `totalRevenue` בדשבורד הקיים הוא **מזויף**: `pax * 175` (`lib/actions/dashboard-actions.ts:168`).
  - אירוע `purchase` שנשלח ל-GTM מהאתר נושא **ערך קבוע של 1500 USD** (`myt-main/lib/gtmAnalytics.ts:79`) - כל ROAS שמטא/גוגל מחשבות היום מבוסס על מספר מומצא.
  - **אין עלות ספק לכרטיס** על ההזמנה. יש רק `offline_flight_cost` / `offline_hotel_cost`. בלי זה אין רווח נקי.
- לכן **שלב 0 (יסודות דאטה) קודם לכל מסך.** בלי זה הדשבורד יציג מספרים יפים ושגויים.

---

## 2. מה קיים היום מול כל מודול

| מודול | קיים | חסר |
|---|---|---|
| **A - הנהלה** | דשבורד בסיסי (`app/(dashboard)/dashboard`), ספירת הזמנות לפי יום, חישוב רווח חלקי לשותפים (`partners-dashboard-actions.ts:385-415` - `knownSupplierCosts`, `netAfterCommissionUsd`) | הכנסה אמיתית, COGS לכרטיס, Spend, CAC/ROAS |
| **B - מדיה ממומנת** | פיד מוצרים למטא (כתיבה בלבד), `product id = events.id` גם בפיד וגם באירועי האתר - מפתח ה-join כבר מיושר | כל קריאה מ-Meta Marketing API / Google Ads API; אין טוקנים, אין ad account id |
| **C - מלאי ותמחור** | רמזור מלא: 5 מתחרים, זחלנים, התאמה, אורות, `/price-light`, תג "ירידת מחיר", משימות אוטומטיות | טראפיק + CVR לאירוע; "מלאי נותר" (אין כמות - רק `available` בוליאני; כמות אמיתית רק ב-TixStock ובמלאי offline) |
| **D - אינסטגרם אורגני** | כלום | הכל |
| **E - SEO** | כלום | הכל |
| **F - משפיענים** | הנכס החזק: `affiliates_tracking` (קליקים + שלבי משפך), RPCs של partner insights, קופון משפיען (`influencer_partner_code`), `coupon_discount_usd`, עמלות מוקפאות להזמנה, פורטל | תצוגה מרוכזת אחת של ROI נקי לכל המשפיענים; עלות המשפיען (אם יש תשלום קבוע מעבר לעמלה) |
| **G - Clarity** | Clarity **לא מותקן**. כן קיים: Mixpanel עם session recording 100%, GTM, Zoho PageSense | התקנה + קריאת נתונים |
| **H - מודעות מתחרים** | כלום | הכל |
| **התראות** | מייל (ZeptoMail, `lib/email.ts`), מנוע חוקים שבועי (`lib/services/task-rules/*`), Tasks Hub עם לוח `marketing` | Slack, Push, חוקים על נתוני מדיה |
| **ייחוס (Attribution)** | `utm_touches` (עד 5 נגיעות להזמנה, כולל `gclid`/`fbclid`), עוגיית `myt_utm` 90 יום | מסך אגרגטיבי; מוסכמת שמות `utm_campaign` שמתחברת ל-campaign id |

ניווט: קבוצת **Marketing** כבר קיימת ב-`lib/nav.ts` (Creative Generator, Meta Feed, Partners, Coupons, Forms) - הדשבורד נכנס אליה.

---

## 3. הערות היתכנות על ה-PRD (לפני שמתחייבים)

1. **"זמן אמת"** - לא ריאלי ולא נחוץ. ממליץ: cron שמושך snapshot יומי/כל 4 שעות לטבלאות שלנו, והמסך קורא רק מה-DB. טעינה מהירה, היסטוריה נשמרת, אין תלות ב-rate limits בזמן צפייה.
2. **טוגל כיבוי/הדלקה של קמפיין (מודול B)** - זו הרשאת **כתיבה** לחשבון הפרסום (`ads_management`). סיכון: באג אצלנו מכבה קמפיין חי. ממליץ לדחות לשלב אחרון, אחרי שהקריאה יציבה, עם אישור כפול + audit.
3. **Clarity Embed (מודול G)** - Clarity חוסם הטמעה ב-iframe. מה שכן אפשרי: Data Export API (מוגבל ל-~10 קריאות ביום, 1-3 ימים אחורה) שנותן Rage Clicks / Dead Clicks לפי URL, + קישור עמוק לתוך Clarity עם הפילטר מוכן. **לאמת מול התיעוד העדכני בספייק.**
4. **Meta Ads Library API (מודול H)** - למיטב ידיעתי ה-API מחזיר מודעות מסחריות רק אם הוצגו ב-EU/UK (מודעות פוליטיות - בכל העולם). מתחרים ישראלים שמפרסמים לישראל כנראה **לא יחזרו**. חייבים ספייק של שעה עם טוקן אמיתי לפני שמתכננים את המודול. חלופות: זחילה של עמוד ה-Ads Library (שביר, אפור מבחינת תנאי שימוש) או שירות צד ג'.
5. **Google Ads API** - דורש Developer Token עם אישור Basic Access מגוגל. תהליך של ימים עד שבועות. **להגיש בקשה היום**, זה הנתיב הקריטי של מודול B.
6. **Price Scraper "פעם ביום על 2-3 אתרים"** - כבר קיים ורחב יותר (5 מתחרים). בכוונה **לא** זוחל פעם ביום: אתר אחד לכל היותר ל-72 שעות כדי לא להיחסם. לא לשנות את זה בגלל ה-PRD.
7. **מטבע** - ה-PRD מדבר ב-EUR. אצלנו ההזמנות ב-USD (`user_shown_price`) + ILS (`final_purchase_price_ils`), וחשבונות הפרסום כנראה ב-ILS/USD. צריך החלטה על מטבע תצוגה אחד (ממליץ USD, כמו שאר הבקאופיס).

---

## 4. שלב 0 - יסודות דאטה (חוסם הכל)

| # | פעולה | ריפו | הערכה | הערות |
|---|---|---|---|---|
| 0.1 | **הכנסה אמיתית להזמנה** - פונקציה אחת `reservationRevenueUsd()` : `final_purchase_price_ils / rate` פחות `coupon_discount_usd` פחות `agent_card_discount_ils`, רק סטטוס Paid | backoffice | 0.5 יום | להחליף גם את ה-`pax * 175` המזויף בדשבורד הקיים |
| 0.2 | **COGS להזמנה** - להוציא את `knownSupplierCosts` מ-`partners-dashboard-actions.ts` לשירות משותף `lib/services/reservation-pnl.ts` (pure + selftest) | backoffice | 1 יום | טיסה: offline cost או מחיר Amadeus מ-`flight_order_info`; מלון: offline cost או `hotel_order_info`; עמלת שותף; עמלת סליקה (% קבוע - צריך מספר מדור) |
| 0.3 | **עלות ספק לכרטיס** - snapshot של מחיר הנטו של הכרטיס ברגע ההזמנה לעמודה חדשה `reservations.ticket_cost_usd` (migration כאן, כתיבה ב-`confirm-order` במיין) | שניהם | 1.5 יום | לבדוק קודם איפה הנטו זמין לכל ספק (XS2 יש net/face; TixStock/LiveTickets/P1 - לבדוק). להזמנות היסטוריות: backfill משוער או "לא ידוע" |
| 0.4 | **תיקון ערך ה-purchase** - לשלוח `value` = ההכנסה האמיתית + `currency` נכון במקום 1500 הקבוע; להוסיף `begin_checkout` שלא נורה היום | main | 0.5 יום | משפיע מיד על האופטימיזציה של מטא/גוגל - **הרווח הכי מהיר במסמך**, בלי קשר לדשבורד |
| 0.5 | **ביקורת GTM** - מה באמת מוגדר בקונטיינר: GA4 property, Meta Pixel, Google Ads conversion, CAPI. בקוד אין `fbq` ואין `AW-`; ה-server-side שולח ל-`G-0000000000` (placeholder) | שיווק + דור | 0.5 יום | קובע אם GA4 Data API שמיש כמקור לטראפיק/CVR |
| 0.6 | **מוסכמת UTM** - בכל מודעה: `utm_campaign={{campaign.id}}` (מטא) / `{campaignid}` (גוגל), `utm_content={{ad.id}}`. כך `utm_touches.utm_campaign` מתחבר 1:1 ל-campaign id מה-API | שיווק | חצי יום הגדרה | בלי זה אין join בין הוצאה להכנסה אמיתית. קמפיינים קיימים - לעדכן URL parameters |
| 0.7 | **מודל ייחוס** - איזו נגיעה מקבלת את ההזמנה: ראשונה / אחרונה / אחרונה-ממומנת | החלטת דור + שיווק | - | ממליץ: last paid touch, fallback ל-primary. משפיען מוגן נשאר כמו היום |

**סה"כ שלב 0: ~4-5 ימי פיתוח.** 0.4 ו-0.6 שווים לבצע גם אם הדשבורד לא נבנה בכלל.

---

## 5. שלב 1 - מסך הנהלה + מדיה ממומנת (קריאה בלבד) - מודולים A + B

| # | פעולה | הערכה |
|---|---|---|
| 1.1 | **גישות (דור)**: Meta - System User ב-Business Manager עם `ads_read` על חשבון הפרסום + ad account id. Google - Developer Token (להגיש בקשה), OAuth client, refresh token, customer id | חיצוני, להתחיל היום |
| 1.2 | Migration: `ad_spend_daily` (`platform, account_id, campaign_id, campaign_name, adset_id?, day, spend, currency, impressions, clicks, platform_purchases, platform_revenue`), unique על (platform, campaign_id, adset_id, day). RLS on, בלי policies, בקאופיס בלבד | 0.5 יום |
| 1.3 | `lib/services/ads/meta-insights.ts` + cron `adsSync` (4 פעמים ביום, מושך 7 ימים אחורה כי מטא מעדכנת רטרואקטיבית, upsert). `guardCronRoute`, `?dry_run=1`, רישום ב-`vercel.json` | 1.5 יום |
| 1.4 | `lib/services/ads/google-ads.ts` - אותו חוזה, אותה טבלה | 1.5 יום (אחרי אישור הטוקן) |
| 1.5 | `lib/services/marketing-pnl.ts` (pure): מחבר `ad_spend_daily` ↔ הזמנות Paid דרך `utm_touches.utm_campaign` לפי מודל הייחוס. מחזיר לכל קמפיין: spend, רכישות אמיתיות, הכנסה אמיתית, COGS, **POAS = (הכנסה - COGS - spend) / spend** | 1 יום |
| 1.6 | מסך `/marketing` (קבוצת Marketing ב-`lib/nav.ts`, `ADMIN_ROLES`): כרטיסי A (Spend / Revenue / Net Profit מול יעד / Blended CAC / Blended ROAS) + טבלת B ב-`DataTable`. בורר טווח תאריכים. שורת "לא מיוחס" להזמנות בלי קמפיין | 2 ימים |
| 1.7 | יעד רווח חודשי - שדה הגדרה פשוט (לצביעה ירוק/אדום) | 0.5 יום |
| 1.8 | עדכון `/guide` + `CLAUDE.md` + env vars | 0.5 יום |

**סה"כ שלב 1: ~8-9 ימים** (גוגל תלוי באישור חיצוני - מטא יכול לעלות לבד קודם).

---

## 6. שלב 2 - רדאר מוצרים - מודול C (הרחבת הרמזור, לא מערכת חדשה)

| # | פעולה | הערכה |
|---|---|---|
| 2.1 | **מקור טראפיק לאירוע** - החלטה: GA4 Data API (חינם, service account; תלוי בתוצאת 0.5) מול Mixpanel Query API (האירועים כבר עשירים - `eventSelected`, `eventCheckout`, `eventPayment`; לבדוק אם התוכנית שלנו כוללת API). ממליץ GA4 אם הוא תקין, אחרת Mixpanel | החלטה |
| 2.2 | טבלה `event_traffic_daily` (`event_id, day, views, checkouts`) + cron יומי | 1.5 יום |
| 2.3 | CVR = הזמנות Paid / views לאירוע, חלון 30 יום | 0.5 יום |
| 2.4 | **מלאי נותר**: כמות אמיתית רק איפה שיש (TixStock quantity, הקצאות offline). לשאר: "זמין / Sold". לא להמציא מספר | 1 יום |
| 2.5 | תצוגה: עמודות טראפיק / CVR / מלאי ב-`/price-light` או טאב "Products" ב-`/marketing` שקורא את אותם `light_*` | 1.5 יום |
| 2.6 | "המלצת מערכת" (זולים + CVR גבוה → Push; יקרים + CVR נמוך → הסבר) - חוקים דטרמיניסטיים בסגנון `price-advice.ts`. עובדות, לא החלטה | 1 יום |

**סה"כ: ~6 ימים.** לזכור: הרמזור משווה מול מחיר ה-"from" נטו-מרווח שלנו, לא מול מחיר האתר - להשאיר כך.

---

## 7. שלב 3 - מודול F מרוכז + מנוע התראות

| # | פעולה | הערכה |
|---|---|---|
| 3.1 | טאב "Influencers" ב-`/marketing`: שורה למשפיען - קליקים (`affiliates_tracking`), קופונים שמומשו ושולמו (`coupons.times_paid`), הכנסה אמיתית, עמלה, ROI נקי. הכל מה-RPCs הקיימים + `reservation-pnl.ts` | 1.5 יום |
| 3.2 | עלות קבועה למשפיען (אם משלמים מעבר לעמלה) - שדה ב-`partners` | 0.5 יום + החלטה |
| 3.3 | **התראות** - להרחיב את מנוע החוקים הקיים במקום מנוע חדש: חוק = משימה בלוח `marketing` + מייל. חוקים: Budget Bleed (spend > X בלי רכישה אמיתית ב-N ימים), Price Drop (כבר קיים - Rule C ברמזור, רק לשייך ללוח), ויראליות ומתחרים (בשלבים 4-5) | 2 ימים |
| 3.4 | Slack - Incoming Webhook (`NEXT_SECRET_SLACK_WEBHOOK_URL`), ערוץ אחד. Push - **לא לבנות** (אין אפליקציה; מייל + Slack מכסים) | 0.5 יום |
| 3.5 | התראות הן יומיות/כל 4 שעות, לא מיידיות - נגזר מקצב ה-cron | - |

**סה"כ: ~5 ימים.**

---

## 8. שלב 4 - אורגני - מודולים D + E

| # | פעולה | הערכה |
|---|---|---|
| 4.1 | **E - Search Console**: service account שמתווסף כמשתמש ב-GSC, cron יומי → `gsc_queries_daily` (`query, page, day, position, impressions, clicks`). טאב SEO. הנתונים מגיעים באיחור של 2-3 ימים | 2 ימים |
| 4.2 | קניבליזציה: אותה שאילתה, 2+ עמודים עם חשיפות משמעותיות באותו חלון → דגל. חוק pure + selftest | 1 יום |
| 4.3 | **D - Instagram**: חשבון Business מחובר לעמוד פייסבוק + אותו System User (`instagram_basic`, `instagram_manage_insights`). cron → `ig_media` + `ig_media_insights_daily` (reach, likes, comments, saves, shares). גריד עם thumbnail. סטוריז נעלמים אחרי 24 שעות - ה-cron חייב לתפוס אותם בזמן | 2.5 ימים |
| 4.4 | חוק ויראליות: מעורבות > 200% מממוצע 30 הפוסטים האחרונים → משימה/התראה | 0.5 יום |

**סה"כ: ~6 ימים.** E פשוט ועצמאי - אפשר להקדים אותו אם SEO בוער.

---

## 9. שלב 5 - מודולים G + H + טוגל

| # | פעולה | הערכה |
|---|---|---|
| 5.1 | **G**: התקנת Clarity דרך GTM (שיווק, בלי פיתוח). ספייק על Data Export API. מסך: Rage/Dead clicks לפי עמוד + קישורים עמוקים להקלטות מסוננות. חלופה זולה: Mixpanel כבר מקליט 100% מהסשנים | 0.5 ספייק + 1.5 יום |
| 5.2 | התראת UX Crash: זינוק Rage Clicks בעמודי `/order` מול ממוצע 7 ימים | 0.5 יום |
| 5.3 | **H - ספייק קודם**: שעה עם טוקן - האם ה-API מחזיר מודעות של מתחרה ישראלי. אם כן: cron יומי → `competitor_ads` (page, ad id, start date, creative url, body, CTA), דגל "מנצחת" מעל 30 יום, התראה על 5+ מודעות חדשות. אם לא: החלטה על חלופה | 1 שעה, ואז 3 ימים |
| 5.4 | **טוגל קמפיינים במטא**: `ads_management`, `requireAdmin`, דיאלוג אישור, `logAudit`, רק pause/resume ברמת קמפיין | 1.5 יום |

---

## 10. פעולות לפי בעלים

### דור (חיצוני - להתחיל היום, זה הנתיב הקריטי)
- [ ] להגיש בקשת Google Ads Developer Token (Basic Access)
- [ ] Meta Business Manager: System User + טוקן `ads_read` + ad account id
- [ ] Google Cloud service account אחד ל-GA4 Data API + Search Console; להוסיף אותו כ-viewer בשניהם
- [ ] לוודא שהאינסטגרם הוא חשבון Business מחובר לעמוד
- [ ] מספר: עמלת סליקה % (ל-COGS)
- [ ] החלטות סעיף 11

### מנהל שיווק (Product Owner)
- [ ] ביקורת GTM (0.5) - מה מותקן בפועל
- [ ] מוסכמת UTM בכל המודעות הפעילות (0.6)
- [ ] רשימת 3-5 עמודי מתחרים למודול H
- [ ] ספי התראות: סכום Budget Bleed, אחוז Price Drop, יעד רווח חודשי
- [ ] התקנת Clarity ב-GTM

### פיתוח
- [ ] שלב 0 (0.1-0.4) - מיד, לא תלוי באף גישה חיצונית
- [ ] שלבים 1-5 לפי הסדר, כל שלב PR נפרד עם migration משלו (migrations רק מ-master)

---

## 11. החלטות פתוחות לדור

1. **COGS: משוער או בפועל?** snapshot בזמן הזמנה (אוטומטי, מדויק ~90%) מול שדות "עלות בפועל" שאופרציה ממלאת אחרי רכישה (מדויק, תלוי משמעת). ממליץ: snapshot עכשיו, שדות ידניים כ-override בהמשך.
2. **מודל ייחוס** (0.7) - ממליץ last paid touch.
3. **מטבע תצוגה** - ממליץ USD.
4. **מי רואה** - ממליץ `ADMIN_ROLES` למסך כולו (יש בו רווח נקי ועלויות ספקים); אפשר טאבים SEO/Instagram פתוחים לכל הצוות.
5. **איפה זה חי** - ממליץ בבקאופיס, מסך `/marketing` עם טאבים (כמו `/tasks`), לא אפליקציה נפרדת.
6. **סדר עדיפויות אחרי שלב 1** - ההמלצה: C → F+התראות → E → D → G → H → טוגל. אם SEO או אינסטגרם דחופים יותר לשיווק - להחליף.

---

## 12. השפעה חוצת-פרויקטים

- **myt-main משתנה ב-2 מקומות בלבד**: `confirm-order` (כתיבת `ticket_cost_usd`) ו-`gtmAnalytics.ts` + עמוד confirmation (ערך purchase אמיתי). לפרוס בקאופיס (migration) לפני מיין.
- כל הטבלאות החדשות (`ad_spend_daily`, `event_traffic_daily`, `gsc_queries_daily`, `ig_*`, `competitor_ads`) הן בקאופיס-בלבד: RLS on, בלי policies. מיין לא קורא אותן.
- העמודה החדשה ב-`reservations` - nullable, בלי CHECK (מיין כותב לטבלה).
- הרמזור ומנוע התמחור (`price-quote.ts`) **לא משתנים**. הדשבורד רק קורא.

## 13. סדר גודל כולל

| שלב | ימי פיתוח | תלות חיצונית |
|---|---|---|
| 0 - יסודות | 4-5 | אין |
| 1 - A + B | 8-9 | טוקנים מטא/גוגל |
| 2 - C | 6 | GA4 תקין או Mixpanel API |
| 3 - F + התראות | 5 | Slack webhook |
| 4 - D + E | 6 | service account, IG Business |
| 5 - G + H + טוגל | 7-8 | ספייקים |
| **סה"כ** | **~37-40 ימים** | |

MVP שנותן ערך אמיתי = שלבים 0 + 1 (מטא בלבד) ≈ **10 ימי פיתוח**.
