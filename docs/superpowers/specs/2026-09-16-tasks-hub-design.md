# מרכז המשימות (Tasks Hub) — Design Spec

**תאריך:** 16.09.2026 · **סטטוס:** מאושר בצ'אט ע"י דור (3 חלקים), ממתין לסקירת spec

דור (16.09): "אני רוצה שנתחיל לבנות את כל המשימות השבועיות, הדברים שצריך לבחון ברמזור /
שינוי מחיר — משימות שהמערכת תבנה לנו אוטומטית ותשייך ליוזרים ע"פ הגדרה. וגם להרחיב את
היכולת לנהל שיח על משימה פה + לצרף תמונות … ואז גם נוכל להעביר את כל ROAD MAP לפה".

הספק מרחיב את לוח המשימות שנבנה ב-01.09 (`tasks`, `/tasks`, `components/task-editor.tsx`,
`lib/services/task-notify.ts`) לשלושה דברים: מנוע משימות חוזרות מונע-כללים, פתיל שיח עם
תמונות ואזכורים, ובליעת אפליקציית ה-ROADMAP (`GitHub/RoadMap`) שחיה היום ב-localStorage בלבד.

---

## החלטות נעולות

| #   | נושא            | הכרעה                                                                                                                                              |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | סוג הייצור      | **שניהם**: סקירה שבועית אחת לכל תחום (`weekly_digest`) **וגם** משימה נפרדת לפריט שעובר סף (`per_item`)                                              |
| 2   | שיוך            | **טבלת כללים לפי תחום** — לא assignee קבוע לתבנית. שורה = תחום + פילטר → משובץ + עדיפות + יעד                                                       |
| 3   | מנוע            | הכלל בדאטה (`task_rules`), הגנרטור בקוד (`lib/services/task-rules/<domain>.ts`). אותו דפוס כמו `lib/agents/` — הוספת תחום = קובץ + שורה             |
| 4   | קרון            | קרון שבועי אחד (`weeklyTaskGen`), לא קרון לכל כלל. `guardCronRoute`, `?dry_run=1`                                                                    |
| 5   | dedupe          | `weekly_digest`: כלל + שבוע ISO. `per_item`: משימה פתוחה קיימת לאותו (entity, scope) — מחזיר `existed: true`, לא כפילות                             |
| 6   | שיח             | תגובות + הדבקת תמונות + `@אזכור` עם מייל + שורות activity בפתיל. **בלי** מייל על כל תגובה                                                           |
| 7   | קבצים           | באקט **פרטי** `task-attachments` + signed URL לשעה. צילום מסך יכול להכיל שם לקוח/מחיר ספק — לא באקט ציבורי                                          |
| 8   | רודמפ           | **הכל** עובר — פיתוח + שיווק. מקור הנתונים: ייצוא מה-localStorage של דור, לא `DEFAULT_TASKS` שבריפו                                                 |
| 9   | תצוגה           | טבלה + קאנבן. גרירה על HTML5 drag נייטיב — **בלי ספריית dnd חדשה** (חוק "no new UI libs")                                                            |
| 10  | נראות           | כל staff רואה הכל. editor מגיב על הכל, משנה סטטוס רק של שלו. אדמין משייך/עורך/מוחק. נאכף ב-server action                                            |
| 11  | האפליקציה הישנה | לא נמחקת. אחרי ייבוא מוצלח — באנר "עבר ל-/tasks", קריאה בלבד                                                                                        |
| 12  | סטטוס חדש       | `paused` נכנס לרשימת הסטטוסים. בלעדיו `paused` של השיווק היה מתורגם ל-`cancelled` — וזה שקר                                                          |

---

## 1. מודל הנתונים

מיגרציה אחת, `npm run db:new tasks_hub`, אחרי `git fetch origin && git merge origin/master`.
הכול idempotent. **לא מפעילים מהברנץ'** — נכנסת עם ה-PR למאסטר (חוק המיגרציות בריפו).
בלי CHECK constraints על `status`/`priority`/`board`/`channel` — ולידציה ב-`task-actions.ts`,
בדיוק כמו היום.

### 1.1 הרחבת `tasks`

```sql
alter table public.tasks add column if not exists board    text not null default 'ops';
alter table public.tasks add column if not exists phase    smallint;
alter table public.tasks add column if not exists channel  text;
alter table public.tasks add column if not exists progress smallint;
```

