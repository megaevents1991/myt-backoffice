// The system guide's content - every section, rule, deep link and flow chart,
// in both languages. Pure data; guide-client.tsx renders it. Think of it as
// the CLAUDE.md of the backoffice, readable by humans.
//
// Keep it honest: when a flow changes (pricing rules, cron cadence, batch
// behavior), update the matching section here in the same PR.

export type L = { en: string; he: string };

export interface GuideLink {
  label: L;
  href: string;
  adminOnly?: boolean;
}

export interface GuideFlowStep {
  label: L;
  sub?: L;
}

export interface GuideFlow {
  title: L;
  steps: GuideFlowStep[];
}

export interface GuideSection {
  id: string;
  title: L;
  intro: L;
  /** Detailed explanation bullets. */
  points?: L[];
  /** Iron rules - the things that must not be broken. Highlighted. */
  rules?: L[];
  links?: GuideLink[];
  flow?: GuideFlow;
  adminOnly?: boolean;
}

const t = (en: string, he: string): L => ({ en, he });

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "getting-around",
    title: t("Getting around", "התמצאות במערכת"),
    intro: t(
      "The sidebar groups every screen by area. Groups collapse (chevron), remember their state, and show a hover preview of their contents when folded. The whole sidebar collapses to icons with Ctrl+B.",
      "הסיידבר מקבץ כל מסך לפי אזור. קבוצות נסגרות (חץ), זוכרות את המצב שלהן, ומציגות תצוגה מקדימה ב־hover כשהן מקופלות. כל הסיידבר מתקפל לאייקונים עם Ctrl+B.",
    ),
    points: [
      t(
        "Ctrl+K opens the command palette - it searches every screen, including Hebrew keywords (try \"מחירים\" or \"קופונים\").",
        "Ctrl+K פותח את פלטת הפקודות — מחפשת כל מסך, כולל מילות מפתח בעברית (נסו \"מחירים\" או \"קופונים\").",
      ),
      t(
        "The sun/moon button switches light and dark mode; every screen supports both.",
        "כפתור השמש/ירח מחליף בין מצב בהיר לכהה; כל מסך תומך בשניהם.",
      ),
      t(
        "Breadcrumbs at the top always show where you are and click back up the path.",
        "פירורי הלחם למעלה תמיד מראים איפה אתם ולוחצים חזרה במעלה המסלול.",
      ),
    ],
    links: [{ label: t("Open the dashboard", "פתח את הדשבורד"), href: "/dashboard" }],
  },
  {
    id: "dashboard",
    title: t("Dashboard", "דשבורד"),
    intro: t(
      "The daily starting point: reservation stats and trend, your open tasks ordered by priority, and the creative-gaps radar showing what the site is missing.",
      "נקודת הפתיחה היומית: סטטיסטיקות ומגמת הזמנות, המשימות הפתוחות שלך לפי עדיפות, ורדאר חוסרי הקריאייטיב שמראה מה חסר באתר.",
    ),
    points: [
      t(
        "My Tasks - check a task off right from the widget; it syncs with the Tasks board.",
        "המשימות שלי — אפשר לסמן משימה כבוצעה ישר מהווידג'ט; מסתנכרן עם לוח המשימות.",
      ),
      t(
        "Creative gaps - counts by severity (red blocks advertising, amber is page quality). Click through for the full work queue.",
        "חוסרי קריאייטיב — ספירות לפי חומרה (אדום חוסם פרסום, ענבר איכות עמוד). קליק מוביל לתור העבודה המלא.",
      ),
    ],
    links: [
      { label: t("Open the dashboard", "פתח את הדשבורד"), href: "/dashboard" },
      { label: t("Creative gaps queue", "תור חוסרי קריאייטיב"), href: "/tasks?tab=gaps" },
    ],
  },
  {
    id: "events",
    title: t("Events - the catalog", "אירועים — הקטלוג"),
    intro: t(
      "Events are what customers buy on the main site. The main app reads this table DIRECTLY - everything you save here is live for customers within minutes. An event bundles tickets + flight + hotel into one package.",
      "אירועים הם מה שלקוחות קונים באתר הראשי. האפליקציה הראשית קוראת את הטבלה הזו ישירות — כל מה ששומרים כאן חי מול לקוחות תוך דקות. אירוע אוגד כרטיסים + טיסה + מלון לחבילה אחת.",
    ),
    points: [
      t(
        "Anatomy: name, type (sports/music/dynamic/tx), date, venue with coordinates and city_iata (the IATA drives flight pricing), images (card + campaign creative), ticket categories in USD, and the two base prices.",
        "אנטומיה: שם, סוג (ספורט/מוזיקה/דינמי/tx), תאריך, מתחם עם קואורדינטות ו־city_iata (ה־IATA מניע את תמחור הטיסות), תמונות (קארד + קריאייטיב), קטגוריות כרטיסים בדולרים, ושני מחירי הבסיס.",
      ),
      t(
        "Flight dates are computed automatically: departure 2 days before (Fri/Sat shift back to Thursday), return the day after (Saturday shifts to Sunday).",
        "תאריכי הטיסה מחושבים אוטומטית: יציאה יומיים לפני (שישי/שבת נדחפים לחמישי), חזרה יום אחרי (שבת נדחפת לראשון).",
      ),
      t(
        "The editor has a section rail on the right - jump straight to Images, Flights, Hotels, Tickets. Deep links from other screens land on the exact field with a highlight flash.",
        "לעורך יש מסילת סקשנים מימין — קפיצה ישירה לתמונות, טיסות, מלונות, כרטיסים. קישורים עמוקים ממסכים אחרים נוחתים על השדה המדויק עם הבהוב.",
      ),
      t(
        "Legacy composed-pricing markups live under a collapsed \"Advanced\" section; it opens automatically for old events that still use them.",
        "שדות markup ישנים יושבים תחת סקשן \"מתקדם\" מכווץ; הוא נפתח אוטומטית באירועים ישנים שעדיין משתמשים בהם.",
      ),
    ],
    rules: [
      t(
        "NEVER hard-delete an event. Deleting = setting is_deleted to a date string (MM-DD-YYYY). The delete buttons do this for you - don't work around them.",
        "לעולם לא מוחקים אירוע פיזית. מחיקה = הצבת תאריך ב־is_deleted. כפתורי המחיקה עושים זאת — לא לעקוף אותם.",
      ),
      t(
        "An event with no computable price is invisible to ads: the creative cron skips it and the feed drops it. Price first, everything else follows.",
        "אירוע בלי מחיר בר־חישוב שקוף לפרסום: ה־cron של הקריאייטיב מדלג עליו והפיד משמיט אותו. קודם מחיר, כל השאר נגזר.",
      ),
    ],
    links: [
      { label: t("Events table", "טבלת אירועים"), href: "/events" },
      { label: t("Create an event", "יצירת אירוע"), href: "/events/new" },
    ],
  },
  {
    id: "pricing",
    title: t("Pricing - the chain", "תמחור — השרשרת"),
    intro: t(
      "One price rule everywhere. What the customer pays is built in layers, and this backoffice owns the base of the chain; the main site finishes it.",
      "כלל מחיר אחד בכל מקום. מה שהלקוח משלם נבנה בשכבות, והבק־אופיס הזה אחראי על בסיס השרשרת; האתר הראשי משלים אותה.",
    ),
    flow: {
      title: t("The price chain", "שרשרת המחיר"),
      steps: [
        {
          label: t("Provider ticket price", "מחיר כרטיס מהספק"),
          sub: t("+$40 USD / +€40 / +£35 / +₪150 at sync", "+$40 / +€40 / +£35 / +₪150 בסנכרון"),
        },
        {
          label: t("Base flight price", "מחיר בסיס טיסה"),
          sub: t("cheapest direct +$100 (connection if gap > $300)", "ישירה הזולה +100$ (קונקשיין אם הפער > 300$)"),
        },
        {
          label: t("Base hotel price", "מחיר בסיס מלון"),
          sub: t("cheapest 3-star +$120, rounded to tens", "3★ הזול +120$, עיגול לעשרות"),
        },
        {
          label: t("Main site +$175", "האתר הראשי +175$"),
          sub: t("final markup, currency conversion", "מארקאפ סופי והמרת מטבע"),
        },
        { label: t("Customer price", "מחיר ללקוח") },
      ],
    },
    points: [
      t(
        "The Search Flights / Search Hotels buttons in the event form quote through this exact rule - the number they fill is the number the nightly sync would write.",
        "כפתורי חיפוש הטיסה/מלון בטופס האירוע מתמחרים דרך אותו כלל בדיוק — המספר שהם ממלאים הוא המספר שהסנכרון הלילי היה כותב.",
      ),
      t(
        "Nightly sync (01:30 UTC): every live future event is re-quoted. Deviation of $150+ per component updates the base (both directions); a change above $400 is FROZEN for human review instead of applied.",
        "סנכרון לילי (01:30 UTC): כל אירוע חי עתידי מתומחר מחדש. סטייה של 150$+ לרכיב מעדכנת את הבסיס (לשני הכיוונים); שינוי מעל 400$ נעצר לבדיקה אנושית במקום להיות מוחל.",
      ),
      t(
        "Events with linked offline inventory are excluded per component - fixed inventory means the price is your decision, not a market read.",
        "אירועים עם מלאי offline מקושר מוחרגים פר רכיב — מלאי קבוע אומר שהמחיר הוא החלטה שלך, לא קריאת שוק.",
      ),
      t(
        "The Price Changes screen shows everything the sync did and holds the frozen changes with an approve button.",
        "מסך שינויי המחיר מראה כל מה שהסנכרון עשה ומחזיק את השינויים הקפואים עם כפתור אישור.",
      ),
    ],
    rules: [
      t(
        "Do NOT add the final $175 here - the main site adds it. Adding it twice overcharges every customer.",
        "לא מוסיפים כאן את ה־175$ הסופיים — האתר הראשי מוסיף. תוספת כפולה = לקוח משלם יותר מדי.",
      ),
      t(
        "Never hardcode exchange rates - they come from the rate service and refresh automatically.",
        "לעולם לא מקבעים שערי חליפין — הם מגיעים משירות השערים ומתעדכנים אוטומטית.",
      ),
      t(
        "Sports-source ticket prices are stored in cents - screens divide by 100. Don't \"fix\" a price that looks 100× too big.",
        "מחירי כרטיסים ממקור ספורט נשמרים בסנטים — המסכים מחלקים ב־100. לא \"לתקן\" מחיר שנראה גדול פי 100.",
      ),
    ],
    links: [
      { label: t("Price changes screen", "מסך שינויי מחיר"), href: "/price-changes", adminOnly: true },
      { label: t("Events table", "טבלת אירועים"), href: "/events" },
    ],
  },
  {
    id: "sources",
    title: t("Event sources - the providers", "מקורות אירועים — הספקים"),
    intro: t(
      "Four external providers feed raw events into their own tables; you turn the good ones into catalog events. Syncs run on schedule - you never import by hand.",
      "ארבעה ספקים חיצוניים מזינים אירועים גולמיים לטבלאות שלהם; אתם הופכים את הטובים לאירועי קטלוג. הסנכרונים רצים לפי לוח זמנים — לא מייבאים ידנית.",
    ),
    points: [
      t(
        "Sports (XS2Event) - fixtures with venues and coordinates; events daily at 00:01, tournaments monthly. Ticket prices refresh every 4 hours.",
        "ספורט (XS2Event) — משחקים עם אצטדיונים וקואורדינטות; אירועים יומית ב־00:01, טורנירים חודשית. מחירי כרטיסים מתרעננים כל 4 שעות.",
      ),
      t(
        "Live (LiveTickets) - sports + music with Hebrew names and IATA codes; syncs at 00:00 and 12:00.",
        "Live (LiveTickets) — ספורט ומוזיקה עם שמות בעברית וקודי IATA; מסתנכרן ב־00:00 וב־12:00.",
      ),
      t(
        "P1 Tickets - XML feed with venue coordinates and embedded tickets.",
        "P1 Tickets — פיד XML עם קואורדינטות מתחם וכרטיסים מוטמעים.",
      ),
      t(
        "TixStock - the biggest source; events nightly at 02:00, prices 4×/day, past events purged automatically. Search in these tables is token-based - \"real madrid champion\" finds what you mean.",
        "TixStock — המקור הגדול ביותר; אירועים לילית ב־02:00, מחירים 4 פעמים ביום, אירועי עבר נמחקים אוטומטית. החיפוש בטבלאות האלה מבוסס מילים — \"real madrid champion\" מוצא את מה שהתכוונתם.",
      ),
      t(
        "From any provider row: open the single-event page to create one event, or multi-select rows for Batch create / Send to factory.",
        "מכל שורת ספק: פותחים את עמוד האירוע הבודד ליצירה אחת, או מסמנים כמה שורות ל־Batch create / שליחה למפעל.",
      ),
    ],
    links: [
      { label: t("Sports (XS2E)", "ספורט (XS2E)"), href: "/sports-events" },
      { label: t("Live", "Live"), href: "/live-events" },
      { label: t("P1", "P1"), href: "/p1-events" },
      { label: t("TixStock", "TixStock"), href: "/tixstock-events" },
    ],
  },
  {
    id: "batch-factory",
    title: t("Batch wizard & the Factory", "וויזרד הבאץ' והמפעל"),
    intro: t(
      "Three ways to create events, from hands-on to hands-off. All three share the same automation blocks: stadium memory, live price quotes, automatic IATA.",
      "שלוש דרכים ליצור אירועים, מידני ועד אוטומטי. שלושתן חולקות את אותם רכיבי אוטומציה: זיכרון אצטדיון, תמחור חי, IATA אוטומטי.",
    ),
    flow: {
      title: t("Three creation paths", "שלושת מסלולי היצירה"),
      steps: [
        {
          label: t("Single: provider page → form", "בודד: עמוד ספק → טופס"),
          sub: t("full control, live provider tickets", "שליטה מלאה, כרטיסי ספק חיים"),
        },
        {
          label: t("Batch: multi-select → wizard", "באץ': מולטי־בחירה → וויזרד"),
          sub: t("review each step, form drags along", "סוקרים כל שלב, הטופס נגרר"),
        },
        {
          label: t("Factory: send → grid → approve", "מפעל: שליחה → גריד → אישור"),
          sub: t("drafts build themselves, you approve in bulk", "טיוטות נבנות לבד, מאשרים בבת אחת"),
        },
      ],
    },
    points: [
      t(
        "Multi-team batch (TixStock): selection accumulates across teams with a chips row; \"select all home games of X\" uses the name-starts-with-team rule; crossing into another team resets the dragged form so the previous venue doesn't leak.",
        "באץ' רב־קבוצות (TixStock): הבחירה נצברת בין קבוצות עם שורת צ'יפים; \"בחר את כל משחקי הבית של X\" משתמש בכלל שם־מתחיל־בשם־הקבוצה; מעבר לקבוצה אחרת מאפס את הטופס הנגרר כדי שהמתחם הקודם לא ידלוף.",
      ),
      t(
        "Stadium memory: a step that lands with no ticket categories copies the structure from the last event at the same venue (banner + undo). Live listings then reprice whatever matches.",
        "זיכרון אצטדיון: שלב שמגיע בלי קטגוריות כרטיסים מעתיק את המבנה מהאירוע האחרון באותו מתחם (באנר + ביטול). הליסטינגים החיים מתמחרים מחדש את מה שמתאים.",
      ),
      t(
        "Auto-fill: once a step has an IATA and dates, flight+hotel base prices fill themselves in the background - empty fields only, with a green flash. A venue without IATA resolves it from the nearest known location within 50km (that's what makes artist tours work city by city).",
        "מילוי אוטומטי: ברגע שלשלב יש IATA ותאריכים, מחירי הבסיס מתמלאים ברקע — שדות ריקים בלבד, עם הבהוב ירוק. מתחם בלי IATA פותר אותו מהלוקיישן הקרוב עד 50 ק\"מ (זה מה שמאפשר סיבובי הופעות עיר־עיר).",
      ),
      t(
        "The Factory: Send to factory from any provider creates draft rows; a stoppable loop builds them one by one through the same blocks; the grid shows what automation couldn't fill in amber, you edit inline and approve selected - each approval creates a real catalog event.",
        "המפעל: Send to factory מכל ספק יוצר שורות טיוטה; לולאה עם עצירה בונה אותן אחת־אחת דרך אותם רכיבים; הגריד מראה בענבר מה האוטומציה לא הצליחה למלא, עורכים אינליין ומאשרים נבחרים — כל אישור יוצר אירוע קטלוג אמיתי.",
      ),
    ],
    rules: [
      t(
        "Drafts are invisible to customers by design - they live in their own table. Nothing reaches the site until you press Approve.",
        "טיוטות שקופות ללקוחות בכוונה — הן חיות בטבלה נפרדת. שום דבר לא מגיע לאתר עד שלוחצים אישור.",
      ),
    ],
    links: [
      { label: t("The Factory", "המפעל"), href: "/factory", adminOnly: true },
      { label: t("TixStock (best batch source)", "TixStock (מקור הבאץ' הטוב ביותר)"), href: "/tixstock-events" },
    ],
  },
  {
    id: "creative-feed",
    title: t("Creatives & the Meta feed", "קריאייטיבים והפיד למטא"),
    intro: t(
      "Every feed event needs a campaign creative - the ad image Meta shows. Most are generated automatically; the gaps radar catches the rest.",
      "כל אירוע בפיד צריך קריאייטיב — תמונת המודעה שמטא מציגה. רובם נוצרים אוטומטית; רדאר החוסרים תופס את השאר.",
    ),
    flow: {
      title: t("Creative → feed pipeline", "צינור קריאייטיב → פיד"),
      steps: [
        {
          label: t("Creative cron (every 4h)", "cron קריאייטיבים (כל 4 שעות)"),
          sub: t("generates ad images; skips priceless events", "מייצר תמונות מודעה; מדלג על אירועים בלי מחיר"),
        },
        {
          label: t("campaign_image_url on the event", "campaign_image_url על האירוע"),
          sub: t("also becomes the card image fallback", "משמש גם כ־fallback לתמונת הקארד"),
        },
        {
          label: t("Meta feed build", "בניית פיד מטא"),
          sub: t("price, availability, category labels", "מחיר, זמינות, תוויות קטגוריה"),
        },
        {
          label: t("Publish 6×/day", "פרסום 6 פעמים ביום"),
          sub: t("copied to the file Meta reads", "מועתק לקובץ שמטא קוראת"),
        },
      ],
    },
    points: [
      t(
        "The Creative Generator makes one manually - gap links open it with the event pre-selected.",
        "מחולל הקריאייטיב מייצר ידנית — קישורי חוסרים פותחים אותו עם האירוע כבר נבחר.",
      ),
      t(
        "When a creative is missing, the recorded skip reason is almost always \"no computable price\" - the Do button on the gap sends you to the event's price fields, not to the generator, because that's the actual fix.",
        "כשקריאייטיב חסר, סיבת הדילוג הרשומה היא כמעט תמיד \"אין מחיר בר־חישוב\" — כפתור ה־Do בחוסר שולח לשדות המחיר של האירוע, לא למחולל, כי זה התיקון האמיתי.",
      ),
      t(
        "The gaps radar watches 9 asset kinds: event creatives and card images (blocking), team crests, hero images, atmosphere galleries, category and blog images (quality). \"Done\" files away a false gap (e.g. a crest that exists elsewhere) with undo.",
        "הרדאר עוקב אחרי 9 סוגי נכסים: קריאייטיבים ותמונות קארד (חוסמים), סמלי קבוצות, תמונות ראשיות, גלריות אווירה, תמונות קטגוריה ובלוג (איכות). \"Done\" מתייק חוסר כוזב (למשל סמל שקיים במקום אחר) עם אפשרות ביטול.",
      ),
    ],
    links: [
      { label: t("Creative generator", "מחולל קריאייטיב"), href: "/creative-generator" },
      { label: t("Meta feed", "פיד מטא"), href: "/meta-feed" },
      { label: t("Gaps queue", "תור חוסרים"), href: "/tasks?tab=gaps" },
    ],
  },
  {
    id: "taxonomy",
    title: t("Tags & categories", "תגיות וקטגוריות"),
    intro: t(
      "Events are only ever TAGGED. A category declares which tags compose it, and every event carrying one of those tags is pulled in automatically. You never assign an event to a category directly.",
      "אירועים תמיד רק מתויגים. קטגוריה מצהירה אילו תגיות מרכיבות אותה, וכל אירוע שנושא אחת מהן נשאב פנימה אוטומטית. לעולם לא משייכים אירוע לקטגוריה ישירות.",
    ),
    flow: {
      title: t("How an event reaches a category page", "איך אירוע מגיע לעמוד קטגוריה"),
      steps: [
        { label: t("Event gets tags", "האירוע מקבל תגיות"), sub: t("auto-tagger rules + manual", "חוקי תיוג אוטומטי + ידני") },
        { label: t("Category declares its tags", "הקטגוריה מצהירה על תגיותיה") },
        {
          label: t("Membership is derived", "החברות נגזרת"),
          sub: t("a database view - always in sync", "view בבסיס הנתונים — תמיד מסונכרן"),
        },
        {
          label: t("Site /c/ page + feed labels", "עמוד /c/ באתר + תוויות פיד"),
        },
      ],
    },
    points: [
      t(
        "Tag rules auto-tag new events on creation - keywords match against the event's name and metadata.",
        "חוקי תיוג מתייגים אירועים חדשים אוטומטית ביצירה — מילות מפתח מול שם האירוע והמטא־דאטה.",
      ),
      t(
        "One switch (is_active) publishes both the homepage tile and the /c/ page. Parent categories do NOT inherit children's events - each collects only what its own tags collect.",
        "מתג אחד (is_active) מפרסם גם את האריח בדף הבית וגם את עמוד ה־/c/. קטגוריות אב לא יורשות אירועי ילדים — כל אחת אוספת רק מה שהתגיות שלה אוספות.",
      ),
    ],
    links: [
      { label: t("Feed tags", "תגיות פיד"), href: "/event-tags" },
      { label: t("Tag rules", "חוקי תיוג"), href: "/tag-rules" },
      { label: t("Categories", "קטגוריות"), href: "/templates/categories" },
    ],
  },
  {
    id: "tasks",
    title: t("Tasks", "משימות"),
    intro: t(
      "A lightweight board for the team. Admins create and assign to anyone; editors create for themselves and update their own status.",
      "לוח קליל לצוות. מנהלים יוצרים ומשייכים לכל אחד; עורכים יוצרים לעצמם ומעדכנים את הסטטוס שלהם.",
    ),
    points: [
      t(
        "Statuses: to do → in progress → done (or cancelled). Priorities: urgent / high / medium / low - your dashboard widget sorts by them.",
        "סטטוסים: לביצוע → בתהליך → בוצע (או בוטל). עדיפויות: דחוף / גבוה / בינוני / נמוך — הווידג'ט בדשבורד ממוין לפיהן.",
      ),
      t(
        "A task born from a creative gap carries a \"Do\" deep link that lands on the exact fixing control - the crest field, the price section, the gallery picker.",
        "משימה שנולדה מחוסר קריאייטיב נושאת קישור \"Do\" שנוחת על הפקד המתקן המדויק — שדה הסמל, סקשן המחיר, בוחר הגלריה.",
      ),
      t(
        "The Creative gaps tab is one unified queue, most blocking first, with type filter pills (All is the default). Do / Create task / Done on every row.",
        "לשונית חוסרי הקריאייטיב היא תור מאוחד אחד, החוסם קודם, עם צ'יפי סינון לפי סוג (All ברירת המחדל). Do / צור משימה / Done על כל שורה.",
      ),
    ],
    links: [{ label: t("Tasks board", "לוח משימות"), href: "/tasks" }],
  },
  {
    id: "partners",
    title: t("Partners & the portal", "שותפים והפורטל"),
    intro: t(
      "Agents and affiliates sell through tracking links and get commissions. They have their own self-service portal, completely separated from this dashboard.",
      "סוכנים ואפיליאייטים מוכרים דרך קישורי מעקב ומקבלים עמלות. יש להם פורטל שירות עצמי משלהם, מופרד לחלוטין מהדשבורד הזה.",
    ),
    points: [
      t(
        "A partner logging in is confined to /portal - links, credit, coupons, reservations, quotes, and the prepared-package link builder that produces customer-ready package URLs.",
        "שותף שמתחבר מוגבל ל־/portal — קישורים, קרדיט, קופונים, הזמנות, הצעות מחיר, ובונה חבילות מוכנות שמייצר קישורי חבילה ללקוח.",
      ),
      t(
        "Commissions snapshot per reservation at booking time - changing a partner's rate later never reprices history.",
        "עמלות מצולמות פר הזמנה ברגע ההזמנה — שינוי אחוז לשותף לא מתמחר מחדש היסטוריה.",
      ),
      t(
        "A monthly partner report goes out automatically on the 1st.",
        "דוח שותפים חודשי נשלח אוטומטית ב־1 לחודש.",
      ),
    ],
    links: [
      { label: t("Partners (staff view)", "שותפים (תצוגת צוות)"), href: "/partners" },
      { label: t("Coupons", "קופונים"), href: "/coupons" },
    ],
  },
  {
    id: "forms",
    title: t("Forms", "טפסים"),
    intro: t(
      "Google-Forms-style bilingual questionnaires: build in the dashboard, send invite links, clients answer on a public page.",
      "שאלונים דו־לשוניים בסגנון Google Forms: בונים בדשבורד, שולחים קישורי הזמנה, לקוחות עונים בעמוד ציבורי.",
    ),
    points: [
      t(
        "Each form has EN+HE labels (either may be empty), a status (draft → live), and per-recipient invite tokens with open/submit tracking. Invite emails go out from the system.",
        "לכל טופס תוויות EN+HE (כל אחת יכולה להיות ריקה), סטטוס (טיוטה → חי), וטוקני הזמנה אישיים עם מעקב פתיחה/שליחה. מיילי הזמנה נשלחים מהמערכת.",
      ),
      t(
        "The public /f/ pages are the only unauthenticated pages in the system - submissions are validated server-side, rate-limited, and honeypotted.",
        "עמודי /f/ הציבוריים הם היחידים ללא התחברות במערכת — שליחות מאומתות בצד השרת, מוגבלות בקצב ומוגנות honeypot.",
      ),
    ],
    links: [{ label: t("Forms", "טפסים"), href: "/forms" }],
  },
  {
    id: "website",
    title: t("Website content & assets", "תוכן ונכסי האתר"),
    intro: t(
      "Everything the site shows besides events: team and artist pages, category tiles, blog, and the shared media library.",
      "כל מה שהאתר מציג חוץ מאירועים: עמודי קבוצות ואמנים, אריחי קטגוריות, בלוג, וספריית המדיה המשותפת.",
    ),
    points: [
      t(
        "Templates - artists, football teams, categories and blog posts share one editing pattern: hero image, atmosphere gallery, page content. Missing visuals show up in the gaps radar automatically.",
        "תבניות — אמנים, קבוצות כדורגל, קטגוריות ופוסטים חולקים דפוס עריכה אחד: תמונה ראשית, גלריית אווירה, תוכן עמוד. חוסרים ויזואליים מופיעים ברדאר אוטומטית.",
      ),
      t(
        "Assets - the football crest library used by creatives and team pages. Gap links arrive here with the team name pre-searched; one upload closes the gap.",
        "Assets — ספריית סמלי הכדורגל שמשמשת קריאייטיבים ועמודי קבוצות. קישורי חוסרים מגיעים לכאן עם שם הקבוצה כבר בחיפוש; העלאה אחת סוגרת את החוסר.",
      ),
      t(
        "Locations - cities with coordinates and IATA codes. This table powers automatic IATA resolution everywhere (wizard, factory, tours) - keep it growing.",
        "לוקיישנים — ערים עם קואורדינטות וקודי IATA. הטבלה הזו מפעילה את פתרון ה־IATA האוטומטי בכל מקום (וויזרד, מפעל, סיבובים) — כדאי להמשיך להרחיב אותה.",
      ),
      t(
        "Storage - a raw browser over the media buckets when you need a file URL directly.",
        "Storage — דפדפן ישיר על דליי המדיה כשצריך URL של קובץ.",
      ),
    ],
    links: [
      { label: t("Templates", "תבניות"), href: "/templates/categories" },
      { label: t("Assets (crests)", "Assets (סמלים)"), href: "/assets" },
      { label: t("Locations", "לוקיישנים"), href: "/locations" },
      { label: t("Storage", "Storage"), href: "/storage" },
    ],
  },
  {
    id: "admin",
    title: t("Admin - users, audit, safety", "ניהול — משתמשים, ביקורת, בטיחות"),
    adminOnly: true,
    intro: t(
      "Management screens for admins: who can do what, and a full trail of every change.",
      "מסכי ניהול למנהלים: מי יכול לעשות מה, ותיעוד מלא של כל שינוי.",
    ),
    points: [
      t(
        "Roles: superadmin and admin manage everything including users; editor works the catalog and their own tasks; forms_operator sees only Forms; office_manager / agent / affiliate are portal-side partner roles and never see this dashboard.",
        "תפקידים: superadmin ו־admin מנהלים הכול כולל משתמשים; editor עובד על הקטלוג והמשימות שלו; forms_operator רואה רק טפסים; office_manager / agent / affiliate הם תפקידי פורטל ולא רואים את הדשבורד הזה.",
      ),
      t(
        "The audit log records every create/update/delete with who and what changed - the first stop when something looks wrong.",
        "לוג הביקורת מתעד כל יצירה/עדכון/מחיקה עם מי ומה השתנה — התחנה הראשונה כשמשהו נראה לא נכון.",
      ),
      t(
        "Database schema changes ship as migration files applied from the main branch only - never by hand, never from a feature branch. If you're not sure, ask before touching.",
        "שינויי סכמה עוברים כקבצי מיגרציה שמוחלים רק מה־branch הראשי — לעולם לא ידנית ולא מ־feature branch. לא בטוחים? שואלים לפני שנוגעים.",
      ),
    ],
    links: [
      { label: t("Users", "משתמשים"), href: "/users", adminOnly: true },
      { label: t("Audit log", "לוג ביקורת"), href: "/audit-log", adminOnly: true },
    ],
  },
];

export const GUIDE_UI: Record<string, L> = {
  subtitle: t(
    "How the whole system fits together - every area, the central flows, and the rules that keep production safe. Buttons jump straight to the screen being explained.",
    "איך כל המערכת מתחברת — כל אזור, הפלואים המרכזיים, והחוקים ששומרים על הפרודקשן. הכפתורים קופצים ישר למסך שמוסבר.",
  ),
  rules: t("Iron rules", "חוקי ברזל"),
  open: t("Open", "פתח"),
  adminBadge: t("Admins only", "מנהלים בלבד"),
  onThisPage: t("On this page", "בעמוד הזה"),
};
