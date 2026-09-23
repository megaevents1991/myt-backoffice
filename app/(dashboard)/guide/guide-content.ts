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
    id: "ticket-only",
    title: t("Ticket-only events", "אירועי כרטיס-בלבד"),
    intro: t(
      "An event sold as a ticket alone - no flight, no hotel (e.g. a show in a city with no convenient flight). The site skips both steps and charges exactly ticket + Ticket-Only Markup.",
      "אירוע שנמכר ככרטיס בלבד - בלי טיסה ובלי מלון (למשל הופעה בעיר בלי טיסה נוחה). האתר מדלג על שני השלבים וגובה בדיוק כרטיס + Ticket-Only Markup.",
    ),
    points: [
      t(
        "On the site: the card shows the \"כרטיס בלבד\" badge, only the ticket icon and \"מחיר לכרטיס\"; the order flow is tickets → summary with a 2-step stepper; the product feeds say \"כרטיס\" only.",
        "באתר: הכרטיס מציג תגית \"כרטיס בלבד\", אייקון כרטיס בלבד ו-\"מחיר לכרטיס\"; ההזמנה היא כרטיסים ← סיכום עם stepper של שני צעדים; הפידים אומרים \"כרטיס\" בלבד.",
      ),
      t(
        "Switching it ON zeroes the flight/hotel base prices - the nightly base-price sync, \"our offer\" and the package light then skip the event by themselves. The ticket light keeps working.",
        "הדלקה מאפסת את מחירי הבסיס של טיסה/מלון - הסנכרון הלילי, \"ההצעה שלנו\" ורמזור החבילה מדלגים על האירוע מעצמם. רמזור הכרטיס ממשיך לעבוד.",
      ),
      t(
        "Events table: filter \"Ticket-only events only\", an amber \"ticket only\" badge on the name (with \"no markup!\" when the markup is still empty), and a bulk menu that switches several events at once.",
        "טבלת האירועים: פילטר \"Ticket-only events only\", תגית \"ticket only\" כתומה על השם (עם \"no markup!\" כשה-markup עוד ריק), ותפריט bulk שמחליף כמה אירועים בבת אחת.",
      ),
      t(
        "Partner portal: the package wizard opens such an event on tickets and never offers the flight/hotel steps.",
        "פורטל השותפים: אשף החבילה נפתח על כרטיסים ולא מציע שלבי טיסה/מלון לאירוע כזה.",
      ),
    ],
    rules: [
      t(
        "Ticket-Only Markup is REQUIRED (0 is allowed). Saving a ticket-only event without it is blocked - the site would otherwise sell at cost.",
        "Ticket-Only Markup הוא חובה (0 מותר). שמירת אירוע כרטיס-בלבד בלעדיו נחסמת - אחרת האתר ימכור במחיר עלות.",
      ),
    ],
    links: [{ label: t("Events table", "טבלת אירועים"), href: "/events" }],
    flow: {
      title: t("Mark an event ticket-only", "סימון אירוע ככרטיס-בלבד"),
      steps: [
        { label: t("Events → open the event → Pricing card", "אירועים ← פתיחת האירוע ← כרטיס Pricing") },
        { label: t("Switch \"Ticket only (no flight, no hotel)\" ON", "מדליקים את המתג \"Ticket only (no flight, no hotel)\""), sub: t("Bases drop to 0 automatically", "הבסיסים יורדים ל-0 אוטומטית") },
        { label: t("Fill Ticket-Only Markup (USD per ticket) and save", "ממלאים Ticket-Only Markup (USD לכרטיס) ושומרים") },
        { label: t("Check the card on the site: badge + \"מחיר לכרטיס\"", "בודקים את הכרטיס באתר: תגית + \"מחיר לכרטיס\"") },
      ],
    },
  },
  {
    id: "lodging",
    title: t("Lodging - event city & split stay", "לינה - עיר המשחק ושהות מפוצלת"),
    intro: t(
      "When the match is in one city and the flight lands in another (a Liverpool game on a London flight), the event gets an EVENT CITY next to its flight city. The site then shows \"הלינה ב: לונדון\" above the hotel list with a button for the other city and, in split mode, a \"מפוצל\" popup where the customer assigns each night to a city.",
      "כשהמשחק בעיר אחת והטיסה נוחתת באחרת (משחק בליברפול על טיסה ללונדון), לאירוע מוגדרת עיר משחק לצד עיר הטיסה. האתר מציג \"הלינה ב: לונדון\" מעל רשימת המלונות עם כפתור לעיר השנייה, ובמצב מפוצל חלון \"מפוצל\" שבו הלקוח מחלק את הלילות בין הערים.",
    ),
    points: [
      t(
        "Flight city = the event's Location (unchanged, carries the IATA). Event city = the new \"Lodging\" card: pick a saved location or type name + coordinates. Empty = today's flow.",
        "עיר הטיסה = ה-Location של האירוע (ללא שינוי, נושא את ה-IATA). עיר המשחק = כרטיס \"Lodging\" החדש: בוחרים Location שמור או מקלידים שם + קואורדינטות. ריק = הזרימה של היום.",
      ),
      t(
        "Mode: flight city only / event city only / customer picks a city / customer picks or splits. \"Opens on\" is the default city. \"Split default\" = 1 or 2 nights in the event city our popup proposes (2 = night before + event night).",
        "מצב: עיר טיסה בלבד / עיר משחק בלבד / הלקוח בוחר עיר / הלקוח בוחר או מפצל. \"Opens on\" = עיר ברירת המחדל. \"Split default\" = 1 או 2 לילות בעיר המשחק שהחלון מציע (2 = ליל לפני + ליל המשחק).",
      ),
      t(
        "The split never changes dates - nights = the flight dates the customer chose. Max 3 segments (A → B → A). Each segment gets an auto-picked hotel; \"החלפת מלון\" opens that segment's list. Price = sum of the segment hotels vs the base, same +/- as today.",
        "הפיצול לא משנה תאריכים - הלילות = תאריכי הטיסה שהלקוח בחר. עד 3 מקטעים (א ← ב ← א). כל מקטע מקבל מלון אוטומטי; \"החלפת מלון\" פותח את הרשימה של המקטע. המחיר = סכום מלונות המקטעים מול הבסיס, אותו +/- כמו היום.",
      ),
      t(
        "Transfer note: free text shown under the city line (\"רכבת לונדון–ליברפול כשעתיים ורבע, לא כלול\"). Transfers are NOT sold.",
        "הערת מעבר: טקסט חופשי מתחת לשורת העיר (\"רכבת לונדון–ליברפול כשעתיים ורבע, לא כלול\"). העברות לא נמכרות.",
      ),
      t(
        "Venue memory copies the event city + mode to the next event at the same venue. The reservation page lists every segment of a split stay (hotel_order_info = the first one).",
        "זיכרון האצטדיון מעתיק את עיר המשחק והמצב לאירוע הבא באותו מגרש. דף ההזמנה מציג כל מקטע של שהות מפוצלת (hotel_order_info = הראשון).",
      ),
      t(
        "\"טען מלונות\" (Locations screen and both location cards in the editor): warms RateHawk static hotel data for a cold city, ~12 hotels per step, 15-20 minutes for a whole city. Without it a new city shows few hotels and gets no 3★ base price.",
        "\"טען מלונות\" (מסך Locations ושני כרטיסי המיקום בעורך): טוען דאטא סטטי של מלונות מ-RateHawk לעיר קרה, כ-12 מלונות לצעד, 15-20 דקות לעיר שלמה. בלעדיו עיר חדשה מציגה מעט מלונות ולא מקבלת מחיר בסיס 3★.",
      ),
    ],
    rules: [
      t(
        "Load hotels for a NEW event city BEFORE the event goes live - the customer list and the base-price probe both read the hotels table.",
        "טוענים מלונות לעיר משחק חדשה לפני שהאירוע עולה לאוויר - רשימת הלקוח וחישוב מחיר הבסיס קוראים את טבלת המלונות.",
      ),
      t(
        "A lodging mode other than \"flight city only\" needs an event city different from the flight city - save is blocked otherwise.",
        "מצב לינה שאינו \"עיר טיסה בלבד\" דורש עיר משחק שונה מעיר הטיסה - אחרת השמירה נחסמת.",
      ),
    ],
    links: [
      { label: t("Locations", "מיקומים"), href: "/locations" },
      { label: t("Events table", "טבלת אירועים"), href: "/events" },
    ],
    flow: {
      title: t("Set up a Liverpool game on a London flight", "הגדרת משחק בליברפול על טיסה ללונדון"),
      steps: [
        { label: t("Locations → add \"ליברפול\" (name + coordinates, no IATA) → \"טען מלונות\"", "Locations ← מוסיפים \"ליברפול\" (שם + קואורדינטות, בלי IATA) ← \"טען מלונות\""), sub: t("15-20 minutes, once", "15-20 דקות, פעם אחת") },
        { label: t("Event → Location card stays London (LON)", "אירוע ← כרטיס Location נשאר לונדון (LON)") },
        { label: t("Lodging card → pick ליברפול → mode \"picks a city or splits\", opens on London, 2 nights, transfer note", "כרטיס Lodging ← בוחרים ליברפול ← מצב \"בוחר או מפצל\", נפתח על לונדון, 2 לילות, הערת מעבר") },
        { label: t("Save. On the site: card \"ליברפול · טיסה ללונדון\", hotel step shows the city line", "שומרים. באתר: כרטיס \"ליברפול · טיסה ללונדון\", שלב המלון מציג את שורת העיר") },
      ],
    },
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
          sub: t("cheapest 3-star, per person (room ÷ 2) +$120, rounded to tens", "3★ הזול לאדם (חדר ÷ 2) +120$, עיגול לעשרות"),
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
        "Nightly sync (01:30 UTC): live future events are re-quoted in rotation (least-recently-checked first, next 45 days ahead of the rest). Any deviation of $20+ per component updates the base (both directions); a change above $400 is FROZEN for human review instead of applied. Every visit is logged - the price-changes screen shows the arithmetic, the event date, and why an event did not move. A frozen row can be approved, marked as fixed in the event, handed to someone as a task, or the event removed from the site (soft delete) right there.",
        "סנכרון לילי (01:30 UTC): אירועים חיים עתידיים מתומחרים מחדש ברוטציה (מי שנבדק הכי מזמן קודם, 45 הימים הקרובים לפני השאר). כל סטייה של 20$+ לרכיב מעדכנת את הבסיס (לשני הכיוונים); שינוי מעל 400$ נעצר לבדיקה אנושית במקום להיות מוחל. כל ביקור נרשם — מסך שינויי המחיר מציג את החשבון, את תאריך האירוע ולמה אירוע לא זז. שורה קפואה אפשר לאשר, לסמן כעודכנה באירוע, להעביר למישהו כמשימה, או להסיר את האירוע מהאתר (מחיקה רכה) ישר משם.",
      ),
      t(
        "Events with linked offline inventory are excluded per component - fixed inventory means the price is your decision, not a market read.",
        "אירועים עם מלאי offline מקושר מוחרגים פר רכיב — מלאי קבוע אומר שהמחיר הוא החלטה שלך, לא קריאת שוק.",
      ),
      t(
        "The Price Changes screen shows everything the sync did and holds the frozen changes with two buttons: Approve writes the live price onto the event; Updated in event closes the row after you set the price by hand inside the event (it records what the event holds now, no waiting for the next cron).",
        "מסך שינויי המחיר מראה כל מה שהסנכרון עשה ומחזיק את השינויים הקפואים עם שני כפתורים: אשר עדכון כותב את מחיר השוק לאירוע; עודכן באירוע סוגר את השורה אחרי שעדכנת את המחיר ידנית בתוך האירוע (נרשם מה שהאירוע מחזיק עכשיו, בלי לחכות ל-cron הבא).",
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
    id: "price-light",
    title: t("Price light (רמזור)", "רמזור מחירים"),
    intro: t(
      "A traffic-light column on the events table (right after the usual price) shows how our price compares to competitors, per event. It never changes a price by itself - it's a read, not a rule. It compares our real \"from\" price: the site price minus the +$100 flight / +$120 hotel margins (taken from the latest search), plus ticket and site markup.",
      "עמודת רמזור בטבלת האירועים (מיד אחרי המחיר הרגיל) מראה איך המחיר שלנו עומד מול המתחרים, לכל אירוע. הרמזור לא משנה מחיר בעצמו — הוא קריאה, לא כלל. ההשוואה היא מול מחיר ה\"החל מ-\" האמיתי שלנו: טיסה ומלון בלי תוספות ה-100$/120$ (מהחיפוש האחרון), ועוד כרטיס ועמלות האתר. המחיר באתר עצמו לא משתנה.",
    ),
    points: [
      t(
        "Two pills per event: Pkg (package price vs. LiveEvents/ISSTA/Golasso) and Tkt (ticket-only price vs. LiveTickets). The number shown is our price minus the cheapest matched competitor, after normalizing their listing to look like ours (direct flight, no bag, 3-star, our number of nights, no breakfast, no transfers).",
        "שני תגים לכל אירוע: Pkg (מחיר חבילה מול LiveEvents/ISSTA/Golasso) ו-Tkt (מחיר כרטיס בלבד מול LiveTickets). המספר המוצג הוא המחיר שלנו פחות המתחרה הזול ביותר שהותאם, אחרי נירמול המודעה שלו כך שתידמה לשלנו (טיסה ישירה, בלי מזוודה, 3 כוכבים, מספר הלילות שלנו, בלי ארוחת בוקר, בלי העברות).",
      ),
      t(
        "Colors: green = we're more than $150 cheaper (after normalization), red = we're more than $150 pricier, orange = within that ±$150 band, grey \"unchecked\" = no fresh, usable match yet, \"alone\" (green-family) = every active competitor was checked and none sells it, a plain dash = not applicable (e.g. no ticket-only price is configured for that event). Unchecked is NEVER read as green - it means we don't know, not that we're fine.",
        "צבעים: ירוק = זולים ביותר מ-150$ (אחרי נירמול), אדום = יקרים ביותר מ-150$, כתום = בטווח ה-±150$, אפור \"unchecked\" = אין עדיין התאמה טרייה ושמישה, \"alone\" (במשפחת הירוק) = כל המתחרים הפעילים נבדקו ואף אחד לא מוכר את האירוע, מקף פשוט = לא רלוונטי (למשל אין מחיר כרטיס-בלבד מוגדר לאירוע). Unchecked לעולם לא נקרא כירוק — הוא אומר שאין מידע, לא שהכול בסדר.",
      ),
      t(
        "Hover a pill for the tooltip: which competitor, their raw price and currency, the normalized USD number, every adjustment applied (bag/connection/stars/nights/breakfast/transfers), and when it was crawled. Click a pill to open the history sheet - every match attempt logged for that event.",
        "hover על תג מציג טולטיפ: איזה מתחרה, המחיר הגולמי שלו והמטבע, המספר המנורמל בדולר, כל התאמה שהופעלה (מזוודה/קונקשיין/כוכבים/לילות/ארוחת בוקר/העברות), ומתי נסרק. קליק על תג פותח את גיליון ההיסטוריה — כל ניסיון התאמה שנרשם לאירוע הזה.",
      ),
      t(
        "Duration is part of the comparison (2026-09-13). Our packages are often a night longer than a competitor's, so the tooltip shows both durations (\"לילות: 4 שלנו מול 3 שלהם\") and the gap is priced at OUR hotel's per-night rate for that trip - a Manchester night is worth far more than a Barcelona one, so a flat rate mis-read a one-night gap by up to double. When the competitor never publishes their dates the tooltip says so and the light's ±$150 band is widened by one night's worth: an unknown duration shows as orange (\"look at it\") instead of a confident red, because a night we cannot see is not a price difference.",
        "משך השהות הוא חלק מההשוואה (13.09.2026). החבילות שלנו לא פעם ארוכות בלילה מזו של המתחרה, ולכן הטולטיפ מציג את שני המשכים (\"לילות: 4 שלנו מול 3 שלהם\"), והפער מתומחר לפי מחיר הלילה של המלון שלנו באותה נסיעה — לילה במנצ'סטר שווה הרבה יותר מלילה בברצלונה, וסכום אחיד קבוע החטיא פער של לילה עד פי שניים. כשהמתחרה לא מפרסם תאריכים הטולטיפ אומר את זה, והטווח של ±150$ מתרחב בשווי לילה אחד: משך לא ידוע מוצג ככתום (\"תסתכלו על זה\") ולא כאדום בטוח, כי לילה שאנחנו לא רואים הוא לא הפרש מחיר.",
      ),
      t(
        "The refresh icon re-runs matching against the catalogs already stored in the database - it does NOT browse the competitor sites live, so it's instant and safe to click often.",
        "אייקון הרענון מריץ שוב את ההתאמה מול הקטלוגים שכבר שמורים בבסיס הנתונים — הוא לא גולש לאתרי המתחרים בזמן אמת, ולכן מהיר ובטוח ללחוץ עליו הרבה.",
      ),
      t(
        "\"ירידת מחיר\" tag: when our price drops $50+ compared to about 14 days ago, the event gets tagged automatically and stays tagged for 14 days (or until the price climbs back within $50 of where it dropped from, whichever is first). This runs in the nightly pass, not the hourly crawl.",
        "תג \"ירידת מחיר\": כשהמחיר שלנו יורד ב-50$ ומעלה לעומת לפני כ-14 יום, האירוע מתויג אוטומטית ונשאר מתויג 14 יום (או עד שהמחיר חוזר לטווח 50$ מהמחיר שממנו ירד - המוקדם מביניהם). זה קורה בריצה הלילית, לא בסריקה השעתית.",
      ),
      t(
        "Sports events checked against LiveEvents show grey, not because nothing was found but because that site's sports board only quotes a price after you pick dates - it never publishes one on the catalog page. That gets resolved in phase 2; until then the light there is honestly \"unknown\", not a claim about the price.",
        "אירועי ספורט שנבדקים מול LiveEvents מוצגים באפור לא כי לא נמצא כלום, אלא כי לוח הספורט של האתר ההוא מציג מחיר רק אחרי בחירת תאריכים — הוא אף פעם לא מפרסם מחיר בדף הקטלוג. זה ייפתר בשלב 2; עד אז האור שם אומר בכנות \"לא ידוע\", לא טענה על המחיר.",
      ),
      t(
        "Each competitor site is crawled at most once a week, one crawl running at a time system-wide (a check every 6 hours picks whichever due site has waited longest). LiveTickets is the exception - its numbers come from the same live_events sync that already runs twice a day, so there's no separate crawl for it.",
        "כל אתר מתחרה נסרק לכל היותר פעם ב-72 שעות, סריקה אחת רצה בכל זמן נתון במערכת (בדיקה שעתית בוחרת את האתר הכי \"רעב\" שממתין). LiveTickets הוא היוצא מן הכלל — המספרים שלו מגיעים מאותו סנכרון live_events שכבר רץ פעמיים ביום, אז אין לו סריקה נפרדת.",
      ),
      t(
        "PRICE_LIGHT_SCRAPE=off is the kill switch: it stops all crawling (runs show as skipped) but matching and the lights keep working off whatever was already crawled - flip it off if a competitor site ever needs to be left alone.",
        "PRICE_LIGHT_SCRAPE=off הוא מפסק החירום: הוא עוצר את כל הסריקה (ריצות מוצגות כ-skipped) אבל ההתאמה והרמזור ממשיכים לעבוד על מה שכבר נסרק — מכבים אותו אם אתר מתחרה צריך להישאר בשקט.",
      ),
      t(
        "Competitors, phase 2: sports packages are compared against LiveEvents, ISSTA Sport and Golasso; music packages against LiveEvents and OnTour; tickets against LiveTickets. ISSTA is football leagues only - a basketball, tennis or motorsport event is compared against LiveEvents and Golasso alone, and ISSTA is simply left out of the count rather than being read as \"ISSTA doesn't sell it\". ISSTA and OnTour publish the trip dates rather than the match date, so the light pairs those by the travel window that contains the event - the tooltip shows which site set the light, and the history sheet (click the pills) shows that listing's trip dates.",
        "מתחרים, שלב 2: חבילות ספורט מושוות מול LiveEvents, איסתא ספורט וגולאסו; חבילות מוזיקה מול LiveEvents ואון.טור; כרטיסים מול LiveTickets. איסתא היא ליגות כדורגל בלבד — אירוע כדורסל, טניס או מוטורספורט מושווה מול LiveEvents וגולאסו בלבד, ואיסתא פשוט לא נספרת במקום להיקרא כ\"איסתא לא מוכרת את זה\". איסתא ואון.טור מפרסמים את תאריכי הנסיעה ולא את תאריך המשחק, ולכן הרמזור מצמיד אותם לפי חלון הנסיעה שמכיל את האירוע — הטולטיפ מראה איזה אתר קבע את האור, ובחלון ההיסטוריה (לחיצה על הרמזור) רואים את תאריכי הנסיעה של אותה רשומה.",
      ),
      t(
        "Phase 1 (admins): the /price-light screen is where a red light gets a decision instead of sitting quietly on the events table. Tiles at the top double as filters - Alone/Green/Orange/Red/Unchecked, plus \"ממתינים להחלטה\" (pending) which lands you on exactly the reds that still need a human: not silenced right now, and no task already chasing them. The table view adds next 45 days, partial-coverage crawls, changed this week, and an AI-sample view.",
        "שלב 1 (מנהלים): מסך /price-light הוא המקום שבו אור אדום מקבל החלטה במקום לשבת בשקט על טבלת האירועים. התגים למעלה משמשים גם כפילטרים — לבד בשוק/ירוק/כתום/אדום/לא נבדק, ובנוסף \"ממתינים להחלטה\" שמנחית אתכם בדיוק על האדומים שעדיין צריכים בן אדם: לא מושתקים כרגע, ואין להם כבר משימה רודפת. תצוגת הטבלה מוסיפה 45 הימים הקרובים, סריקות בכיסוי חלקי, מה שהשתנה השבוע, ותצוגת מדגם AI.",
      ),
      t(
        "A red row gets four decisions: \"הוזל\" jumps straight to that event's price section to fix the base price (the light itself never writes a price); \"השאר בפיד\" silences the red for 14 days - it stays red, it just drops off the pending view until it expires or the light itself changes; \"הסר מהאתר\" soft-deletes the event after a confirm (never a hard delete); \"משימה\" opens a high-priority task with the competitor numbers baked into its description - clicking it again when one is already open just tells you it exists instead of creating a duplicate. Any row (not only red) also gets \"בדוק עכשיו\" (re-match against the stored catalogs, instant) and \"דריסה\" - force a light by hand when the automatic read is wrong, but only with a note of 3+ characters, and it's logged; \"בטל דריסה\" removes it.",
        "לשורה אדומה יש ארבע החלטות: \"הוזל\" קופץ ישר לקטע המחיר של האירוע כדי לתקן את מחיר הבסיס (הרמזור עצמו אף פעם לא כותב מחיר); \"השאר בפיד\" משתיק את האדום ל-14 יום — הוא נשאר אדום, רק יורד מתצוגת הממתינים עד שהוא פג או שהאור עצמו משתנה; \"הסר מהאתר\" מסיר את האירוע בעדינות (soft delete) אחרי אישור — לעולם לא מחיקה לצמיתות; \"משימה\" פותחת משימה בעדיפות גבוהה עם מספרי המתחרים משובצים בתיאור — לחיצה נוספת כשכבר יש אחת פתוחה רק אומרת שהיא קיימת, לא יוצרת כפילות. לכל שורה (לא רק אדומה) יש גם \"בדוק עכשיו\" (התאמה מחדש מול הקטלוגים השמורים, מיידי) ו\"דריסה\" — כפיית אור ידנית כשהקריאה האוטומטית טועה, אבל רק עם הערה של 3+ תווים, והיא נרשמת; \"בטל דריסה\" מסירה אותה.",
      ),
      t(
        "One line per event (2026-09-14). The /price-light table shows BOTH conclusions on the same row - the package pill and the ticket pill, each with its own gap and its own price, and every competitor we asked for that event, with the one that set the light marked. Decisions that belong to a single conclusion say so: when both are red you get \"הוזל · חבילה\" and \"הוזל · כרטיס\" as separate buttons, and דריסה asks which one. \"השאר בפיד\", \"הסר מהאתר\" and \"בדוק עכשיו\" are about the whole event, so they ask nothing.",
        "שורה אחת לכל אירוע (14.09.2026). הטבלה ב-/price-light מציגה את שתי המסקנות באותה שורה — תג החבילה ותג הכרטיס, כל אחד עם הפער שלו והמחיר שלו, ולצידם כל המתחרים שנבדקו לאותו אירוע, כשזה שקבע את האור מסומן. החלטות ששייכות למסקנה אחת אומרות את זה: כששתיהן אדומות יש \"הוזל · חבילה\" ו\"הוזל · כרטיס\" ככפתורים נפרדים, ודריסה שואלת על מה. \"השאר בפיד\", \"הסר מהאתר\" ו\"בדוק עכשיו\" נוגעים לאירוע כולו ולכן לא שואלים כלום.",
      ),
      t(
        "Package / ticket filter and the detailed comparison (2026-09-14). The switch above the tiles - \"חבילה + כרטיס\" / \"חבילה\" / \"כרטיס\" - is a lens, not just a filter: with \"חבילה\" picked, every tile, view and the pending count only looks at package conclusions (\"3 אדומים\" then means three red packages). \"השוואה מפורטת\" on any row opens us next to every competitor for that event, with what each package actually contains, in one format: flight (airline, direct or with a stop, bag, outbound and return times), hotel (name, stars, breakfast or not) and ticket (category/seat). A competitor with no price says why - \"לא מוכר\", \"מוכר · הצעת מחיר\" (they sell it but publish no number, typical of LiveEvents sports) or \"לא ודאי\". Our side is the flight and hotel the pricing rule would buy today (cheapest direct flight, cheapest 3-star hotel, or the offline flight/hotel linked to the event); it refreshes every night and \"פרט את שלנו עכשיו\" refreshes it on the spot. Matching also got much wider the same day: spelling variants, competition names and duplicate listings no longer hide a competitor, and when every listing that night is clearly a different event the competitor is recorded as not selling it rather than \"unsure\".",
        "פילטר חבילה / כרטיס וההשוואה המפורטת (14.09.2026). המתג מעל התגים — \"חבילה + כרטיס\" / \"חבילה\" / \"כרטיס\" — הוא עדשה ולא רק סינון: כשבוחרים \"חבילה\", כל התגים, התצוגות וספירת הממתינים מסתכלים רק על מסקנות החבילה (\"3 אדומים\" אז אומר שלוש חבילות אדומות). \"השוואה מפורטת\" בכל שורה פותח אותנו לצד כל מתחרה של אותו אירוע, עם מה שכל חבילה באמת כוללת, באותו פורמט: טיסה (חברה, ישירה או עם עצירה, מזוודה, שעות הלוך וחזור), מלון (שם, כוכבים, עם או בלי ארוחת בוקר) וכרטיס (קטגוריה/מקום). מתחרה בלי מחיר אומר למה — \"לא מוכר\", \"מוכר · הצעת מחיר\" (מוכרים אבל לא מפרסמים מספר, אופייני לספורט של LiveEvents) או \"לא ודאי\". הצד שלנו הוא הטיסה והמלון שכלל התמחור היה קונה היום (הטיסה הישירה הזולה, מלון ה-3 כוכבים הזול, או הטיסה/המלון האופליין שמקושרים לאירוע); הוא מתרענן כל לילה, ו\"פרט את שלנו עכשיו\" מרענן אותו במקום. באותו יום ההתאמה גם התרחבה משמעותית: וריאציות כתיב, שמות מסגרות ורשומות כפולות כבר לא מסתירות מתחרה, וכשכל הרשומות של אותו ערב הן בבירור אירועים אחרים המתחרה נרשם כ\"לא מוכר\" במקום \"לא ודאי\".",
      ),
      t(
        "A lighter row, one competitor at a time (2026-09-18). With \"חבילה + כרטיס\" open a row shows only the two conclusions, our two prices and each competitor's answer - the site price, our flight/hotel/ticket/fees breakdown, the listing link, the nights line and the adjustment chips appear once you pick \"חבילה\" or \"כרטיס\", and always inside \"השוואה מפורטת\". Picking a competitor - from the select, a column header, or by clicking its card in the competitors strip - now leaves ONLY that competitor's column, narrows the table to the events it sells, and turns the gap column into the gap against it (click the card again to clear). The detailed comparison reads right-to-left with every piece kept whole, and times read one way only: \"15:10 → 17:55\". It also knows more: ISSTA's real package page is read (airline, times, hotel, stars, seat category), a LiveEvents show page is followed to its cheapest package, one package page now fills every date that links to it, and LiveTickets shows the seat category its shelf price buys. Competitor pages are sampled gently, so the contents fill in over the next crawls rather than at once.",
        "שורה קלה יותר, ומתחרה אחד בכל פעם (18.09.2026). בתצוגת \"חבילה + כרטיס\" השורה מציגה רק את שתי המסקנות, שני המחירים שלנו והתשובה של כל מתחרה — המחיר באתר, הפירוק שלנו (טיסה/מלון/כרטיס/עמלות), הקישור למודעה, שורת הלילות וצ'יפים של ההתאמות מופיעים כשבוחרים \"חבילה\" או \"כרטיס\", ותמיד בתוך \"השוואה מפורטת\". בחירת מתחרה — מהרשימה, מכותרת העמודה, או בלחיצה על הכרטיס שלו בשורת המתחרים — משאירה עכשיו רק את העמודה שלו, מצמצמת את הטבלה לאירועים שהוא מוכר, והופכת את עמודת הפער לפער מולו (לחיצה נוספת על הכרטיס מנקה). ההשוואה המפורטת נקראת מימין לשמאל וכל חלק נשאר שלם, ושעות נקראות בכיוון אחד בלבד: \"15:10 → 17:55\". היא גם יודעת יותר: נקרא דף החבילה האמיתי של איסתא (חברת תעופה, שעות, מלון, כוכבים, קטגוריית כרטיס), דף הופעה של LiveEvents מוביל לחבילה הזולה שלו, דף חבילה אחד ממלא עכשיו את כל התאריכים שמקושרים אליו, ו-LiveTickets מציג את קטגוריית הכרטיס שמחיר המדף שלו קונה. את דפי המתחרים דוגמים בעדינות, ולכן התוכן מתמלא בסריקות הקרובות ולא בבת אחת.",
      ),
      t(
        "Fixing a competitor's row yourself (2026-09-18, admins). In \"השוואה מפורטת\" every competitor row has a pencil. It opens that listing's values - price and currency, nights, hotel stars, breakfast, checked bag, direct flight, transfers, airline, hotel name, ticket type - and a checkbox \"זו לא האירוע שלנו\". Change only what is wrong, pick WHY it was wrong (not this event's listing / the price is for part of the package / the system misread the page / their page changed / the AI was wrong) and write a note - both are mandatory. What happens next: the light is recalculated on the spot with your value; the row shows \"✎ תוקן ידנית\" and the dialog lists the active corrections with \"בטל\". A price or contents fix belongs to the listing, so it follows it into every event matched to it; \"not our event\" applies to this event only. A correction stays in force until the competitor's page itself changes that value - then what we crawl shows again, because the market moved. Our own row cannot be edited (it is the pricing rule's answer - use \"פרט את שלנו עכשיו\"), and nothing here changes one of our prices. About \"the AI learns\": the judge reads your correction - with your note - back as an example when you fixed one of the six things it reads itself (nights, hotel stars, breakfast, checked bag, direct flight, transfers) or said a listing is not our event (widened 2026-09-19; before, only a value the AI itself had produced counted, so almost no note reached it). Write the note as a reading rule - \"only a backpack is mentioned, so no checked bag\" - not as a complaint. A fixed price, airline, hotel name or ticket text is the site parser's mistake, which is ordinary code. Those are counted per competitor on the competitors strip (\"✎ 5\", hover for the fields): many fixes of the same field on one site means its crawler needs fixing, so tell the developer rather than correcting the same thing every week.",
        "לתקן שורה של מתחרה בעצמכם (18.09.2026, מנהלים). ב\"השוואה מפורטת\" לכל שורת מתחרה יש עיפרון. הוא פותח את הערכים של המודעה — מחיר ומטבע, לילות, כוכבי מלון, ארוחת בוקר, מזוודה, טיסה ישירה, העברות, חברת תעופה, שם המלון, סוג כרטיס — ותיבת סימון \"זו לא האירוע שלנו\". משנים רק מה ששגוי, בוחרים למה זה היה שגוי (זו לא המודעה של האירוע / המחיר הוא לחלק מהחבילה / המערכת קראה את הדף לא נכון / הדף של המתחרה השתנה / ה-AI טעה) וכותבים הערה — שניהם חובה. מה קורה אחר כך: הרמזור מחושב מחדש במקום עם הערך שלכם; בשורה מופיע \"✎ תוקן ידנית\", ובחלון רואים את התיקונים הפעילים עם \"בטל\". תיקון מחיר או תכולה שייך למודעה, ולכן הולך איתה לכל אירוע שמותאם אליה; \"לא האירוע שלנו\" חל רק על האירוע הזה. תיקון נשאר בתוקף עד שהדף של המתחרה עצמו משנה את הערך הזה — אז חוזר מה שנסרק, כי השוק זז. את השורה שלנו אי אפשר לערוך (זו התשובה של כלל התמחור — יש \"פרט את שלנו עכשיו\"), ושום דבר כאן לא משנה מחיר שלנו. לגבי \"ה-AI לומד\": השופט קורא את התיקון שלכם - יחד עם ההערה - כדוגמה כשתיקנתם אחד מששת הדברים שהוא קורא בעצמו (לילות, כוכבי מלון, ארוחת בוקר, מזוודה, טיסה ישירה, העברות) או כשאמרתם שמודעה היא לא האירוע שלנו (הורחב ב-19.09.2026; קודם נספר רק ערך שה-AI עצמו הפיק, ולכן כמעט אף הערה לא הגיעה אליו). כתבו את ההערה ככלל קריאה - \"מוזכר רק תיק גב, לכן אין מזוודה\" - ולא כתלונה. מחיר, חברת תעופה, שם מלון או טקסט כרטיס שתוקנו הם טעות של ה-parser של האתר, שהוא קוד רגיל. אלה נספרים לכל מתחרה בשורת המתחרים (\"✎ 5\", ריחוף מציג את השדות): הרבה תיקונים של אותו שדה באותו אתר אומרים שצריך לתקן את הסורק שלו, אז עדיף להגיד למפתח מאשר לתקן את אותו דבר כל שבוע.",
      ),
      t(
        "Your own call, a rule for the AI, a light that moves at once (2026-09-23). In \"השוואה מפורטת\", under each competitor's gap there is \"סמן צבע מול <competitor>\": after reading the comparison, set the color against THAT competitor yourself (green / orange / red, a note is mandatory) - e.g. they fly low-cost and we fly El Al, so the gap still leaves us green. The other competitors keep counting and the light takes the worst of them; the mark shows as \"✋ סומן ידנית\" with the computed color beside it, \"בטל סימון\" removes it, and it lapses by itself when that competitor's price moves more than $20. \"הוסף חוק ל-AI\" at the top of the sheet adds a standing rule for the AI (the same list as AI Factory -> memory) - the AI decides which listing is our event and reads what a package contains; it never sets a color or a price. The engine now also prices a low-cost flight against a full-service one at $300 per person, both ways (Wizz, Ryanair, easyJet, Vueling, Transavia, Pegasus, Blue Bird, Jet2 - Israir and Arkia are charters, not low-cost). In the sheet a competitor's big number is the price they published, in dollars, and under it \"שלנו מותאם לחבילה שלהם\" - our package moved onto theirs step by step (bag, stars, nights, low-cost...); the gap is ours-adjusted minus theirs. And the light follows our side at once: saving an event (prices, markups, tickets) and \"פרט את שלנו עכשיו\" both recompute it, and a saved correction tells you what it did to the light (\"חבילה: אדום ← כתום\" or \"נשאר אדום\").",
        "סימון ידני, חוק ל-AI, ורמזור שזז מיד (23.09.2026). ב\"השוואה מפורטת\", מתחת לפער של כל מתחרה יש \"סמן צבע מול <מתחרה>\": אחרי שקראתם את ההשוואה, קובעים בעצמכם את הצבע מול המתחרה הזה (ירוק / כתום / אדום, הערה חובה) - למשל הם טסים לואו-קוסט ואנחנו אל על, אז הפער עדיין משאיר אותנו ירוקים. שאר המתחרים ממשיכים להיספר והרמזור לוקח את הגרוע מביניהם; הסימון מופיע כ\"✋ סומן ידנית\" עם הצבע המחושב לידו, \"בטל סימון\" מסיר אותו, והוא פג לבד כשהמחיר של אותו מתחרה זז ביותר מ-$20. \"הוסף חוק ל-AI\" בראש החלון מוסיף חוק קבוע ל-AI (אותה רשימה כמו ב-AI Factory ← זיכרון ולימוד) - ה-AI מחליט איזו מודעה היא האירוע שלנו וקורא מה יש בחבילה; הוא לעולם לא קובע צבע או מחיר. המנוע גם מתמחר עכשיו טיסת לואו-קוסט מול טיסה רגילה ב-$300 לאדם, לשני הכיוונים (וויז, ריינאייר, איזיג'ט, ווילינג, טרנסאוויה, פגסוס, בלו בירד, Jet2 - ישראייר וארקיע הן צ'רטר, לא לואו-קוסט). בחלון, המספר הגדול של מתחרה הוא המחיר שפרסם, בדולר, ומתחתיו \"שלנו מותאם לחבילה שלהם\" - החבילה שלנו מותאמת לשלהם צעד אחר צעד (מזוודה, כוכבים, לילות, לואו-קוסט...); הפער = שלנו המותאם פחות שלהם. והרמזור עוקב אחרי הצד שלנו מיד: שמירת אירוע (מחירים, עמלות, כרטיסים) ו\"פרט את שלנו עכשיו\" מחשבים אותו מחדש, ותיקון שנשמר אומר מה הוא עשה לרמזור (\"חבילה: אדום ← כתום\" או \"נשאר אדום\").",
      ),
      t(
        "Your decisions teach the system (2026-09-13). Every mark on a red row - הוזל, השאר בפיד, הסר מהאתר, משימה, דריסה - is recorded together with what the comparison looked like at that moment: the gap, which competitor, and both trip lengths. When the AI judge is switched on it reads the most recent of those back before it decides anything, so the call you make today is context it has tomorrow night. Two things follow: an override note is worth writing properly (\"איסתא מוכרים 3 לילות, אנחנו 4\" teaches far more than \"לא נכון\"), and clicking הוזל matters even though it only takes you to the price field - it is how the system learns that a gap was real.",
        "ההחלטות שלכם מלמדות את המערכת (13.09.2026). כל סימון על שורה אדומה — הוזל, השאר בפיד, הסר מהאתר, משימה, דריסה — נרשם יחד עם איך ההשוואה נראתה באותו רגע: הפער, מול איזה מתחרה, ואורך הנסיעה של שני הצדדים. כשמנוע ה-AI דלוק הוא קורא את האחרונים שבהם לפני שהוא מכריע, כך שההחלטה שאתם עושים היום היא ההקשר שיהיה לו מחר בלילה. שתי מסקנות: כדאי לכתוב הערת דריסה כמו שצריך (\"איסתא מוכרים 3 לילות, אנחנו 4\" מלמד הרבה יותר מ\"לא נכון\"), וללחוץ על \"הוזל\" חשוב גם אם הוא רק מקפיץ אתכם לשדה המחיר — ככה המערכת לומדת שהפער היה אמיתי.",
      ),
      t(
        "A price-light task closes itself: the moment a nightly or manual recheck moves that scope's light from red to a real verdict (green, orange or alone), its open task is marked done automatically with a note recording when and why - nobody needs to remember to go close it. A light that only fell to \"not checked\" (stale data, a competitor site failing) does not count: nothing was resolved, so the task stays open.",
        "משימת רמזור נסגרת לבד: ברגע שבדיקה לילית או ידנית מזיזה את האור של אותו היקף מאדום להכרעה אמיתית (ירוק, כתום או לבד בשוק), המשימה הפתוחה שלה מסומנת \"בוצע\" אוטומטית עם הערה שמתעדת מתי ולמה — אף אחד לא צריך לזכור לסגור אותה. אור שרק ירד ל\"לא נבדק\" (מידע ישן, אתר מתחרה שנכשל) לא נחשב: שום דבר לא נפתר, והמשימה נשארת פתוחה.",
      ),
      t(
        "The AI judge only steps in when the rule can't decide on its own, or already found the listing but couldn't read its included-items - it never overrules a confident rule match, and it never sets a light directly. The screen's header shows this month's AI spend and call count so the cost stays visible, not a surprise on a bill.",
        "שופט ה-AI נכנס לפעולה רק כשהחוק לא מצליח להכריע לבד, או כבר מצא את המודעה אבל לא הצליח לקרוא מה כלול בה — הוא לעולם לא דורס התאמת חוק בטוחה, ולעולם לא קובע אור ישירות. כותרת המסך מציגה את הוצאת ה-AI החודשית ומספר הקריאות, כדי שהעלות תישאר גלויה ולא הפתעה בחשבון.",
      ),
      t(
        "The AI is opt-in and off by default: it only runs when PRICE_LIGHT_AI is set to exactly \"on\" and an API key is present. Anything else - unset, empty, a typo - means rule-only matching, so nothing can start spending by accident. Its budget is capped per nightly run too, and a dry run never calls it at all.",
        "ה-AI הוא opt-in וכבוי כברירת מחדל: הוא רץ רק כש-PRICE_LIGHT_AI מוגדר בדיוק ל-\"on\" ויש מפתח API. כל דבר אחר — לא מוגדר, ריק, שגיאת הקלדה — משמעו התאמה לפי חוק בלבד, כך שכלום לא יכול להתחיל להוציא כסף בטעות. יש גם תקרת קריאות לכל ריצה לילית, וריצת ניסיון (dry run) לא קוראת ל-AI בכלל.",
      ),
      t(
        "A manual override (\"דריסה\") keeps winning over the automatic read on every later recheck - but only while the competitor price it was taken against hasn't really moved (about $20). Once the competitor moves more than that, the override is dropped and the computed light takes over: the market changed, so the old manual call no longer describes it.",
        "דריסה ידנית ממשיכה לגבור על הקריאה האוטומטית בכל בדיקה חוזרת — אבל רק כל עוד מחיר המתחרה שמולו היא נקבעה לא באמת זז (כ-20$). ברגע שהמתחרה זז יותר מזה, הדריסה יורדת והאור המחושב חוזר לשלוט: השוק השתנה, והקביעה הידנית הישנה כבר לא מתארת אותו.",
      ),
      t(
        "\"השאר בפיד\" (silence) clears itself: the moment that event's light leaves red, the mute is removed in the same update - so a mute set months ago can never quietly hide the NEXT red on the same event.",
        "\"השאר בפיד\" (השתקה) מתנקה מעצמה: ברגע שהאור של האירוע יורד מאדום, ההשתקה מוסרת באותו עדכון — כך שהשתקה שנקבעה לפני חודשים לא יכולה להסתיר בשקט את האדום הבא של אותו אירוע.",
      ),
      t(
        "The /price-light screen and its dashboard summary card are admins-only - an editor sees neither the screen nor the red count. Red lights do reach all staff in one place: the Pricing tab on /tasks lists them, and a price-light task on the shared board carries the competitor lines in its description.",
        "מסך /price-light וכרטיס הסיכום שלו בדשבורד הם למנהלים בלבד — עורך לא רואה לא את המסך ולא את מספר האדומים. רמזורים אדומים כן מגיעים לכל הצוות במקום אחד: לשונית התמחור ב־/tasks מציגה אותם, ומשימת רמזור על הלוח המשותף כוללת בתיאור שלה את שורות המתחרים.",
      ),
      t(
        "The competitors panel on the same screen shows each site's last run, catalog size, next due time, and whether its circuit breaker is open. \"סרוק עכשיו\" forces an immediate crawl of one site - except LiveTickets, which has no crawl button because its numbers already refresh overnight from the live_events sync, not from browsing a page, and ISSTA, whose site serves our servers a page without any packages: it is crawled every three days from an office computer in Israel, and this panel only shows the run that leaves behind.",
        "פאנל המתחרים באותו מסך מראה לכל אתר את הריצה האחרונה, גודל הקטלוג, מועד הבדיקה הבא, ואם בלם המעגל שלו פתוח. \"סרוק עכשיו\" כופה סריקה מיידית של אתר אחד — חוץ מ-LiveTickets, שאין לו כפתור סריקה כי המספרים שלו כבר מתרעננים בלילה מסנכרון live_events, לא מגלישה בדף, ומ-ISSTA, שהאתר שלו מגיש לשרתים שלנו דף בלי חבילות: הוא נסרק כל שלושה ימים ממחשב במשרד בישראל, והפאנל רק מציג את הריצה שנשארת מזה.",
      ),
    ],
    rules: [
      t(
        "A red or orange light does nothing on its own - no auto-adjustment, no alert to a customer. Reading the light and deciding what to do about it is a person's job: the /price-light decision screen (phase 1, admins only).",
        "אור אדום או כתום לא עושה כלום לבד — בלי התאמה אוטומטית, בלי התראה ללקוח. קריאת האור וההחלטה מה לעשות איתו היא עבודה של בן אדם: מסך ההחלטה /price-light (שלב 1, מנהלים בלבד).",
      ),
    ],
    links: [
      { label: t("Events table", "טבלת אירועים"), href: "/events" },
      { label: t("Price light decisions", "החלטות רמזור"), href: "/price-light", adminOnly: true },
    ],
  },
  {
    id: "ai-factory",
    title: t("AI Factory", "AI Factory"),
    adminOnly: true,
    intro: t(
      "One screen per agent running in this system - what it is, what it has learned, every AI call it made, and how well its calls have held up against what staff actually decided. The price-light judge is agent #1; the price advisor (agent #2, 2026-09-17) words and ranks price suggestions from facts the light already computed. More will follow the same shape.",
      "מסך אחד לכל agent שרץ במערכת - מה הוא, מה הוא למד, כל קריאת AI שהוא ביצע, ומידת ההתאמה בין הקריאות שלו לבין מה שהצוות בפועל החליט. שופט הרמזור הוא agent מספר 1; יועץ המחיר (agent מספר 2, 17.09.2026) מנסח ומדרג הצעות מחיר מתוך עובדות שהרמזור עצמו חישב. עוד ילכו בעקבותיהם באותה תצורה.",
    ),
    points: [
      t(
        "Identity tab: a Hebrew paragraph on what the agent is for, three lists (decides on its own / never does / stays with the team), its live settings (model, call ceiling, confidence floor, token prices), and the env var names that switch it on - never their values.",
        "לשונית זהות: פסקה בעברית על מה הסוכן עושה, שלוש רשימות (מחליט לבד / אף פעם לא / נשאר אצל הצוות), ההגדרות החיות שלו (מודל, תקרת קריאות, רף ביטחון, מחירי טוקנים), ושמות משתני הסביבה שמדליקים אותו - לא הערכים שלהם.",
      ),
      t(
        "Memory tab: the house rules (generated from the pricing/matching engine's live constants, never hand-copied), the recorded decisions exactly as the prompt receives them, and \"team rules\" - free-text instructions an admin adds, which ride WITH the house rules on every future call, not inside the fenced \"data, not instructions\" block the recorded decisions sit in. Only an admin can add or retire one.",
        "לשונית זיכרון: כללי הבית (נוצרים מהקבועים החיים של מנוע התמחור/ההתאמה, לא מועתקים ביד), ההחלטות המתועדות בדיוק כמו שהפרומפט מקבל אותן, ו\"כללי צוות\" - הוראות טקסט חופשי שאדמין מוסיף, שנוסעות עם כללי הבית בכל קריאה עתידית, לא בתוך הגדר ה\"דאטה, לא הוראות\" שההחלטות המתועדות נמצאות בו. רק אדמין יכול להוסיף או לבטל כלל.",
      ),
      t(
        "Memory tab, \"where it learns from\" (2026-09-19): every mark staff left in the last 120 days, each tagged read now / waiting for a slot / not learned - with the reason (a correction of a price or a hotel name belongs to the crawler, a task the nightly opened by itself is not a human's decision, an override with no note teaches nothing). A table counts them per source, and the whole memory opens exactly as the model reads it. Two ways to teach: a team rule (permanent, for something that repeats) or a note while working - a correction in the detailed comparison, an override, a right/wrong mark in the log. The judge only matches listings and reads their contents (nights, stars, bag, breakfast, direct flight, transfers); a rule about pricing enters the prompt and changes nothing.",
        "לשונית זיכרון, \"מאיפה הוא לומד\" (19.09.2026): כל סימון שהצוות השאיר ב-120 הימים האחרונים, מתויג נקרא עכשיו / ממתין למקום / לא נלמד - עם הסיבה (תיקון של מחיר או שם מלון שייך לסורק, משימה שהריצה הלילית פתחה לבד היא לא החלטה של אדם, דריסה בלי הערה לא מלמדת כלום). טבלה סופרת אותם לפי מקור, והזיכרון המלא נפתח בדיוק כמו שהמודל קורא אותו. שתי דרכים ללמד: כלל צוות (קבוע, למשהו שחוזר על עצמו) או הערה תוך כדי עבודה - תיקון בהשוואה המפורטת, דריסת אור, סימון נכון/לא נכון ביומן. השופט רק מתאים מודעות וקורא את התכולה שלהן (לילות, כוכבים, מזוודה, ארוחת בוקר, טיסה ישירה, העברות); כלל על תמחור נכנס לפרומפט ולא משנה כלום.",
      ),
      t(
        "Log tab: every AI call the agent made - which event and competitor, its same-event verdict, confidence, cost, whether the answer was reused from cache - with approve/reject buttons per row. That feedback becomes its own lesson (\"agent.feedback\") the agent reads back next time.",
        "לשונית יומן: כל קריאת AI שהסוכן ביצע - איזה אירוע ומתחרה, ההכרעה שלו על אותו אירוע, רמת הביטחון, העלות, האם התשובה מוחזרת ממטמון - עם כפתורי אישור/דחייה בכל שורה. המשוב הזה הופך ללקח בפני עצמו (\"agent.feedback\") שהסוכן קורא בפעם הבאה.",
      ),
      t(
        "Maturity tab: how many recorded decisions agreed with the agent's alarms versus disagreed, direct feedback counts, an overall rate (hidden below 10 decisions - too little to call it a rate), and a weekly chart. Auto-removing a red light from the feed is explicitly NOT active yet - only after a maturity threshold is set.",
        "לשונית בשלות: כמה החלטות מתועדות הסכימו עם האזעקות של הסוכן לעומת כמה לא הסכימו, ספירת משוב ישיר, שיעור כללי (מוסתר מתחת ל-10 החלטות - מעט מכדי לקרוא לזה שיעור), וגרף שבועי. הסרה אוטומטית של אור אדום מהפיד עדיין לא פעילה במפורש - רק לאחר שיוגדר סף בשלות.",
      ),
      t(
        "Agent #2, the price advisor: when a scope turns red tonight and gets an unassigned task, this agent words and ranks up to 3 of price-advice.ts's deterministic facts (a markup cut, the same ticket at another supplier - LiveTickets, TixStock or XS2Event, a nights gap, and other travel days around the same event that come out cheaper on a real Amadeus search) as short Hebrew sentences, ranked biggest saving first - the facts themselves stay printed underneath, always. The same facts (without the AI wording) also sit above every red scope in \"השוואה מפורטת\" and inside the \"הוזל\" popover; other days and suppliers are quoted nightly for red events, and \"פרט את שלנו עכשיו\" quotes them on the spot. A supplier we cannot attach to an event today (XS2Event) is marked \"מידע בלבד\". It has no per-call log table yet, so its Log tab reads empty and its cost this month reads $0 even though every AI-worded advice is already audited (\"agent.advice\") for a later screen to read.",
        "agent מספר 2, יועץ המחיר: כשהיקף מתחלף לאדום הלילה ונפתחת עליו משימה לא משובצת, הסוכן הזה מנסח ומדרג עד 3 מהעובדות הדטרמיניסטיות של price-advice.ts (קיצוץ מארקאפ, אותו כרטיס אצל ספק אחר - LiveTickets, TixStock או XS2Event, פער לילות, וימי נסיעה אחרים סביב אותו אירוע שיוצאים זולים יותר לפי חיפוש Amadeus אמיתי) כמשפטים קצרים בעברית, מהחיסכון הגדול ביותר - העובדות עצמן נשארות מודפסות מתחתיו, תמיד. אותן עובדות (בלי ניסוח ה-AI) מופיעות גם מעל כל היקף אדום ב\"השוואה מפורטת\" ובתוך חלון \"הוזל\"; ימים וספקים חלופיים נבדקים כל לילה לאירועים אדומים, ו\"פרט את שלנו עכשיו\" בודק אותם במקום. ספק שאי אפשר לצרף היום לאירוע (XS2Event) מסומן \"מידע בלבד\". אין לו עדיין טבלת יומן לכל קריאה, אז לשונית היומן שלו מוצגת ריקה והעלות החודשית שלו מוצגת כ-$0, אף שכל הצעה שנוסחה ב-AI מתועדת כבר (\"agent.advice\") למסך עתידי שיקרא אותה.",
      ),
    ],
    rules: [
      t(
        "The agent never sets a light, never writes a price, and never removes an event by itself - it only answers questions the rule-based matcher could not (same event? what does the listing include?). Reprice / remove / sold out / override / silence stay a human's call, always.",
        "הסוכן אף פעם לא קובע רמזור, לא כותב מחיר, ולא מסיר אירוע בעצמו - הוא רק עונה על שאלות שההתאמה החוקית לא הצליחה להכריע בהן (האם זה אותו אירוע? מה כלול במודעה?). הוזלה / הסרה / נמכר / דריסה / השתקה נשארים החלטה של בן אדם, תמיד.",
      ),
      t(
        "The price advisor never states a dollar figure that isn't already in the facts it was given (a suggestion that invents one is discarded, wholesale, before a human sees it), never suggests touching a base price or the site's +$100/+$120 margins, and never opens or closes a task itself - only wording and ranking what the light already computed.",
        "יועץ המחיר אף פעם לא כותב סכום דולר שלא מופיע כבר בעובדות שקיבל (הצעה שממציאה מספר נפסלת כולה, לפני שבן אדם רואה אותה), אף פעם לא מציע לגעת במחיר בסיס או במרווחי ה+$100/+$120 של האתר, ואף פעם לא פותח או סוגר משימה בעצמו - רק מנסח ומדרג את מה שהרמזור עצמו כבר חישב.",
      ),
    ],
    links: [
      { label: t("AI Factory", "AI Factory"), href: "/ai-factory", adminOnly: true },
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
        "The gaps radar watches 12 kinds: event creatives and card images (blocking), team crests, hero images, atmosphere galleries, category and blog images, and page text (team / artist bio, category page content) - quality. Only active categories are checked. \"Done\" files away a false gap (e.g. a crest that exists elsewhere) with undo.",
        "הרדאר עוקב אחרי 12 סוגים: קריאייטיבים ותמונות קארד (חוסמים), סמלי קבוצות, תמונות ראשיות, גלריות אווירה, תמונות קטגוריה ובלוג, וטקסט לעמוד (ביו של קבוצה/אמן, תוכן עמוד קטגוריה) — איכות. רק קטגוריות פעילות נבדקות. \"Done\" מתייק חוסר כוזב (למשל סמל שקיים במקום אחר) עם אפשרות ביטול.",
      ),
      t(
        "Queue order: artists and teams with packages on sale right now (the site's on-tour rule) come before the wishlist ones - a green \"N on sale\" badge marks them. An entity that already has blob card-art has no hero gap at all any more - a blob picture is enough, it doesn't need a separate page hero on top of it.",
        "סדר התור: אמנים וקבוצות עם חבילות שנמכרות עכשיו (כלל ה-on-tour של האתר) לפני אלה שב-wishlist — תג ירוק \"N on sale\" מסמן אותם. למי שכבר יש בלוב אין יותר חוסר תמונת ראש בכלל — תמונת בלוב מספיקה, אין צורך בתמונת ראש נפרדת מעליה.",
      ),
      t(
        "A category under the Teams or Artists hub whose name matches a real team or artist is a \"twin\" - the site renders that team's/artist's own images there instead of a separate category picture, so a twin category never shows an image gap. A team twin still needs its own page-content text; an artist twin doesn't need that either.",
        "קטגוריה תחת הרכזת קבוצות או אמנים ששמה תואם קבוצה או אמן אמיתיים היא \"תאום\" — האתר מציג שם את התמונות של הקבוצה/האמן עצמם במקום תמונת קטגוריה נפרדת, ולכן לקטגוריית תאום אין חוסר תמונה בכלל. תאום־קבוצה עדיין צריך טקסט תוכן עמוד משלו; תאום־אמן לא צריך גם את זה.",
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
    id: "homepage",
    title: t("Homepage layout", "עמוד הבית"),
    intro: t(
      "A dummy of the customer site's homepage. Sections are dragged into order or hidden; inside every carousel section you pin the items that open it. Whatever is not pinned follows the section's automatic rule after the pinned items.",
      "עמוד דמה של דף הבית באתר. גוררים סקשנים לסדר או מסתירים; בתוך כל סקשן קרוסלה מצמידים את הפריטים שפותחים אותו. מה שלא מוצמד ממשיך לפי החוקיות האוטומטית אחרי המוצמדים.",
    ),
    points: [
      t(
        "Hero ring - always first. Pinned artists/teams in your order, then every other artist/team with an available event, artist-team alternating.",
        "הירו - תמיד ראשון. אמנים/קבוצות מוצמדים לפי הסדר שלך, אחריהם כל אמן/קבוצה עם אירוע זמין, אמן-קבוצה לסירוגין.",
      ),
      t(
        "Most wanted - one row, up to 12. Pinned first, then events marked Prioritized, then auto-fill (never VIP, never plain sports events).",
        "המבוקשים ביותר — שורה אחת, עד 12. מוצמדים ראשונים, אחריהם אירועים מסומנים Prioritized, ואז השלמה אוטומטית (לא VIP, לא אירועי ספורט רגילים).",
      ),
      t(
        "Newest - one row, up to 12. Pinned first, then the most recently created events, skipping anything already in Most wanted.",
        "החדשים ביותר — שורה אחת, עד 12. מוצמדים ראשונים, אחריהם האירועים שנוצרו לאחרונה, בלי כאלה שכבר במבוקשים.",
      ),
      t(
        "Dashed 'auto' cards - what the site shows right now after your pinned items, so a strip is never an empty box: the Prioritized events in Most wanted, the latest uploads in Newest. Pin places one; in Most wanted, Remove drops its Prioritized flag on the spot (it is not part of Save). Faded auto cards do not fit the 12-card row.",
        "כרטיסי 'auto' מקווקווים — מה שהאתר מציג עכשיו אחרי המוצמדים, כך ששורה אף פעם לא ריקה: אירועי Prioritized במבוקשים, ההעלאות האחרונות בחדשים. Pin מצמיד למקום; במבוקשים, Remove מוריד את סימון ה-Prioritized מיד (לא חלק מ-Save). כרטיסי auto דהויים לא נכנסים לשורת ה-12.",
      ),
      t(
        "What Pin does - it moves a dashed 'auto' card to the front of the row, into a fixed place you control (drag or arrows). An unpinned card is shown only while the automatic rule keeps choosing it; a pinned one stays until you remove it.",
        "מה עושה Pin — מעביר כרטיס 'auto' מקווקו לתחילת השורה, למקום קבוע שאתם שולטים בו (גרירה או חצים). כרטיס לא מוצמד מוצג רק כל עוד החוקיות האוטומטית בוחרת בו; מוצמד נשאר עד שמסירים אותו.",
      ),
      t(
        "Remove in Newest - drops that event from the automatic part of this row only (the event stays everywhere else on the site). It is part of Save. Removed events are listed under the row as chips - click one to bring it back. Pinning a removed event brings it back too.",
        "Remove בחדשים ביותר — מוריד את האירוע מהחלק האוטומטי של השורה הזו בלבד (האירוע נשאר באתר בכל מקום אחר). חלק מ-Save. האירועים שהוסרו מופיעים מתחת לשורה כצ'יפים — לחיצה מחזירה. גם Pin לאירוע שהוסר מחזיר אותו.",
      ),
      t(
        "Add in Newest lists only the last 100 packages uploaded to the site, newest first - not every future event.",
        "Add בחדשים ביותר מציג רק את 100 החבילות האחרונות שעלו לאתר, מהחדשה לישנה — לא את כל האירועים העתידיים.",
      ),
      t(
        "Football / Artists rows - every active team/artist. Those with an available event always jump ahead; inside each group your pinned order first, the rest by name.",
        "שורות כדורגל / אמנים — כל קבוצה/אמן פעילים. מי שיש לו אירוע זמין תמיד קופץ קדימה; בתוך כל קבוצה קודם הסדר המוצמד, השאר לפי שם.",
      ),
      t(
        "Rename a section - the pencil next to its title. What you type is the heading on the site; clear the field and the default title comes back. The hero has no heading, so no pencil.",
        "שינוי כותרת — העיפרון ליד הכותרת. מה שמקלידים הוא הכותרת באתר; מרוקנים את השדה והכותרת הרגילה חוזרת. להירו אין כותרת באתר ולכן אין עיפרון.",
      ),
      t(
        "Add block - the small '+ Add block' line between any two sections (up to 12 blocks). Event slider: one row of up to 12 cards - the events you pin come first, and if you choose a category its events follow, soonest first; with no pins and no category the block is not shown. Banners: 1-3 images uploaded here, each with an optional link (/c/... or https://...) and an optional title printed on the image. Text: plain paragraphs (a blank line starts a new one) under the block's title - no HTML, no links. Destinations slider: a row of category tiles, each leading to its /c/ page - the categories you choose come first, and if you pick a parent category all its active children follow. Image gallery: up to 12 images in one scrolling row, each with an optional caption. A block is dragged, hidden and titled like any section; the trash deletes it on Save.",
        "הוספת בלוק — השורה הקטנה '+ Add block' בין כל שני סקשנים (עד 12 בלוקים). סליידר אירועים: שורה אחת של עד 12 כרטיסים — האירועים שמצמידים ראשונים, ואם בוחרים קטגוריה האירועים שלה ממשיכים אחריהם, הקרוב ביותר קודם; בלי פריטים ובלי קטגוריה הבלוק לא מוצג. באנרים: 1-3 תמונות שמעלים כאן, לכל אחת קישור לא חובה (/c/... או https://...) וכותרת לא חובה שמודפסת על התמונה. טקסט: פסקאות טקסט פשוט (שורה ריקה = פסקה חדשה) מתחת לכותרת הבלוק — בלי HTML ובלי קישורים. סליידר יעדים: שורת אריחים של קטגוריות, כל אריח מוביל לעמוד ה-/c/ שלו — הקטגוריות שבוחרים ראשונות, ואם בוחרים קטגוריית אב כל הילדים הפעילים שלה ממשיכים אחריהן. גלריית תמונות: עד 12 תמונות בשורה נגללת, לכל אחת תיאור לא חובה. בלוק נגרר, מוסתר ומקבל כותרת כמו כל סקשן; הפח מוחק אותו ב-Save.",
      ),
      t(
        "Saving refreshes the live site by itself (allow a minute). The old Templates → Homepage Order screens and the person 'Featured order' field are gone - this board replaces them.",
        "שמירה מרעננת את האתר לבד (עד דקה). מסכי Templates → Homepage Order הישנים ושדה 'Featured order' של אמן/קבוצה הוסרו — הלוח הזה מחליף אותם.",
      ),
    ],
    links: [{ label: t("Open the Homepage board", "פתח את לוח עמוד הבית"), href: "/homepage" }],
  },
  {
    id: "tasks",
    title: t("Tasks", "משימות"),
    intro: t(
      "The team's shared work board. Everyone sees every task; admins can touch anything, an editor changes status and progress only on tasks assigned to them.",
      "לוח העבודה המשותף לצוות. כולם רואים כל משימה; מנהלים יכולים לגעת בהכול, ועורך משנה סטטוס והתקדמות רק במשימות ששויכו אליו.",
    ),
    points: [
      t(
        "Statuses: to do → in progress → paused → done (or cancelled) - paused still counts as an open task. Priorities: urgent / high / medium / low - your dashboard widget sorts by them. A task can also carry a board (dev / marketing / ops), a phase, a marketing channel and a progress percentage.",
        "סטטוסים: לביצוע → בתהליך → מושהה → בוצע (או בוטל) — מושהה עדיין נחשב משימה פתוחה. עדיפויות: דחוף / גבוה / בינוני / נמוך — הווידג'ט בדשבורד ממוין לפיהן. למשימה יש גם לוח (dev / marketing / ops), פאזה, ערוץ שיווקי ואחוז התקדמות.",
      ),
      t(
        "A task born from a creative gap or a frozen price row carries a \"Do\" deep link that lands on the exact fixing control - the crest field, the price section, the gallery picker.",
        "משימה שנולדה מחוסר קריאייטיב או משורת מחיר קפואה נושאת קישור \"Do\" שנוחת על הפקד המתקן המדויק — שדה הסמל, סקשן המחיר, בוחר הגלריה.",
      ),
      t(
        "Assigning a task to someone else emails them (title, priority, due date, the Do link). A task born from a creative gap or a frozen price change files that gap away when it is closed as Done or Cancelled; reopening the task brings the gap straight back. A price-light task closed as Done while the light is still red records that the price was fixed (the lesson the price-light agent learns from); Cancelled records nothing, and the light itself only changes at the next nightly check.",
        "שיבוץ משימה למישהו אחר שולח לו מייל (כותרת, עדיפות, תאריך יעד, קישור Do). משימה שנולדה מחוסר קריאייטיב או משינוי מחיר קפוא מתייקת את החוסר כשהיא נסגרת כבוצעה או בוטלה; פתיחה מחדש של המשימה מחזירה את החוסר מיד. משימת רמזור שנסגרת כבוצעה כשהרמזור עדיין אדום רושמת שהמחיר תוקן (הלקח שסוכן הרמזור לומד ממנו); ביטול לא רושם כלום, והרמזור עצמו משתנה רק בבדיקה הלילית הבאה.",
      ),
      t(
        "The Creative gaps tab is one unified queue, most blocking first, with type filter pills (All is the default). Do / Create task / Done on every row.",
        "לשונית חוסרי הקריאייטיב היא תור מאוחד אחד, החוסם קודם, עם צ'יפי סינון לפי סוג (All ברירת המחדל). Do / צור משימה / Done על כל שורה.",
      ),
      t(
        "Click a task's row (or its speech-bubble button) and its thread opens right under the row - no edit dialog needed; the pencil is only for changing the task itself. The thread holds every comment, screenshot and status change in one chronological scroll. Paste a screenshot straight from the clipboard (it's shrunk automatically); type @ and a name to mention a teammate - they get an email with the comment itself. Email also goes out without a mention: a new comment mails everyone in the conversation - the task's creator, its assignee, and whoever wrote or was mentioned in the thread before, so a reply reaches the person it answers (never the person who wrote it) - and marking a task Done mails the person who created it. Assigning a task mails the assignee, and the toast tells you whether that email actually went out. The system posts its own lines into the same thread whenever the task's status, assignee, priority, due date, progress or board changes, so the whole history of a task lives in one place, not scattered across edits. A comment you have not read yet shows from the outside: the row's speech bubble turns mint with a \"new\" count (a dot on kanban and roadmap cards), only on tasks whose conversation you are part of; opening the thread clears it and tags those comments \"חדש\". Your own comment has a pencil and a bin in its header - edit it (it is marked as edited) or delete it; an admin can delete anyone's comment but never edit it.",
        "לוחצים על שורת המשימה (או על כפתור בועת השיחה) והפתיל נפתח מתחת לשורה — בלי דיאלוג העריכה; העיפרון נשאר רק לשינוי המשימה עצמה. בפתיל: כל תגובה, צילום מסך ושינוי סטטוס בגלילה כרונולוגית אחת. מדביקים צילום מסך ישר מהלוח (מוקטן אוטומטית); מקלידים @ ושם כדי לתייג עמית — הוא מקבל מייל עם התגובה עצמה. מיילים יוצאים גם בלי תיוג: תגובה חדשה נשלחת לכל מי שהשיחה שייכת לו — יוצר המשימה, המשובץ, וכל מי שכתב או תויג בפתיל קודם, כך שתשובה מגיעה למי שענו לו (לעולם לא למי שכתב אותה) — וסימון משימה כ־Done שולח מייל למי שיצר אותה. שיבוץ משימה שולח מייל למשובץ, וההודעה הקופצת אומרת אם המייל באמת יצא. המערכת כותבת שורות משלה לאותו פתיל בכל פעם שסטטוס, שיוך, עדיפות, תאריך יעד, התקדמות או לוח של המשימה משתנים, כך שכל ההיסטוריה של משימה חיה במקום אחד ולא מפוזרת בין עריכות. תגובה שעוד לא קראתם נראית מבחוץ: בועת השיחה בשורה נצבעת במנטה עם מונה \"חדשות\" (נקודה בכרטיסי הקנבן והרודמאפ), רק במשימות שהשיחה בהן שייכת לכם; פתיחת הפתיל מנקה את הסימון ומתייגת את התגובות האלה \"חדש\". בתגובה שלכם יש עיפרון ופח בכותרת — עריכה (מסומנת כ\"נערך\") או מחיקה; אדמין יכול למחוק תגובה של כל אחד אבל לא לערוך אותה.",
      ),
      t(
        "Recurring rules (admins, the Task rules tab on /tasks) create tasks automatically every week without anyone remembering to look - one rule can either drop a single weekly summary task, or open one task per item it finds (say, one per event whose price light has been red too long). Each rule has a day of the week it runs on, always read in UTC, not Israel time - the check itself runs every morning at 06:00 UTC and each rule fires only on its own day. A per-item rule opens at most 25 tasks per run (the rest follow on its next run) and its assignee gets one summary email listing them, not one email per task.",
        "כללים חוזרים (מנהלים, לשונית Task rules ב־/tasks) יוצרים משימות אוטומטית כל שבוע בלי שמישהו צריך לזכור לבדוק — כלל אחד יכול להטיל משימת סיכום שבועית אחת, או לפתוח משימה לכל פריט שהוא מוצא (למשל, אחת לכל אירוע שהרמזור שלו אדום יותר מדי זמן). לכל כלל יום בשבוע שבו הוא רץ, נקרא תמיד לפי UTC ולא לפי שעון ישראל — הבדיקה עצמה רצה כל בוקר ב־06:00 UTC וכל כלל פועל רק ביום שלו. כלל ״משימה לכל פריט״ פותח לכל היותר 25 משימות בריצה (השאר בריצה הבאה שלו), והמשובץ מקבל מייל סיכום אחד עם הרשימה ולא מייל לכל משימה.",
      ),
      t(
        "The board also has a Kanban view (the Kanban tab) alongside the table - drag a card to change its status. The board lens above both (All / Dev / Marketing / Ops) narrows the table, its counts and the Kanban together to one board at a time.",
        "ללוח יש גם תצוגת קאנבן (לשונית Kanban) לצד הטבלה — גוררים כרטיס כדי לשנות סטטוס. עדשת הלוח מעל שתיהן (הכול / Dev / Marketing / Ops) מצמצמת יחד את הטבלה, הספירות והקאנבן ללוח אחד בכל פעם.",
      ),
      t(
        "The Roadmap tab is the product road map that used to be a separate app: every Dev-board task laid out by its phase (1-7), with done/total and a progress bar per phase. The Marketing tab does the same for the Marketing board by channel, with each campaign's progress. Click a card to open the task; the + next to a phase or channel creates a task already placed there. Both show the whole team - filter by name or search inside the tab.",
        "לשונית Roadmap היא מפת הדרכים של המוצר שהייתה פעם אפליקציה נפרדת: כל משימות לוח הפיתוח מסודרות לפי השלב שלהן (1-7), עם הושלם/סה״כ ופס התקדמות לכל שלב. לשונית Marketing עושה אותו דבר ללוח השיווק לפי ערוץ, עם ההתקדמות של כל קמפיין. לחיצה על כרטיס פותחת את המשימה; ה־+ ליד שלב או ערוץ יוצר משימה שכבר משובצת שם. שתיהן מציגות את כל הצוות - מסננים לפי שם או מחפשים בתוך הלשונית.",
      ),
      t(
        "The Pricing tab (visible to everyone, not just admins) lists every open pricing problem - red price lights and frozen price-change rows - in one place. The gap slider narrows the list to a range, both ends (say $0-$150 to see only the small gaps), and every row links to the event's page on the site. Each row has three buttons: Task opens a tracked task for it, Fix jumps straight to the field that actually fixes it, and Handled records that you dealt with it without touching a price - a price light stays hidden until the next nightly check (and comes back if it is still red), a frozen price row is marked reviewed with the note 'סומן כטופל' in front of the sync's original note. That mark is final - nothing reopens it. Only a price-change row closed through its TASK can come back: reopening that task restores the row and its original note.",
        "לשונית התמחור (גלויה לכולם, לא רק למנהלים) מרכזת כל בעיית תמחור פתוחה — רמזורים אדומים ושורות שינוי מחיר קפואות — במקום אחד. סרגל הפער מצמצם את הרשימה לטווח, משני הקצוות (למשל $0-$150 כדי לראות רק את הפערים הקטנים), ולכל שורה יש קישור לעמוד האירוע באתר. לכל שורה שלושה כפתורים: משימה פותחת משימה עוקבת, לתקן קופץ ישר לשדה שבאמת מתקן את זה, וטופל מתעד שטיפלתם בלי לגעת במחיר — רמזור נשאר מוסתר עד הבדיקה הלילית הבאה (וחוזר אם הוא עדיין אדום), ושורת מחיר קפואה מסומנת כנבדקה עם 'סומן כטופל' לפני ההערה המקורית של הסנכרון. הסימון הזה סופי — שום דבר לא פותח אותו מחדש. רק שורת שינוי מחיר שנסגרה דרך המשימה שלה יכולה לחזור: פתיחה מחדש של אותה משימה משחזרת את השורה ואת ההערה המקורית.",
      ),
    ],
    links: [
      { label: t("Tasks board", "לוח משימות"), href: "/tasks" },
      { label: t("Pricing tab", "לשונית תמחור"), href: "/tasks?tab=pricing" },
      { label: t("Kanban view", "תצוגת קאנבן"), href: "/tasks?tab=kanban" },
      { label: t("Roadmap", "מפת דרכים"), href: "/tasks?tab=roadmap" },
      { label: t("Marketing board", "לוח שיווק"), href: "/tasks?tab=marketing" },
      { label: t("Recurring rules", "כללים חוזרים"), href: "/tasks?tab=rules", adminOnly: true },
    ],
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
      t(
        "Link builder (portal menu → הלינקים שלי, and the same page picker sits on the portal dashboard under the package search): besides the homepage and per-event links, a partner can point a tracking link at any site page - an artist, a team or a category (/c/...) - with the same utm_source attribution. Pages are searchable in Hebrew or English, and the dashboard's package search finds an event by its Hebrew or English name, venue, artist, team or league. The menu's לאתר button opens the customer site with the agent already connected (agent badge in the site header, agent payment options at checkout) - the portal is the only place a partner signs in.",
        "בונה הלינקים (תפריט הפורטל → הלינקים שלי, ואותו בורר עמודים יושב גם בדשבורד הפורטל מתחת לחיפוש החבילות): מלבד דף הבית ולינק לאירוע, שותף יכול לכוון לינק מעקב לכל עמוד באתר — אמן, קבוצה או קטגוריה (/c/...) — עם אותה זקיפה של utm_source. העמודים ניתנים לחיפוש בעברית או באנגלית, וחיפוש החבילות בדשבורד מוצא אירוע לפי שם בעברית או באנגלית, מקום, אמן, קבוצה או ליגה. כפתור ״לאתר״ בתפריט פותח את אתר הלקוחות כשהסוכן כבר מחובר (תג סוכן בכותרת האתר, אפשרויות תשלום של סוכן בקופה) — הפורטל הוא המקום היחיד שבו שותף מתחבר.",
      ),
      t(
        "Influencer coupon: every affiliate (משפיען) gets one coupon built from the follower discount - code = tracking code + value (AVIRAN30), fixed amounts are per person like the link discount, and an order with the code counts as the influencer's. Built from the partner editor; saving a new follower discount renames it.",
        "קופון משפיען: לכל משפיען קופון אחד שנבנה מהנחת העוקבים — קוד = קוד מעקב + ערך (AVIRAN30), סכום קבוע הוא לאדם כמו בהנחת הלינק, והזמנה עם הקוד נספרת למשפיען. נבנה מעורך השותף; שמירת הנחת עוקבים חדשה משנה את הקוד.",
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