| עמודה      | ערכים                                                | שייך ל-                 |
| ---------- | ---------------------------------------------------- | ----------------------- |
| `board`    | `dev` \| `marketing` \| `ops`                        | הכל. `ops` = ברירת מחדל |
| `phase`    | 1..7                                                 | `dev` בלבד              |
| `channel`  | `social\|email\|seo\|ads\|content\|partnerships\|pr` | `marketing` בלבד        |
| `progress` | 0..100                                               | `marketing` בלבד        |

`ops` הוא כל מה שהמערכת מייצרת היום (רמזור, פערי קריאייטיב, שינויי מחיר) ומשימות תפעול
ידניות. כל השורות הקיימות מקבלות `ops` — זה בדיוק מה שהן, ולכן אין backfill.

תוויות הפאזות והערוצים חיות **רק** ב-`lib/task-boards.ts` (שם, תת-שם, צבע מטוקני "MYT Admin"),
לא בפלטה של האפליקציה הישנה ולא בדאטה.

### 1.2 סטטוסים ועדיפויות

`TASK_STATUSES` → `todo | in_progress | paused | done | cancelled`.
`paused` מתנהג כפתוח לכל דבר (נספר ב"פתוחות"), ולכן האינדקס החלקי
`tasks_assignee_open_idx` נבנה מחדש עם `status in ('todo','in_progress','paused')`.

`critical` של הרודמפ ממופה ל-`urgent` בייבוא. `PRIORITY_ORDER` לא משתנה.

`TASK_SOURCES` מקבל שני ערכים: `recurring` (נולד מכלל ב-`task_rules`) ו-`roadmap` (יובא
מהאפליקציה הישנה). הערכים הקיימים — `manual`, `creative_gap`, `price_review`, `price_light` —
נשארים כמו שהם, כולל המשימות שכבר בפרוד.

### 1.3 `events.light_red_since` — מאז מתי אדום

```sql
alter table public.events add column if not exists light_red_since timestamptz;
```

בלי העמודה הזו `min_weeks_red` ("אדום כבר שבועיים") הוא ניחוש מתוך `audit_log` — לוג החלטות,
לא ציר זמן של אורות, ושורה שנמחקה ברטנציה מוחקת גם את הידיעה. לכן:

- `recomputeEventLights` (`lib/services/price-light-store.ts`) כותב `light_red_since = now()`
  ברגע שאירוע **נכנס** לאדום באחד הסקופים ואין לו כבר ערך, ומאפס ל-`null` ברגע ששני הסקופים
  אינם אדומים — באותה כתיבה שכבר מנקה `light_silenced_until`.
- אור אדום שנשאר אדום לא נוגע בערך. חזרה לאדום אחרי הפוגה מתחילה ספירה חדשה, וזה הנכון:
  "אדום שבועיים ברצף" ולא "אדום מתישהו".
- העמודה נוספת ל-`LIGHT_COLUMNS` שב-store ולטיפוס האירוע של הרמזור.
- העמודה חדשה, אז בכל האירועים היא `null` עד המעבר הלילי הראשון. `min_weeks_red` מתייחס
  ל-`null` כ"לא ידוע" ו**לא** מייצר משימה — עדיף שבוע שקט מאשר גל משימות שקרי ביום הראשון.
- האתר הראשי לא קורא את העמודה (הוא קורא 4 עמודות אור בלבד) — אין השפעה חוצת-פרויקטים.

### 1.4 `task_rules` — הכלל הוא דאטה

```sql
create table if not exists public.task_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                          -- "רמזור ספורט → תום"
  domain       text not null,                          -- price_light | price_changes | creative_gaps | custom
  mode         text not null default 'weekly_digest',  -- weekly_digest | per_item
  match        jsonb not null default '{}'::jsonb,     -- הפילטר של התחום (ראה 2.2)
  assignee_id  uuid references public.user_profiles(id) on delete set null,
  priority     text not null default 'medium',
  due_days     smallint,                               -- יעד = יום ההרצה + N
  dow          smallint not null default 0,            -- 0=ראשון .. 6=שבת
  board        text not null default 'ops',
  title        text,                                   -- custom בלבד; בתחומים אחרים הגנרטור מנסח
  description  text,
  active       boolean not null default true,
  last_run_at  timestamptz,
  created_by   uuid references public.user_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists task_rules_active_idx on public.task_rules (domain) where active;
alter table public.task_rules enable row level security;  -- service-role only, כמו tasks
```

### 1.5 `task_comments` — פתיל אחד לתגובות ולהיסטוריה

```sql
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references public.user_profiles(id) on delete set null,
  kind        text not null default 'comment',    -- comment | activity
  body        text,                               -- ריק ב-activity
  activity    jsonb,                              -- {field,from,to}
  attachments jsonb not null default '[]'::jsonb, -- [{path,name,mime,size,width,height}]
  mentions    uuid[] not null default '{}',
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;
```

תגובות ושורות מערכת באותה טבלה בכוונה: הפתיל הוא סיפור כרונולוגי אחד, ושתי טבלאות היו
מחייבות מיזוג בקוד בכל פתיחה. `activity` נכתב מתוך `updateTask`, לא מטריגר DB — טריגר לא
יודע מי המשתמש שביצע.

### 1.6 באקט `task-attachments`

```sql
insert into storage.buckets (id, name, public) values ('task-attachments','task-attachments', false)
on conflict (id) do nothing;
```

פרטי, כמו `user_contracts`. כל קריאה עוברת ב-server action שמייצר signed URL לשעה.

---

## 2. מנוע המשימות החוזרות

### 2.1 הזרימה

קרון `weeklyTaskGen`, ראשון 06:00 UTC (`vercel.json`), `guardCronRoute(request)` שורה ראשונה.
לכל כלל `active` שה-`dow` שלו הוא היום:

1. הגנרטור של ה-`domain` מחזיר מועמדים לפי `match`.
2. `weekly_digest` → משימה **אחת**: כותרת מנוסחת מהמניין ("סקירת רמזור שבועית — 12 אדומים
   ממתינים להחלטה"), `source: 'recurring'`, `source_ref: {kind:'rule', table:'task_rules',
   row_id:<rule id>, label:<שם הכלל>, url:<מסך התחום>}` + שבוע ה-ISO בתוך ה-ref ל-dedupe.
   אפס מועמדים = אין משימה, ונרשם למה.
3. `per_item` → משימה לכל מועמד שעובר את הסף, dedupe על משימה פתוחה קיימת לאותו entity+scope
   (בדיוק כמו `openPriceLightTask` היום).
4. שיוך: `assignee_id` של הכלל. מייל דרך `notifyTaskAssigned` הקיים.
5. `logAudit({action:'tasks.generated'})` עם מה נוצר, מה דולג ולמה; `last_run_at` מתעדכן.
6. `?dry_run=1` — דוח מלא, אפס כתיבות (כמו `base-price-sync`).

הריצה חסומה בתקציב זמן (270s) ועוברת על הכללים לפי `last_run_at` הישן ביותר קודם, כך שקיצוץ
באמצע לא מרעיב כלל מסוים שבוע אחר שבוע.

### 2.2 התחומים בגרסה ראשונה

| `domain`        | מועמדים                                                                   | `match` נתמך                                        | קישור                    |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------ |
| `price_light`   | אירועים עם אור אדום שאינם מושתקים ואין להם משימה פתוחה (`isPending` היום) | `scope`, `vertical`, `min_gap_usd`, `min_weeks_red` | `/price-light?f=pending` |
| `price_changes` | שורות `needs_review` ב-`base_price_sync_log`                              | `min_deviation_usd`, `max_age_days`                 | `/price-changes`         |
| `creative_gaps` | פערים פתוחים (12 הסוגים), לא `dismissed`                                  | `kinds[]`, `min_severity`                           | `/tasks` (לשונית הפערים) |
| `custom`        | אין — הכלל עצמו הוא המשימה                                                | —                                                   | `title`/`description` של הכלל |

הגנרטורים **קוראים בלבד**. אף אחד מהם לא כותב מחיר, לא מוריד אירוע ולא מכבה אור — הם רק
מנסחים משימה. אותו קו הפרדה כמו ברמזור: האור לא נוגע בתמחור.

### 2.3 סגירה אוטומטית

משימת `weekly_digest` נסגרת לבד (`status:'done'`, הערה "נסגר אוטומטית — אין יותר פריטים
פתוחים") כשהגנרטור שלה מחזיר אפס מועמדים בהרצה הבאה. אותה לוגיקה שכבר סוגרת משימת רמזור
כשהאור יורד מאדום (`lightSettled`). משימות `per_item` ממשיכות להיסגר בדיוק כמו היום.

### 2.4 מסך הכללים

`/tasks/rules`, אדמין בלבד (`ADMIN_ROLES` ב-`lib/nav.ts` + `requireAdmin()` בכל action).
שורה = "רמזור · ספורט · אדום · פער > $150 → תום · דחוף · יעד 3 ימים · ראשון". כפתור
**"הרץ עכשיו"** מריץ כלל בודד (audited), וכפתור **"תצוגה מקדימה"** מריץ אותו ב-dry-run
ומראה בדיוק אילו משימות היו נוצרות.

---

## 3. שיח על משימה

### 3.1 UI

הפתיל חי ב-sheet של המשימה. `components/task-editor.tsx` (240 שורות) נשאר טופס; הפתיל יוצא
לקומפוננטה נפרדת `components/task-thread.tsx` כדי שהקובץ לא יתפח. בטבלה ובכרטיס הקאנבן:
אייקון 💬 עם מספר התגובות.

### 3.2 תמונות

- `onPaste` על תיבת הכתיבה קורא `clipboardData.files`; אותו נתיב לגרירה ולבחירת קובץ.
- הקליינט מקטין ל-2000px רוחב (canvas) לפני שליחה, מציג thumbnail עם ספינר ו-X לביטול.
- `uploadTaskAttachment` (server action, `requireStaff`): `image/png|jpeg|webp|gif`, עד 5MB,
  ובודק **magic bytes** ולא רק את ה-mime שהדפדפן הצהיר. נתיב `{task_id}/{uuid}.{ext}`.
- קריאה: `signedAttachmentUrl` (שעה). לחיצה על thumbnail = לייטבוקס.
- מחיקת משימה מוחקת את הקבצים שלה מה-storage.

### 3.3 אזכורים

`@` פותח בורר staff; הבחירה מכניסה שם לטקסט ו-uuid ל-`mentions`. הזיהוי אינו פרסור של הטקסט —
שם עם רווח או שני אנשים עם אותו שם פרטי היו שוברים אותו.

מייל לכל מאוזכר חוץ מהכותב, דרך `lib/email.ts`, בתבנית אחות ל-`notifyTaskAssigned`:
נושא "אוזכרת במשימה: …", גוף = 300 התווים הראשונים + קישור למשימה. כישלון מייל נרשם
ולא מפיל את כתיבת התגובה — בדיוק כמו היום.

### 3.4 הרשאות

| פעולה                | editor       | admin |
| -------------------- | ------------ | ----- |
| קריאת פתיל           | כל המשימות   | הכל   |
| כתיבת תגובה          | כל המשימות   | הכל   |
| עריכה/מחיקה של תגובה | של עצמו בלבד | הכל   |
| שינוי סטטוס/התקדמות  | של עצמו בלבד | הכל   |
| שיוך, מחיקת משימה    | ✗            | ✓     |

מחיקת תגובה היא רכה (`deleted_at`) ומוצגת כ"התגובה נמחקה" — פתיל שנעלמות ממנו שורות משקר.
כל הבדיקות ב-server action, לא רק בהסתרת כפתור.

---

## 4. ייבוא ה-ROADMAP

### 4.1 המקור

האפליקציה (`GitHub/RoadMap`) שומרת ב-`localStorage` של הדפדפן בלבד (`me_tasks` + מפתח
השיווק). לכן המקור הוא **ייצוא מהדפדפן של דור**, לא `DEFAULT_TASKS` שבריפו — הוא המצב ההתחלתי,
לא המצב הנוכחי. נספק snippet קצר לקונסול שמדפיס את שני המפתחות ל-JSON.

### 4.2 המיפוי

| רודמפ             | tasks                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `title`,`desc`    | `title`, `description`                                                                      |
| `ph` 1..7         | `phase`, `board='dev'`                                                                      |
| `ch`              | `channel`, `board='marketing'`                                                              |
| `prog`            | `progress`                                                                                  |
| `pri` `critical`  | `priority='urgent'`; שאר הערכים זהים                                                        |
| `st`              | `inprogress`→`in_progress`; `planning`→`todo`; `active`→`in_progress`; `paused`→`paused`; `done`→`done` |
| `as` dor/alon/tom | `assignee_id` לפי **מייל** ב-`user_profiles`                                                |

### 4.3 הסקריפט

`scripts/import-roadmap.ts` (`npx tsx`), מקבל נתיב ל-JSON:

- אין התאמת מייל לאחד האנשים → הסקריפט **נעצר** ומדפיס את מי חסר. לא משייך `null` בשקט.
- `source: 'roadmap'`, `source_ref: {kind:'roadmap_dev'|'roadmap_mkt', table:'roadmap',
  row_id:<id מקורי>, label, url:'/tasks'}` — הרצה חוזרת **מעדכנת** את אותן שורות, לא מכפילה.
- `--dry-run` מדפיס בדיוק מה ייכתב (כמה חדשות, כמה עדכונים, מי משובץ) לפני נגיעה בפרוד.
- גם משימות `done` עוברות — ההיסטוריה שווה משהו, והלוח מסנן לפי סטטוס ממילא.

### 4.4 האפליקציה הישנה

נשארת פרוסה, קריאה בלבד, עם באנר "הלוח עבר ל-backoffice/tasks". לא מוחקים את הריפו ולא את
ה-localStorage של אף אחד — אם הייבוא פספס משהו, המקור עדיין שם.

---

## 5. תצוגות ב-`/tasks`

שלוש לשוניות: **Tasks** (הטבלה הקיימת) · **Kanban** (חדש) · **Creative gaps** (קיים).

- **עדשה** מעל הכל: `dev / marketing / ops / הכל` — עדשה אמיתית, מסננת גם את הטבלה, נשמרת
  ב-URL (`?board=`) כדי שקישור ישמור את מה שראית.
- **קאנבן**: עמודה לכל סטטוס; גרירה קוראת ל-`updateTask` (אופטימי, חוזר אחורה בכישלון).
  קיבוץ: ללא / לפי פאזה / לפי משובץ. כרטיס: כותרת, אווטאר, עדיפות, יעד, 💬, ופס התקדמות
  בלוח השיווק.
- **מובייל**: HTML5 drag לא עובד במגע — בכרטיס מופיע בורר סטטוס במקום הגרירה.
- הטבלה מקבלת עמודות `board`/`phase` ומסננים תואמים; `matchesSearch` (`lib/search.ts`) כמו
  בכל טבלה בריפו.

---

### 5.1 לשונית Pricing + סגירת פער אחידה (תוספת דור, 16.09)

- לשונית רביעית, **Pricing**, באותו דפוס של Creative gaps: פערי רמזור (אדום, לא מושתק) ושינויי
  מחיר שממתינים (`needs_review`) ברשימה אחת. המקור הוא **אותם גנרטורים** של מנוע הכללים (§2.2),
  כך שהמסך והקרון לעולם לא חלוקים על "מה נחשב פער".
- שלושה כפתורים: **משימה** (עם dedupe), **לתקן** (`/events/{id}#fix-price`), **טופל**.
- **טופל** = `markRepriced` (אודיט `price_light.repriced`, מה שהסוכן לומד ממנו) והסתרה עד
  החישוב הלילי הבא; פער ששרד חוזר. בשינוי מחיר — השורה ב-`base_price_sync_log` עוברת ל-`reviewed`.
- הלשונית גלויה **לכל הצוות**, בניגוד ל-`/price-light`.
- **כלל אחד לכל משפחת פערים:** משימה שנולדה מפער סוגרת אותו כשהיא `done`/`cancelled`, ומחזירה
  אותו כשהיא נפתחת מחדש — קריאייטיב, רמזור, שינוי מחיר, ומשימות חוזרות לפי ה-`kind` שלהן.
  הניתוב ב-`lib/services/gap-resolution.ts`, במקום הענף הייעודי לקריאייטיב שיש היום ב-`setTaskStatus`.

## 6. מה לא נכנס (YAGNI)

- תצוגת טיימליין/גאנט של פאזות — הקאנבן והסינון עונים על "מה מצב פאזה 4".
- מייל על כל תגובה (רק אזכור), תגובות מקוננות, ריאקשנים, עריכת תגובה של אחר.
- קבצים שאינם תמונות (PDF/וידאו), תגובות מלקוחות או משותפים — `/tasks` הוא staff בלבד.
- מנוע cron-expression לכל כלל — `dow` שבועי מספיק; `min_weeks_red` נותן את "כבר שבועיים אדום".
- סנכרון דו-כיווני עם האפליקציה הישנה. הייבוא חד-כיווני וחד-פעמי.

---

## 7. השפעה חוצת-פרויקטים

**אין.** `tasks`, `task_rules`, `task_comments` והבאקט הם backoffice-only — האתר הראשי לא
קורא אף אחד מהם. אין שינוי בטיפוסים המשותפים, אין שינוי בשרשרת המחיר, והגנרטורים קוראים
בלבד. `types/database.types.ts` יתעדכן ב-`npm run db:types` אחרי שהמיגרציה תגיע למאסטר.

---

## 8. סדר בנייה

1. מיגרציה (שדות `tasks`, `task_rules`, `task_comments`, באקט) + טיפוסים + `paused` בכל מקום.
2. פתיל השיח: actions, העלאה, signed URL, `task-thread.tsx`, אזכורים + מייל, שורות activity.
3. מנוע הכללים: רג'יסטרי גנרטורים, `weeklyTaskGen`, `/tasks/rules`, dry-run.
4. קאנבן + עדשת הלוחות + נראות חדשה ל-editor.
5. ייבוא הרודמפ (dry-run → אמיתי) + באנר באפליקציה הישנה.

2 ו-3 בלתי תלויים זה בזה ויכולים לרוץ במקביל; 4 תלוי ב-1 בלבד; 5 אחרון.
