// The system guide's content - every section, rule, deep link and flow chart,
// in both languages. Pure data; guide-client.tsx renders it. Think of it as
// the CLAUDE.md of the backoffice, readable by humans.
//
// Laid out like the sidebar (Dor, 30.09): every section names the menu screen
// it belongs to (`nav` = that screen's href in lib/nav.ts, or "start"), and the
// page groups them under the sidebar's own headings. `howTo` is the
// step-by-step part; any text may carry `[label](/path)` links, which open in a
// new tab. scripts/guide-selftest.ts checks every menu screen has a section and
// every link lands on a real route.
//
// One guide, every company (02.10): `productType` says which companies read a
// section - "events" (Mega Events) or "tours" (Mega Family). Untagged = shared
// by every company, so its text and links must hold in all of them. A shared
// screen (Tasks, Offline Flights, Users) whose story differs per company gets
// one section per product type. The Mega Events sections come first, then the
// tours ones; each company sees its own in this order.
//
// Keep it honest: when a flow changes (pricing rules, cron cadence, batch
// behavior), update the matching section here in the same PR.

// Type only - lib/company.ts is server code and must not reach the client bundle.
import type { ProductType } from "@/lib/company";
import { TOURS_GUIDE_SECTIONS } from "./guide-content-tours";

export type L = { en: string; he: string };

/** One "how do I…" recipe: numbered steps, each may link with [label](/path). */
export interface GuideHowTo {
  title: L;
  steps: L[];
}

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
  /** The sidebar screen this section documents (lib/nav.ts href), or "start". */
  nav: string;
  /** Only companies that sell this product type read it. Unset = shared by every company. */
  productType?: ProductType;
  title: L;
  intro: L;
  /** Step-by-step recipes - shown first, numbered. */
  howTo?: GuideHowTo[];
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
    nav: "start",
    productType: "events",
    howTo: [
      {
        title: t("Use this guide", "להשתמש במדריך הזה"),
        steps: [
          t("On any screen, \"Guide\" at the right of the top bar opens this guide in a new tab, right at the part about that screen - the screen stays open to work on.", "בכל מסך, \"Guide\" בצד ימין של הסרגל העליון פותח את המדריך הזה בלשונית חדשה, ישר בחלק של אותו מסך - המסך נשאר פתוח לעבודה."),
          t("The guide follows the sidebar: the same groups, the same screens, in the same order. Every screen's heading has \"Open the screen\", which opens it in a new tab.", "המדריך בנוי כמו התפריט: אותן קבוצות, אותם מסכים, באותו סדר. בכותרת של כל מסך יש \"פתח את המסך\", שפותח אותו בלשונית חדשה."),
          t("Every underlined link inside a step also opens in a new tab, so the guide stays open next to the screen you are working on.", "גם כל קישור עם קו תחתון בתוך צעד נפתח בלשונית חדשה, כך שהמדריך נשאר פתוח ליד המסך שעובדים עליו."),
          t("The search box reads Hebrew and English together - type a button's name (\"Save\", \"הוזל\") or a job (\"קופון\", \"מלונות\").", "תיבת החיפוש קוראת עברית ואנגלית יחד - מקלידים שם של כפתור (\"Save\", \"הוזל\") או פעולה (\"קופון\", \"מלונות\")."),
          t("\"How it works\" under the recipes opens the full explanation of a screen: the rules behind it and what happens automatically.", "\"איך זה עובד\" מתחת למתכונים פותח את ההסבר המלא של המסך: החוקים שמאחוריו ומה קורה אוטומטית."),
        ],
      },
      {
        title: t("Jump to any screen", "לקפוץ לכל מסך"),
        steps: [
          t("Press Ctrl+K (Cmd+K on a Mac) anywhere in the dashboard, or click \"Go to page…\" at the top of the sidebar or \"Search\" in the top bar.", "לוחצים Ctrl+K (Cmd+K במק) מכל מקום בדשבורד, או \"Go to page…\" בראש הסיידבר או \"Search\" בסרגל העליון."),
          t("Type part of a screen's name, its path or a Hebrew word - \"קופונים\" finds Coupons, \"מחירים\" finds Price Changes.", "מקלידים חלק משם המסך, את הנתיב או מילה בעברית - \"קופונים\" מוצא את Coupons, \"מחירים\" מוצא את Price Changes."),
          t("Arrow keys to the result, Enter to go. Esc or Ctrl+K closes the palette.", "חצים לתוצאה, Enter כדי להגיע. Esc או Ctrl+K סוגרים את החלון."),
          t("The palette lists only screens your role can open - a missing screen is admin-only.", "החלון מציג רק מסכים שהתפקיד שלכם יכול לפתוח - מסך שלא מופיע הוא למנהלים בלבד."),
        ],
      },
      {
        title: t("Make room: fold the sidebar", "לפנות מקום: לקפל את הסיידבר"),
        steps: [
          t("Ctrl+B shrinks the sidebar to icons and brings it back. The panel button at the left of the top bar does the same.", "Ctrl+B מכווץ את הסיידבר לאייקונים ומחזיר אותו. כפתור הפאנל בצד שמאל של הסרגל העליון עושה את אותו הדבר."),
          t("Click a group heading (\"Website\", \"Admin\"…) to fold or unfold it - this browser remembers it.", "לחיצה על כותרת קבוצה (\"Website\", \"Admin\"…) מקפלת או פותחת אותה - הדפדפן הזה זוכר."),
          t("Hover a folded heading to preview its screens and click one without unfolding. The group of the screen you are on opens by itself.", "ריחוף מעל כותרת מקופלת מציג את המסכים שלה, ולחיצה על אחד מגיעה אליו בלי לפתוח את הקבוצה. הקבוצה של המסך הנוכחי נפתחת מעצמה."),
        ],
      },
      {
        title: t("Theme, breadcrumbs and signing out", "ערכת צבעים, פירורי לחם והתנתקות"),
        steps: [
          t("The sun (or moon) icon at the right end of the top bar offers \"Light\", \"Dark\" or \"System\".", "אייקון השמש (או הירח) בקצה הימני של הסרגל העליון מציע \"Light\", \"Dark\" או \"System\"."),
          t("Breadcrumbs in the top bar show where you are; click an earlier part to go back up (an id shows as \"#1234\").", "פירורי הלחם בסרגל העליון מראים איפה אתם; לחיצה על חלק קודם מחזירה למעלה (מזהה מופיע כ-\"#1234\")."),
          t("Your name at the bottom of the sidebar → \"Log out\". The same menu has \"מצב סוכן\" (the partner portal in a new tab) - it works only if your user is linked to a partner in [Users](/users).", "השם שלכם בתחתית הסיידבר ← \"Log out\". באותו תפריט יש \"מצב סוכן\" (פורטל השותפים בלשונית חדשה) - עובד רק אם המשתמש שלכם מקושר לשותף ב[משתמשים](/users)."),
        ],
      },
    ],
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
        "The sun/moon button opens Light / Dark / System (System follows your computer); every screen supports both.",
        "כפתור השמש/ירח פותח Light / Dark / System (System לפי המחשב); כל מסך תומך בכולם.",
      ),
      t(
        "Breadcrumbs at the top always show where you are and click back up the path.",
        "פירורי הלחם למעלה תמיד מראים איפה אתם ולוחצים חזרה במעלה המסלול.",
      ),
    ],
    links: [{ label: t("Open the dashboard", "פתח את הדשבורד"), href: "/dashboard" }],
  },
  {
    id: "reservations",
    nav: "/reservations",
    productType: "events",
    title: t("Reservations - customer bookings", "הזמנות - הזמנות הלקוחות"),
    intro: t(
      "Every customer booking, written here by the site at checkout - one row per order with its package, payment status and source. Here you follow up with customers, buy what the order needs, and record status, accounting number and comments.",
      "כל הזמנת לקוח, שנכתבת לכאן מהאתר בסיום ההזמנה - שורה לכל הזמנה עם תכולת החבילה, מצב התשלום והמקור. כאן עושים מעקב מול הלקוח, קונים מה שההזמנה צריכה ומתעדים סטטוס, מספר הנהלת חשבונות והערות.",
    ),
    howTo: [
      {
        title: t("Find a booking and see what was bought", "למצוא הזמנה ולראות מה נקנה"),
        steps: [
          t("Open [Reservations](/reservations). The newest bookings are at the top.", "פותחים את [ההזמנות](/reservations). ההזמנות החדשות למעלה."),
          t("Type in \"Search by name, phone, email, or acc no...\" - the reservation ID works too. Click a column header (\"Email\", \"Created At\", \"Status\") to sort; \"Mega only\" keeps bookings on our own offline flights and hotels.", "מקלידים בחיפוש \"Search by name, phone, email, or acc no...\" - גם מספר הזמנה עובד. לחיצה על כותרת עמודה (\"Email\", \"Created At\", \"Status\") ממיינת; \"Mega only\" משאיר הזמנות על טיסות ומלונות האופליין שלנו."),
          t("Click the eye icon on the row to open the booking page.", "לוחצים על אייקון העין בשורה כדי לפתוח את דף ההזמנה."),
          t("\"Customer Information\" lists every passenger. \"Reservation Details\" has the total, status, payment info, exchange rate and partner code. Below: \"Event Information\", \"Flight Information\" and \"Hotel Information\". \"Print\" prints the page.", "\"Customer Information\" מציג את כל הנוסעים. ב-\"Reservation Details\" יש סכום, סטטוס, פרטי תשלום, שער חליפין וקוד שותף. מתחת: \"Event Information\", \"Flight Information\" ו-\"Hotel Information\". \"Print\" מדפיס את הדף."),
          t("Left open, the list checks for new bookings after 30 idle seconds and pops \"New Reservation\" with the names. \"Refresh\" reloads right away.", "כשהרשימה פתוחה, אחרי 30 שניות בלי פעילות היא בודקת הזמנות חדשות ומקפיצה \"New Reservation\" עם השמות. \"Refresh\" טוען מיד."),
        ],
      },
      {
        title: t("Know which tickets to buy (or allocate)", "לדעת אילו כרטיסים לקנות (או להקצות)"),
        steps: [
          t("Open the booking and scroll to \"Event Information\": event, date, \"Ticket Category\", \"Number of Tickets\" and price per ticket.", "פותחים את ההזמנה וגוללים ל-\"Event Information\": אירוע, תאריך, \"Ticket Category\", \"Number of Tickets\" ומחיר לכרטיס."),
          t("An amber \"Buy from: <SUPPLIER>\" box means you buy there - it shows the supplier's category name, the ticket id and their event id.", "תיבה כתומה \"Buy from: <ספק>\" אומרת שקונים שם - מופיעים בה שם הקטגוריה אצל הספק, מזהה הכרטיס ומזהה האירוע אצלם."),
          t("A green \"Our stock - nothing to buy\" box means the seats come from stock we hold - just allocate the number shown (and the zone).", "תיבה ירוקה \"Our stock - nothing to buy\" אומרת שהמושבים ממלאי שבידינו - רק מקצים את הכמות שמופיעה (ואת האזור)."),
          t("A red \"Not instant-confirm\" box means you confirm the ticket with that supplier by hand BEFORE confirming the order.", "תיבה אדומה \"Not instant-confirm\" אומרת שמאשרים את הכרטיס מול הספק ידנית לפני שמאשרים את ההזמנה."),
          t("\"Seating chosen by the customer\": \"all together\" = buy seats that sit together, not the cheapest split listing; \"split\" = pairs plus a triple is fine. Several events show as \"Event 1\", \"Event 2\" - repeat for each.", "\"Seating chosen by the customer\": \"all together\" = קונים מושבים צמודים, לא את ההצעה המפוצלת הזולה; \"split\" = זוגות ושלישייה זה בסדר. כמה אירועים מופיעים כ-\"Event 1\", \"Event 2\" - חוזרים על זה לכל אחד."),
        ],
      },
      {
        title: t("Check the flight and hotel (split stay, Mega inventory)", "לבדוק טיסה ומלון (שהות מפוצלת, מלאי Mega)"),
        steps: [
          t("\"Flight Information\" shows the airline, airports, times, stops and bags. \"No Flight Included\" = the order has no flight.", "\"Flight Information\" מציג חברה, שדות, שעות, עצירות ומזוודות. \"No Flight Included\" = בהזמנה אין טיסה."),
          t("Paid add-ons under the flight - \"שדרוג כרטיס\" (fare upgrade with a bag) and \"מזוודות שנוספו\" (bags bought at checkout) - are booked with the airline too.", "תוספות בתשלום מתחת לטיסה - \"שדרוג כרטיס\" (שדרוג עם מזוודה) ו-\"מזוודות שנוספו\" (מזוודות שנקנו בהזמנה) - מזמינים גם אותן מול חברת התעופה."),
          t("El Al never sells a bag as an add-on: the customer buys \"שדרוג לקלאסיק\" (Amadeus' Classic fare when it costs more than $120 a traveller, else $120). Usually the stored offer already IS the Classic fare and the line under the upgrade says so; when it reads \"להזמין CLASSIC\" in amber, the flight lines above are the lower fare and Classic is what to book.", "באל על לא נמכרת מזוודה כתוספת: הלקוח קונה \"שדרוג לקלאסיק\" (תעריף Classic של אמדאוס כשהוא יקר מ-120$ לנוסע, אחרת 120$). בדרך כלל ההצעה השמורה היא כבר תעריף Classic והשורה מתחת לשדרוג אומרת זאת; כשכתוב בכתום \"להזמין CLASSIC\", שורות הטיסה שמעל הן של התעריף הנמוך ומזמינים Classic."),
          t("A \"Mega\" badge = our own offline inventory; \"Mega inventory cost\" shows our cost × travellers or rooms. \"Mega inventory rooms\" / \"Assigned room details\" list the offline rooms with order no., supplier and \"Cancel by\" date.", "תג \"Mega\" = מלאי אופליין שלנו; \"Mega inventory cost\" מציג את העלות שלנו × נוסעים או חדרים. \"Mega inventory rooms\" / \"Assigned room details\" מציגים את חדרי האופליין עם מספר הזמנה, ספק ותאריך \"Cancel by\"."),
          t("A split stay shows a \"Split stay\" table: one row per city with dates, nights, hotel and room, \"Meal\" and price, plus \"Total hotels\". Book each hotel separately.", "שהות מפוצלת מציגה טבלת \"Split stay\": שורה לכל עיר עם תאריכים, לילות, מלון וחדר, \"Meal\" ומחיר, ועוד \"Total hotels\". מזמינים כל מלון בנפרד."),
          t("\"Meal\" says whether breakfast is included; \"ארוחת בוקר נוספה כשדרוג\" (or \"added +$\" in the split table) means the customer paid for it as an upgrade.", "\"Meal\" אומר אם ארוחת בוקר כלולה; \"ארוחת בוקר נוספה כשדרוג\" (או \"added +$\" בטבלת הפיצול) = הלקוח שילם עליה כשדרוג."),
          t("\"Room\", \"Cancellation\" and \"Payment type\" are the booked rate's own terms in RateHawk's words - \"Non-refundable\" (red) or \"Free until 22/06/2027 23:00\" in the hotel's local time, then \"Pay later\" / \"Pay now\". Look the hotel up in the extranet with exactly these dates, this room and these terms: a refundable rate or a longer stay is a different, dearer product, not a site mistake. If the extranet still shows a different price, send a screenshot before booking another hotel.", "\"Room\", \"Cancellation\" ו-\"Payment type\" הם תנאי התעריף שנקנה, במילים של רייטהוק - \"Non-refundable\" (באדום) או \"Free until 22/06/2027 23:00\" בשעון המקומי של המלון, ואז \"Pay later\" / \"Pay now\". מחפשים את המלון ב-extranet בדיוק עם התאריכים, החדר והתנאים האלה: תעריף עם ביטול חינם או שהות ארוכה יותר הם מוצר אחר ויקר יותר, לא טעות באתר. אם ה-extranet עדיין מראה מחיר אחר, שולחים צילום מסך לפני שמזמינים מלון אחר."),
        ],
      },
      {
        title: t("Update status, accounting number and comments", "לעדכן סטטוס, מספר הנהלת חשבונות והערות"),
        steps: [
          t("In the [Reservations](/reservations) list, type straight into \"Comment\" or \"Acc No.\" and press Enter - it saves at once.", "ברשימת [ההזמנות](/reservations) מקלידים ישר ב-\"Comment\" או ב-\"Acc No.\" ולוחצים Enter - נשמר מיד."),
          t("Several bookings: tick the rows, choose from \"Set status…\" (Paid / Lost / Pending / Follow-up) and click \"Apply\".", "כמה הזמנות: מסמנים את השורות, בוחרים ב-\"Set status…\" (Paid / Lost / Pending / Follow-up) ולוחצים \"Apply\"."),
          t("Cancel: open the booking → \"Edit Reservation\" → \"Status\" = \"Cancelled\" → \"Save Changes\" → \"Yes, Save\". No status fits? Type a custom one in the box next to \"Status\".", "ביטול: פותחים את ההזמנה ← \"Edit Reservation\" ← \"Status\" = \"Cancelled\" ← \"Save Changes\" ← \"Yes, Save\". אין סטטוס מתאים? מקלידים סטטוס חופשי בתיבה שליד \"Status\"."),
          t("\"24Save\" is a customer's 24-hour price hold, not a sale - it holds no seats until the customer pays.", "\"24Save\" הוא שמירת מחיר של לקוח ל-24 שעות, לא מכירה - לא תופס מקומות עד שהלקוח משלם."),
          t("\"Cancelled\" and \"Lost\" put Mega seats and rooms back on sale automatically. Reopening a booking does not take them back until the flight is opened in [Offline Flights](/offline-flights) or the hotel in [Offline Hotels](/offline-hotels) - the count then corrects itself.", "\"Cancelled\" ו-\"Lost\" מחזירים מושבים וחדרי Mega למכירה אוטומטית. פתיחה מחדש של הזמנה לא תופסת אותם שוב עד שפותחים את הטיסה ב-[Offline Flights](/offline-flights) או את המלון ב-[Offline Hotels](/offline-hotels) - אז הספירה מתקנת את עצמה."),
          t("Deleting is superadmin-only (bin icon or bulk \"Delete\") and only marks the booking deleted; \"Show deleted\" brings those rows back into view.", "מחיקה היא לסופר-אדמין בלבד (אייקון הפח או \"Delete\" על כמה שורות) ורק מסמנת את ההזמנה כמחוקה; \"Show deleted\" מחזיר את השורות האלה לתצוגה."),
        ],
      },
      {
        title: t("Follow-up - a customer waiting for a call back", "Follow-up - לקוח שמחכה שנחזור אליו"),
        steps: [
          t("Set the booking to \"Follow-up\": tick the row(s), \"Set status…\" → \"Follow-up\" → \"Apply\", or pick it in \"Edit Reservation\". It gets a call-back day by itself - the next working day (Sunday-Thursday).", "מעבירים את ההזמנה ל-\"Follow-up\": מסמנים את השורה/ות, \"Set status…\" ← \"Follow-up\" ← \"Apply\", או בוחרים ב-\"Edit Reservation\". היא מקבלת יום חזרה לבד - יום העבודה הבא (ראשון-חמישי)."),
          t("Change the day in the date box under the amber \"Follow-up\" tag in the \"Status\" column (or \"Call the customer back on\" in \"Edit Reservation\") - picking a day saves at once. Write what was agreed in \"Comment\".", "משנים את היום בתיבת התאריך מתחת לתג הכתום \"Follow-up\" בעמודת \"Status\" (או ב-\"Call the customer back on\" ב-\"Edit Reservation\") - בחירת יום נשמרת מיד. את מה שסוכם כותבים ב-\"Comment\"."),
          t("The tag next to the day says where it stands: \"Today\", \"2 days late\" (red), \"In 3 days\", or \"No date\" for a booking that never got a day.", "התג ליד היום אומר איפה הוא עומד: \"Today\", \"2 days late\" (אדום), \"In 3 days\", או \"No date\" להזמנה שלא נקבע לה יום."),
          t("Click \"Follow-up\" above the [Reservations](/reservations) list to see only that pile, longest overdue first. In the full list those rows are tinted.", "לוחצים \"Follow-up\" מעל רשימת [ההזמנות](/reservations) כדי לראות רק את הערימה הזו, האיחור הארוך קודם. ברשימה המלאה השורות האלה צבועות."),
          t("Every working morning a mail lists the customers to call that day: the day is today, has passed, or was never set. A booking leaves it when you move the day forward or change the status (\"Paid\" / \"Lost\").", "כל בוקר של יום עבודה יוצא מייל עם הלקוחות שצריך לחזור אליהם באותו יום: היום הגיע, עבר, או לא נקבע. הזמנה יורדת ממנו כשמזיזים את היום קדימה או משנים סטטוס (\"Paid\" / \"Lost\")."),
        ],
      },
      {
        title: t("Complete passenger details for ticketing", "להשלים פרטי נוסעים להנפקה"),
        steps: [
          t("Open the booking and click \"Edit Reservation\" (or the pencil icon in the list).", "פותחים את ההזמנה ולוחצים \"Edit Reservation\" (או אייקון העיפרון ברשימה)."),
          t("Checkout collects names only; under \"Passengers\" fill each traveller's \"Passport no.\", \"Passport expiry\", \"Date of birth\", \"Nationality\" (2 letters, e.g. IL) and \"Gender\".", "באתר נאספים רק שמות; תחת \"Passengers\" ממלאים לכל נוסע \"Passport no.\", \"Passport expiry\", \"Date of birth\", \"Nationality\" (2 אותיות, למשל IL) ו-\"Gender\"."),
          t("Click \"Save Changes\" and confirm with \"Yes, Save\". \"no passport details yet\" on the booking page means something is still missing.", "לוחצים \"Save Changes\" ומאשרים ב-\"Yes, Save\". \"no passport details yet\" בדף ההזמנה אומר שעדיין חסר משהו."),
        ],
      },
      {
        title: t("Agent and voucher bookings, travel material, source", "הזמנות סוכן ושובר, חומר ללקוח, מקור הגעה"),
        steps: [
          t("\"Source\" shows the partner code, or \"Organic\" when the customer came directly; \"סוכן\" shows the office agent it is credited to. Fix a wrong code in \"Edit Reservation\" → \"Partner Tracking Code\".", "\"Source\" מציג את קוד השותף, או \"Organic\" כשהלקוח הגיע ישירות; \"סוכן\" מציג את סוכן המשרד שההזמנה נזקפת לו. קוד שגוי מתקנים ב-\"Edit Reservation\" ← \"Partner Tracking Code\"."),
          t("An amber \"Voucher\" badge means the agent pays with a voucher - do not call the customer for payment. Move \"Voucher State\" along in \"Agent Settlement\" (\"שובר נשלח\" → \"שובר נקלט\" → \"שובר נגבה\") and set \"Paid\" only once it is collected.", "תג כתום \"Voucher\" אומר שהסוכן משלם בשובר - לא מתקשרים ללקוח לגבייה. מקדמים את \"Voucher State\" ב-\"Agent Settlement\" (\"שובר נשלח\" ← \"שובר נקלט\" ← \"שובר נגבה\") ומסמנים \"Paid\" רק אחרי שנגבה."),
          t("After sending the travel documents, click \"סמן שחומר נשלח ללקוח\" (\"בטל סימון\" undoes it). \"מקור הגעה\" at the bottom lists the ad/UTM visits before the booking; \"Primary\" gets the credit.", "אחרי ששולחים את מסמכי הנסיעה לוחצים \"סמן שחומר נשלח ללקוח\" (\"בטל סימון\" מבטל). \"מקור הגעה\" בתחתית מציג את ביקורי הפרסום/UTM שלפני ההזמנה; \"Primary\" מקבל את הזיכוי."),
        ],
      },
    ],
    links: [{ label: t("Reservations", "הזמנות"), href: "/reservations" }],
  },
  {
    id: "dashboard",
    nav: "/dashboard",
    productType: "events",
    howTo: [
      {
        title: t("Start the day from the dashboard", "לפתוח את היום מהדשבורד"),
        steps: [
          t("Open the [Dashboard](/dashboard).", "פותחים את [הדשבורד](/dashboard)."),
          t("A red \"Google reviews sync is broken\" banner at the top means new Google reviews stopped reaching the site. Admins click \"Run sync now\" (admins); everyone else tells an admin.", "באנר אדום \"Google reviews sync is broken\" למעלה אומר שביקורות גוגל חדשות לא מגיעות לאתר. מנהלים לוחצים \"Run sync now\" (מנהלים); כל השאר מעדכנים מנהל."),
          t("The top cards count \"Events\" (7+ days away), \"Agents\", \"Partners\", \"Paid Reservations\" and \"Pending Reservations\".", "הכרטיסים העליונים סופרים \"Events\" (7+ ימים קדימה), \"Agents\", \"Partners\", \"Paid Reservations\" ו-\"Pending Reservations\"."),
          t("\"Pending Reservations\" are bookings not paid yet. Open [Reservations](/reservations) and sort by \"Status\" to work through them.", "\"Pending Reservations\" הן הזמנות שעוד לא שולמו. פותחים את [ההזמנות](/reservations) וממיינים לפי \"Status\" כדי לעבור עליהן."),
          t("A banner \"N customers are waiting for a call back\" appears while a booking in \"Follow-up\" is due today, overdue (the banner turns red) or has no day. \"Open the list\" goes to the pile.", "באנר \"N customers are waiting for a call back\" מופיע כל עוד יש הזמנה ב-\"Follow-up\" שהיום שלה הגיע, עבר (הבאנר נהיה אדום) או שאין לה יום. \"Open the list\" מוביל לערימה."),
          t("The \"Follow-up\" card under the top cards lists who to call back, in order: day tag, name, event and comment, and the phone number (click to dial). The name opens the booking.", "הכרטיס \"Follow-up\" מתחת לכרטיסים העליונים מציג למי לחזור, לפי הסדר: תג היום, שם, אירוע והערה, ומספר הטלפון (לחיצה מחייגת). השם פותח את ההזמנה."),
          t("\"My tasks\" lists up to 6 of your open tasks, most urgent first (dot = priority, date = due date). \"All tasks\" opens the full board. A row tagged \"לבדיקה שלך\" is a task you opened that its assignee finished - ticking it approves it. Tasks you sent to review yourself leave the list until they come back.", "\"My tasks\" מציג עד 6 משימות פתוחות שלכם, הדחופה קודם (נקודה = עדיפות, תאריך = יעד). \"All tasks\" פותח את הלוח המלא. שורה עם תג \"לבדיקה שלך\" היא משימה שפתחתם והמשובץ סיים - סימון וי מאשר אותה. משימות שהעברתם בעצמכם לבדיקה יורדות מהרשימה עד שהן חוזרות."),
        ],
      },
      {
        title: t("Close a task without leaving the dashboard", "לסגור משימה בלי לצאת מהדשבורד"),
        steps: [
          t("In the \"My tasks\" card on the [Dashboard](/dashboard), tick the checkbox next to the task.", "בכרטיס \"My tasks\" ב[דשבורד](/dashboard) מסמנים וי ליד המשימה."),
          t("It leaves the list right away and is marked \"Done\" on the board. Whoever opened the task gets an email.", "היא יורדת מהרשימה מיד ומסומנת \"Done\" בלוח. מי שפתח את המשימה מקבל מייל."),
          t("Ticked the wrong one? Open [Tasks](/tasks), pick the \"Done\" view and set its \"Status\" back to \"In progress\".", "סימנתם בטעות? פותחים את [המשימות](/tasks), בוחרים בתצוגה \"Done\" ומחזירים את ה-\"Status\" ל-\"In progress\"."),
        ],
      },
      {
        title: t("Read the sales numbers", "לקרוא את מספרי המכירות"),
        steps: [
          t("Scroll to \"Statistics\". Every number there counts only Paid bookings, and deleted ones are left out.", "גוללים ל-\"Statistics\". כל מספר שם סופר רק הזמנות Paid, והזמנות מחוקות לא נספרות."),
          t("\"Reservations Last 7 Days\" / \"Last 30 Days\" / \"This Month\" / \"Last Month\" count bookings. The \"PAX:\" line under each one counts travellers.", "\"Reservations Last 7 Days\" / \"Last 30 Days\" / \"This Month\" / \"Last Month\" סופרים הזמנות. שורת \"PAX:\" מתחת לכל אחד סופרת נוסעים."),
          t("\"Revenue\" is what all Paid bookings paid, in dollars - the customer price with the coupon and any agent-card discount already taken off. It is revenue, not profit: supplier costs and ad spend are in the [Marketing Dashboard](/marketing) (admins).", "\"Revenue\" הוא מה שכל הזמנות ה-Paid שילמו, בדולרים - מחיר הלקוח אחרי שהקופון והנחת כרטיס הסוכן כבר ירדו. זו הכנסה ולא רווח: עלות ספקים והוצאה על מודעות נמצאות ב[דשבורד שיווק](/marketing) (מנהלים)."),
          t("\"Top Events\" and \"Top Sources\" (30d, This Month, Last Month) show what sells and which partner codes bring buyers. \"Organic\" = no partner code.", "\"Top Events\" ו-\"Top Sources\" (30d, This Month, Last Month) מראים מה נמכר ואילו קודי שותף מביאים קונים. \"Organic\" = בלי קוד שותף."),
          t("In \"Reservations Over Time\", click \"Last 7 days\", \"Last 30 days\", \"Last 90 days\", \"YTD\" or \"Last year\" to change the range. This chart also counts only Paid bookings.", "ב-\"Reservations Over Time\" לוחצים \"Last 7 days\", \"Last 30 days\", \"Last 90 days\", \"YTD\" או \"Last year\" כדי לשנות את הטווח. גם הגרף הזה סופר רק הזמנות Paid."),
        ],
      },
      {
        title: t("Pick up missing creative work", "לאסוף עבודת קריאייטיב חסרה"),
        steps: [
          t("The \"Creative gaps\" card counts missing visuals by type. Red numbers block advertising; amber ones hurt page quality.", "כרטיס \"Creative gaps\" סופר ויזואלים חסרים לפי סוג. מספר אדום חוסם פרסום; כתום פוגע באיכות העמוד."),
          t("Click a tile to jump to the screen where that asset is added (a template, the event, the creative generator).", "לחיצה על משבצת קופצת למסך שבו מוסיפים את הנכס הזה (תבנית, האירוע, מחולל הקריאייטיב)."),
          t("Or click \"Details\" to see the whole queue in [Creative gaps](/tasks?tab=gaps), most blocking first.", "או לוחצים \"Details\" כדי לראות את כל התור ב-[Creative gaps](/tasks?tab=gaps), החוסם קודם."),
        ],
      },
      {
        title: t("Check the price-light summary (admins)", "לבדוק את סיכום הרמזור (מנהלים)"),
        steps: [
          t("Only admins see the \"רמזור מחירים\" card. Its bar splits every price conclusion by color - hover a segment for its count.", "רק מנהלים רואים את כרטיס \"רמזור מחירים\". הפס שלו מחלק כל מסקנת מחיר לפי צבע - ריחוף על קטע מציג את הכמות."),
          t("The line under it reads \"X אדומים · Y ממתינים להחלטה\". Y counts red events that nobody silenced or opened a task for.", "השורה מתחת: \"X אדומים · Y ממתינים להחלטה\". Y סופר אירועים אדומים שאף אחד לא השתיק ולא פתח להם משימה."),
          t("Click \"פירוט\" to go straight to those [pending reds](/price-light?f=pending) and decide on each one.", "לוחצים \"פירוט\" ומגיעים ישר ל[אדומים הממתינים](/price-light?f=pending) כדי להחליט על כל אחד."),
          t("Editors don't see this card. Red prices reach them in the [Pricing tab](/tasks?tab=pricing).", "עורכים לא רואים את הכרטיס. מחירים אדומים מגיעים אליהם ב[לשונית התמחור](/tasks?tab=pricing)."),
        ],
      },
    ],
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
    nav: "/events",
    productType: "events",
    howTo: [
      {
        title: t("Find and edit an event", "למצוא אירוע ולערוך אותו"),
        steps: [
          t("Open [Events](/events) and type part of the name in \"Search events...\". \"Hide past events\" shortens the list; deleted events show only with \"Show deleted events\".", "פותחים את [האירועים](/events) ומקלידים חלק מהשם ב-\"Search events...\". \"Hide past events\" מקצר את הרשימה; אירועים מחוקים מופיעים רק עם \"Show deleted events\"."),
          t("Small changes save right in the row: \"Tags\", \"Skip Flight\", \"Add. Markup\" (Enter saves) and \"Prioritized\".", "שינויים קטנים נשמרים ישר בשורה: \"Tags\", \"Skip Flight\", \"Add. Markup\" (Enter שומר) ו-\"Prioritized\"."),
          t("For anything else, the row's \"...\" menu → \"Edit\". \"View\" is read-only; \"Duplicate\" makes a \"(Copy)\" you can move to another date.", "לכל השאר, תפריט ה-\"...\" בשורה ← \"Edit\". \"View\" לקריאה בלבד; \"Duplicate\" יוצר \"(Copy)\" שאפשר להעביר לתאריך אחר."),
          t("On a wide screen the \"On this page\" rail jumps between cards: Basic information, Location, Lodging, Ready package, Images, Tickets & rates, Suppliers & zones.", "במסך רחב, מסילת \"On this page\" קופצת בין הכרטיסים: Basic information, Location, Lodging, Ready package, Images, Tickets & rates, Suppliers & zones."),
          t("Once you change something, \"You have unsaved changes\" appears at the bottom: \"Save Event\" → \"Save Changes\", or \"Discard\".", "ברגע שמשנים משהו מופיע למטה \"You have unsaved changes\": \"Save Event\" ← \"Save Changes\", או \"Discard\"."),
          t("To see the change on the site right away, click \"Revalidate live site\" at the top of the editor.", "כדי לראות את השינוי באתר מיד, לוחצים \"Revalidate live site\" בראש העורך."),
        ],
      },
      {
        title: t("Set or refresh an event's base prices", "לעדכן את מחירי הבסיס של אירוע"),
        steps: [
          t("Open the event. \"לתקן\" on the [Pricing tab](/tasks?tab=pricing) and \"הוזל\" on Price Light (admins) land straight on the price fields in \"Basic Information\".", "פותחים את האירוע. \"לתקן\" ב[לשונית התמחור](/tasks?tab=pricing) ו-\"הוזל\" ברמזור (מנהלים) נוחתים ישר על שדות המחיר בכרטיס \"Basic Information\"."),
          t("Check the inputs: \"City IATA Code\", \"Latitude\" and \"Longitude\" in \"Location\", and \"Default Departure Date\" / \"Default Return Date\" (they follow \"Date\" automatically).", "בודקים את הנתונים: \"City IATA Code\", \"Latitude\" ו-\"Longitude\" בכרטיס \"Location\", ו-\"Default Departure Date\" / \"Default Return Date\" (מתעדכנים לבד לפי \"Date\")."),
          t("\"Search Flights\" fills \"Base Flight Price\" by the pricing rule and shows the arithmetic; \"Search Hotels\" does the same for \"Base Hotel Price\".", "\"Search Flights\" ממלא את \"Base Flight Price\" לפי כלל התמחור ומציג את החשבון; \"Search Hotels\" עושה אותו דבר ל-\"Base Hotel Price\"."),
          t("You can also type a base by hand (e.g. offline inventory linked). The per-event extra is \"Additional Event Markup (USD)\"; \"Skip-Flight Markup (USD per ticket)\" appears only with \"Allow Skip Flight\" on.", "אפשר גם להקליד בסיס ידנית (למשל כשמקושר מלאי offline). התוספת לאירוע היא \"Additional Event Markup (USD)\"; \"Skip-Flight Markup (USD per ticket)\" מופיע רק כש-\"Allow Skip Flight\" דלוק."),
          t("Save. The price light recalculates on save; \"Revalidate live site\" puts the new price on the site right away.", "שומרים. הרמזור מחושב מחדש בשמירה; \"Revalidate live site\" מעלה את המחיר החדש לאתר מיד."),
          t("The refresh icon in the table's \"Usual Price\" column quotes through the same rule (it skips ticket-only events, offline-linked components and zero bases); its toast shows the arithmetic or why a base was kept.", "אייקון הרענון בעמודת \"Usual Price\" בטבלה מתמחר לפי אותו כלל (מדלג על אירועי כרטיס-בלבד, רכיבים שמקושרים למלאי offline ובסיסים של 0); ההודעה מציגה את החשבון או למה בסיס נשאר."),
        ],
      },
      {
        title: t("Create a single event", "ליצור אירוע בודד"),
        steps: [
          t("Easiest from a provider: on [TixStock](/tixstock-events), [Sports](/sports-events), [Live](/live-events) or [P1](/p1-events), click the calendar icon \"Create Event\" - the form opens filled in.", "הכי קל מספק: ב-[TixStock](/tixstock-events), [ספורט](/sports-events), [Live](/live-events) או [P1](/p1-events) לוחצים על אייקון היומן \"Create Event\" - הטופס נפתח ממולא."),
          t("From scratch: [Add Event](/events/new). Pick \"Event Type\" and fill \"Name\", \"English Name\" and \"Date\" (all required); flight dates fill themselves.", "מאפס: [Add Event](/events/new). בוחרים \"Event Type\" וממלאים \"Name\", \"English Name\" ו-\"Date\" (כולם חובה); תאריכי הטיסה מתמלאים לבד."),
          t("In \"Location\", pick from \"Select Existing Location\" (fills name, IATA and coordinates) or type them - \"Location Name\" is required.", "בכרטיס \"Location\" בוחרים מ-\"Select Existing Location\" (ממלא שם, IATA וקואורדינטות) או מקלידים - \"Location Name\" חובה."),
          t("With an IATA and dates, both base prices fill themselves (green flash). \"חיפוש אוטומטי נכשל\"? Click \"Search Flights\" / \"Search Hotels\" or type them.", "כשיש IATA ותאריכים, שני הבסיסים מתמלאים לבד (הבהוב ירוק). \"חיפוש אוטומטי נכשל\"? לוחצים \"Search Flights\" / \"Search Hotels\" או מקלידים."),
          t("Tickets: on a TixStock event, \"Add\" next to each category under \"Source Tickets\"; other types use \"Add Ticket\" in \"Tickets and Rates\" (price in USD).", "כרטיסים: באירוע TixStock לוחצים \"Add\" ליד כל קטגוריה ב-\"Source Tickets\"; בסוגים אחרים \"Add Ticket\" בכרטיס \"Tickets and Rates\" (מחיר בדולר)."),
          t("\"Save Event\" → \"Create Event\". You land on the new event, where offline flights/hotels and \"Suppliers & zones\" become available.", "\"Save Event\" ← \"Create Event\". נוחתים על האירוע החדש, ושם זמינים קישור טיסות/מלונות offline ו-\"Suppliers & zones\"."),
        ],
      },
      {
        title: t("Mark sold out, or remove from the site", "לסמן אזל או להוריד מהאתר"),
        steps: [
          t("Sold out (stays on the site, can't be booked): set \"Tag\" in \"Basic Information\" to \"Sold\" and save. Ticking \"Sold\" in the table's \"Tags\" cell (or bulk \"Set Tags\") makes it the only tag - the site's rule; other tags lock while sold out, and bulk tagging skips sold-out events.", "אזל (נשאר באתר, אי אפשר להזמין): מגדירים \"Tag\" בכרטיס \"Basic Information\" ל-\"Sold\" ושומרים. סימון \"Sold\" בתא ה-\"Tags\" בטבלה (או ב-\"Set Tags\" על כמה) הופך אותה לתגית היחידה - הכלל של האתר; שאר התגיות נעולות כל עוד האירוע אזל, ותיוג מרובה מדלג על אירועים שאזלו."),
          t("Back on sale: set \"Tag\" to \"None\" (or another tag) and save.", "חזרה למכירה: מגדירים \"Tag\" ל-\"None\" (או לתגית אחרת) ושומרים."),
          t("Off the site: in [Events](/events), the row's \"...\" menu → \"Delete\" → confirm. A soft delete - the event gets a \"Deleted Date\", nothing is erased. Several at once: tick rows → \"Delete\" in the selection bar.", "הורדה מהאתר: ב[אירועים](/events), תפריט ה-\"...\" בשורה ← \"Delete\" ← אישור. מחיקה רכה - האירוע מקבל \"Deleted Date\", שום דבר לא נמחק. כמה בבת אחת: מסמנים שורות ← \"Delete\" בפס הבחירה."),
          t("Deleted events show only with \"Show deleted events\". There is no restore button - ask a developer.", "אירועים מחוקים מופיעים רק עם \"Show deleted events\". אין כפתור שחזור - מבקשים ממפתח."),
        ],
      },
      {
        title: t("Connect or change an event's TixStock show", "לחבר או להחליף הופעת TixStock לאירוע"),
        steps: [
          t("Open the event - \"Event Type\" must be \"TixStock Event\", only then does \"Suppliers & zones\" appear.", "פותחים את האירוע - \"Event Type\" חייב להיות \"TixStock Event\", רק אז מופיע \"Suppliers & zones\"."),
          t("Click \"Connect TixStock show\" (\"Change TixStock show\" when one is connected). Pick a show (a red badge = a day gap from our date) or type a name and press Enter, then \"Connect\" / \"Switch to this\".", "לוחצים \"Connect TixStock show\" (\"Change TixStock show\" כשכבר מחוברת). בוחרים הופעה (תג אדום = פער ימים מהתאריך שלנו) או מקלידים שם ולוחצים Enter, ואז \"Connect\" / \"Switch to this\"."),
          t("Switching asks to confirm and takes the old show's TixStock tickets off - an event sells from one TixStock show.", "החלפה מבקשת אישור ומורידה את כרטיסי ה-TixStock של ההופעה הקודמת - אירוע מוכר מהופעת TixStock אחת."),
          t("The page scrolls to \"Source Tickets\": \"Add\" each category you want (price converted to USD with the supplier markup), then give a zone to anything under \"ללא אזור\" in \"Tickets by zone\".", "הדף גולל ל-\"Source Tickets\": לוחצים \"Add\" על כל קטגוריה שרוצים (המחיר מומר לדולר עם תוספת הספק), ואז משייכים לאזור כל מה שתחת \"ללא אזור\" ב-\"Tickets by zone\"."),
          t("Mix-up? \"Remove TixStock tickets\" takes them all off. Nothing changes until you save.", "טעות? \"Remove TixStock tickets\" מוריד את כולם. שום דבר לא משתנה עד השמירה."),
        ],
      },
      {
        title: t("Add LiveTickets tickets or our own seats", "להוסיף כרטיסי LiveTickets או מושבים שלנו"),
        steps: [
          t("In \"Suppliers & zones\", if \"Seat map\" says the map comes from the supplier, click \"Make this map ours\" first - zoning needs our map and at least one zone (\"Same stadium as: …\" reuses zones when offered).", "ב-\"Suppliers & zones\", אם ב-\"Seat map\" כתוב שהמפה מהספק, לוחצים קודם \"Make this map ours\" - שיוך לאזורים דורש את המפה שלנו ולפחות אזור אחד (\"Same stadium as: …\" משתמש שוב באזורים כשמוצע)."),
          t("LiveTickets: \"Add LiveTickets tickets\" → pick their event (search by name if missing) → under \"LiveTickets categories - choose our zone for each\" tick categories and pick a zone each. Double-check \"Suggested - check it\" / \"Closest zone - a guess\" badges.", "LiveTickets: \"Add LiveTickets tickets\" ← בוחרים את האירוע שלהם (חיפוש לפי שם אם חסר) ← ב-\"LiveTickets categories - choose our zone for each\" מסמנים קטגוריות ובוחרים אזור לכל אחת. בודקים שוב תגיות \"Suggested - check it\" / \"Closest zone - a guess\"."),
          t("Different date on their side? Tick \"Same fixture - the date is not final. Attach anyway.\", then \"Add N ticket(s)\".", "תאריך שונה אצלם? מסמנים \"Same fixture - the date is not final. Attach anyway.\" ואז \"Add N ticket(s)\"."),
          t("Our own seats: \"Our own ticket\" → name, \"Price $\" (the ticket part, USD), \"Seats\", optional \"Together (up to)\", zone → \"Add\".", "מושבים שלנו: \"Our own ticket\" ← שם, \"Price $\" (חלק הכרטיס, בדולר), \"Seats\", אם רוצים \"Together (up to)\", אזור ← \"Add\"."),
          t("Save the event - nothing sells before that. Our tickets then show \"sold X · left Y\"; once seats are sold, lower \"Seats\" instead of deleting.", "שומרים את האירוע - לפני כן שום דבר לא נמכר. אחר כך הכרטיסים שלנו מציגים \"sold X · left Y\"; אחרי שנמכרו מושבים מורידים את \"Seats\" במקום למחוק."),
        ],
      },
      {
        title: t("Change many events at once", "לשנות הרבה אירועים בבת אחת"),
        steps: [
          t("In [Events](/events), narrow first: \"Hide sold events\", \"Hide past events\", \"Ticket-only events only\", \"All categories\", \"All feed tags\" (\"ללא תגיות (untagged)\" finds events with no feed tag).", "ב[אירועים](/events) קודם מצמצמים: \"Hide sold events\", \"Hide past events\", \"Ticket-only events only\", \"All categories\", \"All feed tags\" (\"ללא תגיות (untagged)\" מוצא אירועים בלי תגית פיד)."),
          t("Tick rows - a bar with \"N selected\" opens: \"Set Tags\" (site badge on/off), \"Prioritized\" (Yes/No), \"Tags (feed)\" (add / replace / remove feed tags).", "מסמנים שורות - נפתח פס \"N selected\": \"Set Tags\" (תגית אתר מופעלת/כבויה), \"Prioritized\" (Yes/No), \"Tags (feed)\" (הוספה / החלפה / הסרה של תגיות פיד)."),
          t("Ticket-only in bulk: \"Skip Flight\" → \"Ticket only: ON (bases → 0; set each markup after)\". The selection clears - tick the same rows again → \"Ticket Markup\" → USD per ticket → \"Apply\". Until then the name shows \"ticket only · no markup!\".", "כרטיס-בלבד בבת אחת: \"Skip Flight\" ← \"Ticket only: ON (bases → 0; set each markup after)\". הבחירה מתאפסת - מסמנים שוב את אותן שורות ← \"Ticket Markup\" ← דולר לכרטיס ← \"Apply\". עד אז ליד השם מופיע \"ticket only · no markup!\"."),
          t("Additional markup in bulk: tick rows → \"Additional Markup\" → whole dollars per person (negative lowers the price, -5000 to 5000) → \"Apply\", or \"Clear markup\". It is the editor's \"Additional Event Markup\" on every selected event; the site refreshes at once and the old values are kept in the [Audit log](/audit-log).", "תוספת מארק-אפ בבת אחת: מסמנים שורות ← \"Additional Markup\" ← דולרים שלמים לנוסע (שלילי מוריד מחיר, 5000- עד 5000) ← \"Apply\", או \"Clear markup\". זה ה-\"Additional Event Markup\" של העורך על כל האירועים שסומנו; האתר מתרענן מיד והערכים הקודמים נשמרים ב[יומן השינויים](/audit-log)."),
          t("Price light column \"רמזור\": two pills (חב׳ = package, כר׳ = ticket); click a pill for its history. The small refresh icon rechecks against the stored catalogs - instant and safe.", "עמודת \"רמזור\": שני תגים (חב׳ = חבילה, כר׳ = כרטיס); לחיצה על תג פותחת היסטוריה. אייקון הרענון הקטן בודק מחדש מול הקטלוגים השמורים - מיידי ובטוח."),
        ],
      },
      {
        title: t("Push one event to the Meta feed now", "להעלות אירוע אחד לפיד של מטא עכשיו"),
        steps: [
          t("Open the event and save first - \"העלה לפיד עכשיו\" is disabled while there are unsaved changes.", "פותחים את האירוע ושומרים קודם - \"העלה לפיד עכשיו\" נעול כל עוד יש שינויים שלא נשמרו."),
          t("Click \"העלה לפיד עכשיו\" at the top of the editor, next to \"Revalidate live site\".", "לוחצים \"העלה לפיד עכשיו\" בראש העורך, ליד \"Revalidate live site\"."),
          t("\"האירוע בפיד\" = the creative is ready and the feed file was rewritten; Meta picks it up within the hour.", "\"האירוע בפיד\" = הקריאייטיב מוכן וקובץ הפיד נכתב מחדש; מטא קוראת אותו תוך שעה."),
          t("\"האירוע לא נכנס לפיד\" says why (sold out, under 3 days away, test event, no price). Fix it - usually the base prices - save and click again. The whole feed is on [Meta Product Feed](/meta-feed).", "\"האירוע לא נכנס לפיד\" אומר למה (אזל, פחות מ-3 ימים, אירוע בדיקה, אין מחיר). מתקנים - לרוב את מחירי הבסיס - שומרים ולוחצים שוב. הפיד המלא ב[פיד מטא](/meta-feed)."),
        ],
      },
      {
        title: t("Set up an event city or split stay", "להגדיר עיר משחק או לינה מפוצלת"),
        steps: [
          t("Make sure the event city is in [Locations](/locations) (name + coordinates, no IATA needed).", "מוודאים שעיר המשחק קיימת ב[מיקומים](/locations) (שם + קואורדינטות, בלי IATA)."),
          t("Open the event. \"Location\" stays the flight city with its IATA - don't change it.", "פותחים את האירוע. \"Location\" נשאר עיר הטיסה עם ה-IATA שלה - לא משנים."),
          t("In \"Lodging - event city\", pick the city in \"Event city from saved locations\" (or type \"Event city name\" + coordinates). The mode switches to \"Customer picks a city or splits the stay\" by itself.", "בכרטיס \"Lodging - event city\" בוחרים את העיר ב-\"Event city from saved locations\" (או מקלידים \"Event city name\" + קואורדינטות). המצב עובר לבד ל-\"Customer picks a city or splits the stay\"."),
          t("\"מלונות: לא נטען\"? Click \"טען מלונות\" and leave the page open - 15-20 minutes for a new city (\"עצירה\" stops, \"המשך טעינה\" resumes).", "\"מלונות: לא נטען\"? לוחצים \"טען מלונות\" ומשאירים את הדף פתוח - 15-20 דקות לעיר חדשה (\"עצירה\" עוצר, \"המשך טעינה\" ממשיך)."),
          t("Set \"What the hotel step offers\", \"Opens on\", \"Split default: nights in event city\" (1 or 2) and the \"Transfer note\", then save. Back to a regular event: \"Clear event city (same as flight city)\" in the same list.", "מגדירים \"What the hotel step offers\", \"Opens on\", \"Split default: nights in event city\" (1 או 2) ואת ה-\"Transfer note\", ושומרים. חזרה לאירוע רגיל: \"Clear event city (same as flight city)\" באותה רשימה."),
        ],
      },
      {
        title: t("Give an event a ready package (a click on the site lands on a full package)", "לתת לאירוע חבילה מוכנה (לחיצה באתר נוחתת על חבילה מלאה)"),
        steps: [
          t("Open the (saved) event → card \"Ready package\" → \"Build closed package\". Set \"Built for\" (the party size it is built on - on the site the customer picks their own number) and the dates. Then choose each piece: \"1. Ticket\" lists every ticket on sale, our own stock first and marked \"our stock\"; under \"2. Flight\" and \"3. Hotel\" the block \"Our inventory\" lists our own flight blocks and rooms linked to the event straight away, and \"Search online flights\" / \"Search online hotels\" bring the site's offers. \"Compose automatically\" fills all three by a plain rule (cheapest ticket, cheapest direct flight with a checked bag, cheapest 4★ with a meal) and you change what does not fit.", "פותחים את האירוע (השמור) ← כרטיס \"Ready package\" ← \"Build closed package\". קובעים \"Built for\" (מספר הנוסעים שעליו בונים - באתר הלקוח בוחר את המספר שלו) ותאריכים. ואז בוחרים כל רכיב: \"1. Ticket\" מציג כל כרטיס שבמכירה, המלאי שלנו ראשון ומסומן \"our stock\"; תחת \"2. Flight\" ו-\"3. Hotel\" הבלוק \"Our inventory\" מציג מיד את בלוקי הטיסות והחדרים שלנו שמקושרים לאירוע, ו-\"Search online flights\" / \"Search online hotels\" מביאים את ההצעות של האתר. \"Compose automatically\" ממלא את שלושתם לפי כלל פשוט (הכרטיס הזול, הטיסה הישירה הזולה עם מזוודה, 4★ הזול עם ארוחה) ומשנים מה שלא מתאים."),
          t("What the customer may swap: \"Closed package\" on = nothing. Or tick only some of \"Ticket\" / \"Flight\" / \"Hotel\" - a ticked piece gets a small \"החלפה\" link on the site, an unticked one is fixed. The same three boxes (and \"Nothing\" / \"Everything\") stay on the card afterwards, under \"The customer may swap\". A closed package still lets the customer ADD a suitcase on the site (and breakfast, when the hotel's rate has none) - an add-on on top of the same flight and hotel, at the airline's / the hotel's own price; it swaps nothing.", "מה הלקוח רשאי להחליף: \"Closed package\" דלוק = כלום. או מסמנים רק חלק מ-\"Ticket\" / \"Flight\" / \"Hotel\" - רכיב מסומן מקבל באתר קישור קטן \"החלפה\", רכיב לא מסומן קבוע. אותן שלוש תיבות (ו-\"Nothing\" / \"Everything\") נשארות אחר כך על הכרטיס, תחת \"The customer may swap\". גם בחבילה סגורה הלקוח יכול להוסיף באתר מזוודה (וארוחת בוקר, כשתעריף המלון בלי ארוחה) - תוספת על אותה טיסה ואותו מלון, במחיר של חברת התעופה / המלון; זו לא החלפה."),
          t("Which party sizes it is sold to: in the builder \"Sold to\" = \"Every party size (1-9)\" or \"Pairs only (2, 4, 6, 8)\"; on the card, under \"Sold to parties of\", click any number to sell or stop selling that size (\"Pairs only\" / \"All\" do it in one click). The site's picker offers only these. The size it was built for always stays.", "לאילו כמויות נוסעים היא נמכרת: בבילדר \"Sold to\" = \"Every party size (1-9)\" או \"Pairs only (2, 4, 6, 8)\"; בכרטיס, תחת \"Sold to parties of\", לוחצים על כל מספר כדי למכור או להפסיק למכור את הכמות הזו (\"Pairs only\" / \"All\" עושים את זה בלחיצה). הבורר באתר מציע רק את אלה. הכמות שעליה נבנתה תמיד נשארת."),
          t("\"Save as the ready package\" - the card then prices every party size that is sold; leave the page open until it finishes. A number in amber is sold but could not be priced (for example the hotel has no room for three with breakfast) - the picker on the site does not offer it until it can. On the site the package's ticket also goes through the ticket step's own live check (supplier price for that quantity, our stock), so a size the supplier cannot sell right now drops out there too.", "\"Save as the ready package\" - הכרטיס מתמחר כל כמות נוסעים שנמכרת; משאירים את הדף פתוח עד שמסיים. מספר בכתום נמכר אבל לא תומחר (למשל אין במלון חדר לשלושה עם ארוחת בוקר) - הבורר באתר לא מציע אותו עד שיתומחר. באתר הכרטיס של החבילה עובר גם את הבדיקה החיה של שלב הכרטיסים (מחיר הספק לכמות הזו, המלאי שלנו), כך שכמות שהספק לא יכול למכור כרגע יורדת גם שם."),
          t("Saving does NOT put it on the site. The box \"Is it on the site?\" at the top of the card has three buttons: \"Preview\" (where a saved package starts) - customers still get the regular flow, and only \"Open on site\" / \"Copy link\" opens the package; \"Live on the site\" - every click on the event card opens it; \"Off\" - nothing opens it, not even the link.", "שמירה לא מעלה אותה לאתר. בתיבה \"Is it on the site?\" בראש הכרטיס יש שלושה כפתורים: \"Preview\" (שם חבילה שמורה מתחילה) - הלקוחות עדיין מקבלים את התהליך הרגיל, ורק \"Open on site\" / \"Copy link\" פותחים את החבילה; \"Live on the site\" - כל לחיצה על כרטיס האירוע פותחת אותה; \"Off\" - שום דבר לא פותח אותה, גם לא הלינק."),
          t("Prices refresh every night by themselves; \"Refresh prices\" does it now. To change one piece (only the hotel, say) press \"Change a piece\": the builder opens on the package as it is, a piece you do not touch is kept, and saving prices it again. \"Cannot open\" means the party size it was built for can no longer be served - change the piece that is gone. A package built in the partner portal can still be used: \"Or use a package built in the partner portal\".", "המחירים מתרעננים כל לילה לבד; \"Refresh prices\" עושה את זה עכשיו. כדי לשנות רכיב אחד (נניח רק את המלון) לוחצים \"Change a piece\": הבילדר נפתח על החבילה כמו שהיא, רכיב שלא נוגעים בו נשמר, והשמירה מתמחרת מחדש. \"Cannot open\" אומר שמספר הנוסעים שהיא נבנתה לו כבר לא זמין - מחליפים את הרכיב שנעלם. עדיין אפשר להשתמש בחבילה שנבנתה בפורטל השותפים: \"Or use a package built in the partner portal\"."),
        ],
      },
    ],
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
        "The editor has an \"On this page\" section rail - jump straight to Images, Flights, Hotels, Tickets. Deep links from other screens land on the exact field with a highlight flash.",
        "לעורך יש מסילת סקשנים \"On this page\" — קפיצה ישירה לתמונות, טיסות, מלונות, כרטיסים. קישורים עמוקים ממסכים אחרים נוחתים על השדה המדויק עם הבהוב.",
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
    nav: "/events",
    productType: "events",
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
        "In Meta ads: the event goes up by itself like every other event, in the same catalog and the same ad sets - only its post is different. The picture says \"כרטיסים רשמיים · כרטיס בלבד\" and \"כרטיסים החל מ-$X\" at the site's own price (ticket + Ticket-Only Markup), and the ad's title ends with \"כרטיס בלבד\". All of it follows the switch by itself: flipping it redraws the picture within the hour.",
        "במודעות Meta: האירוע עולה לבד כמו כל אירוע, באותו קטלוג ובאותם סטים - רק הפוסט שלו שונה. התמונה אומרת \"כרטיסים רשמיים · כרטיס בלבד\" ו-\"כרטיסים החל מ-$X\" במחיר של האתר (כרטיס + Ticket-Only Markup), וכותרת המודעה מסתיימת ב-\"כרטיס בלבד\". הכל נגזר מהמתג לבד: שינוי שלו מצייר את התמונה מחדש בתוך שעה.",
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
        { label: t("Events → open the event → Basic Information card", "אירועים ← פתיחת האירוע ← כרטיס Basic Information") },
        { label: t("Switch \"Ticket only (no flight, no hotel)\" ON", "מדליקים את המתג \"Ticket only (no flight, no hotel)\""), sub: t("Bases drop to 0 automatically", "הבסיסים יורדים ל-0 אוטומטית") },
        { label: t("Fill Ticket-Only Markup (USD per ticket) and save", "ממלאים Ticket-Only Markup (USD לכרטיס) ושומרים") },
        { label: t("Check the card on the site: badge + \"מחיר לכרטיס\"", "בודקים את הכרטיס באתר: תגית + \"מחיר לכרטיס\"") },
      ],
    },
  },
  {
    id: "lodging",
    nav: "/events",
    productType: "events",
    title: t("Lodging - event city & split stay", "לינה - עיר המשחק ושהות מפוצלת"),
    intro: t(
      "When the match is in one city and the flight lands in another (a Liverpool game on a London flight), the event gets an EVENT CITY next to its flight city. The hotel step opens on the ordinary hotel list of the default city; above it \"איפה ישנים?\" offers three buttons - \"לינה בלונדון\", \"לינה בליברפול\" and \"פיצול מלונות\" (the event's default split: 2 nights around the match in the match city, the rest in the flight city). With a split on, \"עריכת הפיצול\" opens the night squares in place (a tap moves a night between the cities, then \"עדכון הלינה\"). The first visit to such an event shows a one-time bubble on the split button. Coming back to the same city after the match city defaults to the SAME hotel (tag \"חוזרים לאותו מלון\"); swapping that hotel moves the other nights in that city with it. City names show without the country (\"לונדון\", not \"לונדון, בריטניה\").",
      "כשהמשחק בעיר אחת והטיסה נוחתת באחרת (משחק בליברפול על טיסה ללונדון), לאירוע מוגדרת עיר משחק לצד עיר הטיסה. שלב המלון נפתח על רשימת המלונות הרגילה של עיר ברירת המחדל; מעליה \"איפה ישנים?\" עם שלושה כפתורים - \"לינה בלונדון\", \"לינה בליברפול\" ו\"פיצול מלונות\" (ברירת המחדל של האירוע: 2 לילות סביב המשחק בעיר המשחק, השאר בעיר הטיסה). כשהפיצול פעיל, \"עריכת הפיצול\" פותח במקום את ריבועי הלילות (לחיצה מעבירה לילה בין הערים, ואז \"עדכון הלינה\"). בכניסה הראשונה לאירוע כזה מופיעה פעם אחת בועה על כפתור הפיצול. חזרה לאותה עיר אחרי עיר המשחק = אותו מלון כברירת מחדל (תג \"חוזרים לאותו מלון\"); החלפת המלון מזיזה איתה את שאר הלילות באותה עיר. שמות הערים בלי המדינה (\"לונדון\", לא \"לונדון, בריטניה\").",
    ),
    points: [
      t(
        "Flight city = the event's Location (unchanged, carries the IATA). Event city = the new \"Lodging\" card: pick a saved location or type name + coordinates. Empty = today's flow.",
        "עיר הטיסה = ה-Location של האירוע (ללא שינוי, נושא את ה-IATA). עיר המשחק = כרטיס \"Lodging\" החדש: בוחרים Location שמור או מקלידים שם + קואורדינטות. ריק = הזרימה של היום.",
      ),
      t(
        "Mode: flight city only / event city only / customer picks a city / customer picks or splits. \"Opens on\" is the default city. \"Split default\" = 1 or 2 nights in the event city that \"פיצול מלונות\" lays out (2 = night before + event night).",
        "מצב: עיר טיסה בלבד / עיר משחק בלבד / הלקוח בוחר עיר / הלקוח בוחר או מפצל. \"Opens on\" = עיר ברירת המחדל. \"Split default\" = 1 או 2 לילות בעיר המשחק ש\"פיצול מלונות\" משבץ (2 = ליל לפני + ליל המשחק).",
      ),
      t(
        "Hotel nights start at the flight dates; the customer may add or drop a night in the hotel step's date picker (the flight never moves). Max 3 segments (A → B → A). Each segment gets an auto-picked hotel; \"החלפת מלון\" opens that segment's list. Price = sum of the segment hotels vs the base, same +/- as today. Every hotel shows whether breakfast is included and, when its room has a breakfast rate, \"הוסף ארוחת בוקר\" (on one hotel while another can still get it, a small popup asks: all hotels or only this one). The order summary lists each hotel with its own +/- and its breakfast; the customer mail lists every hotel; the reservation page has a Meal column per hotel.",
        "לילות המלון מתחילים מתאריכי הטיסה; הלקוח יכול להוסיף או להוריד לילה בבורר התאריכים של שלב המלון (הטיסה לא משתנה). עד 3 מקטעים (א ← ב ← א). כל מקטע מקבל מלון אוטומטי; \"החלפת מלון\" פותח את הרשימה של המקטע. המחיר = סכום מלונות המקטעים מול הבסיס, אותו +/- כמו היום. ליד כל מלון מופיע אם ארוחת הבוקר כלולה, וכשלחדר יש תעריף עם ארוחת בוקר - \"הוסף ארוחת בוקר\" (על מלון אחד כשגם לאחר אפשר, פופ-אפ קטן שואל: לכל המלונות או רק לזה). סיכום ההזמנה מציג כל מלון עם ה-+/- שלו וארוחת הבוקר שלו; המייל ללקוח מציג את כל המלונות; בדף ההזמנה יש עמודת Meal לכל מלון.",
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
    id: "euro-trips",
    nav: "/events",
    productType: "events",
    howTo: [
      {
        title: t("Build a Euro Trip", "לבנות טריפ"),
        steps: [
          t("Open [Events](/events) and switch to the \"טריפים (Euro Trip)\" tab, or go straight to [Trips](/events/trips).", "פותחים את [האירועים](/events) ועוברים ללשונית \"טריפים (Euro Trip)\", או ישר ל[טריפים](/events/trips)."),
          t("Click \"טריפ חדש\" and write a \"כותרת\" (2-80 characters) - the heading of the trip's card on the site.", "לוחצים \"טריפ חדש\" וכותבים \"כותרת\" (2-80 תווים) - הכותרת של כרטיס הטריפ באתר."),
          t("Under \"אירועים\" search by name (Hebrew or English) or by event number and pick 2 or 3 upcoming events. The × on a chip removes one.", "תחת \"אירועים\" מחפשים לפי שם (עברית או אנגלית) או לפי מספר אירוע ובוחרים 2 או 3 אירועים עתידיים. ה-× על השבב מסיר אחד."),
          t("\"סדר\": the lower number shows first. A new trip starts with \"פעיל\" off - turn it on to show the trip on the site.", "\"סדר\": המספר הנמוך מוצג קודם. טריפ חדש נפתח עם \"פעיל\" כבוי - מדליקים אותו כדי שהטריפ יוצג באתר."),
          t("\"שמירה\". The site refreshes at once - if it could not, a red \"האתר לא התרענן\" toast says so and the site catches up by itself within the hour.", "\"שמירה\". האתר מתרענן מיד - אם לא הצליח, מופיעה הודעה אדומה \"האתר לא התרענן\" והאתר מתעדכן לבד בתוך שעה."),
        ],
      },
      {
        title: t("Turn a customer's trip into a ready trip", "להפוך טיול של לקוח לטריפ מוכן"),
        steps: [
          t("A customer who built a trip on the site and ticked \"רוצים שנציע את הטיול שלכם גם לאחרים?\" before \"שמרו לי ל-24 שעות\" lands in [Trip requests](/events/trips/requests), with the name they gave it.", "לקוח שבנה טיול באתר וסימן \"רוצים שנציע את הטיול שלכם גם לאחרים?\" לפני \"שמרו לי ל-24 שעות\" מופיע ב[בקשות טריפים](/events/trips/requests), עם השם שנתן לטיול."),
          t("Requests for the same events are one card - \"3 הציעו\" means three customers built that trip. \"פרטי הלקוחות\" lists who, when, and links each hold's reservation.", "בקשות על אותם אירועים הן כרטיס אחד - \"3 הציעו\" אומר ששלושה לקוחות בנו את הטיול הזה. \"פרטי הלקוחות\" מראה מי ומתי, עם קישור להזמנה של כל אחד."),
          t("\"הפוך לטריפ\" opens the trip form with the customer's name and events. Edit the title if needed and \"שמירה\" - the trip is created and the card moves to \"טופלו\".", "\"הפוך לטריפ\" פותח את טופס הטריפ עם השם והאירועים של הלקוח. מתקנים את הכותרת אם צריך ו\"שמירה\" - הטריפ נוצר והכרטיס עובר ל\"טופלו\"."),
          t("Not a fit? \"דחייה\". A rejected card can come back with \"החזרה לבקשות\".", "לא מתאים? \"דחייה\". כרטיס שנדחה אפשר להחזיר עם \"החזרה לבקשות\"."),
        ],
      },
    ],
    title: t("Euro Trips (staff trips)", "טריפים (Euro Trip)"),
    intro: t(
      "A trip is a ready route of 2-3 events with a title you choose. The site's Build Your Euro Trip page shows the staff trips marked \"פעיל\", in \"סדר\" order; routes the site builds by itself appear only when the Euro Trip settings ask for some (0 by default). The page itself is open only while the \"יורו טריפ\" row on [Homepage](/homepage) is shown.",
      "טריפ הוא מסלול מוכן של 2-3 אירועים עם כותרת שאתם בוחרים. עמוד Build Your Euro Trip באתר מציג את הטריפים שלכם שמסומנים \"פעיל\", לפי \"סדר\"; מסלולים שהאתר בונה לבד מופיעים רק אם ההגדרות של Euro Trip מבקשות (ברירת המחדל 0). העמוד עצמו פתוח באתר רק כשהשורה \"יורו טריפ\" ב[עמוד הבית](/homepage) מוצגת.",
    ),
    points: [
      t(
        "The line under each trip says whether the site will show it: \"לא יוצג באתר: <event> - <reason>\" when an event is deleted, hidden, taken off sale, sold out, already past, a test event, ticket-only, in the US, less than 3 days away (the site sells nothing closer) or not found; \"כבוי - לא מוצג באתר\" when the switch is off; otherwise \"מוצג באתר אם כל האירועים עדיין מתאימים זה לזה\".",
        "השורה מתחת לכל טריפ אומרת אם האתר יציג אותו: \"לא יוצג באתר: <אירוע> - <סיבה>\" כשאירוע נמחק, מוסתר, הוסר מהמכירה, אזל, כבר עבר, אירוע בדיקה, כרטיס בלבד, בארה״ב, פחות מ-3 ימים מהיום (האתר לא מוכר קרוב מזה) או לא נמצא; \"כבוי - לא מוצג באתר\" כשהמתג כבוי; אחרת \"מוצג באתר אם כל האירועים עדיין מתאימים זה לזה\".",
      ),
      t(
        "The site re-checks, by itself, that the events still fit each other (distance and gap between dates, by the Euro Trip settings). A trip that stopped fitting simply disappears from the site - this screen cannot see that, so \"מוצג באתר אם...\" is a promise of \"not ruled out here\", not of \"is live\".",
        "האתר בודק לבד שהאירועים עדיין מתאימים זה לזה (מרחק ופער בין התאריכים, לפי ההגדרות של Euro Trip). טריפ שהפסיק להתאים פשוט נעלם מהאתר - המסך הזה לא רואה את זה, ולכן \"מוצג באתר אם...\" אומר \"לא נפסל כאן\", לא \"באוויר\".",
      ),
      t(
        "Auto-built routes that hold exactly the same events as a staff trip are not shown twice - the staff trip, with your title, wins. Staff trips show even when the setting for auto-built routes is 0.",
        "מסלולים שהאתר בונה לבד ומכילים בדיוק אותם אירועים כמו טריפ שלכם לא מוצגים פעמיים - הטריפ שלכם, עם הכותרת שלכם, מנצח. טריפים שלכם מוצגים גם כשההגדרה של מסלולים אוטומטיים היא 0.",
      ),
      t(
        "Any staff member can create, edit and switch trips (editors too). Every change is in the Audit Log.",
        "כל איש צוות יכול ליצור, לערוך ולהדליק/לכבות טריפים (גם עורכים). כל שינוי נרשם בלוג הביקורת.",
      ),
    ],
    rules: [
      t(
        "\"מחיקה\" removes the trip for good (a trip is not an event); the Audit Log keeps what it held. To hide a trip for a while, switch \"פעיל\" off instead.",
        "\"מחיקה\" מוחקת את הטריפ סופית (טריפ הוא לא אירוע); לוג הביקורת שומר מה היה בו. כדי להסתיר טריפ לזמן מה, מכבים \"פעיל\" במקום.",
      ),
      t(
        "A trip that vanished from the site is not an error: read its status line first (a sold-out or deleted event is the usual reason).",
        "טריפ שנעלם מהאתר הוא לא תקלה: קודם קוראים את שורת המצב שלו (אירוע שאזל או נמחק הוא הסיבה הרגילה).",
      ),
    ],
    links: [
      { label: t("Trips", "טריפים"), href: "/events/trips" },
      { label: t("Trip requests", "בקשות טריפים"), href: "/events/trips/requests" },
      { label: t("Events table", "טבלת אירועים"), href: "/events" },
    ],
  },
  {
    id: "pricing",
    nav: "/price-changes",
    productType: "events",
    howTo: [
      {
        title: t("Review a frozen price change", "בדיקת שינוי מחיר קפוא"),
        steps: [
          t("Open [Price Changes](/price-changes) (admins) and switch to \"Needs review\" - the changes above $400 the nightly sync froze.", "פותחים את [שינויי מחיר](/price-changes) (מנהלים) ועוברים ל-\"Needs review\" - השינויים מעל $400 שהסנכרון הלילי הקפיא."),
          t("Read the row: \"Event date\", \"Component\" (flight or hotel), \"Change\" (old → new) and the \"Why\" note - hover it for the full arithmetic. Click the event name to check it (the editor opens on its price fields).", "קוראים את השורה: \"Event date\", \"Component\" (טיסה או מלון), \"Change\" (ישן → חדש) והערת \"Why\" - ריחוף מציג את כל החשבון. לחיצה על שם האירוע פותחת את העורך על שדות המחיר."),
          t("New price right? Click \"אשר עדכון\" - the market price is written onto the event (\"עודכן\" toast).", "המחיר החדש נכון? לוחצים \"אשר עדכון\" - מחיר השוק נכתב על האירוע (הודעת \"עודכן\")."),
          t("Otherwise: set it yourself, hand it over as a task, or remove the event (next recipes).", "אחרת: קובעים בעצמכם, מעבירים כמשימה, או מסירים את האירוע (המתכונים הבאים)."),
        ],
      },
      {
        title: t("Set the price yourself, then close the row", "לקבוע את המחיר בעצמכם ולסגור את השורה"),
        steps: [
          t("Click the event name on the frozen row, type the base flight or hotel price you decided on, and save the event.", "לוחצים על שם האירוע בשורה הקפואה, מקלידים את מחיר הבסיס שהחלטתם עליו ושומרים את האירוע."),
          t("Back on [Price Changes](/price-changes), click \"עודכן באירוע\" on that row - it records what the event holds now, no waiting for the next cron.", "חוזרים ל[שינויי מחיר](/price-changes) ולוחצים \"עודכן באירוע\" באותה שורה - נרשם מה שהאירוע מחזיק עכשיו, בלי לחכות ל-cron."),
          t("\"סומן כעודכן\" = worked. A red \"סומן - אבל האירוע לא השתנה\" means the event still holds the old price - the row closed anyway, so go back and fix the event.", "\"סומן כעודכן\" = הצליח. \"סומן - אבל האירוע לא השתנה\" באדום אומר שהאירוע עדיין מחזיק את המחיר הישן - השורה נסגרה בכל זאת, אז חוזרים לתקן את האירוע."),
        ],
      },
      {
        title: t("Hand a frozen row to a teammate, or remove the event", "להעביר שורה קפואה למישהו, או להסיר את האירוע"),
        steps: [
          t("\"Create task\" opens the task form pre-filled (\"בדיקת מחיר: …\", the change and date, high priority). Pick \"Assign to\" and click \"Create task\" - they get an email with a link to the price fields.", "\"Create task\" פותח טופס משימה ממולא (\"בדיקת מחיר: …\", השינוי והתאריך, עדיפות גבוהה). בוחרים \"Assign to\" ולוחצים \"Create task\" - האחראי מקבל מייל עם קישור לשדות המחיר."),
          t("The row's button turns into \"Task exists\" (no second task for the same event). Closing the task as Done or Cancelled closes the row as \"נבדק\".", "הכפתור בשורה הופך ל-\"Task exists\" (בלי משימה שנייה לאותו אירוע). סגירת המשימה כבוצעה או כבוטלה סוגרת את השורה כ-\"נבדק\"."),
          t("\"הסר מהאתר\" → confirm soft-deletes the event (like the events table) and closes all its review rows.", "\"הסר מהאתר\" ← אישור מוחק את האירוע מחיקה רכה (כמו בטבלת האירועים) וסוגר את כל שורות הבדיקה שלו."),
        ],
      },
      {
        title: t("Find out why an event's price did not move", "לבדוק למה המחיר של אירוע לא זז"),
        steps: [
          t("Open [Price Changes](/price-changes) → \"All visits\" (includes the skipped visits the default \"Changes\" view hides) and type the event in \"Search events...\".", "פותחים את [שינויי מחיר](/price-changes) ← \"All visits\" (כולל ביקורים שדולגו, שתצוגת \"Changes\" מסתירה) ומקלידים את האירוע ב-\"Search events...\"."),
          t("Read \"Status\" (applied / needs review / skipped / error / נבדק) and the \"Why\" note - the arithmetic and the reason nothing changed.", "קוראים את ה-\"Status\" (applied / needs review / skipped / error / נבדק) ואת הערת \"Why\" - החשבון והסיבה שלא השתנה כלום."),
          t("No row at all? The screen keeps the last 1,500 visits and each night re-quotes only part of the catalog - the rotation may not have reached it yet.", "אין שורה בכלל? המסך שומר את 1,500 הביקורים האחרונים וכל לילה מתמחר רק חלק מהקטלוג - ייתכן שהרוטציה עוד לא הגיעה לאירוע."),
        ],
      },
    ],
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
          sub: t(
            "+$40 USD / +€40 / +£35 / +₪150 at sync; a TixStock ticket then +3.5%, rounded up - the price the site charges",
            "+$40 / +€40 / +£35 / +₪150 בסנכרון; בכרטיס TixStock עוד 3.5% ועיגול למעלה - המחיר שהאתר גובה",
          ),
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
    nav: "/price-light",
    productType: "events",
    howTo: [
      {
        title: t("Work the pending queue", "עבודה על תור הממתינים"),
        steps: [
          t("Open [Price Light](/price-light?f=pending) (admins). It opens on \"ממתינים להחלטה\": red rows not muted and with no open task.", "פותחים את [רמזור המחירים](/price-light?f=pending) (מנהלים). המסך נפתח על \"ממתינים להחלטה\": שורות אדומות שלא מושתקות ואין להן משימה פתוחה."),
          t("One conclusion at a time: pick \"חבילה\" or \"כרטיס\" above the tiles, e.g. [packages only](/price-light?f=pending&scope=package).", "מסקנה אחת בכל פעם: בוחרים \"חבילה\" או \"כרטיס\" מעל התגים, למשל [חבילות בלבד](/price-light?f=pending&scope=package)."),
          t("Biggest gap first. Hover a pill for the competitor, their raw price and every adjustment; if a gap looks odd, open \"השוואה מפורטת\" before deciding.", "הפער הגדול ראשון. ריחוף על תג מציג את המתחרה, המחיר הגולמי וכל התאמה; פער מוזר - פותחים \"השוואה מפורטת\" לפני שמחליטים."),
          t("Decide on the row - it leaves the view once it is muted, has a task, or changes color.", "מחליטים על השורה - היא יוצאת מהתצוגה כשהיא מושתקת, יש לה משימה או שהצבע משתנה."),
        ],
      },
      {
        title: t("Decide on a red row", "החלטה על שורה אדומה"),
        steps: [
          t("\"הוזל\" opens a popover that edits only that scope's markup (\"הוזל · חבילה\" / \"הוזל · כרטיס\" when both are red) - base prices are not touched.", "\"הוזל\" פותח חלון שעורך רק את המארקאפ של אותו היקף (\"הוזל · חבילה\" / \"הוזל · כרטיס\" כששניהם אדומים) - מחירי הבסיס לא משתנים."),
          t("In it, \"לכתום\" / \"לירוק\" fill the markup that reaches that color and the preview shows the new price, gap and light. On a package cut of $50+ you can tick 'סמן \"המחיר ירד\" באתר ל-14 יום'. Click \"שמור\" - or \"לעריכה מלאה באירוע\" for the event's price fields.", "בחלון, \"לכתום\" / \"לירוק\" ממלאים את המארקאפ שמגיע לצבע הזה והתצוגה מראה מחיר, פער ואור חדשים. בהוזלת חבילה של $50+ אפשר לסמן 'סמן \"המחיר ירד\" באתר ל-14 יום'. לוחצים \"שמור\" - או \"לעריכה מלאה באירוע\" לשדות המחיר של האירוע."),
          t("The ⋯ menu: \"השאר בפיד\" mutes the red for 14 days; \"משימה\" opens a high-priority task with the competitor numbers; \"סולד אאוט\" makes the event unbookable and pulls it from search and the feed (\"בטל סולד אאוט\" undoes).", "בתפריט ⋯: \"השאר בפיד\" משתיק את האדום ל-14 יום; \"משימה\" פותחת משימה בעדיפות גבוהה עם מספרי המתחרים; \"סולד אאוט\" חוסם הזמנה ומוציא מהחיפוש ומהפיד (\"בטל סולד אאוט\" מבטל)."),
          t("\"דריסה\" forces a light: \"על מה\" (when both scopes), the \"אור\", a note of 3+ characters → \"שמור דריסה\" (\"בטל דריסה\" removes it).", "\"דריסה\" כופה אור: \"על מה\" (כשיש שני היקפים), ה-\"אור\", הערה של 3+ תווים ← \"שמור דריסה\" (\"בטל דריסה\" מסירה)."),
          t("\"הסר מהאתר\" (red rows only) soft-deletes after a confirm. \"בדוק עכשיו\" works on any row and re-matches it against the stored catalogs.", "\"הסר מהאתר\" (רק בשורות אדומות) מוחק מחיקה רכה אחרי אישור. \"בדוק עכשיו\" עובד בכל שורה ומתאים אותה מחדש מול הקטלוגים השמורים."),
        ],
      },
      {
        title: t("Read the detailed comparison", "לקרוא את ההשוואה המפורטת"),
        steps: [
          t("On any row, \"השוואה מפורטת\" (column \"פירוט\") opens one table per scope: our row first, then every competitor with flight, hotel, ticket and \"מחיר · פער\". ● marks the one that set the light.", "בכל שורה, \"השוואה מפורטת\" (עמודת \"פירוט\") פותח טבלה לכל היקף: השורה שלנו ראשונה, אחריה כל מתחרה עם טיסה, מלון, כרטיס ו-\"מחיר · פער\". ● מסמן את מי שקבע את האור."),
          t("Under each competitor, \"שלנו מותאם לחבילה שלהם\" shows our price moved onto their package step by step.", "מתחת לכל מתחרה, \"שלנו מותאם לחבילה שלהם\" מראה את המחיר שלנו מותאם לחבילה שלהם צעד אחר צעד."),
          t("Our side out of date? \"פרט את שלנו עכשיו\" re-describes our flight and hotel and recomputes the light (a few seconds).", "הצד שלנו לא מעודכן? \"פרט את שלנו עכשיו\" מפרט מחדש את הטיסה והמלון שלנו ומחשב את הרמזור (כמה שניות)."),
          t("Your own call against one competitor: \"סמן צבע מול <competitor>\" → why → ירוק / כתום / אדום (\"בטל סימון\" removes). A standing reading rule for the AI: \"הוסף חוק ל-AI\" → \"שמור חוק\".", "הכרעה משלכם מול מתחרה אחד: \"סמן צבע מול <מתחרה>\" ← למה ← ירוק / כתום / אדום (\"בטל סימון\" מסיר). כלל קריאה קבוע ל-AI: \"הוסף חוק ל-AI\" ← \"שמור חוק\"."),
        ],
      },
      {
        title: t("Correct a competitor's row", "לתקן שורה של מתחרה"),
        steps: [
          t("In \"השוואה מפורטת\", click the pencil next to the competitor's name.", "ב-\"השוואה מפורטת\" לוחצים על העיפרון שליד שם המתחרה."),
          t("Change only what is wrong (price and currency, nights, stars, breakfast, bag, direct flight, transfers, airline, hotel name, ticket type) - or tick \"לא האירוע שלנו\" for a different event (this event only).", "משנים רק מה ששגוי (מחיר ומטבע, לילות, כוכבים, ארוחת בוקר, מזוודה, טיסה ישירה, העברות, חברת תעופה, שם מלון, סוג כרטיס) - או מסמנים \"לא האירוע שלנו\" לאירוע אחר (חל רק על האירוע הזה)."),
          t("Pick a reason in \"למה הערך היה שגוי?\" and write \"הערה ל-AI (חובה)\" as a reading rule (\"מוזכר רק תיק גב, לכן אין מזוודה\"). Click \"שמור\" - if disabled, \"כדי לשמור חסר:\" says what's missing.", "בוחרים סיבה ב-\"למה הערך היה שגוי?\" וכותבים \"הערה ל-AI (חובה)\" ככלל קריאה (\"מוזכר רק תיק גב, לכן אין מזוודה\"). לוחצים \"שמור\" - אם מושבת, \"כדי לשמור חסר:\" אומר מה חסר."),
          t("The toast says what happened to the light (\"חבילה: אדום ← כתום\" / \"נשאר אדום\"); the row shows \"✎ תוקן ידנית\". To undo, open the pencil again → \"בטל\".", "ההודעה אומרת מה קרה לרמזור (\"חבילה: אדום ← כתום\" / \"נשאר אדום\"); בשורה מופיע \"✎ תוקן ידנית\". לביטול פותחים שוב את העיפרון ← \"בטל\"."),
        ],
      },
      {
        title: t("Look at one competitor, or crawl it now", "להתמקד במתחרה אחד, או לסרוק אותו עכשיו"),
        steps: [
          t("Pick it in the \"כל המתחרים\" select, click its column header, or click its card in the competitors strip - e.g. [Golasso only](/price-light?comp=golasso).", "בוחרים אותו ברשימה \"כל המתחרים\", לוחצים על כותרת העמודה שלו או על הכרטיס שלו בשורת המתחרים - למשל [גולאסו בלבד](/price-light?comp=golasso)."),
          t("Only its column and the events it sells stay, and the gap becomes \"פער מול <competitor>\". Click the header again to sort by that gap; a third click, the card again, or × on \"מוכר ע״י …\" clears it.", "נשארות רק העמודה שלו והאירועים שהוא מוכר, והפער הופך ל-\"פער מול <מתחרה>\". לחיצה נוספת על הכותרת ממיינת לפי הפער הזה; לחיצה שלישית, לחיצה על הכרטיס או × ב-\"מוכר ע״י …\" מנקים."),
          t("Crawl now: the refresh icon on the card (\"סרוק עכשיו\") - Golasso and OnTour only; a crawl can take minutes. Hover a card for its last run, next due, an open breaker (\"בלם\") and staff corrections (\"✎\").", "סריקה עכשיו: אייקון הרענון בכרטיס (\"סרוק עכשיו\") - רק לגולאסו ול-OnTour; סריקה יכולה לקחת דקות. ריחוף על כרטיס מציג ריצה אחרונה, מועד הבא, בלם פתוח (\"בלם\") ותיקוני צוות (\"✎\")."),
        ],
      },
    ],
    title: t("Price light (רמזור)", "רמזור מחירים"),
    intro: t(
      "A traffic-light column on the events table (right after the usual price) shows how our price compares to competitors, per event. It never changes a price by itself - it's a read, not a rule. It compares our real \"from\" price: the site price minus the +$100 flight / +$120 hotel margins (taken from the latest search), plus ticket and site markup.",
      "עמודת רמזור בטבלת האירועים (מיד אחרי המחיר הרגיל) מראה איך המחיר שלנו עומד מול המתחרים, לכל אירוע. הרמזור לא משנה מחיר בעצמו — הוא קריאה, לא כלל. ההשוואה היא מול מחיר ה\"החל מ-\" האמיתי שלנו: טיסה ומלון בלי תוספות ה-100$/120$ (מהחיפוש האחרון), ועוד כרטיס ועמלות האתר. המחיר באתר עצמו לא משתנה.",
    ),
    points: [
      t(
        "Two pills per event: Pkg (package price vs. LiveEvents/ISSTA/Golasso) and Tkt (ticket-only price vs. LiveTickets). The number shown is our price minus the cheapest matched competitor, after normalizing their listing to look like ours: their bag, breakfast, hotel stars, direct/connecting flight and number of nights are moved onto OUR package's own (what the pricing rule would buy today), and only the difference is priced - a feature both packages have moves nothing (2026-09-24). Where our package is not described yet, ours is taken as direct, no bag, 3-star, no breakfast. Stars and breakfast count per THEIR nights. The ticket price vs. LiveTickets uses only categories a couple can buy (2+ per order).",
        "שני תגים לכל אירוע: Pkg (מחיר חבילה מול LiveEvents/ISSTA/Golasso) ו-Tkt (מחיר כרטיס בלבד מול LiveTickets). המספר המוצג הוא המחיר שלנו פחות המתחרה הזול ביותר שהותאם, אחרי נירמול המודעה שלו כך שתידמה לשלנו: המזוודה, ארוחת הבוקר, כוכבי המלון, טיסה ישירה או קונקשן ומספר הלילות שלהם מותאמים לחבילה שלנו עצמה (מה שכלל התמחור היה קונה היום), ורק ההפרש מתומחר - דבר שיש בשתי החבילות לא מזיז כלום (24.09.2026). כשהחבילה שלנו עוד לא פורטה, שלנו נחשבת ישירה, בלי מזוודה, 3 כוכבים, בלי ארוחת בוקר. כוכבים וארוחת בוקר נספרים לפי הלילות שלהם. מחיר הכרטיס מול LiveTickets נלקח רק מקטגוריות שזוג יכול לקנות (2 ומעלה בהזמנה).",
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
        "כל אתר מתחרה נסרק לכל היותר פעם בשבוע, סריקה אחת רצה בכל זמן נתון במערכת (בדיקה כל 6 שעות בוחרת את האתר שממתין הכי הרבה זמן). LiveTickets הוא היוצא מן הכלל — המספרים שלו מגיעים מאותו סנכרון live_events שכבר רץ פעמיים ביום, אז אין לו סריקה נפרדת.",
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
        "A red row gets its decisions: \"הוזל\" opens a popover that sets that scope's markup (the one price the light may write - never a base price, and the popover also links to the event's price fields); \"סולד אאוט\" makes the event unbookable; \"השאר בפיד\" silences the red for 14 days - it stays red, it just drops off the pending view until it expires or the light itself changes; \"הסר מהאתר\" soft-deletes the event after a confirm (never a hard delete); \"משימה\" opens a high-priority task with the competitor numbers baked into its description - clicking it again when one is already open just tells you it exists instead of creating a duplicate. Any row (not only red) also gets \"בדוק עכשיו\" (re-match against the stored catalogs, instant) and \"דריסה\" - force a light by hand when the automatic read is wrong, but only with a note of 3+ characters, and it's logged; \"בטל דריסה\" removes it.",
        "לשורה אדומה יש ההחלטות שלה: \"הוזל\" פותח חלון שקובע את המארקאפ של אותו היקף (המחיר היחיד שהרמזור רשאי לכתוב - אף פעם לא מחיר בסיס, והחלון מקשר גם לשדות המחיר של האירוע); \"סולד אאוט\" חוסם הזמנה; \"השאר בפיד\" משתיק את האדום ל-14 יום — הוא נשאר אדום, רק יורד מתצוגת הממתינים עד שהוא פג או שהאור עצמו משתנה; \"הסר מהאתר\" מסיר את האירוע בעדינות (soft delete) אחרי אישור — לעולם לא מחיקה לצמיתות; \"משימה\" פותחת משימה בעדיפות גבוהה עם מספרי המתחרים משובצים בתיאור — לחיצה נוספת כשכבר יש אחת פתוחה רק אומרת שהיא קיימת, לא יוצרת כפילות. לכל שורה (לא רק אדומה) יש גם \"בדוק עכשיו\" (התאמה מחדש מול הקטלוגים השמורים, מיידי) ו\"דריסה\" — כפיית אור ידנית כשהקריאה האוטומטית טועה, אבל רק עם הערה של 3+ תווים, והיא נרשמת; \"בטל דריסה\" מסירה אותה.",
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
        "The competitors panel on the same screen shows each site's last run, catalog size, next due time, and whether its circuit breaker is open. \"סרוק עכשיו\" forces an immediate crawl of one site - except LiveTickets, which has no crawl button because its numbers already refresh overnight from the live_events sync, not from browsing a page, and ISSTA and LiveEvents, whose sites serve our servers pages without packages (on LiveEvents, the concerts board): they are crawled once a week from an office computer in Israel, and this panel only shows the run that leaves behind. A crawl where one board came back empty or failed is marked partial and mails, instead of passing as a clean run.",
        "פאנל המתחרים באותו מסך מראה לכל אתר את הריצה האחרונה, גודל הקטלוג, מועד הבדיקה הבא, ואם בלם המעגל שלו פתוח. \"סרוק עכשיו\" כופה סריקה מיידית של אתר אחד — חוץ מ-LiveTickets, שאין לו כפתור סריקה כי המספרים שלו כבר מתרעננים בלילה מסנכרון live_events, לא מגלישה בדף, ומ-ISSTA ו-LiveEvents, שהאתרים שלהם מגישים לשרתים שלנו דפים בלי חבילות (ב-LiveEvents - לוח ההופעות): הם נסרקים פעם בשבוע ממחשב במשרד בישראל, והפאנל רק מציג את הריצה שנשארת מזה. סריקה שבה לוח אחד חזר ריק או נכשל מסומנת חלקית ושולחת מייל, במקום לעבור כריצה תקינה.",
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
    nav: "/ai-factory",
    productType: "events",
    title: t("AI Factory", "AI Factory"),
    adminOnly: true,
    intro: t(
      "One screen per agent running in this system - what it is, what it has learned, every AI call it made, and how well its calls have held up against what staff actually decided. The price-light judge is agent #1; the price advisor (agent #2, 2026-09-17) words and ranks price suggestions from facts the light already computed; the tour uploader (agent #3, 2026-10-21) reads a free-text brief into the plan behind [AI Uploader](/uploader), and on its board proposes a hall's Hebrew name and zone names, the Hebrew names of the run's teams (or artist) and the form of a missing location - each a proposal a person confirms. More will follow the same shape.",
      "מסך אחד לכל agent שרץ במערכת - מה הוא, מה הוא למד, כל קריאת AI שהוא ביצע, ומידת ההתאמה בין הקריאות שלו לבין מה שהצוות בפועל החליט. שופט הרמזור הוא agent מספר 1; יועץ המחיר (agent מספר 2, 17.09.2026) מנסח ומדרג הצעות מחיר מתוך עובדות שהרמזור עצמו חישב; מעלה הטורים (agent מספר 3, 21.10.2026) קורא בריף חופשי לתוכנית שמאחורי [AI Uploader](/uploader), ובלוח הריצה מציע שם בעברית לאולם ושמות לזונים שלו, שמות בעברית לקבוצות (או לאמן) של הריצה ואת הטופס של מיקום חסר - כל אחת הצעה שאדם מאשר. עוד ילכו בעקבותיהם באותה תצורה.",
    ),
    howTo: [
      {
        title: t("Open an agent and check it is on", "לפתוח agent ולבדוק שהוא דלוק"),
        steps: [
          t("Open [AI Factory](/ai-factory) (admins). Each card shows the agent's status pill, \"עלות החודש\", \"קריאות החודש\" and \"שיעור התאמה\".", "פותחים את [AI Factory](/ai-factory) (מנהלים). בכל כרטיס רואים את תג הסטטוס של הסוכן, \"עלות החודש\", \"קריאות החודש\" ו\"שיעור התאמה\"."),
          t("Click a card (\"לפרטים\"), or go straight to the [Price light judge](/ai-factory/price-light), the [Price advisor](/ai-factory/price-advisor) or the [Tour uploader](/ai-factory/tour-uploader).", "לוחצים על כרטיס (\"לפרטים\"), או נכנסים ישר ל[שופט הרמזור](/ai-factory/price-light), ל[יועץ המחיר](/ai-factory/price-advisor) או ל[מעלה הטורים](/ai-factory/tour-uploader)."),
          t("The pill should read \"פעיל\". \"כבוי\", \"מפתח חסר\" or \"כבוי (מפסק ראשי)\" means the agent is not running.", "התג צריך להראות \"פעיל\". \"כבוי\", \"מפתח חסר\" או \"כבוי (מפסק ראשי)\" אומרים שהסוכן לא רץ."),
          t("To switch it on, pass the \"איך מדליקים\" list from the \"זהות\" tab to the developer. You can't turn an agent on from this screen.", "כדי להדליק אותו מעבירים למפתח את רשימת \"איך מדליקים\" מלשונית \"זהות\". אי אפשר להדליק סוכן מהמסך הזה."),
        ],
      },
      {
        title: t("Add or retire a team rule", "להוסיף או לבטל כלל צוות"),
        steps: [
          t("Open the agent's [memory tab](/ai-factory/price-light?tab=memory) and scroll down to \"כללי צוות\".", "פותחים את [לשונית הזיכרון](/ai-factory/price-light?tab=memory) של הסוכן וגוללים עד \"כללי צוות\"."),
          t("Write one reading rule in the box (3-500 characters). It should be about something the agent reads: nights, stars, bag, breakfast, direct flight, transfers, or which listing is our event.", "כותבים בתיבה כלל קריאה אחד (3-500 תווים). הכלל צריך לעסוק במשהו שהסוכן קורא: לילות, כוכבים, מזוודה, ארוחת בוקר, טיסה ישירה, העברות, או איזו מודעה היא האירוע שלנו."),
          t("Click \"למד אותו\" (admins). The rule appears at the top of the list with your email, and every call from now on includes it.", "לוחצים \"למד אותו\" (מנהלים). הכלל מופיע בראש הרשימה עם המייל שלכם, ומעכשיו הוא נכלל בכל קריאה."),
          t("To see the exact text the model gets, open \"הזיכרון המלא\" above the rules.", "כדי לראות את הטקסט המדויק שהמודל מקבל, פותחים את \"הזיכרון המלא\" מעל הכללים."),
          t("To retire a rule, click its X (admins). It turns grey and struck through, marked \"בוטל\" with a date. You can't undo this, so add the rule again if you still need it.", "כדי לבטל כלל לוחצים על ה-X שלו (מנהלים). הוא הופך לאפור ומחוק, עם \"בוטל\" ותאריך. אי אפשר לבטל את הפעולה, אז אם עדיין צריך את הכלל מוסיפים אותו מחדש."),
        ],
      },
      {
        title: t("Review the log and mark right or wrong", "לעבור על היומן ולסמן נכון / לא נכון"),
        steps: [
          t("Open the judge's [log tab](/ai-factory/price-light?tab=log). The newest AI calls come first, 25 per page (\"הקודם\" / \"הבא\").", "פותחים את [לשונית היומן](/ai-factory/price-light?tab=log) של השופט. קריאות ה-AI החדשות ביותר מופיעות ראשונות, 25 בעמוד (\"הקודם\" / \"הבא\")."),
          t("Read the row: \"אותו אירוע?\" is the agent's answer and \"ביטחון\" is its confidence. Click the event name to check the event yourself.", "קוראים את השורה: \"אותו אירוע?\" היא התשובה של הסוכן ו\"ביטחון\" היא רמת הביטחון שלו. לוחצים על שם האירוע כדי לבדוק אותו בעצמכם."),
          t("Click ✓ if the agent was right, or ✗ if it was wrong (admins).", "לוחצים ✓ אם הסוכן צדק, או ✗ אם הוא טעה (מנהלים)."),
          t("Optionally write a note in \"הערה (רשות)\" (up to 300 characters, phrased as a reading rule), then click \"שלח\".", "אפשר לכתוב הערה ב\"הערה (רשות)\" (עד 300 תווים, בניסוח של כלל קריאה), ואז לוחצים \"שלח\"."),
          t("The row now shows \"אושר\" or \"נדחה\". You get one mark per row and can't change it. The Price advisor has no log yet, so its tab is empty.", "עכשיו מופיע בשורה \"אושר\" או \"נדחה\". כל שורה מקבלת סימון אחד ואי אפשר לשנות אותו. ליועץ המחיר עדיין אין יומן, אז הלשונית שלו ריקה."),
        ],
      },
      {
        title: t("Read maturity", "לקרוא את הבשלות"),
        steps: [
          t("Open the [maturity tab](/ai-factory/price-light?tab=maturity).", "פותחים את [לשונית הבשלות](/ai-factory/price-light?tab=maturity)."),
          t("\"הסכמה\" counts red rows that staff acted on (הוזל, הסר מהאתר, סולד אאוט). \"חוסר הסכמה\" counts reds that were silenced (\"השאר בפיד\") or overridden to another color.", "\"הסכמה\" סופרת שורות אדומות שהצוות פעל עליהן (הוזל, הסר מהאתר, סולד אאוט). \"חוסר הסכמה\" סופרת אדומים שהושתקו (\"השאר בפיד\") או נדרסו לצבע אחר."),
          t("\"משוב חיובי\" / \"משוב שלילי\" are the ✓/✗ marks from the log. AI values fixed in the detailed comparison also count as negative. These counts are not part of the rate.", "\"משוב חיובי\" / \"משוב שלילי\" הם סימוני ה-✓/✗ מהיומן. ערכי AI שתוקנו בהשוואה המפורטת נספרים גם הם כשליליים. הספירות האלה לא נכנסות לשיעור."),
          t("\"שיעור התאמה (30 יום)\" is agreed divided by agreed + disagreed. It shows \"אין מספיק החלטות\" until there are 10 decisions. The chart below shows the same week by week.", "\"שיעור התאמה (30 יום)\" הוא ההסכמות חלקי הסכמות + חוסרי הסכמה. עד שיש 10 החלטות מופיע \"אין מספיק החלטות\". הגרף מתחת מציג את אותו הדבר שבוע אחר שבוע."),
        ],
      },
    ],
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
    id: "offline-flights",
    nav: "/offline-flights",
    productType: "events",
    title: t("Offline flights - our own seats", "טיסות אופליין - המושבים שלנו"),
    intro: t(
      "Mega's own flight inventory: seats we hold on charters and group blocks. A flight linked to an event is offered on that event's package, and the nightly price sync then leaves that event's flight price alone - the price of fixed inventory is your decision.",
      "מלאי הטיסות של מגה עצמה: מושבים שאנחנו מחזיקים בצ'רטרים ובבלוקים. טיסה שמקושרת לאירוע מוצעת בחבילה שלו, והסנכרון הלילי לא נוגע אז במחיר הטיסה של האירוע - המחיר של מלאי קבוע הוא החלטה שלכם.",
    ),
    howTo: [
      {
        title: t("Create a flight", "יצירת טיסה"),
        steps: [
          t("Open [Offline Flights](/offline-flights) and click \"Add New Flight\".", "פותחים את [הטיסות האופליין](/offline-flights) ולוחצים \"Add New Flight\"."),
          t("Type the \"Airline Code (IATA)\" (e.g. LY) and click \"Validate\" - it fills the airline name and logo. \"Create Flight\" stays disabled until the button reads \"Validated\".", "מקלידים \"Airline Code (IATA)\" (למשל LY) ולוחצים \"Validate\" - זה ממלא שם ולוגו של חברת התעופה. \"Create Flight\" נשאר מושבת עד שעל הכפתור כתוב \"Validated\"."),
          t("Fill \"Price (USD)\" (per seat) and \"Initial Quantity\" (seats we hold).", "ממלאים \"Price (USD)\" (למושב) ו-\"Initial Quantity\" (המושבים שאנחנו מחזיקים)."),
          t("Under \"Outbound Flight\" / \"Inbound Flight\", fill flight numbers, airports (IATA) and times - durations calculate themselves. For a connection set \"Outbound Stops\" / \"Inbound Stops\" with the stopover; tick the bags each leg includes.", "תחת \"Outbound Flight\" / \"Inbound Flight\" ממלאים מספרי טיסה, שדות (IATA) ושעות - המשכים מחושבים לבד. בקונקשן מגדירים \"Outbound Stops\" / \"Inbound Stops\" עם שדה העצירה; מסמנים אילו מזוודות כלולות בכל כיוון."),
          t("A leg's landing must be within 48 hours of its takeoff - the form refuses a landing typed in the wrong month, because the site reads the hotel's check-in from the outbound landing.", "נחיתה של כיוון חייבת להיות עד 48 שעות אחרי ההמראה שלו - הטופס מסרב לנחיתה שהוקלדה בחודש הלא נכון, כי האתר לוקח את הצ'ק-אין של המלון מנחיתת ההלוך."),
          t("Optionally link events (next recipe), then \"Create Flight\".", "אפשר לקשר אירועים (המתכון הבא), ואז \"Create Flight\"."),
        ],
      },
      {
        title: t("Link a flight to events", "קישור טיסה לאירועים"),
        steps: [
          t("In the flight form, \"Linked Events\" lists only events in the arrival city dated between the outbound and return departures - fill airports and dates first.", "בטופס הטיסה, \"Linked Events\" מציג רק אירועים בעיר הנחיתה שהתאריך שלהם בין ההמראה הלוך להמראה חזור - קודם ממלאים שדות ותאריכים."),
          t("Tick the events and save. Saving on the edit page (\"Update Flight\") also copies the flight's price and dates onto each newly linked event.", "מסמנים את האירועים ושומרים. שמירה בדף העריכה (\"Update Flight\") מעתיקה גם את מחיר הטיסה והתאריכים לכל אירוע שקושר עכשיו."),
          t("Several flights to one event: tick rows in the table → pick the \"Event\" in the bar → \"Link event\" (\"Unlink event\" removes). From the event side: the editor's \"Offline Flights\" card → \"Link Existing\".", "כמה טיסות לאירוע אחד: מסמנים שורות ← בוחרים \"Event\" בסרגל ← \"Link event\" (\"Unlink event\" מסיר). מצד האירוע: כרטיס \"Offline Flights\" בעורך ← \"Link Existing\"."),
          t("Every path - create, series, bulk link, bulk price - copies the flight's price (and dates for a newly linked event) onto the linked events.", "כל דרך - יצירה, סדרה, קישור מרובה, שינוי מחיר מרובה - מעתיקה את מחיר הטיסה (ואת התאריכים לאירוע שקושר עכשיו) לאירועים המקושרים."),
        ],
      },
      {
        title: t("Edit a flight or change its price", "עריכת טיסה או שינוי מחיר"),
        steps: [
          t("Click any table cell to edit in place (Enter saves, Esc cancels), click the flight ID for all fields in a side panel, or the eye icon → \"Edit Flight\" → \"Update Flight\" for the full form.", "לוחצים על תא בטבלה לעריכה במקום (Enter שומר, Esc מבטל), על מזהה הטיסה לכל השדות בחלונית צד, או אייקון העין ← \"Edit Flight\" ← \"Update Flight\" לטופס המלא."),
          t("Changing one flight's price (cell or form) pushes the new base flight price to every linked event.", "שינוי מחיר של טיסה אחת (בתא או בטופס) דוחף את מחיר הבסיס החדש לכל האירועים המקושרים."),
          t("Many at once: tick them → \"Set field\" + \"Value\" + \"Apply\", or \"Price\" (± %, ± $, set $) + \"Apply price\". A bulk price change updates the linked events too.", "הרבה בבת אחת: מסמנים ← \"Set field\" + \"Value\" + \"Apply\", או \"Price\" (± %, ± $, set $) + \"Apply price\". שינוי מחיר ב-bulk מעדכן גם את האירועים המקושרים."),
          t("\"Columns\" picks the visible fields; \"Filters\" narrows by airline, dates, series, block status or event; \"Show deleted\" brings deleted flights back with \"Restore Flight\".", "\"Columns\" בוחר שדות מוצגים; \"Filters\" מסנן לפי חברה, תאריכים, סדרה, סטטוס בלוק או אירוע; \"Show deleted\" מחזיר טיסות שנמחקו עם \"Restore Flight\"."),
        ],
      },
      {
        title: t("Split a flight's seats between events", "חלוקת מושבים בין אירועים"),
        steps: [
          t("Click the arrow at the start of the row (\"Seat allocations\") - every linked event with ORG / TAKEN / AVAILABLE.", "לוחצים על החץ בתחילת השורה (\"Seat allocations\") - כל אירוע מקושר עם ORG / TAKEN / AVAILABLE."),
          t("An event without an allocation sells from the shared \"global pool\". To reserve seats: \"Allocate\", type the number, Enter. You can't go below what it sold or above the free seats.", "אירוע בלי הקצאה מוכר מהמאגר המשותף (\"global pool\"). לשריון מושבים: \"Allocate\", מספר, Enter. אי אפשר לרדת מתחת למה שנמכר או לעבור את המושבים הפנויים."),
          t("\"Remove allocation\" (X) returns it to the pool; \"Unallocated: X of Y\" turns red when allocations exceed the seats. An amber dot by the ID = a ticketing deadline or option expiry is near or past.", "\"Remove allocation\" (X) מחזיר למאגר; \"Unallocated: X of Y\" אדום כשההקצאות עוברות את המושבים. נקודה כתומה ליד המזהה = מועד כרטוס או תפוגת אופציה קרובים או עברו."),
          t("\"Export for ticketing\" downloads the passenger list; \"Export inventory\" downloads the flights.", "\"Export for ticketing\" מוריד את רשימת הנוסעים; \"Export inventory\" מוריד את הטיסות."),
        ],
      },
      {
        title: t("Create a series (same route, many dates)", "יצירת סדרה (אותו מסלול, הרבה תאריכים)"),
        steps: [
          t("Click [New series](/offline-flights/series/new).", "לוחצים [New series](/offline-flights/series/new)."),
          t("Step 1 \"Shared template\": \"Series name\", \"Airline code\" (\"Look up\"), airports, flight numbers, times, \"Price per seat (USD)\", \"Seats per flight (ORG)\", \"Block status\" → \"Next: pick dates\".", "שלב 1 \"Shared template\": \"Series name\", \"Airline code\" (\"Look up\"), שדות, מספרי טיסה, שעות, \"Price per seat (USD)\", \"Seats per flight (ORG)\", \"Block status\" ← \"Next: pick dates\"."),
          t("Step 2: pick every departure date and \"Number of days\" (return = departure + days) → \"Next: preview\".", "שלב 2: בוחרים את כל תאריכי היציאה ו-\"Number of days\" (חזרה = יציאה + ימים) ← \"Next: preview\"."),
          t("Step 3 \"Preview & adjust\": change any flight, untick suggested events, remove rows → \"Create N flight(s)\". Later, \"Filters\" → \"Series\" shows just that series.", "שלב 3 \"Preview & adjust\": משנים כל טיסה, מבטלים אירועים מוצעים, מסירים שורות ← \"Create N flight(s)\". בהמשך, \"Filters\" ← \"Series\" מציג רק את הסדרה."),
        ],
      },
    ],
    links: [
      { label: t("Offline flights", "טיסות אופליין"), href: "/offline-flights" },
      { label: t("New series", "סדרה חדשה"), href: "/offline-flights/series/new" },
    ],
  },
  {
    id: "offline-hotels",
    nav: "/offline-hotels",
    productType: "events",
    title: t("Offline hotels - our own rooms", "מלונות אופליין - החדרים שלנו"),
    intro: t(
      "Mega's own hotel inventory: rooms we hold for fixed dates. A hotel linked to an event is offered on it, and its cheapest free room per person becomes the event's base hotel price - only when the stay matches the event's default travel dates.",
      "מלאי המלונות של מגה עצמה: חדרים שאנחנו מחזיקים לתאריכים קבועים. מלון שמקושר לאירוע מוצע בו, והחדר הפנוי הזול שלו לאדם הופך למחיר הבסיס למלון של האירוע - רק כשהשהות תואמת את תאריכי הנסיעה הדיפולטיים של האירוע.",
    ),
    howTo: [
      {
        title: t("Create a hotel", "יצירת מלון"),
        steps: [
          t("Open [Offline Hotels](/offline-hotels) and click \"Add New Hotel\".", "פותחים את [המלונות האופליין](/offline-hotels) ולוחצים \"Add New Hotel\"."),
          t("In \"Search Hotel (WorldOTA)\" type 2+ letters and pick the hotel - it fills \"Hotel Name\" and \"City\" and links the hotel id. Check the city (it is read from the address).", "ב-\"Search Hotel (WorldOTA)\" מקלידים 2+ אותיות ובוחרים את המלון - זה ממלא \"Hotel Name\" ו-\"City\" ומקשר את מזהה המלון. בודקים את העיר (נקראת מהכתובת)."),
          t("Set \"Check-in Date\", \"Check-out Date\", \"Room Type\" and \"Price (USD)\" - the total per room for the whole stay, not per night or per person.", "קובעים \"Check-in Date\", \"Check-out Date\", \"Room Type\" ו-\"Price (USD)\" - סך הכול לחדר לכל השהות, לא ללילה ולא לאדם."),
          t("Optional: \"Meal Plan\", \"Last Cancellation Date\" (shown to customers), \"Guest Rating\" / \"Review Count\" (blank = from WorldOTA), \"Notes\". Add rooms and links, then \"Create Hotel\".", "לא חובה: \"Meal Plan\", \"Last Cancellation Date\" (מוצג ללקוחות), \"Guest Rating\" / \"Review Count\" (ריק = מ-WorldOTA), \"Notes\". מוסיפים חדרים וקישורים, ואז \"Create Hotel\"."),
        ],
      },
      {
        title: t("Add rooms and record bookings", "הוספת חדרים ותיעוד הזמנות"),
        steps: [
          t("Under \"Rooms\", fill the \"Room Template\" (\"Room Type\", \"Price (USD)\", \"Meal\", \"Cancel by\", \"Supplier\"), set \"Generate\" to the number of rooms and click \"Generate rooms\" (replaces the current list).", "תחת \"Rooms\" ממלאים את ה-\"Room Template\" (\"Room Type\", \"Price (USD)\", \"Meal\", \"Cancel by\", \"Supplier\"), מגדירים ב-\"Generate\" את מספר החדרים ולוחצים \"Generate rooms\" (מחליף את הרשימה)."),
          t("Adjust a room in its own card; \"Add room\" adds one, the bin removes one, \"Apply template to all\" resets them. A later save never deletes booked rooms.", "משנים חדר בכרטיס שלו; \"Add room\" מוסיף, הפח מוחק, \"Apply template to all\" מאפס לתבנית. שמירה מאוחרת לא מוחקת חדרים שהוזמנו."),
          t("After a sale, open the hotel (eye icon) → \"Rooms\" → pick the booking in \"Reservation\" (the room turns \"Booked\") and expand it for \"Supplier\", \"Order No\", \"Acc No\".", "אחרי מכירה פותחים את המלון (אייקון העין) ← \"Rooms\" ← בוחרים את ההזמנה בעמודת \"Reservation\" (החדר הופך ל-\"Booked\") ופותחים אותו ל-\"Supplier\", \"Order No\", \"Acc No\"."),
        ],
      },
      {
        title: t("Link a hotel to events", "קישור מלון לאירועים"),
        steps: [
          t("Fill the dates first, then open \"Linked Events\" - events in the hotel's city dated between check-in and check-out. The matching charter can go under \"Linked Flights\".", "קודם ממלאים תאריכים, ואז פותחים \"Linked Events\" - אירועים בעיר המלון שהתאריך שלהם בין הצ'ק-אין לצ'ק-אאוט. את הצ'רטר המתאים אפשר לקשר ב-\"Linked Flights\"."),
          t("Save (\"Create Hotel\" / \"Update Hotel\"). On the edit page, a newly linked event with no offline flight takes the hotel's dates as its travel dates.", "שומרים (\"Create Hotel\" / \"Update Hotel\"). בדף העריכה, אירוע שקושר עכשיו ואין לו טיסה אופליין מקבל את תאריכי המלון כתאריכי הנסיעה שלו."),
          t("The price reaches an event only when the hotel's check-in / check-out equal the event's default travel dates - otherwise customers don't see the hotel at all. From the event side: the \"Offline Hotels\" card → \"Link Existing\".", "המחיר מגיע לאירוע רק כשהצ'ק-אין / צ'ק-אאוט של המלון שווים לתאריכי הנסיעה הדיפולטיים של האירוע - אחרת הלקוחות לא רואים את המלון בכלל. מצד האירוע: כרטיס \"Offline Hotels\" ← \"Link Existing\"."),
        ],
      },
      {
        title: t("Edit or remove a hotel", "עריכה או הסרה של מלון"),
        steps: [
          t("\"Rooms\" in the table shows free / total. Row icons: eye (\"View Hotel\"), pencil (\"Edit Hotel\"), bin (\"Delete Hotel\").", "\"Rooms\" בטבלה מציג פנויים / סך הכול. אייקונים בשורה: עין (\"View Hotel\"), עיפרון (\"Edit Hotel\"), פח (\"Delete Hotel\")."),
          t("\"Update Hotel\" after a new price or room type pushes the new per-person price (room ÷ guests, e.g. Double = 2) to the linked events.", "\"Update Hotel\" אחרי מחיר או סוג חדר חדשים דוחף את המחיר החדש לאדם (חדר ÷ אורחים, למשל Double = 2) לאירועים המקושרים."),
          t("Delete is soft: deleted hotels hide until you tick \"Show deleted\", and \"Restore Hotel\" brings one back.", "המחיקה רכה: מלונות שנמחקו מוסתרים עד שמסמנים \"Show deleted\", ו-\"Restore Hotel\" מחזיר מלון."),
        ],
      },
    ],
    links: [{ label: t("Offline hotels", "מלונות אופליין"), href: "/offline-hotels" }],
  },
  {
    id: "sources",
    nav: "/sports-events",
    productType: "events",
    howTo: [
      {
        title: t("Find a match or show", "למצוא משחק או הופעה"),
        steps: [
          t("[Sports (XS2E)](/sports-events): pick a sport under \"Sports\", then a tournament (\"Filter tournaments...\"), then narrow \"Events\" with \"Filter events...\". Click a match for its \"Live Tickets\".", "[ספורט (XS2E)](/sports-events): בוחרים ענף תחת \"Sports\", אחר כך טורניר (\"Filter tournaments...\"), ומצמצמים את \"Events\" עם \"Filter events...\". לחיצה על משחק מציגה את ה-\"Live Tickets\" שלו."),
          t("[Live (LiveTickets)](/live-events): \"Categories\" (then \"Category 2\" / \"Category 3\"), optionally \"Performers\", then \"Filter events...\". \"Clear All Filters\" resets.", "[Live (LiveTickets)](/live-events): \"Categories\" (ואז \"Category 2\" / \"Category 3\"), אם רוצים \"Performers\", ואז \"Filter events...\". \"Clear All Filters\" מאפס."),
          t("[P1 Tickets](/p1-events): \"Categories\", \"Series\" and \"Cities\", then \"Filter events...\".", "[P1 Tickets](/p1-events): \"Categories\", \"Series\" ו-\"Cities\", ואז \"Filter events...\"."),
          t("[TixStock](/tixstock-events): a category, then a team or artist under \"Performers\", then \"Search events...\" (name, venue or city, any word order). \"Hide events without tickets\" is on by default; events under 48 hours away never appear.", "[TixStock](/tixstock-events): קטגוריה, ואז קבוצה או אמן תחת \"Performers\", ואז \"Search events...\" (שם, מקום או עיר, מילים בכל סדר). \"Hide events without tickets\" דלוק כברירת מחדל; אירועים בעוד פחות מ-48 שעות לא מופיעים."),
        ],
      },
      {
        title: t("Create one event from a row", "ליצור אירוע אחד משורה"),
        steps: [
          t("Hover the row and click the calendar icon (\"Create Event\"). The event form opens pre-filled (TixStock: in a new tab, already connected to that TixStock show).", "מרחפים על השורה ולוחצים על אייקון לוח השנה (\"Create Event\"). טופס האירוע נפתח ממולא (TixStock: בלשונית חדשה, כבר מחובר להופעת ה-TixStock)."),
          t("Sports: the Hebrew name is left empty on purpose - fill it; tickets with 4+ in stock come in converted to USD. \"View Details\" → \"Create Event\" builds the same form.", "ספורט: השם בעברית נשאר ריק בכוונה - ממלאים; כרטיסים עם 4+ במלאי נכנסים מומרים לדולר. גם \"View Details\" ← \"Create Event\" בונה את אותו טופס."),
          t("Live: set the venue - LiveTickets sends the city but no venue coordinates. P1: fill the city IATA (P1 sends none) and fix the type if it isn't sports. TixStock: add the categories from \"Source Tickets\", zone them, fill the Hebrew name and check the IATA.", "Live: קובעים את המקום - LiveTickets שולח עיר בלי קואורדינטות. P1: ממלאים IATA (P1 לא שולח) ומתקנים סוג אם זה לא ספורט. TixStock: מוסיפים קטגוריות מ-\"Source Tickets\", משייכים לאזורים, ממלאים שם בעברית ובודקים IATA."),
          t("Check the base prices, then save.", "בודקים את מחירי הבסיס ושומרים."),
        ],
      },
      {
        title: t("Create many events at once", "ליצור כמה אירועים בבת אחת"),
        steps: [
          t("Tick the events you want - the selection is kept when you change a tournament, category, performer, series or city, so a batch holds exactly what \"N selected\" says.", "מסמנים את האירועים שרוצים - הבחירה נשמרת גם כשמחליפים טורניר, קטגוריה, מבצע, סדרה או עיר, כך שהבאץ' מכיל בדיוק את מה ש-\"N selected\" אומר."),
          t("\"Create N events\" opens the batch wizard in a new tab: \"Save & Next (i/N)\", \"Skip this event\", and \"Save & Finish\" on the last step.", "\"Create N events\" פותח את וויזרד הבאץ' בלשונית חדשה: \"Save & Next (i/N)\", \"Skip this event\", ו-\"Save & Finish\" בשלב האחרון."),
          t("To upload a whole tour or a team's home games hands-off, don't select rows here - write a brief in [AI Uploader](/uploader) (admins); the events are built hidden and you approve them there. \"Clear\" empties the selection.", "כדי להעלות טור שלם או משחקי בית של קבוצה בלי עבודה ידנית לא מסמנים שורות כאן - כותבים בריף ב-[AI Uploader](/uploader) (מנהלים); האירועים נבנים מוסתרים ומאשרים אותם שם. \"Clear\" מנקה את הבחירה."),
        ],
      },
      {
        title: t("Batch home games for several teams (TixStock)", "באץ' משחקי בית לכמה קבוצות (TixStock)"),
        steps: [
          t("On [TixStock](/tixstock-events), pick a team under \"Performers\" and click \"בחר את כל משחקי הבית של <team>\" - its home games are ticked and marked \"בית\".", "ב-[TixStock](/tixstock-events) בוחרים קבוצה תחת \"Performers\" ולוחצים \"בחר את כל משחקי הבית של <קבוצה>\" - משחקי הבית שלה מסומנים ומקבלים \"בית\"."),
          t("Pick the next team and repeat - the selection accumulates, one chip per team (× clears that team).", "בוחרים את הקבוצה הבאה וחוזרים - הבחירה מצטברת, צ'יפ לכל קבוצה (× מנקה את הקבוצה)."),
          t("\"Create N events\" opens the wizard ordered team by team. Save & Next carries only TixStock tickets to the next game - attach LiveTickets and our own stock again on each step.", "\"Create N events\" פותח את הוויזרד מסודר קבוצה אחרי קבוצה. Save & Next מעביר למשחק הבא רק כרטיסי TixStock - את LiveTickets והמלאי שלנו מצרפים מחדש בכל שלב."),
        ],
      },
    ],
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
        "From any provider row: open the single-event page to create one event, or multi-select rows for Batch create. A whole tour or a team's home games are uploaded through AI Uploader instead.",
        "מכל שורת ספק: פותחים את עמוד האירוע הבודד ליצירה אחת, או מסמנים כמה שורות ל־Batch create. טור שלם או משחקי בית של קבוצה מעלים דרך AI Uploader במקום.",
      ),
      t(
        "Our own tickets: on a TixStock event, Suppliers & zones → \"Our own ticket\" adds seats WE hold - name, price (USD, the ticket part), number of seats, zone. The site sells them beside the suppliers (in a shared zone the cheaper offer wins) and stops when the seats are gone: every live reservation of that ticket takes seats (Cancelled / Lost / 24Save don't), and checkout re-counts before it books. The board shows \"sold X · left Y\"; the order mail and reservation page say \"our stock - nothing to buy\". \"Together (up to)\" says how many of the seats sit together: a party up to that size is promised to sit together, a bigger one in groups of up to that many; empty = no seating promise.",
        "כרטיסים שלנו: באירוע TixStock, ב-Suppliers & zones ← \"Our own ticket\" מוסיפים מושבים שמוחזקים אצלנו - שם, מחיר (דולר, חלק הכרטיס), מספר מושבים, אזור. האתר מוכר אותם לצד הספקים (באזור משותף ההצעה הזולה מנצחת) ועוצר כשהמושבים נגמרים: כל הזמנה חיה של הכרטיס תופסת מושבים (Cancelled / Lost / 24Save לא), והקופה סופרת שוב לפני שהיא מזמינה. הלוח מראה \"sold X · left Y\"; מייל ההזמנה ועמוד ההזמנה אומרים \"מלאי שלנו - אין מה לקנות\". \"Together (up to)\" אומר כמה מהמושבים יושבים יחד: קבוצה עד הגודל הזה מקבלת ישיבה ביחד מובטחת, קבוצה גדולה יותר - בקבוצות של עד הגודל הזה; ריק = בלי הבטחת ישיבה.",
      ),
      t(
        "The TixStock show (28.09): Suppliers & zones → \"Connect TixStock show\" lists TixStock shows within 3 days of the event's date that share its name (or search by name). Pick one and \"Source Tickets\" above loads its categories - add them there, zone them, save. Before this, an event built without TixStock tickets (say, only LiveTickets) had no way to get them. \"Change TixStock show\" swaps to another show: the current show's TixStock tickets come off first (an event sells from one TixStock show). \"Remove TixStock tickets\" takes them all off, next to \"Remove LiveTickets tickets\" - so a mix-up can be fixed by removing one supplier and adding the other, instead or as well. Nothing changes until the event is saved.",
        "הופעת TixStock (28.09): ב-Suppliers & zones ← \"Connect TixStock show\" מציג הופעות TixStock עד 3 ימים מתאריך האירוע שחולקות איתו את השם (או חיפוש לפי שם). בוחרים הופעה, ו-\"Source Tickets\" למעלה טוען את הקטגוריות שלה - מוסיפים משם, משייכים לאזורים, שומרים. לפני כן, אירוע שנבנה בלי כרטיסי TixStock (למשל רק LiveTickets) לא יכול היה לקבל אותם. \"Change TixStock show\" מחליף להופעה אחרת: כרטיסי ה-TixStock של ההופעה הנוכחית יורדים קודם (אירוע מוכר מהופעת TixStock אחת). \"Remove TixStock tickets\" מוריד את כולם, ליד \"Remove LiveTickets tickets\" - כך טעות מתקנים בהורדת ספק אחד והוספת השני, במקומו או בנוסף. שום דבר לא משתנה עד שמירת האירוע.",
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
    id: "uploader",
    nav: "/uploader",
    productType: "events",
    adminOnly: true,
    title: t("AI Uploader", "העלאה חכמה (AI Uploader)"),
    intro: t(
      "Type a brief about a tour - an artist's shows in Europe, a football team's home games, a competition round - and the AI Uploader finds every show at TixStock and LiveTickets, builds one HIDDEN event per show with all the tickets, and lays them out on a review board with what it decided and what is missing. Nothing reaches the site until an admin presses Approve.",
      "כותבים בריף על טור - הופעות של אמן באירופה, משחקי בית של קבוצה, סבב בתחרות - וה-AI Uploader מוצא כל הופעה אצל TixStock ו-LiveTickets, בונה אירוע מוסתר אחד לכל הופעה עם כל הכרטיסים, ומסדר אותם על לוח בדיקה עם מה שהחליט ומה שחסר. שום דבר לא מגיע לאתר עד שמנהל לוחץ אישור.",
    ),
    howTo: [
      {
        title: t("Upload an artist's tour", "להעלות טור של אמן"),
        steps: [
          t("Open [AI Uploader](/uploader) (admins) and write what to upload the way you would write a colleague - or click the \"טור של אמן\" example under the box and edit it. A good brief says who (one artist), which dates, what to recommend for a show that has no flight-and-hotel location (ticket only, or skip - the board asks you about each such show either way) and the markups. The example: \"יצא טור של אריק קלפטון באירופה. לכל היעדים שיש לנו לוקיישן קיים - לעלות כחבילה. לאלו שאין לוקיישן - לעלות ככרטיס בלבד. מארק אפ לכרטיס בלבד - 250 דולר. אדישנל מארק אפ - 75 דולר. כל הספקים שלנו.\"", "פותחים את [AI Uploader](/uploader) (מנהלים) וכותבים מה להעלות כמו שכותבים לעמית - או לוחצים על הדוגמה \"טור של אמן\" מתחת לתיבה ומתקנים אותה. בריף טוב אומר מי (אמן אחד), באילו תאריכים, מה להמליץ להופעה שאין לה לוקיישן לטיסה ומלון (כרטיס בלבד או לדלג - הלוח שואל אתכם על כל הופעה כזו בכל מקרה) וכמה מארק אפ. הדוגמה: \"יצא טור של אריק קלפטון באירופה. לכל היעדים שיש לנו לוקיישן קיים - לעלות כחבילה. לאלו שאין לוקיישן - לעלות ככרטיס בלבד. מארק אפ לכרטיס בלבד - 250 דולר. אדישנל מארק אפ - 75 דולר. כל הספקים שלנו.\""),
          t("Click \"פענח\". The \"מה הבנתי\" card shows how the agent read the brief: the subject (artist / team / competition, Hebrew and English name), the dates, that a show with a location is built as a package and the recommended answer when a show has no location (the board asks about each such show anyway), the suppliers (always TixStock and LiveTickets) and the two markups. A markup the brief did not state is filled from the last run and tagged \"מהפעם הקודמת\". Fix any field right on the card; \"עוד מהבריף\" lists what the agent could not place. Under the card: what the AI asks, the box \"כוון את ה-AI\", the description template and the LiveTickets switch - see \"Steer the plan before you build\" below.", "לוחצים \"פענח\". הכרטיס \"מה הבנתי\" מראה איך הסוכן קרא את הבריף: הנושא (אמן / קבוצה / תחרות, שם בעברית ובאנגלית), התאריכים, שהופעה עם לוקיישן נבנית כחבילה ומה התשובה המומלצת כשאין להופעה לוקיישן (הלוח שואל על כל הופעה כזו בכל מקרה), הספקים (תמיד TixStock ו-LiveTickets) ושני המארק אפים. מארק אפ שהבריף לא אמר ממולא מהריצה הקודמת ומסומן \"מהפעם הקודמת\". מתקנים כל שדה ישר בכרטיס; \"עוד מהבריף\" מפרט מה שהסוכן לא ידע לשבץ. מתחת לכרטיס: מה ה-AI שואל, התיבה \"כוון את ה-AI\", תבנית התיאור ומתג LiveTickets - ראו \"לכוון את התוכנית לפני הבנייה\" בהמשך."),
          t("Read the line under the card - \"נמצאו N הופעות · N קיימות · N שאלות\" and the cities. It is only a search of the suppliers' catalogs: nothing is built yet, and a show that already exists as an event is counted \"קיימות\" and left alone.", "קוראים את השורה מתחת לכרטיס - \"נמצאו N הופעות · N קיימות · N שאלות\" והערים. זו רק חיפוש בקטלוגים של הספקים: עוד לא נבנה כלום, והופעה שכבר קיימת כאירוע נספרת \"קיימות\" ונשארת כמו שהיא."),
          t("Click \"בנה את האירועים (N)\". The run's board opens with a card per show (\"ממתין לבנייה\") and each fills in as its show is built (a few seconds each). Keep the board open while it builds: \"עצור\" stops after the show in progress, \"המשך\" goes on, and a board you closed picks up where it stopped when you open the run again from the list under the brief.", "לוחצים \"בנה את האירועים (N)\". לוח הריצה נפתח עם כרטיס לכל הופעה (\"ממתין לבנייה\") וכל כרטיס מתמלא כשההופעה שלו נבנית (כמה שניות לכל אחת). משאירים את הלוח פתוח בזמן הבנייה: \"עצור\" עוצר אחרי ההופעה שבתהליך, \"המשך\" ממשיך, ולוח שסגרתם ממשיך מאיפה שעצר כשפותחים שוב את הריצה מהרשימה מתחת לבריף."),
          t("Go through the cards and approve them - see \"Approve, edit or reject\" below. Until then every event is hidden.", "עוברים על הכרטיסים ומאשרים - ראו \"לאשר, לערוך או לדחות\" למטה. עד אז כל האירועים מוסתרים."),
        ],
      },
      {
        title: t("Upload a team's home games", "להעלות משחקי בית של קבוצה"),
        steps: [
          t("In the brief box click the \"משחקי בית של קבוצה\" example, or write your own. The example: \"להעלות את כל משחקי הבית של ליברפול לעונה הקרובה. חבילה לכל יעד עם לוקיישן, אחרת לדלג. אדישנל מארק אפ 75 דולר.\"", "בתיבת הבריף לוחצים על הדוגמה \"משחקי בית של קבוצה\" או כותבים בריף משלכם. הדוגמה: \"להעלות את כל משחקי הבית של ליברפול לעונה הקרובה. חבילה לכל יעד עם לוקיישן, אחרת לדלג. אדישנל מארק אפ 75 דולר.\""),
          t("Click \"פענח\". For a team the plan card has the switch \"רק משחקי בית\" - ON unless the brief asked for all games or away games. Turn it off to take every fixture. A whole round of a competition works the same way: the subject kind is \"תחרות\" and \"סבב\" holds the round.", "לוחצים \"פענח\". לקבוצה יש בכרטיס התוכנית את המתג \"רק משחקי בית\" - דלוק, אלא אם הבריף ביקש את כל המשחקים או משחקי חוץ. מכבים אותו כדי לקחת כל משחק. סבב שלם בתחרות עובד אותו דבר: סוג הנושא \"תחרות\" ו\"סבב\" מחזיק את הסבב."),
          t("On the plan card, \"הופעה בלי לוקיישן\" has four choices: \"החלטה בזמן אמת\" (the default - nothing recommended, you decide show by show), \"בניית לוקיישן חדש\", \"כרטיס בלבד\" and \"לדלג\". A football brief usually says \"לדלג\" - that only marks \"skip\" as the recommended answer: the board asks about every such show and nothing is skipped or built ticket-only silently (see \"Answer a question from the AI\"). The games you skip show on the board as grey cards with the reason and \"צור ידנית\" (opens a new event form).", "בכרטיס התוכנית, ל-\"הופעה בלי לוקיישן\" ארבע אפשרויות: \"החלטה בזמן אמת\" (ברירת המחדל - בלי המלצה, מחליטים בכל הופעה), \"בניית לוקיישן חדש\", \"כרטיס בלבד\" ו-\"לדלג\". בריף כדורגל בדרך כלל אומר \"לדלג\" - זה רק מסמן את \"לדלג\" כתשובה המומלצת: הלוח שואל על כל הופעה כזו ושום דבר לא מדולג ולא נבנה כרטיס בלבד בשקט (ראו \"לענות לשאלה של ה-AI\"). המשחקים שדילגתם מופיעים בלוח ככרטיסים אפורים עם הסיבה ו-\"צור ידנית\" (פותח טופס אירוע חדש)."),
          t("A stadium more than 50 km from every location of ours is never built by itself: its card asks \"אין לנו מיקום ל-<עיר>. מה לעשות?\" (create a location, a two-city package, ticket only or skip - the steps below). When the nearest location is within 300 km, \"חבילה דרך <עיר> (N ק\"מ) עם פיצול מלון\" builds that show as a two-city package (fly to our nearest location, hotel split between the two cities); once you approve that event the system remembers the venue, so later runs do it on their own. A show you built ticket-only keeps \"בנה כחבילה דרך <עיר>\" on its card, so you can change your mind.", "אצטדיון שרחוק יותר מ-50 ק\"מ מכל לוקיישן שלנו אף פעם לא נבנה מעצמו: הכרטיס שלו שואל \"אין לנו מיקום ל-<עיר>. מה לעשות?\" (ליצור מיקום, חבילה דו-עירונית, כרטיס בלבד או לדלג - בשלבים למטה). כשהלוקיישן הקרוב נמצא עד 300 ק\"מ, \"חבילה דרך <עיר> (N ק\"מ) עם פיצול מלון\" בונה את ההופעה כחבילה דו-עירונית (טיסה ללוקיישן הקרוב שלנו, לינה מפוצלת בין שתי הערים); אחרי שאישרתם את האירוע המערכת זוכרת את האולם והריצות הבאות עושות זאת לבד. הופעה שבניתם ככרטיס בלבד שומרת על הכפתור \"בנה כחבילה דרך <עיר>\" בכרטיס שלה, כך שאפשר להתחרט."),
          t("A city's name beats wrong coordinates: when a supplier puts the venue far from its city (TixStock gave Velodrome Berlin the middle of Germany) but we have a location with that city's name or one of its \"שמות נוספים\", the show is built as a package from that location and its card warns \"הקואורדינטות של האולם רחוקות N ק\"מ מ<עיר> - נבנה לפי שם העיר\".", "שם העיר גובר על קואורדינטות שגויות: כשספק שם את האולם רחוק מהעיר שלו (TixStock נתן ל-Velodrome Berlin את אמצע גרמניה) אבל יש לנו מיקום בשם העיר או באחד מה\"שמות נוספים\" שלו, ההופעה נבנית כחבילה מהמיקום הזה והכרטיס שלה מזהיר \"הקואורדינטות של האולם רחוקות N ק\"מ מ<עיר> - נבנה לפי שם העיר\"."),
          t("Build and review exactly as for an artist's tour (steps 4-5 above).", "בונים ובודקים בדיוק כמו בטור של אמן (שלבים 4-5 למעלה)."),
        ],
      },
      {
        title: t("Steer the plan before you build", "לכוון את התוכנית לפני הבנייה"),
        steps: [
          t("Under the plan card, \"ה-AI שואל:\" lists what the agent could not map from the brief (up to five questions - they are not part of the plan). Answer them, or change anything else, in the box \"כוון את ה-AI\" under it - for example \"בלי ברלין, ומארק אפ של 50 על חבילות\" - and press \"שלח\".", "מתחת לכרטיס התוכנית, \"ה-AI שואל:\" מפרט מה שהסוכן לא ידע למפות מהבריף (עד חמש שאלות - הן לא חלק מהתוכנית). עונים עליהן, או משנים כל דבר אחר, בתיבה \"כוון את ה-AI\" שמתחתיהן - למשל \"בלי ברלין, ומארק אפ של 50 על חבילות\" - ולוחצים \"שלח\"."),
          t("The agent reads the brief again with the plan as it stands on the card and your instruction, and answers with a whole updated plan that opens as a fresh card. A card you already edited asks first (\"לכוון את ה-AI?\") because the steer replaces your edits; the test-run switch and the description templates you wrote travel along. A steer counts against the same allowance as the brief (10 calls per person per 10 minutes), and what you asked for is read back on later runs. With the agent off there is no steering box - fill the card by hand.", "הסוכן קורא שוב את הבריף עם התוכנית כפי שהיא על הכרטיס ואת ההוראה שלכם, ועונה בתוכנית מעודכנת שלמה שנפתחת ככרטיס חדש. כרטיס שכבר ערכתם שואל קודם (\"לכוון את ה-AI?\") כי הכיוון מחליף את העריכות שלכם; מתג ריצת הבדיקה ותבניות התיאור שכתבתם עוברים איתו. כיוון נספר באותה מכסה של הבריף (10 קריאות לאדם ב-10 דקות), וההוראה נקראת בריצות הבאות. כשהסוכן כבוי אין תיבת כיוון - ממלאים את הכרטיס ביד."),
          t("The switch \"כולל קטגוריות LiveTickets ללא אישור מיידי\" is ON: LiveTickets categories that are not instant-confirm are brought and marked on the site, which warns the customer; the board says \"N קטגוריות LiveTickets ללא אישור מיידי (יסומנו באתר)\". Turn it off for a run that must sell instant-confirm only (the brief may also say so). A category blocked for any other reason is still dropped.", "המתג \"כולל קטגוריות LiveTickets ללא אישור מיידי\" דלוק: קטגוריות LiveTickets שאינן באישור מיידי מובאות ומסומנות באתר, שמזהיר את הלקוח; הלוח אומר \"N קטגוריות LiveTickets ללא אישור מיידי (יסומנו באתר)\". מכבים אותו בריצה שחייבת למכור רק באישור מיידי (גם הבריף יכול לומר זאת). קטגוריה שנחסמה מכל סיבה אחרת עדיין נפסלת."),
          t("\"תבנית תיאור\" sits under the plan too, with the places as chips and a sample: the text each event prints under its name. It is the standing template of the subject's family (football or artists), saved with the run when you changed it - more in \"Write the description template once\" below.", "גם \"תבנית תיאור\" נמצאת מתחת לתוכנית, עם המקומות כתגיות ועם דוגמה: הטקסט שכל אירוע מדפיס מתחת לשמו. זו התבנית הקבועה של משפחת הנושא (כדורגל או אמנים), והיא נשמרת עם הריצה כששיניתם אותה - עוד ב\"לכתוב פעם אחת את תבנית התיאור\" בהמשך."),
        ],
      },
      {
        title: t("Answer a question from the AI", "לענות לשאלה של ה-AI"),
        steps: [
          t("When the builder cannot decide a show alone - two shows in one city on one day, a date that differs by a day between the suppliers, a venue with no coordinates (\"לאיזה מיקום לטוס?\"), a show with no location of ours, the two suppliers' rows that may be one show (\"זו אותה הופעה?\") - that card stops as a question and the rest of the run goes on.", "כשהבונה לא מצליח להכריע הופעה לבד - שתי הופעות באותה עיר ביום אחד, תאריך שמשתנה ביום בין הספקים, אולם בלי קואורדינטות (\"לאיזה מיקום לטוס?\"), הופעה בלי מיקום שלנו, שורות של שני הספקים שאולי הן הופעה אחת (\"זו אותה הופעה?\") - הכרטיס הזה עוצר כשאלה ושאר הריצה ממשיכה."),
          t("You hear about it three ways: an amber bar at the top of the board (\"ה-AI מחכה לך: ...\"), a task in [Tasks](/tasks) assigned to whoever started the run (the usual assignment mail goes out too), and a toast \"🟠 ה-AI מחכה לתשובה\" on any dashboard screen, within about a minute, with \"פתח את הלוח\". Closing the toast keeps it quiet until a new question arrives - or until the page is reloaded, which brings it back for any question still open.", "מקבלים על זה הודעה בשלוש דרכים: פס ענבר בראש הלוח (\"ה-AI מחכה לך: ...\"), משימה ב[משימות](/tasks) על מי שהתחיל את הריצה (גם מייל השיוך הרגיל יוצא), והודעה \"🟠 ה-AI מחכה לתשובה\" בכל מסך בדשבורד, תוך כדקה, עם \"פתח את הלוח\". סגירת ההודעה משתיקה אותה עד שמגיעה שאלה חדשה - או עד טעינה מחדש של הדף, שמחזירה אותה לכל שאלה שעדיין פתוחה."),
          t("On the question card pick one of the options - or type a free answer where the box is offered - and click \"ענה\". The task closes by itself and the show goes back to building with your answer.", "בכרטיס השאלה בוחרים אחת מהאפשרויות - או כותבים תשובה חופשית במקום שהתיבה מוצעת - ולוחצים \"ענה\". המשימה נסגרת לבד וההופעה חוזרת להיבנות עם התשובה שלכם."),
          t("\"דלג על ההופעה\" is an answer too: the show is skipped and its card turns grey. An answer is remembered - the same question about the same show in a later run is answered from memory (\"לפי תשובה קודמת\") and not asked again.", "\"דלג על ההופעה\" היא גם תשובה: ההופעה מדולגת והכרטיס שלה נהיה אפור. תשובה נזכרת - אותה שאלה על אותה הופעה בריצה מאוחרת יותר נענית מהזיכרון (\"לפי תשובה קודמת\") ולא נשאלת שוב."),
          t("Several cards asking the same thing (two LiveTickets rows for one fixture, a hall that offers the same flight cities)? Once your pick can be a rule for the run, a box \"החל גם על N השאלות הדומות בריצה\" appears under the options. Tick it before \"ענה\" and every other open question it fits is answered the same way (the toast says \"נענו N שאלות\", and their tasks close too). What counts as similar: a show question takes \"שתיהן - שני אירועים\" / \"כולן - N אירועים\" or \"דלג על ההופעה\" (picking one supplier's listing names one show, so it is no rule); a date question takes \"תאריך TixStock ...\" / \"תאריך LiveTickets ...\" (each other show gets its own day of that supplier), \"שתי הופעות\" or \"דלג על ההופעה\"; a location question reaches only shows at the same venue in the same city; a same-show question takes \"כן, אותה הופעה\" / \"לא, שתי הופעות\" / \"דלג\"; a no-location question: \"כרטיס בלבד\" and \"דלג\" reach every open one, while \"חבילה דרך ...\" and a location you created reach only the shows of the same city. The rule is for this run only - a later run still gets exact repeats from memory.", "כמה כרטיסים שואלים אותו דבר (שתי שורות של LiveTickets לאותו משחק, אולם שמציע את אותן ערי טיסה)? ברגע שהבחירה שלכם יכולה להיות כלל לריצה, מתחת לאפשרויות מופיעה תיבה \"החל גם על N השאלות הדומות בריצה\". מסמנים אותה לפני \"ענה\" וכל שאלה פתוחה אחרת שהכלל מתאים לה נענית באותו אופן (ההודעה אומרת \"נענו N שאלות\", והמשימות שלהן נסגרות גם הן). מה נחשב דומה: שאלת הופעה לוקחת \"שתיהן - שני אירועים\" / \"כולן - N אירועים\" או \"דלג על ההופעה\" (בחירה בשורה אחת של ספק היא הופעה אחת, ולכן לא כלל); שאלת תאריך לוקחת \"תאריך TixStock ...\" / \"תאריך LiveTickets ...\" (כל הופעה אחרת מקבלת את היום שלה אצל אותו ספק), \"שתי הופעות\" או \"דלג על ההופעה\"; שאלת מיקום מגיעה רק להופעות באותו אולם ובאותה עיר; שאלת אותה-הופעה לוקחת \"כן, אותה הופעה\" / \"לא, שתי הופעות\" / \"דלג\"; שאלת הופעה בלי מיקום: \"כרטיס בלבד\" ו\"דלג\" מגיעות לכל השאלות הפתוחות, ואילו \"חבילה דרך ...\" ומיקום שיצרתם מגיעים רק להופעות באותה עיר. הכלל חל על הריצה הזו בלבד - ריצה מאוחרת יותר עדיין מקבלת חזרות מדויקות מהזיכרון."),
          t("\"זו אותה הופעה?\": TixStock and LiveTickets sell a show of the subject on the same day under two city spellings the system cannot join (\"TixStock מוכר הופעה ב-Lisboa ו-LiveTickets ב-Lisbon באותו יום (06.04.2027)\"). \"כן, אותה הופעה\" builds ONE show with both suppliers' tickets and remembers the two spellings as one city, so the next run joins them without asking; \"לא, שתי הופעות\" splits them into two shows; \"דלג\" skips. Before it asks, the system already joins cities through the \"שמות נוספים\" of every [Location](/locations) (Rome / Roma, Munich / München, Vienna / Wien - add a spelling there and it holds for every run), a broken letter in a supplier's city name, and clubs written two ways (\"SS Lazio\" / \"Lazio\", \"Cagliari Calcio\" / \"Cagliari\").", "\"זו אותה הופעה?\": TixStock ו-LiveTickets מוכרים הופעה של הנושא באותו יום תחת שני כתיבים של העיר שהמערכת לא מצליחה לחבר (\"TixStock מוכר הופעה ב-Lisboa ו-LiveTickets ב-Lisbon באותו יום (06.04.2027)\"). \"כן, אותה הופעה\" בונה הופעה אחת עם הכרטיסים של שני הספקים וזוכר ששני הכתיבים הם עיר אחת, כך שהריצה הבאה מחברת אותם בלי לשאול; \"לא, שתי הופעות\" מפצל לשתי הופעות; \"דלג\" מדלג. לפני ששואלת, המערכת כבר מחברת ערים דרך \"שמות נוספים\" של כל [מיקום](/locations) (Rome / Roma, Munich / München, Vienna / Wien - מוסיפים שם כתיב והוא תקף לכל ריצה), אות שבורה בשם העיר אצל ספק, ומועדונים שכתובים בשתי דרכים (\"SS Lazio\" / \"Lazio\", \"Cagliari Calcio\" / \"Cagliari\")."),
          t("\"אין לנו מיקום ל-<עיר> (<אולם>). מה לעשות?\": a show with no location of ours within 50 km is never built or skipped by itself. The options: \"צור מיקום ל-<עיר>\", \"חבילה דרך <עיר> (N ק\"מ) עם פיצול מלון\" (only when a location of ours is within 300 km), \"כרטיס בלבד\" and \"דלג\" - the brief's rule is marked \"(לפי הבריף)\" and listed first of the last two. A show with no coordinates at all (\"לאיזה מיקום לטוס?\") gets \"צור מיקום חדש\" too.", "\"אין לנו מיקום ל-<עיר> (<אולם>). מה לעשות?\": הופעה בלי מיקום שלנו בטווח 50 ק\"מ אף פעם לא נבנית ולא מדולגת מעצמה. האפשרויות: \"צור מיקום ל-<עיר>\", \"חבילה דרך <עיר> (N ק\"מ) עם פיצול מלון\" (רק כשיש מיקום שלנו עד 300 ק\"מ), \"כרטיס בלבד\" ו\"דלג\" - הכלל של הבריף מסומן \"(לפי הבריף)\" ועומד ראשון מבין השניים האחרונים. גם להופעה בלי קואורדינטות בכלל (\"לאיזה מיקום לטוס?\") יש \"צור מיקום חדש\"."),
          t("\"צור מיקום ל-<עיר>\" opens the form \"יצירת מיקום ל-<עיר>\": the AI fills the Hebrew name in the table's convention (\"ולנסיה, ספרד\"), the airport code (IATA, 3 letters), the city-centre coordinates, the country code and the other spellings suppliers print - you check them and press \"צור מיקום ובנה\". The row is added to [Locations](/locations), the show builds as a package, and every other open no-location question of the same city in the run is answered with it too (\"נוצר מיקום ... · N הופעות ייבנו כחבילה\"). The form refuses a name with no Hebrew letters, an IATA that is not 3 capital letters and coordinates out of range. A city we already have with an airport code is not created twice - its location is used (\"המיקום כבר קיים (#N) - ההופעות ייבנו דרכו\"); a city we have WITHOUT one (Manchester, Liverpool - flown via London on purpose) is refused: pick \"חבילה דרך…\" or add the code on [Locations](/locations). Coordinates more than 300 km from the venue are flagged (\"המיקום רחוק N ק\"מ מהאולם\") - check them, and a second click confirms. With the AI off, or after too many calls, the same form opens with what the show knows: the venue's coordinates, its country code and the city as the supplier spells it. The locations you create are read back by the next proposal.", "\"צור מיקום ל-<עיר>\" פותח את הטופס \"יצירת מיקום ל-<עיר>\": ה-AI ממלא את השם בעברית לפי המוסכמה של הטבלה (\"ולנסיה, ספרד\"), את קוד שדה התעופה (IATA, 3 אותיות), את הקואורדינטות של מרכז העיר, את קוד המדינה ואת הכתיבים האחרים שהספקים מדפיסים - בודקים ולוחצים \"צור מיקום ובנה\". השורה נוספת ל[מיקומים](/locations), ההופעה נבנית כחבילה, וכל שאלת הופעה-בלי-מיקום פתוחה אחרת של אותה עיר בריצה נענית איתו גם היא (\"נוצר מיקום ... · N הופעות ייבנו כחבילה\"). הטופס לא מקבל שם בלי אותיות עבריות, IATA שאינו 3 אותיות גדולות וקואורדינטות מחוץ לטווח. עיר שכבר יש לנו בה מיקום עם קוד שדה תעופה לא נוצרת פעמיים - המיקום הקיים משמש (\"המיקום כבר קיים (#N) - ההופעות ייבנו דרכו\"); עיר שיש לנו בלי קוד (מנצ'סטר, ליברפול - טסים דרך לונדון בכוונה) נדחית: בוחרים \"חבילה דרך…\" או מוסיפים את הקוד ב[מיקומים](/locations). קואורדינטות רחוקות יותר מ-300 ק\"מ מהאולם מסומנות (\"המיקום רחוק N ק\"מ מהאולם\") - בודקים, ולחיצה נוספת מאשרת. כשה-AI כבוי, או אחרי יותר מדי קריאות, אותו טופס נפתח עם מה שההופעה יודעת: הקואורדינטות של האולם, קוד המדינה והעיר כפי שהספק כותב אותה. המיקומים שיצרתם נקראים בהצעה הבאה."),
        ],
      },
      {
        title: t("Handle what the whole run needs: the run panel and the hall's tickets", "לטפל במה שכל הריצה צריכה: פאנל הריצה והכרטיסים של האולם"),
        steps: [
          t("Open the run's board. When the shows share things only a person can settle - a hall with no zone template, categories still to check, Hebrew names missing, a team page that does not exist - a card \"לטיפול ברמת הריצה\" appears between the header and the filter pills: one row per topic, with the number of shows it touches and ONE button. It counts built shows only (\"מוכן\" / \"באתר\"). The cards stop repeating those warnings: each folds them into one grey line, \"N הערות ברמת הריצה - בפאנל למעלה\" (click it to jump to the panel). A warning that belongs to one show - a LiveTickets-only hall, a supplier that did not answer, a far venue, a blocker - stays on its card. A row goes away when no show carries its warning any more, and the panel with its last row; \"קפל\" / \"הצג\" folds it meanwhile.", "פותחים את לוח הריצה. כשההופעות חולקות דברים שרק אדם יכול להכריע - אולם בלי תבנית אזורים, קטגוריות שעוד צריך לבדוק, שמות בעברית שחסרים, עמוד קבוצה שלא קיים - מופיע בין הכותרת לפילטרים כרטיס \"לטיפול ברמת הריצה\": שורה לכל נושא, עם מספר ההופעות שהוא נוגע בהן וכפתור אחד. הוא סופר רק הופעות שנבנו (\"מוכן\" / \"באתר\"). הכרטיסים מפסיקים לחזור על האזהרות האלה: כל אחד מקפל אותן לשורה אפורה אחת, \"N הערות ברמת הריצה - בפאנל למעלה\" (לחיצה עליה קופצת אל הפאנל). אזהרה ששייכת להופעה אחת - אולם של LiveTickets בלבד, ספק שלא ענה, אולם רחוק, חוסם - נשארת על הכרטיס שלה. שורה נעלמת כשאף הופעה לא נושאת את האזהרה שלה, והפאנל נעלם עם השורה האחרונה; \"קפל\" / \"הצג\" מקפלים אותו בינתיים."),
          t("The rows, in this order: the hall (\"אולם חדש: <hall> · N הופעות · הכרטיסים עלו באנגלית ובלי זונים\", or \"אולם: <hall> · N קטגוריות לבדיקה\") with \"סווג כרטיסים\"; the Hebrew names (\"שמות בעברית חסרים: ...\") and the missing team / artist page (\"אין עמוד קבוצה באתר\") with \"תן שמות בעברית\"; a missing crest / biography row (an artist: cut-out, event gallery) with \"פתח ב-Templates\" (a new tab on the fix) - these appear only once the team or artist page exists and lacks them; and an information line, with no button, when the team or artist has no /c/ twin category. The page row and every fix row also carry \"פתח משימה\": the shared task dialog opens already WRITTEN (\"לבנות עמוד קבוצה: <name>\" / \"לבנות עמוד אמן: <name>\" / \"<the fix>: <name>\", with what to do, how many shows of the run wait for it, the page and the run) on the marketing board, assigned to whoever got the last such task (pick Liz once and it stays). Once it is saved the row leaves the panel and the cards - the work is the marketing board's now - and it does not come back in a later run of the same page while the task is open or done (a cancelled task brings it back). Under the hall rows one line says how to arrange a hall by hand (see \"Teach the whole hall from one event you fixed by hand\"). Start with the hall.", "השורות, בסדר הזה: האולם (\"אולם חדש: <אולם> · N הופעות · הכרטיסים עלו באנגלית ובלי זונים\", או \"אולם: <אולם> · N קטגוריות לבדיקה\") עם \"סווג כרטיסים\"; השמות בעברית (\"שמות בעברית חסרים: ...\") ועמוד הקבוצה / האמן החסר (\"אין עמוד קבוצה באתר\") עם \"תן שמות בעברית\"; שורת סמל / ביוגרפיה חסרים (לאמן: גזרה, גלריית אירועים) עם \"פתח ב-Templates\" (לשונית חדשה על התיקון) - הן מופיעות רק אחרי שעמוד הקבוצה או האמן קיים וחסר בו משהו; ושורת מידע, בלי כפתור, כשלקבוצה או לאמן אין קטגוריית /c/ תאומה. שורת העמוד וכל שורת תיקון נושאות גם \"פתח משימה\": דיאלוג המשימות המשותף נפתח כשהמשימה כבר כתובה (\"לבנות עמוד קבוצה: <שם>\" / \"לבנות עמוד אמן: <שם>\" / \"<התיקון>: <שם>\", עם מה לעשות, כמה הופעות בריצה מחכות לזה, העמוד והריצה) בלוח השיווק, ומשויכת למי שקיבל את המשימה הקודמת מהסוג הזה (בוחרים את ליז פעם אחת וזה נשאר). אחרי השמירה השורה יוצאת מהפאנל ומהכרטיסים - העבודה עברה ללוח השיווק - ולא חוזרת גם בריצה אחרת של אותו עמוד כל עוד המשימה פתוחה או בוצעה (משימה שבוטלה מחזירה אותה). מתחת לשורות האולם שורה אחת אומרת איך מסדרים אולם ביד (ראו \"ללמד את כל האולם מאירוע אחד שסידרתם ביד\"). מתחילים באולם."),
          t("\"סווג כרטיסים\" opens the hall's dialog. On top, \"שם האולם בעברית\" - the Hebrew name of the hall that {אולם} prints in the event description (empty: the supplier's English venue name); then the hall's map (below) and a table with a row per category of its seat-map drawing and of the tickets the run bought - the category as TixStock names it, an editable Hebrew zone name (the card title the customer sees), a \"לפסול\" switch and a status. The AI proposes the hall's name and the zone names (\"ה-AI מציע…\", a few seconds). There is no description column: a description already stored for a zone in the hall's template stays as it is. A code rule switches \"לפסול\" on for away / visiting supporters' sections (\"Away Fans Section\" is a category we must never sell), the AI may propose another drop (the row reads \"נפסל (הצעת ה-AI)\"; for an away section \"נפסל: יציע אוהדי חוץ (הצעת ה-AI)\"), and you can flip any drop either way. Nothing here touches a price.", "\"סווג כרטיסים\" פותח את הדיאלוג של האולם. למעלה \"שם האולם בעברית\" - השם בעברית של האולם ש-{אולם} מדפיס בתיאור האירוע (ריק: שם האולם באנגלית כפי שהספק כותב אותו); אחריו מפת האולם (בהמשך) וטבלה עם שורה לכל קטגוריה של שרטוט מפת המושבים ושל הכרטיסים שהריצה קנתה - הקטגוריה כפי ש-TixStock קורא לה, שם הזון בעברית שאפשר לערוך (כותרת הכרטיס שהלקוח רואה), מתג \"לפסול\" וסטטוס. ה-AI מציע את שם האולם ואת שמות הזונים (\"ה-AI מציע…\", כמה שניות). אין עמודת תיאור: תיאור ששמור כבר לזון בתבנית האולם נשאר כמו שהוא. כלל בקוד מדליק \"לפסול\" ביציעי אוהדי חוץ (\"Away Fans Section\" היא קטגוריה שאסור לנו למכור), ה-AI יכול להציע פסילה נוספת (השורה נקראת \"נפסל (הצעת ה-AI)\"; ביציע חוץ \"נפסל: יציע אוהדי חוץ (הצעת ה-AI)\"), ואפשר להפוך כל פסילה לשני הכיוונים. שום דבר כאן לא נוגע במחיר."),
          t("A category the AI is unsure about (a hospitality box, a code) opens as \"לבדיקה - ה-AI לא בטוח (יישאר בלי זון)\": its ticket stays with no zone, it is left OUT of the hall's template, the show's card keeps a \"לבדיקה: <categories>\" line and the hall stays on the panel until every category is placed. Type a name in the row to place it, or empty both boxes of any row to mark it \"לבדיקה\" yourself. Nothing is dropped silently, and an unsure category never blocks an approval.", "קטגוריה שה-AI לא בטוח לגביה (תא אירוח, קוד) נפתחת כ-\"לבדיקה - ה-AI לא בטוח (יישאר בלי זון)\": הכרטיס שלה נשאר בלי זון, היא נשארת מחוץ לתבנית האולם, על כרטיס ההופעה נשארת שורה \"לבדיקה: <קטגוריות>\" והאולם נשאר בפאנל עד שכל קטגוריה מוצבת. כותבים שם בשורה כדי להציב אותה, או מרוקנים את שתי התיבות של כל שורה כדי לסמן אותה \"לבדיקה\" בעצמכם. שום דבר לא נפסל בשקט, וקטגוריה לא בטוחה אף פעם לא חוסמת אישור."),
          t("The hall's map (\"מפת האולם\") sits beside the table. Hover a row and its category lights up on the drawing; click a section to EXCLUDE it - it will not be sold at any show of the hall (the same exclusion as the editor's map on the Suppliers & zones board), and the line under the map counts them (\"N גושים מוחרגים - לא יימכרו בכל ההופעות באולם\"). Click again to bring a section back. The excluded sections are saved with the hall's template and written to every ready and approved show of the hall; a section you excluded by hand on one show alone stays; a later run at this hall starts with them. Prices follow at the next TixStock price sync (\"המחירים יתעדכנו בסנכרון הבא\").", "מפת האולם (\"מפת האולם\") נמצאת ליד הטבלה. מרחפים על שורה והקטגוריה שלה נדלקת בשרטוט; לוחצים על גוש כדי להחריג אותו - הוא לא יימכר בשום הופעה של האולם (אותה החרגה כמו המפה של העורך בלוח Suppliers & zones), והשורה מתחת למפה סופרת אותם (\"N גושים מוחרגים - לא יימכרו בכל ההופעות באולם\"). לחיצה נוספת מחזירה גוש. הגושים המוחרגים נשמרים עם תבנית האולם ונכתבים בכל הופעה מוכנה ומאושרת של האולם; גוש שהחרגתם ביד בהופעה אחת בלבד נשאר; ריצה מאוחרת באולם הזה מתחילה איתם. המחירים מתעדכנים בסנכרון המחירים הבא של TixStock (\"המחירים יתעדכנו בסנכרון הבא\")."),
          t("\"אשר - יחול על N ההופעות ויישמר כתבנית האולם\" needs at least one row named or dropped. It rewrites every show of the hall in this run (tickets get their zone and Hebrew name; dropped categories come off; the excluded map sections are written to the event; the event's description is rewritten with the hall's Hebrew name wherever it is still the uploader's own; a show whose tickets would ALL be dropped is left as it is with \"כל הקטגוריות נפסלו - בדקו ידנית\") and saves the hall's template - drawing, zones, the dropped categories, the excluded map sections and the hall's Hebrew name - so every later run at this hall comes out classified and described by itself, and a show whose template drops every ticket is skipped as \"אין כרטיסים למכירה\". The toast reads \"N אירועים עודכנו · N זונים · N נפסלו · N לבדיקה\". If the page ran out of time before the last shows, a notice says how many were not updated and the dialog closes: open \"סווג כרטיסים\" again and confirm to finish them.", "\"אשר - יחול על N ההופעות ויישמר כתבנית האולם\" דורש לפחות שורה אחת ששמה או נפסלה. הוא כותב מחדש כל הופעה של האולם בריצה (הכרטיסים מקבלים זון ושם בעברית; קטגוריות שנפסלו יורדות; הגושים המוחרגים נכתבים באירוע; תיאור האירוע נכתב מחדש עם שם האולם בעברית בכל מקום שהוא עדיין של המעלה עצמו; הופעה שכל הכרטיסים שלה היו נפסלים נשארת כמו שהיא עם \"כל הקטגוריות נפסלו - בדקו ידנית\") ושומר את תבנית האולם - השרטוט, הזונים, הקטגוריות שנפסלו, הגושים המוחרגים והשם של האולם בעברית - כך שכל ריצה מאוחרת באולם הזה יוצאת מסווגת ומתוארת בעצמה, והופעה שהתבנית פוסלת את כל הכרטיסים שלה מדולגת כ-\"אין כרטיסים למכירה\". ההודעה אומרת \"N אירועים עודכנו · N זונים · N נפסלו · N לבדיקה\". אם נגמר הזמן לפני ההופעות האחרונות, הודעה אומרת כמה הופעות לא הספיקו להתעדכן והדיאלוג נסגר: פותחים שוב את \"סווג כרטיסים\" ומאשרים כדי לסיים אותן."),
          t("When the AI is off or did not answer, the same table opens with the Hebrew boxes empty and the line \"ה-AI כבוי / לא ענה - מלאו את השמות ידנית\"; when you opened the dialogs too often (the AI dialogs - classification, names and the create-location form - share the brief's allowance of 10 calls per person per 10 minutes) the line is \"יותר מדי קריאות ל-AI בזמן קצר - מלאו את השמות ידנית\". Either way the code-rule drops are still applied and you fill the names yourself. LiveTickets categories are not in this table: their Hebrew comes from LiveTickets, and their zones are set on the editor's Suppliers & zones board.", "כשה-AI כבוי או לא ענה, אותה טבלה נפתחת עם תיבות עבריות ריקות והשורה \"ה-AI כבוי / לא ענה - מלאו את השמות ידנית\"; אם פתחתם את הדיאלוגים יותר מדי פעמים (הדיאלוגים עם ה-AI - סיווג, שמות וטופס יצירת המיקום - חולקים את המכסה של הבריף: 10 קריאות לאדם ב-10 דקות) השורה היא \"יותר מדי קריאות ל-AI בזמן קצר - מלאו את השמות ידנית\". בשני המקרים פסילות הכלל בקוד עדיין מוחלות ואתם ממלאים את השמות. קטגוריות LiveTickets לא בטבלה הזו: העברית שלהן באה מ-LiveTickets, והזונים שלהן נקבעים בלוח Suppliers & zones של העורך."),
        ],
      },
      {
        title: t("Teach the whole hall from one event you fixed by hand", "ללמד את כל האולם מאירוע אחד שסידרתם ביד"),
        steps: [
          t("Prefer the editor? Open one of the hall's events with \"ערוך\" and arrange it there: on the Suppliers & zones board adopt the drawing and name the zones (each zone has a \"תיאור ללקוח\" box - the Hebrew line under the card title), write Hebrew descriptions on the tickets, delete a category you never want to sell. Save.", "מעדיפים את העורך? פותחים אחד מאירועי האולם עם \"ערוך\" ומסדרים אותו שם: בלוח Suppliers & zones מאמצים את השרטוט ונותנים שמות לזונים (לכל זון תיבת \"תיאור ללקוח\" - השורה בעברית מתחת לכותרת הכרטיס), כותבים תיאורים בעברית על הכרטיסים, מוחקים קטגוריה שלא רוצים למכור אף פעם. שומרים."),
          t("Back on the board: every card (ready or already approved) whose run has other built shows shows the two steps from the start - \"1. סדרו את האירוע בעורך\" (opens the editor in a new tab) and a greyed \"2. למדו והחילו על N ההופעות\" with the line \"אחרי השמירה בעורך הכפתור נפתח\". Once the event was really changed by hand and saved, step 1 reads \"✓ האירוע סודר בעורך\" and step 2 lights up - also after the hall was classified with \"סווג כרטיסים\" (say, to spread a description you then typed on one event). The hall's row in the panel offers \"החל על שאר ההופעות\" (several events fixed by hand: the newest is offered and the others are listed under it as \"נערכו בעורך גם\"), and under the hall rows and in the classification dialog's footer one line says the same: \"רוצים לסדר ידנית? סדרו אירוע אחד בעורך, חזרו ולחצו \"למדו והחילו\" בכרטיס שלו\". The dialog \"ללמוד מהאירוע הזה?\" lists what changed since the event's last learn, one kind per box (ticked by default): the HALL - zones (and how many are new), categories dropped, descriptions, the excluded map sections (\"N גושים מוחרגים\") and how many shows of the hall it applies to; and the LIVETICKETS TICKET DESCRIPTIONS you cleared or typed - a description cleared (or every LiveTickets description cleared, as on Lazio) is cleared on every other show of the run, a description typed reaches the shows at the same hall only, and a ticket someone typed a description for by hand is never touched (TixStock descriptions go with the hall template). Untick a kind to leave it for later; a part that ran out of time stays pending too - press \"החל\" again to finish it. An optional \"הערה ל-AI\" is saved as a standing rule of the uploader's AI (read on every later run - the brief, the classification, the names, the location); it changes no event by itself. No AI is called, and the event you fixed is not rewritten. Edit the same event again later and step 1 lights up again - each new edit can be learned. The event's own description is not in the list: change it for every show through \"תבנית תיאור\".", "בחזרה בלוח: כל כרטיס (מוכן או כבר מאושר) שיש בריצה שלו הופעות בנויות נוספות מציג את שני השלבים מההתחלה - \"1. סדרו את האירוע בעורך\" (פותח את העורך בלשונית חדשה) ו\"2. למדו והחילו על N ההופעות\" מכובה, עם השורה \"אחרי השמירה בעורך הכפתור נפתח\". ברגע שהאירוע באמת שונה ביד ונשמר, שלב 1 נקרא \"✓ האירוע סודר בעורך\" ושלב 2 נדלק - גם אחרי שהאולם סווג ב-\"סווג כרטיסים\" (למשל כדי להפיץ תיאור שכתבתם אחר כך על אירוע אחד). שורת האולם בפאנל מציעה \"החל על שאר ההופעות\" (כמה אירועים סודרו ביד: מוצע האחרון והאחרים רשומים מתחתיו כ-\"נערכו בעורך גם\"), ומתחת לשורות האולם ובתחתית דיאלוג הסיווג שורה אחת אומרת אותו דבר: \"רוצים לסדר ידנית? סדרו אירוע אחד בעורך, חזרו ולחצו \"למדו והחילו\" בכרטיס שלו\". הדיאלוג \"ללמוד מהאירוע הזה?\" מפרט מה השתנה מאז הלמידה האחרונה של האירוע, סוג בכל תיבה (מסומנת מראש): האולם - זונים (וכמה חדשים), קטגוריות שנפסלו, תיאורים, הגושים המוחרגים (\"N גושים מוחרגים\") ועל כמה הופעות באולם זה יחול; ותיאורי כרטיסי LiveTickets שמחקתם או כתבתם - תיאור שנמחק (או כל תיאורי LiveTickets שנמחקו, כמו בלאציו) נמחק בכל שאר ההופעות בריצה, תיאור שנכתב מגיע רק להופעות באותו אולם, וכרטיס שמישהו כתב לו תיאור ביד לא נוגעים בו (תיאורי TixStock הולכים עם תבנית האולם). מורידים סימון כדי להשאיר סוג לאחר כך; חלק שלא הספיק להסתיים נשאר ממתין גם הוא - לוחצים שוב \"החל\" כדי לסיים. \"הערה ל-AI\" (לא חובה) נשמרת כחוק קבוע של ה-AI של המעלה (נקראת בכל ריצה הבאה - הבריף, הסיווג, השמות, המיקום); היא לא משנה אירועים בעצמה. אין קריאה ל-AI, והאירוע שסידרתם לא נכתב מחדש. עורכים את אותו אירוע שוב אחר כך - שלב 1 נדלק שוב, וכל עריכה חדשה אפשר ללמוד. תיאור האירוע עצמו לא ברשימה: משנים אותו לכל ההופעות דרך \"תבנית תיאור\"."),
          t("\"החל\" updates the hall's template from the event as it is now (what you did not touch in the template stays) and rewrites every other show of the hall in the run exactly like a classification confirm. A category counts as dropped only if the event once had it and you removed it - one it never had does not. Later runs at this hall use the template.", "\"החל\" מעדכן את תבנית האולם מהאירוע כפי שהוא עכשיו (מה שלא נגעתם בו בתבנית נשאר) וכותב מחדש כל הופעה אחרת של האולם בריצה בדיוק כמו אישור סיווג. קטגוריה נחשבת פסולה רק אם האירוע היה לו אותה פעם ומחקתם אותה - קטגוריה שמעולם לא הייתה לו לא נחשבת. ריצות מאוחרות באולם הזה משתמשות בתבנית."),
        ],
      },
      {
        title: t("Give the teams Hebrew names", "לתת לקבוצות שמות בעברית"),
        steps: [
          t("How a show gets its Hebrew name: both teams exist in Templates → \"<home> - <away>\"; otherwise the Hebrew name LiveTickets gives the same show (a name with no Hebrew letters does not count); otherwise it is built with the English name and the run raises ONE task for the whole run in [Tasks](/tasks), for whoever started it - \"שמות בעברית חסרים: N קבוצות - <subject>\" - never a question per show. The names dialog closes that task (the Tasks board will not let you close it by hand).", "איך הופעה מקבלת שם בעברית: שתי הקבוצות קיימות ב-Templates ← \"<בית> - <חוץ>\"; אחרת השם בעברית ש-LiveTickets נותן לאותה הופעה (שם בלי אותיות עבריות לא נחשב); אחרת היא נבנית עם השם באנגלית והריצה פותחת משימה אחת לכל הריצה ב[משימות](/tasks), למי שהתחיל אותה - \"שמות בעברית חסרים: N קבוצות - <נושא>\" - אף פעם לא שאלה לכל הופעה. דיאלוג השמות סוגר את המשימה הזו (לוח המשימות לא נותן לסגור אותה ביד)."),
          t("\"תן שמות בעברית\" (on the names row or on the missing-page row) lists every side we have no Hebrew for - the subject first when it has no page: the supplier's name, an English page name (\"Newcastle United\" for \"Newcastle United FC\") and a Hebrew name, all editable, proposed by the AI. A team already in Templates reads \"קיימת כבר - ישתמש בה\"; two spellings of one club (\"Cagliari Calcio\" and \"Cagliari\") are one row, never two teams. Empty a row's Hebrew box to skip it (that fixture keeps its English name). On an artist run the one row is the artist. When some shows take their name from LiveTickets the dialog says \"N אירועים יקבלו את השם בעברית מלייב טיקטס\"; with nothing to fill it is one button, \"עדכן שמות בעברית\".", "\"תן שמות בעברית\" (בשורת השמות או בשורת העמוד החסר) מפרט כל צד שאין לנו עבורו עברית - הנושא ראשון כשאין לו עמוד: שם הספק, שם עמוד באנגלית (\"Newcastle United\" במקום \"Newcastle United FC\") ושם בעברית, הכול ניתן לעריכה, בהצעת ה-AI. קבוצה שכבר ב-Templates נקראת \"קיימת כבר - ישתמש בה\"; שני כתיבים של אותו מועדון (\"Cagliari Calcio\" ו-\"Cagliari\") הם שורה אחת, אף פעם לא שתי קבוצות. מרוקנים את התיבה העברית של שורה כדי לדלג עליה (המשחק ההוא נשאר עם השם באנגלית). בריצת אמן השורה היחידה היא האמן. כשחלק מההופעות לוקחות את שמן מ-LiveTickets הדיאלוג אומר \"N אירועים יקבלו את השם בעברית מלייב טיקטס\"; כשאין מה למלא זה כפתור אחד, \"עדכן שמות בעברית\"."),
          t("Beside a row, \"זה עמוד קיים\" opens a search over every team page (Hebrew or English, inactive ones too): pick the page and the supplier's spelling is linked to it - its Hebrew name names the events, no team is created, and the link is remembered for later runs (\"בטל את הקישור\" undoes it). A name that matches a team we already have by the club rule (SS / AS / FC / Calcio and the like dropped) is linked instead of created, so the dialog no longer makes a duplicate team.", "ליד שורה, \"זה עמוד קיים\" פותח חיפוש בכל עמודי הקבוצות (בעברית או באנגלית, גם לא פעילים): בוחרים עמוד וכתיב הספק מקושר אליו - השם שלו בעברית נותן שם לאירועים, לא נוצרת קבוצה, והקישור נזכר בריצות הבאות (\"בטל את הקישור\" מבטל אותו). שם שמתאים לקבוצה שיש לנו כבר לפי כלל המועדון (SS / AS / FC / Calcio וכדומה מוסרים) מקושר במקום להיווצר, כך שהדיאלוג כבר לא יוצר קבוצה כפולה."),
          t("\"צור את הקבוצות ועדכן את שמות האירועים\" creates the teams and renames the run's events in Hebrew (\"N קבוצות נוצרו · N קישורים לעמוד קיים · N אירועים קיבלו שם בעברית\"). The AI never fetches a picture: the teams are created INACTIVE, with no crest and no photo, and with no tag or /c/ page yet - so they are not on the site's homepage. Upload the crest in [Football Teams](/templates/football) (an artist: [Artists](/templates/artists)) and switch the team on; switching it on creates its tag and its /c/ page then.", "\"צור את הקבוצות ועדכן את שמות האירועים\" יוצר את הקבוצות וכותב מחדש את שמות אירועי הריצה בעברית (\"N קבוצות נוצרו · N קישורים לעמוד קיים · N אירועים קיבלו שם בעברית\"). ה-AI אף פעם לא מביא תמונה: הקבוצות נוצרות לא פעילות, בלי סמל ובלי תמונה, ועוד בלי תג ובלי עמוד /c/ - ולכן הן לא בדף הבית של האתר. מעלים את הסמל ב[Football Teams](/templates/football) (אמן: [Artists](/templates/artists)) ומפעילים את הקבוצה; ההפעלה יוצרת את התג ואת עמוד ה-/c/ שלה באותו רגע."),
        ],
      },
      {
        title: t("Write the description template once", "לכתוב פעם אחת את תבנית התיאור"),
        steps: [
          t(
            "An event's description is the line the order page prints under its name, and the text the Meta feed reads. On a run's board press \"תבנית תיאור\" (top of the header). One template is kept for all football runs (a team or a competition) and one for artist runs - it is not per run. You can also write it on the plan card before you build (\"תבנית תיאור\" under the plan). The starting texts are football \"{בית} נגד {חוץ} ב{אולם}, במסגרת {מפעל}.\" and artists \"{אמן} יוצא לסיבוב הופעות שחובה לראות! כרטיסים להופעה שלו ב{עיר}.\" - edit them freely.",
            "התיאור של אירוע הוא השורה שעמוד ההזמנה מדפיס מתחת לשם שלו, והטקסט שהפיד של מטא קורא. בלוח של ריצה לוחצים \"תבנית תיאור\" (בראש הכותרת). נשמרת תבנית אחת לכל ריצות הכדורגל (קבוצה או תחרות) ואחת לריצות של אמנים - היא לא לכל ריצה בנפרד. אפשר לכתוב אותה גם בכרטיס התוכנית לפני הבנייה (\"תבנית תיאור\" מתחת לתוכנית). טקסטי ההתחלה הם: כדורגל \"{בית} נגד {חוץ} ב{אולם}, במסגרת {מפעל}.\" ואמנים \"{אמן} יוצא לסיבוב הופעות שחובה לראות! כרטיסים להופעה שלו ב{עיר}.\" - אפשר לשנות כרצונכם.",
          ),
          t(
            "Write the text and put places in braces - click a chip to add one at the cursor: football {בית} {חוץ} {מפעל} {אירוע} {אולם} {עיר} {תאריך}; artists {אמן} {אירוע} {אולם} {עיר} {תאריך}. Under the box you see it filled for one of the run's own shows as you type.",
            "כותבים את הטקסט ושמים מקומות בסוגריים מסולסלים - לחיצה על תגית מוסיפה אותה במקום הסמן: כדורגל {בית} {חוץ} {מפעל} {אירוע} {אולם} {עיר} {תאריך}; אמנים {אמן} {אירוע} {אולם} {עיר} {תאריך}. מתחת לתיבה רואים אותה ממולאת על אחת ההופעות של הריצה תוך כדי הקלדה.",
          ),
          t(
            "A place with no Hebrew yet prints in English and is named under the preview: a team waits for \"תן שמות בעברית\" (the descriptions are filled again by itself after it), a competition needs a league tag in [Tags & Rules](/event-tags) whose English name matches the supplier's. The hall prints by the Hebrew name you gave it in \"סווג כרטיסים\" (until then the supplier's English one), the date as it is.",
            "מקום שעוד אין לו עברית מודפס באנגלית ומצוין מתחת לתצוגה: קבוצה מחכה ל-\"תן שמות בעברית\" (התיאורים מתמלאים שוב לבד אחריו), מפעל צריך תגית ליגה ב-[תגיות וחוקים](/event-tags) שהשם האנגלי שלה תואם לשם אצל הספק. האולם מודפס בשם העברי שנתתם לו ב-\"סווג כרטיסים\" (עד אז בשם האנגלי של הספק), התאריך כמו שהוא.",
          ),
          t(
            "\"שמור לריצות הבאות\" keeps it for every event built from now on. \"שמור והחל על N האירועים בריצה\" also rewrites this run's events now - hidden and approved alike. A description someone already typed in the editor is never overwritten. An empty box clears the template: new events go back to the English line.",
            "\"שמור לריצות הבאות\" שומר אותה לכל אירוע שייבנה מעכשיו. \"שמור והחל על N האירועים בריצה\" גם כותב מחדש עכשיו את האירועים של הריצה - מוסתרים ומאושרים כאחד. תיאור שמישהו כבר כתב בעורך לא נדרס אף פעם. תיבה ריקה מוחקת את התבנית: אירועים חדשים חוזרים לשורה באנגלית.",
          ),
        ],
      },
      {
        title: t("Approve, edit or reject", "לאשר, לערוך או לדחות"),
        steps: [
          t("Every built event is hidden (\"מוסתר\"): not on the site, not in the feeds, and the checkout refuses it. A card shows the picture the site will draw, city · venue · date, the mode (\"חבילה\" or \"כרטיס בלבד\") and \"החל מ-$X\", the supplier chips, the decisions the agent took (one checkable line each) and amber warnings with a fix link (a missing artist page, no cut-out, a new venue with no zone template ...).", "כל אירוע שנבנה מוסתר (\"מוסתר\"): לא באתר, לא בפידים, והקופה דוחה אותו. הכרטיס מראה את התמונה שהאתר ישרטט, עיר · אולם · תאריך, את המצב (\"חבילה\" או \"כרטיס בלבד\") ו-\"החל מ-$X\", צ'יפים של הספקים, את ההחלטות שהסוכן קיבל (שורה אחת שאפשר לבדוק לכל החלטה) ואזהרות בענבר עם קישור לתיקון (עמוד אמן חסר, בלי cut-out, אולם חדש בלי תבנית אזורים ...)."),
          t("A red \"חוסם אישור\" line (no base price for a package, no ticket-only markup) switches the approve button off until you fill it in the event editor - the check runs again when you press approve.", "שורה אדומה \"חוסם אישור\" (אין מחיר בסיס לחבילה, אין מארק אפ לכרטיס בלבד) מכבה את כפתור האישור עד שממלאים בעורך האירוע - הבדיקה רצה שוב בלחיצה על אשר."),
          t("\"אשר\" lists the event on the site at once and the card turns \"באתר ✓\" (who approved, link to the site). The ad picture is drawn on the next hourly creative tick.", "\"אשר\" מעלה את האירוע לאתר מיד והכרטיס נהפך ל-\"באתר ✓\" (מי אישר, קישור לאתר). תמונת המודעה מצוירת בטיק הקריאייטיב השעתי הבא."),
          t("\"ערוך\" opens the event in the editor in a new tab. Change what you need, save, and come back: the card carries a \"נערך\" tag, and what you changed is recorded as a lesson when you approve.", "\"ערוך\" פותח את האירוע בעורך בלשונית חדשה. משנים מה שצריך, שומרים וחוזרים: על הכרטיס תג \"נערך\", ומה ששיניתם נרשם כלקח כשמאשרים."),
          t("\"דחה\" asks for a reason (at least 3 characters - the agent reads it next time) and has the switch \"אל תציע את ההופעה הזו שוב\" (ON: later runs of this subject skip the show as \"נדחה בעבר\"; OFF: the next run builds it again). The hidden event is deleted. To bring back a show you rejected for good, create it by hand with \"צור ידנית\".", "\"דחה\" מבקש סיבה (לפחות 3 תווים - הסוכן קורא אותה בפעם הבאה) ויש בו את המתג \"אל תציע את ההופעה הזו שוב\" (דלוק: ריצות מאוחרות של הנושא מדלגות על ההופעה כ-\"נדחה בעבר\"; כבוי: הריצה הבאה בונה אותה שוב). האירוע המוסתר נמחק. כדי להחזיר הופעה שדחיתם סופית יוצרים אותה ביד עם \"צור ידנית\"."),
          t("The board opens on the pill \"פעילים\": every show except the ones you rejected and the ones that were skipped, so a rejected card leaves the view at once. \"נדחו\", \"דולגו\" and \"הכל\" (last) bring them back; the pill stays in the address (?f=) through a refresh.", "הלוח נפתח על הפילטר \"פעילים\": כל הופעה חוץ מאלה שדחיתם ומאלה שדולגו, כך שכרטיס שנדחה יוצא מהתצוגה מיד. \"נדחו\", \"דולגו\" ו-\"הכל\" (אחרון) מחזירים אותם; הפילטר נשמר בכתובת (?f=) גם אחרי רענון."),
          t("\"אשר הכל (N) ← עולה לאתר\" in the bottom bar approves every ready card that has no blocker, after one confirmation. Keyboard: ↑ / ↓ moves between cards, A approves the focused one, R opens reject.", "\"אשר הכל (N) ← עולה לאתר\" בפס התחתון מאשר כל כרטיס מוכן בלי חוסם, אחרי אישור אחד. מקלדת: ↑ / ↓ עוברים בין כרטיסים, A מאשר את הכרטיס שבפוקוס, R פותח דחייה."),
        ],
      },
    ],
    flow: {
      title: t("From a brief to the site", "מבריף לאתר"),
      steps: [
        {
          label: t("Brief → plan card", "בריף → כרטיס תוכנית"),
          sub: t("the agent's one AI call; you confirm", "קריאת ה-AI היחידה; אתם מאשרים"),
        },
        {
          label: t("Search → build (hidden)", "חיפוש → בנייה (מוסתר)"),
          sub: t("code, not AI: shows, tickets, location, prices", "קוד, לא AI: הופעות, כרטיסים, לוקיישן, מחירים"),
        },
        {
          label: t("Questions → answers", "שאלות → תשובות"),
          sub: t("only what code cannot decide", "רק מה שהקוד לא מכריע"),
        },
        {
          label: t("Board → Approve", "לוח → אישור"),
          sub: t("the event goes live", "האירוע עולה לאתר"),
        },
      ],
    },
    points: [
      t(
        "What is AI and what is code: the agent has four AI calls - reading the brief into the plan (again when you steer it), proposing a hall's Hebrew name and zone names, proposing names for missing teams, and filling the form of a missing location - each a forced tool whose answer waits for your confirmation. Finding the shows, joining the two suppliers' rows into one show, the tickets, the location, the dates and every price are plain code - the flight and hotel bases from the one pricing rule, ticket prices from the supplier formula, markups only from the brief. The AI never writes a price and never guesses a match.",
        "מה AI ומה קוד: לסוכן ארבע קריאות AI - קריאת הבריף לתוכנית (ושוב כשמכוונים אותו), הצעת שם בעברית לאולם ושמות לזונים שלו, הצעת שמות לקבוצות שחסרות, ומילוי הטופס של מיקום חסר - כל אחת בכלי כפוי שהתשובה שלו מחכה לאישור שלכם. מציאת ההופעות, חיבור השורות של שני הספקים להופעה אחת, הכרטיסים, הלוקיישן, התאריכים וכל מחיר הם קוד פשוט - בסיסי הטיסה והמלון מכלל התמחור היחיד, מחירי הכרטיסים מנוסחת הספק, מארק אפים רק מהבריף. ה-AI אף פעם לא כותב מחיר ואף פעם לא מנחש התאמה.",
      ),
      t(
        "What gets found: a row whose performer is the artist (a tribute act that only has the name in its title is left out); a team's home games; a competition's fixtures. Rows from the two suppliers with the same city and day are one show; two shows on one day, or a one-day gap between the suppliers, become a question. A show with a flight-and-hotel location within 50 km is a package; without one the board asks you (build a new location, a package through a nearby city, ticket only, or skip) - the plan only marks the recommended answer.",
        "מה נמצא: שורה שהמבצע בה הוא האמן (מופע מחווה שרק מזכיר את השם בכותרת נשאר בחוץ); משחקי הבית של קבוצה; משחקי תחרות. שורות של שני הספקים באותה עיר וביום זהה הן הופעה אחת; שתי הופעות ביום אחד, או פער של יום בין הספקים, הופכים לשאלה. הופעה עם לוקיישן לטיסה ומלון עד 50 ק\"מ היא חבילה; בלי לוקיישן הלוח שואל אתכם (בניית לוקיישן חדש, חבילה דרך עיר קרובה, כרטיס בלבד או דילוג) - התוכנית רק מסמנת את התשובה המומלצת.",
      ),
      t(
        "What it learns: markups you correct on the plan card, what you tell it when you steer the plan, your answers, rejections with their reason, what you edit before approving, and a venue you built two-city. They are read back on the next run (and exact repeats are answered from memory), so the next tour has fewer gaps and fewer questions. Taught rules for it live in [AI Factory → Tour uploader](/ai-factory/tour-uploader).",
        "מה הוא לומד: מארק אפים שתיקנתם בכרטיס התוכנית, מה שאמרתם לו כשכיוונתם את התוכנית, התשובות שלכם, דחיות עם הסיבה, מה שערכתם לפני אישור, ואולם שבניתם דו-עירוני. כל אלה נקראים בריצה הבאה (וחזרות מדויקות נענות מהזיכרון), כך שלטור הבא יהיו פחות פערים ופחות שאלות. חוקים שמלמדים אותו נמצאים ב-[AI Factory ← Tour uploader](/ai-factory/tour-uploader).",
      ),
      t(
        "Where a hidden event shows up: in [Events](/events) with a \"מוסתר\" tag and a \"מוסתרים\" filter. It is not in the Meta product feed picker (nor in any other feed, nor in the price-light and base-price runs) until it is approved. Its page opens by direct link as a preview, but nobody can complete an order on it.",
        "איפה אירוע מוסתר מופיע: ב-[אירועים](/events) עם תג \"מוסתר\" ופילטר \"מוסתרים\". הוא לא בבורר של פיד המוצרים למטא (ולא באף פיד אחר, ולא בריצות הרמזור ובסיסי המחיר) עד שהוא מאושר. אפשר לפתוח את העמוד שלו בקישור ישיר כתצוגה מקדימה, אבל אף אחד לא יכול להשלים עליו הזמנה.",
      ),
      t(
        "When the agent is off (\"הסוכן כבוי\" next to the title) the brief cannot be read; the same screen offers \"מלאו את התוכנית\" - the plan card as an empty form. Searching, building, questions and approvals work the same. The batch wizard (\"Create N events\" on the provider tables) stays as the hands-on path.",
        "כשהסוכן כבוי (\"הסוכן כבוי\" ליד הכותרת) אי אפשר לקרוא את הבריף; אותו מסך מציע \"מלאו את התוכנית\" - כרטיס התוכנית כטופס ריק. חיפוש, בנייה, שאלות ואישורים עובדים אותו דבר. וויזרד הבאץ' (\"Create N events\" בטבלאות הספקים) נשאר כמסלול הידני.",
      ),
      t(
        "Stadium memory still serves both paths: a step with no ticket categories copies the TixStock categories of the last event on the same seat map - the stadium's drawing, never the city. A generic map (\"General Admission\") remembers nothing; only football reaches the stadium's other drawings; Save & Next carries only TixStock tickets (LiveTickets and our own stock belong to one game).",
        "זיכרון האצטדיון עדיין משרת את שני המסלולים: שלב בלי קטגוריות כרטיסים מעתיק את קטגוריות ה-TixStock מהאירוע האחרון על אותה מפת מושבים - השרטוט של האצטדיון, לא העיר. מפה כללית (\"General Admission\") לא זוכרת כלום; רק כדורגל מגיע לשרטוטים האחרים של האצטדיון; Save & Next מעביר רק כרטיסי TixStock (LiveTickets והמלאי שלנו שייכים למשחק אחד).",
      ),
      t(
        "What the board can do for the whole run (22.10): what used to print on every card is handled once. The run panel (\"לטיפול ברמת הריצה\") holds one row per topic - the hall's tickets, the Hebrew names, the missing team page, the missing crest / biography / cut-out / gallery - each with one action, and the cards fold those warnings into one grey line. A hall's tickets are classified once, from an AI proposal you confirm: the confirmation rewrites every show of the hall in the run and becomes the hall's template - or you fix ONE event in the editor and press \"למדו והחילו\" (two clear steps on the card, 28.10). A show's Hebrew name follows a rule (our teams, then LiveTickets, else one task for the run), and the answer to a question can become a rule for the run's similar questions. The panel is only a view: the warnings stay stored on the shows and in the audit.",
        "מה הלוח יודע לעשות לכל הריצה (22.10): מה שהודפס על כל כרטיס מטופל פעם אחת. פאנל הריצה (\"לטיפול ברמת הריצה\") מחזיק שורה לכל נושא - הכרטיסים של האולם, השמות בעברית, עמוד הקבוצה החסר, הסמל / הביוגרפיה / הגזרה / הגלריה החסרים - לכל אחד פעולה אחת, והכרטיסים מקפלים את האזהרות האלה לשורה אפורה אחת. הכרטיסים של אולם מסווגים פעם אחת, מהצעה של ה-AI שאתם מאשרים: האישור כותב מחדש כל הופעה של האולם בריצה והופך לתבנית האולם - או שמסדרים אירוע אחד בעורך ולוחצים \"למדו והחילו\" (שני שלבים ברורים בכרטיס, 28.10). השם בעברית של הופעה עוקב אחרי כלל (הקבוצות שלנו, אחר כך LiveTickets, אחרת משימה אחת לריצה), ותשובה לשאלה יכולה להפוך לכלל לשאלות הדומות של הריצה. הפאנל הוא רק תצוגה: האזהרות נשארות שמורות על ההופעות וביומן.",
      ),
      t(
        "The three newer AI calls: proposing the Hebrew name and the zone names of a hall (22.10; no descriptions since 28.10), proposing English and Hebrew names for the teams that lack them, and filling the create-location form from the show's city, country code, venue and coordinates (28.10) (the same agent, the same switch - \"הסוכן כבוי\" turns them off too, 20 seconds each, and the brief's allowance of 10 calls per person per 10 minutes). They see the hall's name and city, the subject, the categories with their section ids and the zone labels already stored (and a few from other halls as style examples), or the club names with the Hebrew show titles LiveTickets gives as hints - no price, no listing, no URL - and every result is a proposal in a dialog: nothing is written, created or removed until you press the confirm button. The AI never fetches a picture, and the code rule for away sections applies whatever it says.",
        "שלוש קריאות ה-AI החדשות: הצעת שם בעברית לאולם ושמות לזונים שלו (22.10; בלי תיאורים מ-28.10), הצעת שמות באנגלית ובעברית לקבוצות שאין להן, ומילוי טופס יצירת המיקום מהעיר, קוד המדינה, האולם והקואורדינטות של ההופעה (28.10) (אותו סוכן, אותו מתג - \"הסוכן כבוי\" מכבה גם אותן, 20 שניות כל אחת, ובמכסה של הבריף: 10 קריאות לאדם ב-10 דקות). הן רואות את שם האולם והעיר, הנושא, הקטגוריות עם מזהי האזורים שלהן והשמות שכבר שמורים לזונים (ועוד כמה מאולמות אחרים כדוגמת סגנון), או את שמות המועדונים עם שמות ההופעות בעברית ש-LiveTickets נותן כרמז - בלי מחיר, בלי שורת כרטיס ובלי כתובת - וכל תוצאה היא הצעה בדיאלוג: שום דבר לא נכתב, נוצר או יורד עד שלוחצים על כפתור האישור. ה-AI אף פעם לא מביא תמונה, וכלל הקוד ליציעי חוץ חל מה שלא יאמר.",
      ),
      t(
        "What it learns from the dialogs: each call reads only the lessons about its own job. The classification reads the changes you made to its proposals (a zone renamed, a category dropped or un-dropped, a name typed by hand); the names call reads the team names you confirmed or linked to an existing page; the location call reads the locations you created; the brief reads what it always did, plus the instructions you steered it with. A row you confirm exactly as proposed teaches nothing. What matters most is what is saved: the hall's template (the next run there is classified by itself) and the teams created. [AI Factory → Tour uploader](/ai-factory/tour-uploader) shows every quoted lesson with its source.",
        "מה הוא לומד מהדיאלוגים: כל קריאה קוראת רק את הלקחים על התפקיד שלה. הסיווג קורא את השינויים שעשיתם בהצעות שלו (זון ששונה שמו, קטגוריה שנפסלה או שהפסילה בוטלה, שם שהקלדתם ביד); קריאת השמות קוראת את שמות הקבוצות שאישרתם או קישרתם לעמוד קיים; קריאת המיקום קוראת את המיקומים שיצרתם; הבריף קורא מה שתמיד קרא, ובנוסף את ההוראות שכיוונתם בהן. שורה שאישרתם בדיוק כפי שהוצעה לא מלמדת כלום. החשוב ביותר הוא מה שנשמר: תבנית האולם (הריצה הבאה שם מסווגת בעצמה) והקבוצות שנוצרו. [AI Factory ← Tour uploader](/ai-factory/tour-uploader) מראה כל לקח מצוטט עם המקור שלו.",
      ),
      t(
        "What changed on 28.10 (Alon's second round): (1) one rule joins a TixStock and a LiveTickets show - cities through the Locations' \"שמות נוספים\" and the answers you gave, clubs by the club name without SS / AS / Calcio and the like; answers and rejections of earlier runs stay valid. (2) A city's name beats wrong venue coordinates. (3) A show with no location is always asked: create a location (the AI fills the form), a two-city package, ticket only or skip. (4) LiveTickets categories that are not instant-confirm are brought and marked, with a switch on the plan card. (5) The names dialog links a name to an existing team page instead of creating a duplicate, and the panel opens a task for a missing page. (6) A hall has a Hebrew name and a map where you exclude sections for every show of the hall; the classification no longer asks for zone descriptions. (7) The plan card has \"כוון את ה-AI\", the AI's questions and the description template. (8) The board opens on \"פעילים\" and teaches a hall in two steps.",
        "מה השתנה ב-28.10 (הסבב השני של אלון): (1) כלל אחד מחבר הופעה של TixStock והופעה של LiveTickets - ערים דרך \"שמות נוספים\" של המיקומים והתשובות שנתתם, מועדונים לפי שם המועדון בלי SS / AS / Calcio וכדומה; תשובות ודחיות מריצות קודמות נשארות בתוקף. (2) שם העיר גובר על קואורדינטות שגויות של האולם. (3) הופעה בלי מיקום נשאלת תמיד: ליצור מיקום (ה-AI ממלא את הטופס), חבילה דו-עירונית, כרטיס בלבד או לדלג. (4) קטגוריות LiveTickets שאינן באישור מיידי מובאות ומסומנות, עם מתג בכרטיס התוכנית. (5) דיאלוג השמות מקשר שם לעמוד קבוצה קיים במקום ליצור כפילות, והפאנל פותח משימה לעמוד חסר. (6) לאולם יש שם בעברית ומפה שמחריגים בה גושים לכל ההופעות של האולם; הסיווג כבר לא מבקש תיאורי זונים. (7) בכרטיס התוכנית יש \"כוון את ה-AI\", שאלות ה-AI ותבנית התיאור. (8) הלוח נפתח על \"פעילים\" ומלמד אולם בשני שלבים.",
      ),
    ],
    rules: [
      t(
        "Hidden until approved. A built event is invisible to customers, feeds and checkout until an admin presses Approve - there is no auto-approve, however many good runs it has had.",
        "מוסתר עד אישור. אירוע שנבנה בלתי נראה ללקוחות, לפידים ולקופה עד שמנהל לוחץ אשר - אין אישור אוטומטי, גם אחרי הרבה ריצות טובות.",
      ),
      t(
        "No tickets, no event. A show that neither TixStock nor LiveTickets sells tickets for is not created - its card is grey with \"אין כרטיסים למכירה\" and \"צור ידנית\". A supplier that did not answer is not \"no tickets\": that show is an error card with \"נסה שוב\" - build it again later.",
        "אין כרטיסים - אין אירוע. הופעה שאף אחד מ-TixStock ו-LiveTickets לא מוכר לה כרטיסים לא נוצרת - הכרטיס שלה אפור עם \"אין כרטיסים למכירה\" ו-\"צור ידנית\". ספק שלא ענה הוא לא \"אין כרטיסים\": ההופעה נשארת כרטיס שגיאה עם \"נסה שוב\" - בונים אותה שוב מאוחר יותר.",
      ),
      t(
        "Never a guessed match. When the suppliers disagree or a venue cannot be placed, the show waits for your answer; it never guesses a supplier show, a date or a flight city.",
        "אף פעם לא התאמה מנוחשת. כשהספקים לא מסכימים או שאי אפשר לשבץ אולם, ההופעה מחכה לתשובה שלכם; היא לא מנחשת הופעת ספק, תאריך או עיר טיסה.",
      ),
      t(
        "Rehearse with the test-run switch. \"ריצת בדיקה\" at the bottom of the plan card also marks every event of the run as a test event - the marking the site and the feeds already skip - so a rehearsal stays out of customers' sight even if something about the hidden flag is off. Use it for the first run of a new kind of brief, then reject the test events - on a test run the \"אל תציע את ההופעה הזו שוב\" switch starts OFF, and a test run's answers and rejections never carry into a real run.",
        "מתאמנים עם מתג ריצת הבדיקה. \"ריצת בדיקה\" בתחתית כרטיס התוכנית מסמן את כל אירועי הריצה גם כאירועי בדיקה - סימון שהאתר והפידים כבר מדלגים עליו - כך שהתנסות נשארת רחוקה מעיני הלקוחות גם אם משהו בדגל ההסתרה לא תקין. משתמשים בו בריצה הראשונה של סוג חדש של בריף, ואחר כך דוחים את אירועי הבדיקה - בריצת בדיקה המתג \"אל תציע את ההופעה הזו שוב\" מתחיל כבוי, ותשובות ודחיות של ריצת בדיקה לא עוברות אף פעם לריצה אמיתית.",
      ),
      t(
        "No pictures from the AI. A team or artist the names dialog creates is INACTIVE, with no crest and no photo; staff upload the picture in Templates and switch it on, and only then does it get its tag and /c/ page and appear on the site. The AI never fetches, picks or attaches an image of any kind.",
        "אין תמונות מה-AI. קבוצה או אמן שדיאלוג השמות יוצר נוצרים לא פעילים, בלי סמל ובלי תמונה; הצוות מעלה את התמונה ב-Templates ומפעיל, ורק אז יש להם תג ועמוד /c/ והם מופיעים באתר. ה-AI אף פעם לא מביא, בוחר או מצרף תמונה מכל סוג.",
      ),
      t(
        "Unplaced is flagged, not dropped. A category the AI cannot place keeps its ticket with no zone and a \"לבדיקה\" line on the card; it is left out of the hall's template (so no English zone is stored for later runs) and the hall stays on the run panel until it is placed. The only automatic drop is the rule for away / visiting supporters' sections, and you can flip it. Obstructed-view seats are not a category rule: they are refused listing by listing when the event is built.",
        "מה שלא הוצב מסומן, לא נפסל. קטגוריה שה-AI לא יודע להציב שומרת את הכרטיס שלה בלי זון ועם שורת \"לבדיקה\" על הכרטיס; היא נשארת מחוץ לתבנית האולם (כך שלא נשמר זון באנגלית לריצות מאוחרות) והאולם נשאר בפאנל הריצה עד שהיא מוצבת. הפסילה האוטומטית היחידה היא הכלל ליציעי אוהדי חוץ / מבקרים, ואפשר להפוך אותה. מושבים עם הפרעת ראות הם לא כלל קטגוריה: הם נדחים ברמת הרישום של הספק כשהאירוע נבנה.",
      ),
    ],
    links: [
      { label: t("AI Uploader", "העלאה חכמה"), href: "/uploader", adminOnly: true },
      { label: t("Tour uploader in AI Factory", "Tour uploader ב-AI Factory"), href: "/ai-factory/tour-uploader", adminOnly: true },
      { label: t("Events (hidden filter)", "אירועים (פילטר מוסתרים)"), href: "/events" },
    ],
  },
  {
    id: "marketing",
    nav: "/marketing",
    productType: "events",
    adminOnly: true,
    title: t("Marketing dashboard", "דשבורד שיווק"),
    intro: t(
      "What the ads cost against what the orders brought in. It reads Meta and Google Ads spend, the site's traffic from Google Analytics, the Instagram posts and our reservations - in shekels by default, dollars on the switch - and shows the funnel from lead to passenger, the profit after supplier costs, what sold (by artist, team and category) and how each influencer performs. The screen only reads - it never changes a campaign, a budget or an ad account.",
      "מה עלו המודעות מול מה שההזמנות הכניסו. המסך קורא הוצאה ממטא ומגוגל, את התנועה באתר מ-Google Analytics, פוסטים מאינסטגרם והזמנות שלנו - בשקלים כברירת מחדל, בדולרים במתג - ומציג את המשפך מליד עד נוסע, את הרווח אחרי עלות הספקים, מה נמכר (לפי אמן, קבוצה וקטגוריה) ואיך כל משפיען מתפקד. המסך רק קורא - הוא לא משנה קמפיין, תקציב או חשבון פרסום.",
    ),
    howTo: [
      {
        title: t("Read the executive tab", "לקרוא את מסך ההנהלה"),
        steps: [
          t("Open the [Marketing Dashboard](/marketing) - it opens on \"Executive\". The bar beside the tabs holds four filters for every tab: the period (\"Today\", \"Yesterday\", \"Last 7 / 30 / 90 days\", \"This month\", \"Last month\", or any days you pick on the calendar and \"Apply\"), the currency (₪ / $), the brand (\"Mega Events\" by default; \"Other brand\" = the other brands; \"All brands\" = every campaign) and the source (\"All sources\", \"Meta\", \"Google Ads\", \"Partners\", \"No UTM\", \"Other\"). Days are Israel days. All four stay in the address, so a copied link shows the same view.", "פותחים את [דשבורד שיווק](/marketing) - הוא נפתח על \"Executive\". בסרגל שליד הלשוניות ארבעה מסננים לכל הלשוניות: תקופה (\"Today\", \"Yesterday\", \"Last 7 / 30 / 90 days\", \"This month\", \"Last month\", או כל ימים שבוחרים בלוח השנה ו-\"Apply\"), מטבע (₪ / $), מותג (\"Mega Events\" כברירת מחדל; \"Other brand\" = שאר המותגים; \"All brands\" = כל הקמפיינים) ומקור (\"All sources\", \"Meta\", \"Google Ads\", \"Partners\", \"No UTM\", \"Other\"). הימים הם ימים בשעון ישראל. ארבעתם נשארים בכתובת, אז קישור שהועתק מציג את אותו מסך."),
          t("The executive tab reads top to bottom like the reference report. SPEND: total spend, then Google and Meta with their share. FUNNEL - every order of the period from the chosen source: \"Leads\" = orders entered (any status), \"Signups\" = the Paid ones, \"Passengers\" = tickets on the Paid ones. EFFICIENCY: cost per lead / signup / passenger (spend of that source ÷ the count), lead → signup % and passengers per signup. Partners, No UTM and Other have no ad spend, so their costs read \"—\".", "מסך ההנהלה נקרא מלמעלה למטה כמו דוח הרפרנס. SPEND: סך ההוצאה, ואחריה גוגל ומטא עם החלק שלהן. FUNNEL - כל ההזמנות של התקופה מהמקור שנבחר: \"Leads\" = הזמנות שנכנסו (בכל סטטוס), \"Signups\" = אלה ששולמו (Paid), \"Passengers\" = הכרטיסים בהזמנות ששולמו. EFFICIENCY: עלות לליד / להרשמה / לנוסע (הוצאת המקור ÷ המספר), אחוז ליד → הרשמה ונוסעים להרשמה. ל-Partners, No UTM ו-Other אין הוצאה על מודעות, ולכן העלויות שלהם מוצגות \"—\"."),
          t("\"Leaders\" (under the funnel) names the best-selling artist and football team of the period, the influencer who sold most (\"Top seller\") and the one who brought most visitors (\"Top traffic maker\"), and \"Rising\" - the artists and teams that sold more tickets than in the previous period of the same length. Each card shows its change against that period. \"All sales by artist, team and category\" and \"All influencers\" open the full tables.", "\"Leaders\" (מתחת למשפך) מציג את האמן וקבוצת הכדורגל שמכרו הכי הרבה בתקופה, את המשפיען שמכר הכי הרבה (\"Top seller\") ואת זה שהביא הכי הרבה מבקרים (\"Top traffic maker\"), ו-\"Rising\" - האמנים והקבוצות שמכרו יותר כרטיסים מאשר בתקופה הקודמת באותו אורך. כל כרטיס מציג את השינוי מול התקופה ההיא. \"All sales by artist, team and category\" ו-\"All influencers\" פותחים את הטבלאות המלאות."),
          t("Three charts follow: daily spend Google vs Meta; leads, signups and passengers over time; and \"Spend vs results\" - spend as bars with revenue and signups on top, to see whether a day of spending brought orders.", "אחריהם שלושה גרפים: הוצאה יומית גוגל מול מטא; לידים, הרשמות ונוסעים לאורך זמן; ו-\"Spend vs results\" - ההוצאה כעמודות וההכנסה וההרשמות מעליהן, כדי לראות אם יום של הוצאה הביא הזמנות."),
          t("\"Spend\" is the ad spend of the period. \"Revenue\" is what the Paid bookings credited to those ads paid (coupon and agent-card discount already off); under it, \"Unattributed\" (bookings no paid ad is credited with) and \"Other brand campaign\" (bookings credited to a campaign outside the chosen brand) - each with its bookings and revenue, shown beside the cards, never inside them. \"COGS\" is what flights, hotels and tickets cost us (\"N estimated\" = part of it is an estimate). \"Net profit from media\" = revenue - supplier cost - processing fee - ad spend of the bookings credited to the brand's ads; under it, the net of \"Unattributed\" and of \"Other brand\".", "\"Spend\" היא ההוצאה על מודעות בתקופה. \"Revenue\" היא מה שהזמנות ה-Paid שנזקפות למודעות האלה שילמו (הקופון והנחת כרטיס הסוכן כבר ירדו); מתחתיה \"Unattributed\" (הזמנות שאף מודעה משולמת לא נזקפת להן) ו-\"Other brand campaign\" (הזמנות שנזקפו לקמפיין שאינו במותג שנבחר) - כל אחד עם מספר ההזמנות וההכנסה שלו, מוצגים ליד הכרטיסים ולא בתוכם. \"COGS\" היא מה שטיסות, מלונות וכרטיסים עולים לנו (\"N estimated\" = חלק ממנה הערכה). \"Net profit from media\" = הכנסה - עלות ספקים - עמלת סליקה - הוצאה על מודעות, של ההזמנות שנזקפות למודעות של המותג; מתחתיו הרווח של \"Unattributed\" ושל \"Other brand\"."),
          t("Below them: \"CAC\" (ad spend per booking), \"ROAS\" (revenue per dollar of spend) and \"POAS\" (net profit per dollar of spend). POAS is coloured: red below 0 (the ads lose money), amber up to 1, green above 1. In \"This month\" the monthly target is held against the ALL-IN profit - the media net plus the net of \"Unattributed\" and \"Other brand\" - on the line \"Target ... vs all-in net $X\": green on target, red below it.", "מתחתיהם: \"CAC\" (הוצאה על מודעות להזמנה), \"ROAS\" (הכנסה לכל דולר הוצאה) ו-\"POAS\" (רווח נקי לכל דולר הוצאה). POAS צבוע: אדום מתחת ל-0 (המודעות מפסידות), כתום עד 1, ירוק מעל 1. ב-\"This month\" היעד החודשי נמדד מול הרווח הכולל - הרווח ממדיה ועוד הרווח של \"Unattributed\" ושל \"Other brand\" - בשורה \"Target ... vs all-in net $X\": ירוק ביעד, אדום מתחתיו."),
          t("To see the campaign behind a number open \"Media\": the totals first, then one row per campaign, biggest spend first - click a row for its ad sets, and \"Ads\" on an ad set shows its ads; \"Preview\" opens the ad as Meta draws it (Facebook feed, Instagram feed, Instagram story). A Google ad group shows its headlines, descriptions and landing page; a Performance Max campaign shows its \"Asset groups\" with their pictures. The ⓘ beside a column title says what it counts. Under the table three cards: \"Unresolved\" lists, per platform, bookings that came from an ad but could not be matched to a campaign; \"Unattributed\" the bookings with no paid ad; \"Other brand campaign\" the bookings credited to another brand's campaign (a campaign the system does not know counts as \"Other brand\").", "כדי לראות את הקמפיין שמאחורי מספר פותחים את \"Media\": קודם הסיכומים, ואז שורה לכל קמפיין, ההוצאה הגדולה ראשונה - לחיצה על שורה פותחת את סטי המודעות שלה, ו-\"Ads\" על סט מודעות מציג את המודעות שלו; \"Preview\" פותח את המודעה כמו שמטא מציגה אותה (פיד פייסבוק, פיד אינסטגרם, סטורי). קבוצת מודעות בגוגל מציגה את הכותרות, התיאורים ודף הנחיתה שלה; קמפיין Performance Max מציג את ה-\"Asset groups\" שלו עם התמונות. ה-ⓘ ליד כותרת עמודה מסביר מה היא סופרת. מתחת לטבלה שלושה כרטיסים: \"Unresolved\" מציג, לפי פלטפורמה, הזמנות שהגיעו ממודעה אבל לא הצלחנו לשייך לקמפיין; \"Unattributed\" את ההזמנות בלי מודעה משולמת; \"Other brand campaign\" את ההזמנות שנזקפו לקמפיין של מותג אחר (קמפיין שהמערכת לא מכירה נחשב \"Other brand\")."),
        ],
      },
      {
        title: t("Read the traffic tab", "לקרוא את לשונית התנועה"),
        steps: [
          t("Open \"Traffic\" ([Marketing → Traffic](/marketing?tab=traffic)). The cards marked GA4 come from Google Analytics (sessions, users, engagement); the ones marked \"ours\" are our orders (leads, signups) and \"Conversion\" = our signups ÷ GA4 sessions of the same source. The source filter in the bar is the UTM filter - Meta (Facebook / Instagram ads and links), Google Ads, Partners (an influencer or a partner code), No UTM (direct, no source) or Other (organic search, referrals...).", "פותחים את \"Traffic\" ([Marketing ← Traffic](/marketing?tab=traffic)). הכרטיסים שמסומנים GA4 מגיעים מ-Google Analytics (סשנים, משתמשים, מעורבות); אלה שמסומנים \"ours\" הם ההזמנות שלנו (לידים, הרשמות), ו-\"Conversion\" = ההרשמות שלנו ÷ הסשנים ב-GA4 מאותו מקור. מסנן המקור בסרגל הוא מסנן ה-UTM - Meta (מודעות וקישורים מפייסבוק / אינסטגרם), Google Ads, Partners (משפיען או קוד שותף), No UTM (ישיר, בלי מקור) או Other (חיפוש אורגני, הפניות...)."),
          t("\"Sessions per day\" stacks the visits by source. The three funnels split them by the first page - the homepage, an artist or team page, or an event's order page (the same rule as the Partners screen) - and count, for each step, the sessions in which it happened: picked an event, searched flights, reached the order summary, confirmed (paid or asked for a call), purchased. \"Sources\" lists every source - click one for its source / medium rows - and \"Top landing pages\" the pages people arrive on. Click a page to open it on the site. \"Sold\" = our Paid orders of what the page sells (an event page: that event; a category, artist or team page: its events; the homepage and other pages: —), \"Sale rate\" = sold ÷ sessions, \"vs previous\" = sessions against the previous period. A red \"No sales\" badge = enough sessions to judge and nothing sold; a green \"Selling\" badge = a high sale rate - the page alerts' rule. \"GA4 purchases\" counts only a purchase made in the same session, so it reads far lower.", "\"Sessions per day\" מציג את הביקורים לפי מקור. שלושת המשפכים מחלקים אותם לפי הדף הראשון - דף הבית, דף אמן או קבוצה, או דף הזמנה של אירוע (אותו חוק כמו במסך השותפים) - וסופרים בכל שלב את הסשנים שבהם הוא קרה: בחר אירוע, חיפש טיסות, הגיע לסיכום ההזמנה, אישר (שילם או ביקש שיחה), רכש. \"Sources\" מציג כל מקור - לחיצה פותחת את שורות ה-source / medium שלו - ו-\"Top landing pages\" את הדפים שאנשים נוחתים בהם. לחיצה על דף פותחת אותו באתר. \"Sold\" = ההזמנות ששולמו אצלנו ממה שהדף מוכר (דף אירוע: האירוע; דף קטגוריה, אמן או קבוצה: האירועים שלו; דף הבית ושאר הדפים: —), \"Sale rate\" = נמכר ÷ סשנים, \"vs previous\" = הסשנים מול התקופה הקודמת. תג אדום \"No sales\" = מספיק סשנים כדי לשפוט ושום דבר לא נמכר; תג ירוק \"Selling\" = אחוז מכירה גבוה - אותו חוק כמו התראות הדפים. \"GA4 purchases\" סופר רק רכישה שקרתה באותו סשן, ולכן הוא נמוך בהרבה."),
        ],
      },
      {
        title: t("See what sold - by artist, team and category", "לראות מה נמכר - לפי אמן, קבוצה וקטגוריה"),
        steps: [
          t("Open \"Sales\" ([Marketing → Sales](/marketing?tab=sales)). It counts the Paid orders of the period (the period and source filters apply; brand does not - they are the site's orders), each against the previous period of the same length: the cards up top (orders, tickets, revenue), then \"Trends\" - the best-selling artist, the best-selling football team and \"Rising\".", "פותחים את \"Sales\" ([Marketing ← Sales](/marketing?tab=sales)). הוא סופר את ההזמנות ששולמו בתקופה (מסנני התקופה והמקור חלים; המותג לא - אלה ההזמנות של האתר), כל אחת מול התקופה הקודמת באותו אורך: הכרטיסים למעלה (הזמנות, כרטיסים, הכנסה), ואחריהם \"Trends\" - האמן שמכר הכי הרבה, קבוצת הכדורגל שמכרה הכי הרבה ו-\"Rising\"."),
          t("The tables split the same orders by artist, by football team, by category (music / football...), by league or genre, and by event (click an event to open its page on the site). Each row: orders, tickets, its share of the tickets, revenue and the change against the previous period (hover it for the previous numbers). The artist, team, league and genre are the event's tags - an event with no such tag is not in that table, and a match tagged with both teams counts for both.", "הטבלאות מחלקות את אותן הזמנות לפי אמן, לפי קבוצת כדורגל, לפי קטגוריה (מוסיקה / כדורגל...), לפי ליגה או ז'אנר, ולפי אירוע (לחיצה על אירוע פותחת את הדף שלו באתר). בכל שורה: הזמנות, כרטיסים, החלק שלה מהכרטיסים, הכנסה והשינוי מול התקופה הקודמת (מעבר עם העכבר מראה את המספרים הקודמים). האמן, הקבוצה, הליגה והז'אנר הם התגיות של האירוע - אירוע בלי תגית כזו לא מופיע בטבלה הזו, ומשחק שמתויג בשתי הקבוצות נספר לשתיהן."),
        ],
      },
      {
        title: t("Read the influencers tab", "לקרוא את לשונית המשפיענים"),
        steps: [
          t("Open \"Influencers\" ([Marketing → Influencers](/marketing?tab=influencers)). Every influencer (affiliate partner) with traffic or orders in the period or the one before - agents are not here. \"Visitors\" = people their links brought, \"Orders\" = bookings with their code (any status), \"Paid\" = the Paid ones, then tickets, revenue, their commission and conversion (paid ÷ visitors) - the same numbers as the [Partners](/partners) screen. Click a name for the partner's own page.", "פותחים את \"Influencers\" ([Marketing ← Influencers](/marketing?tab=influencers)). כל משפיען (שותף affiliate) שהיו לו תנועה או הזמנות בתקופה או בזו שלפניה - סוכנים לא כאן. \"Visitors\" = האנשים שהקישורים שלו הביאו, \"Orders\" = הזמנות עם הקוד שלו (בכל סטטוס), \"Paid\" = אלה ששולמו, ואחריהם כרטיסים, הכנסה, העמלה שלו והמרה (ששולמו ÷ מבקרים) - אותם מספרים כמו במסך [שותפים](/partners). לחיצה על שם פותחת את הדף של השותף."),
          t("The cards on top name the top seller, the top traffic maker and the best conversion (only among those with enough visitors to judge). A red \"No sales\" badge = many visitors and no Paid order; a green \"Selling\" badge = enough Paid orders - the influencer alerts' rule, set on \"Settings\".", "הכרטיסים למעלה מציגים את מי שמכר הכי הרבה, את מי שהביא הכי הרבה תנועה ואת ההמרה הטובה ביותר (רק בין מי שהביא מספיק מבקרים כדי לשפוט). תג אדום \"No sales\" = הרבה מבקרים ואף הזמנה ששולמה; תג ירוק \"Selling\" = מספיק הזמנות ששולמו - אותו חוק כמו התראות המשפיענים, שנקבע ב-\"Settings\"."),
        ],
      },
      {
        title: t("Read the time-to-purchase tab", "לקרוא את לשונית הזמן עד רכישה"),
        steps: [
          t(
            "Open \"Time to purchase\" ([Marketing → Time to purchase](/marketing?tab=timelag)). The cards marked \"ours\" count the Paid orders of the period and how long their buyers took from the first tracked visit to the order (the median, the share within 24 hours); the cards marked GA4 count Google Analytics' purchase events and the days from the buyer's first session to the purchase.",
            "פותחים את \"Time to purchase\" ([Marketing ← Time to purchase](/marketing?tab=timelag)). הכרטיסים שמסומנים \"ours\" סופרים את ההזמנות ששולמו בתקופה וכמה זמן לקח לרוכשים מהביקור הראשון שנרשם ועד ההזמנה (חציון, חלק שהזמין תוך 24 שעות); הכרטיסים שמסומנים GA4 סופרים את אירועי הרכישה ב-Google Analytics ואת הימים מהביקור הראשון של הרוכש ועד הרכישה.",
          ),
          t(
            "\"Ours\" measures an order only when the site stamped a tracked visit for it - a visit that came with a UTM, a gclid or an fbclid (the cookie keeps the newest five visits for 90 days). Direct, organic and agent-typed orders are counted as \"not measured\", never guessed, and a \"No UTM\" order is never measured. The source filter in the bar applies to this half only; the table under the charts splits it by source.",
            "\"Ours\" מודד הזמנה רק כשהאתר רשם לה ביקור - ביקור שהגיע עם UTM, gclid או fbclid (העוגייה שומרת את חמשת הביקורים האחרונים ל-90 יום). הזמנות ישירות, אורגניות או שסוכן הקליד נספרות כ\"לא נמדדו\", לעולם לא מנחשים, והזמנת \"No UTM\" אף פעם לא נמדדת. מסנן המקור בסרגל חל רק על החצי הזה; הטבלה מתחת לגרפים מפצלת אותו לפי מקור.",
          ),
          t(
            "The GA4 half covers every buyer, in days (same day, 1 day, 2-3 days...), by GA4's own user - a new device or cleared cookies counts as a new user - and ignores the source filter. The two halves measure different things and never add up to one number: compare each with itself over time.",
            "חצי ה-GA4 מכסה כל רוכש, בימים (אותו יום, יום, 2-3 ימים...), לפי המשתמש של GA4 - מכשיר חדש או עוגיות שנמחקו נחשבים למשתמש חדש - ומתעלם ממסנן המקור. שני החצאים מודדים דברים שונים ולעולם לא מסתכמים למספר אחד: משווים כל אחד לעצמו לאורך זמן.",
          ),
        ],
      },
      {
        title: t("Tag a campaign's brand / change a threshold", "לתייג קמפיין למותג / לשנות סף"),
        steps: [
          t("Open the \"Settings\" tab ([Marketing → Settings](/marketing?tab=settings)). Under \"Campaign brands\" search the campaign by name.", "פותחים את לשונית \"Settings\" ([Marketing ← Settings](/marketing?tab=settings)). תחת \"Campaign brands\" מחפשים את הקמפיין לפי שם."),
          t("In its row, under \"Assign to\", pick \"Mega Events\" or \"Other brand\". A pick by hand beats the system's rule (a name that says MYT / Mega Events, or ads that land on mega-events.co.il) until you choose \"By rule\" again; its ad sets follow it at once.", "בשורה שלו, תחת \"Assign to\", בוחרים \"Mega Events\" או \"Other brand\". בחירה ידנית גוברת על חוק המערכת (שם שמכיל MYT / Mega Events, או מודעות שנוחתות ב-mega-events.co.il) עד שבוחרים שוב \"By rule\"; סטי המודעות שלו עוברים איתו מיד."),
          t("To change a limit, edit its box on the same tab - \"Processing fee (%)\", \"Monthly profit target ($)\", \"Budget bleed - amount (₪)\", \"Budget bleed - days\", \"Viral - % of average\", the \"Pages - ...\" and \"Influencers - ...\" boxes (the days each is judged over, the sessions or visitors that make \"no sales\", the sale rate or Paid orders that make \"selling\") or \"Alert emails\" (comma-separated; empty = the system's default address) - and click \"Save\". A value out of range refuses the whole save (fee 0-100%, days a whole number 1-60, viral 50-1,000%, at most 10 addresses). Fee and target show on the executive tab at once; the alert limits count from the next sync.", "כדי לשנות סף עורכים את התיבה שלו באותה לשונית - \"Processing fee (%)\", \"Monthly profit target ($)\", \"Budget bleed - amount (₪)\", \"Budget bleed - days\", \"Viral - % of average\", התיבות \"Pages - ...\" ו-\"Influencers - ...\" (הימים שעליהם שופטים, הסשנים או המבקרים שהופכים ל-\"no sales\", אחוז המכירה או ההזמנות ששולמו שהופכים ל-\"selling\") או \"Alert emails\" (מופרדים בפסיק; ריק = כתובת ברירת המחדל של המערכת) - ולוחצים \"Save\". ערך מחוץ לטווח מבטל את כל השמירה (עמלה 0-100%, ימים מספר שלם 1-60, ויראלי 50-1,000%, עד 10 כתובות). עמלה ויעד מופיעים במסך ההנהלה מיד; ספי ההתראות נספרים מהסנכרון הבא."),
        ],
      },
    ],
    points: [
      t(
        "ROAS = revenue ÷ ad spend (2.00× = every dollar of ads brought two dollars of bookings). POAS = net profit ÷ ad spend, where net profit = revenue − supplier cost − processing fee − ad spend; 0 is break-even, below 0 the ads lose money - the number that says whether a campaign earns money, because a campaign can show a fine ROAS and still lose. CAC = ad spend ÷ the bookings credited to it. A dash means there is nothing to divide by (no spend, or no booking).",
        "ROAS = הכנסה ÷ הוצאה על מודעות (2.00× = כל דולר מודעות הביא שני דולרים של הזמנות). POAS = רווח נקי ÷ הוצאה על מודעות, כשרווח נקי = הכנסה − עלות ספקים − עמלת סליקה − הוצאה על מודעות; 0 הוא איזון, מתחת ל-0 המודעות מפסידות - המספר שאומר אם קמפיין מרוויח, כי קמפיין יכול להציג ROAS יפה ועדיין להפסיד. CAC = הוצאה ÷ ההזמנות שנזקפות לו. מקף אומר שאין במה לחלק (אין הוצאה או אין הזמנה).",
      ),
      t(
        "A Paid booking is credited to the last paid ad click before it - the newest Meta or Google visit that carried an ad id or a click id (campaign names are never used to match). \"Unresolved\" = the booking did come from a Meta or Google ad, but that ad or click is not in the synced data (a very new ad, an old click, a deleted ad) - and also a visit tagged facebook / fb / ig / instagram / meta, or google with cpc, that carried no id we can resolve; its revenue is still counted, per platform. \"Unattributed\" = no paid ad touch at all: organic, direct or a partner link. \"Other brand campaign\" = the click resolved to a campaign outside the chosen brand. Revenue never drops out - it lands on a campaign, on \"Unresolved\", on \"Unattributed\" or on \"Other brand campaign\".",
        "הזמנת Paid נזקפת לקליק המשולם האחרון על מודעה שקדם לה - הביקור החדש ביותר ממטא או מגוגל שנשא מזהה מודעה או מזהה קליק (שמות קמפיינים לא משמשים להתאמה). \"Unresolved\" = ההזמנה אכן הגיעה ממודעה במטא או בגוגל, אבל המודעה או הקליק לא נמצאים בנתונים שסונכרנו (מודעה חדשה מאוד, קליק ישן, מודעה שנמחקה) - וגם ביקור שתויג facebook / fb / ig / instagram / meta, או google עם cpc, בלי מזהה שאפשר לשייך; ההכנסה שלה נספרת, לפי פלטפורמה. \"Unattributed\" = אין בכלל מגע משולם: אורגני, ישיר או קישור שותף. \"Other brand campaign\" = הקליק שויך לקמפיין שאינו במותג שנבחר. הכנסה אף פעם לא נעלמת - היא נוחתת על קמפיין, על \"Unresolved\", על \"Unattributed\" או על \"Other brand campaign\".",
      ),
      t(
        "\"N estimated\" (and the amber dot in the Media table) marks a supplier cost that is a stand-in, not a real number. Flights and hotels are exact when the Amadeus offer / the offline cost is on the order (the Amadeus total, the hotel price, or the cost of our own inventory); otherwise estimated. A ticket's real cost is recorded by the site when the order is placed (LiveTickets, TixStock); for other suppliers the sync fills an estimate within hours, and until then the ticket's sale price stands in. To make an order exact open [Reservations](/reservations) → the booking → \"Edit Reservation\" → \"Actual supplier cost (USD)\" (and \"Cost note\") - the total you type replaces the computed cost of the whole order and the order no longer counts as estimated.",
        "\"N estimated\" (והנקודה הכתומה בטבלת Media) מסמן עלות ספק שהיא הערכה ולא מספר אמיתי. טיסות ומלונות מדויקים כשהצעת Amadeus / העלות של המלאי שלנו רשומה על ההזמנה (סכום Amadeus, מחיר המלון או עלות המלאי שלנו); אחרת הם הערכה. את העלות האמיתית של הכרטיס האתר רושם ברגע ההזמנה (LiveTickets, TixStock); אצל שאר הספקים הסנכרון ממלא הערכה בתוך שעות, ועד אז מחיר המכירה של הכרטיס מחליף אותה. כדי שהזמנה תהיה מדויקת פותחים [הזמנות](/reservations) ← ההזמנה ← \"Edit Reservation\" ← \"Actual supplier cost (USD)\" (ו-\"Cost note\") - הסכום שמקלידים מחליף את העלות המחושבת של כל ההזמנה וההזמנה כבר לא נספרת כמשוערת.",
      ),
      t(
        "The data syncs by itself every six hours - at 01:20, 07:20, 13:20 and 19:20 UTC (Meta and Google spend of the last 7 days, Instagram posts, estimated ticket costs, alerts) - so a number can be hours old. \"Sync now\" on the \"Settings\" tab runs it immediately (a few minutes) and lists every step with ✓ or ✗; a step the time limit did not reach shows ✗ \"skipped: budget\". A scheduled run that fails also mails the admin address. Spend is kept in shekels as the platform bills it - the ₪ view shows exactly that, the $ view converts at the rate of the sync (an order's money at the rate the customer paid at); when the day's rate cannot be fetched, no spend is written at all (the Meta / Google step shows ✗) and the next run fetches it - a guessed rate is never stored.",
        "הנתונים מתעדכנים לבד כל שש שעות - ב-01:20, 07:20, 13:20 ו-19:20 UTC (הוצאה של 7 הימים האחרונים ממטא וגוגל, פוסטים מאינסטגרם, הערכת עלויות כרטיסים, התראות) - ולכן מספר יכול להיות בן כמה שעות. \"Sync now\" בלשונית \"Settings\" מריץ אותו מיד (עד כמה דקות) ומציג כל שלב עם ✓ או ✗; שלב שמגבלת הזמן לא הגיעה אליו מוצג ✗ \"skipped: budget\". ריצה מתוזמנת שנכשלה שולחת גם מייל לכתובת המנהל. ההוצאה נשמרת בשקלים כפי שהפלטפורמה מחייבת - תצוגת ₪ מציגה בדיוק את זה, תצוגת $ ממירה לפי השער של הסנכרון (הכסף של הזמנה לפי השער שבו הלקוח שילם); כשאי אפשר להביא את השער של היום לא נכתבת הוצאה בכלל (שלב מטא / גוגל מוצג ✗) והריצה הבאה מביאה אותה - שער מנוחש לא נשמר אף פעם.",
      ),
      t(
        "Two alerts are mailed - once each, and again only if the condition cleared and came back - to the \"Alert emails\" addresses (empty = the system's admin address), and listed in \"Alerts\" under the same names the mail uses: \"Budget bleed\", a Mega Events campaign that spent more than the limit (default ₪1,500) over the last few days (default 3) with no booking credited to it; and \"Viral post\", an Instagram post of the last 7 days whose likes, comments, saves and shares beat the limit (default 200%) of the average of the 30 posts before it. Viral posts wear a \"Viral\" badge in \"Instagram\" whatever their age - only the alert is limited to the last 7 days. Four more come in pairs, over the last 14 days by default: \"Page with no sales\" (a page with 150+ sessions whose events sold nothing - an event page, a category, artist or team page) and \"Converting page\" (2+ Paid orders at 1.5%+ of its sessions); \"Influencer with no sales\" (30+ visitors, no Paid order) and \"Influencer selling\" (2+ Paid orders). Each names its change against the 14 days before. Only the top three of each are raised, and an open one stays open while it still qualifies.",
        "שתי התראות נשלחות במייל - פעם אחת כל אחת, ושוב רק אם התנאי חלף וחזר - לכתובות שב-\"Alert emails\" (ריק = כתובת המנהל של המערכת), ומופיעות ב-\"Alerts\" באותם שמות שבמייל: \"Budget bleed\", קמפיין של Mega Events שהוציא יותר מהסף (ברירת מחדל ₪1,500) בימים האחרונים (ברירת מחדל 3) בלי הזמנה שנזקפת לו; ו-\"Viral post\", פוסט באינסטגרם מ-7 הימים האחרונים שהלייקים, התגובות, השמירות והשיתופים שלו עוברים את הסף (ברירת מחדל 200%) מהממוצע של 30 הפוסטים שלפניו. פוסטים ויראליים נושאים תג \"Viral\" ב-\"Instagram\" בכל גיל - רק ההתראה מוגבלת ל-7 הימים האחרונים. עוד ארבע מגיעות בזוגות, על 14 הימים האחרונים כברירת מחדל: \"Page with no sales\" (דף עם 150+ סשנים שהאירועים שלו לא מכרו כלום - דף אירוע, קטגוריה, אמן או קבוצה) ו-\"Converting page\" (2+ הזמנות ששולמו ב-1.5%+ מהסשנים שלו); \"Influencer with no sales\" (30+ מבקרים, אף הזמנה ששולמה) ו-\"Influencer selling\" (2+ הזמנות ששולמו). כל אחת מציינת את השינוי מול 14 הימים שלפני. רק שלוש הראשונות מכל סוג עולות, והתראה פתוחה נשארת פתוחה כל עוד היא עדיין עומדת בתנאי.",
      ),
    ],
    rules: [
      t(
        "Numbers come from paid orders, never from pixels - revenue is what our Paid reservations paid and cost is what the suppliers charge. Meta's and Google's own purchase counts appear only for comparison (the \"Purchases (platform)\" column - purchase events of their pixel, by their own attribution window, so both may claim the same sale - with \"Platform revenue\" beside it) and can be far off; never decide on a platform's number alone.",
        "המספרים מהזמנות ששולמו, לא מפיקסלים - הכנסה היא מה שהזמנות ה-Paid שלנו שילמו ועלות היא מה שהספקים גובים. מספרי הרכישות של מטא וגוגל מופיעים רק להשוואה (העמודה \"Purchases (platform)\" - אירועי רכישה של הפיקסל שלהן, לפי חלון הייחוס שלהן, כך ששתיהן יכולות לטעון לאותה מכירה - ולידה \"Platform revenue\") ויכולים לסטות בהרבה; לא מחליטים לפי המספר של פלטפורמה לבד.",
      ),
      t(
        "The dashboard never writes to an ad account - it cannot pause a campaign, change a budget or edit an ad. To act on a number, do it in Meta Ads Manager or Google Ads.",
        "הדשבורד לא כותב לחשבונות הפרסום - הוא לא יכול להשהות קמפיין, לשנות תקציב או לערוך מודעה. כדי לפעול לפי מספר עושים זאת ב-Meta Ads Manager או ב-Google Ads.",
      ),
    ],
    links: [
      { label: t("Marketing dashboard", "דשבורד שיווק"), href: "/marketing" },
      { label: t("Reservations", "הזמנות"), href: "/reservations" },
    ],
  },
  {
    id: "creative-feed",
    nav: "/creative-generator",
    productType: "events",
    howTo: [
      {
        title: t("Make an ad image for an event", "יצירת תמונת מודעה לאירוע"),
        steps: [
          t("Open the [Creative Generator](/creative-generator) and click the picker under \"בחר אירוע - הכול יתמלא אוטומטית\" - search by name, city or date (future events only).", "פותחים את [מחולל הקריאייטיב](/creative-generator) ולוחצים על הבורר מתחת ל-\"בחר אירוע - הכול יתמלא אוטומטית\" - חיפוש לפי שם, עיר או תאריך (רק אירועים עתידיים)."),
          t("Pick the event - type, teams or artist, date, time, location, price and currency fill themselves (still editable). Read any amber ⚠ line: an unmatched team or artist switches Type to \"Regular photo (no matched logo)\".", "בוחרים את האירוע - סוג, קבוצות או אמן, תאריך, שעה, מיקום, מחיר ומטבע מתמלאים לבד (אפשר לערוך). קוראים כל שורה כתומה עם ⚠: קבוצה או אמן שלא זוהו מעבירים את ה-Type ל-\"Regular photo (no matched logo)\"."),
          t("Check \"Mode\" - it starts on \"Package (flight+hotel+ticket)\", switch to \"Ticket only\" for a ticket-only event.", "בודקים את \"Mode\" - הוא נפתח על \"Package (flight+hotel+ticket)\", באירוע כרטיס-בלבד מחליפים ל-\"Ticket only\"."),
          t("Optionally change \"פריסת טקסט\", \"רקע כרטיס\", \"צבע Blob\", \"צורת Blob\", or the \"זום תמונה\" / \"מיקום תמונה\" sliders (\"איפוס\" resets).", "אם רוצים משנים \"פריסת טקסט\", \"רקע כרטיס\", \"צבע Blob\", \"צורת Blob\", או את הסליידרים \"זום תמונה\" / \"מיקום תמונה\" (\"איפוס\" מאפס)."),
          t("Click \"צור תמונה\" and download both sizes: \"Download 1080×1350\" and \"Download 1200×628\".", "לוחצים \"צור תמונה\" ומורידים את שני הגדלים: \"Download 1080×1350\" ו-\"Download 1200×628\"."),
        ],
      },
      {
        title: t("Redo the ad Meta shows for an event", "חידוש המודעה שמטא מציגה לאירוע"),
        steps: [
          t("The generator's image is NOT sent to Meta. Meta's image comes from the creative run - fix what should change first (price, date, name, card image, or the team crest / artist cut-out) and save the event.", "התמונה מהמחולל לא נשלחת למטא. התמונה של מטא מגיעה מריצת הקריאייטיב - קודם מתקנים את מה שצריך להשתנות (מחיר, תאריך, שם, תמונת קארד, או סמל הקבוצה / cut-out של האמן) ושומרים את האירוע."),
          t("In [Events](/events), open the event and click \"העלה לפיד עכשיו\" (greyed while there are unsaved changes).", "ב[אירועים](/events) פותחים את האירוע ולוחצים \"העלה לפיד עכשיו\" (אפור כל עוד יש שינויים שלא נשמרו)."),
          t("\"נוצר קריאייטיב חדש\" = redrawn; \"הקריאייטיב כבר עדכני\" = nothing printed on it changed; \"לא נוצר קריאייטיב\" usually = no price to calculate. Meta reads the file hourly.", "\"נוצר קריאייטיב חדש\" = צויר מחדש; \"הקריאייטיב כבר עדכני\" = שום דבר שמודפס עליו לא השתנה; \"לא נוצר קריאייטיב\" בדרך כלל = אין מחיר לחשב. מטא קוראת את הקובץ כל שעה."),
        ],
      },
      {
        title: t("Build a match or artist creative by hand", "בניית קריאייטיב של משחק או אמן ידנית"),
        steps: [
          t("Leave the picker empty and choose \"Type\": \"Match (2 teams + VS)\" or \"Artist (single image)\".", "משאירים את הבורר ריק ובוחרים \"Type\": \"Match (2 teams + VS)\" או \"Artist (single image)\"."),
          t("Match: pick \"Home team\" and \"Away team\" (Hebrew or English). A team missing from the list has no logo yet - \"Manage logos\" → upload in [Assets](/assets).", "משחק: בוחרים \"Home team\" ו-\"Away team\" (עברית או אנגלית). קבוצה שלא ברשימה עוד אין לה לוגו - \"Manage logos\" ← מעלים ב-[Assets](/assets)."),
          t("Artist: \"Artist name\" and \"Artist image URL\"; untick \"Real cut-out (transparent PNG) - uncheck for a regular photo\" for an ordinary photo.", "אמן: \"Artist name\" ו-\"Artist image URL\"; לצילום רגיל מורידים את הסימון מ-\"Real cut-out (transparent PNG) - uncheck for a regular photo\"."),
          t("Fill \"Date\", \"Location\" and \"Price\" (\"צור תמונה\" needs a subject, a date and a price above 0), then \"צור תמונה\" and download.", "ממלאים \"Date\", \"Location\" ו-\"Price\" (\"צור תמונה\" צריך נושא, תאריך ומחיר מעל 0), ואז \"צור תמונה\" ומורידים."),
        ],
      },
      {
        title: t("Put it on the site card, or send files to a designer", "הצבה על כרטיס האתר, או קבצים למעצב"),
        steps: [
          t("With an event chosen, \"Set as event card image (overwrites current card)\" puts the square image on the site card - off by default, tick it only to really replace the card.", "כשנבחר אירוע, \"Set as event card image (overwrites current card)\" שם את התמונה המרובעת על כרטיס האתר - כבוי כברירת מחדל, מסמנים רק כשבאמת רוצים להחליף."),
          t("Under \"קבצי עזר למעצב\": \"צורת Blob שקופה (PNG)\" (the empty blob) and \"תבנית מלאה בלי תמונה\" (the template without the picture) - for events with no cut-out yet.", "תחת \"קבצי עזר למעצב\": \"צורת Blob שקופה (PNG)\" (הבלוב הריק) ו-\"תבנית מלאה בלי תמונה\" (התבנית בלי התמונה) - לאירועים שעוד אין להם cut-out."),
        ],
      },
    ],
    title: t("Creatives & the Meta feed", "קריאייטיבים והפיד למטא"),
    intro: t(
      "Every feed event needs a campaign creative - the ad image Meta shows. Most are generated automatically; the gaps radar catches the rest.",
      "כל אירוע בפיד צריך קריאייטיב — תמונת המודעה שמטא מציגה. רובם נוצרים אוטומטית; רדאר החוסרים תופס את השאר.",
    ),
    flow: {
      title: t("Creative → feed pipeline", "צינור קריאייטיב → פיד"),
      steps: [
        {
          label: t("Creative cron (every hour)", "cron קריאייטיבים (כל שעה)"),
          sub: t("new events first, then the longest-waiting picture; skips priceless events", "קודם אירועים חדשים, אחר כך התמונה שמחכה הכי הרבה; מדלג על אירועים בלי מחיר"),
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
        "An event reaches Meta only once it has a creative. The creative cron now makes the missing ones FIRST (new events), then re-renders the ones whose price or date moved - soonest first. Before 29.09 it went by date alone, spent every run re-rendering near events whose price had moved, and new events dated far out never got a creative.",
        "אירוע מגיע למטא רק אחרי שיש לו קריאייטיב. ה-cron של הקריאייטיבים מייצר עכשיו קודם את החסרים (אירועים חדשים), ורק אחר כך מרנדר מחדש את אלה שהמחיר או התאריך שלהם זזו - הקרובים קודם. עד 29.09 הוא עבר רק לפי תאריך, בזבז כל הרצה על רינדור מחדש של אירועים קרובים שהמחיר שלהם זז, ואירועים חדשים רחוקים לא קיבלו קריאייטיב.",
      ),
      t(
        "One event, now: \"העלה לפיד עכשיו\" at the top of the event editor makes that event's creative and republishes the feed file (not the whole sync-everything pipeline), then says whether the event is in the feed and, if not, why (sold out, less than 3 days out, test event, no price). Save the event first. Meta reads the file hourly. It redraws only when something the creative prints changed; to force a redraw of a fixed picture - or several events at once - use \"אירועים ספציפיים לפיד\" on [Meta Product Feed](/meta-feed).",
        "אירוע אחד, עכשיו: \"העלה לפיד עכשיו\" בראש עורך האירוע מייצר את הקריאייטיב של האירוע ומפרסם מחדש את קובץ הפיד (בלי כל תהליך הסנכרון המלא), ואומר אם האירוע בפיד ואם לא - למה (אזל, פחות מ-3 ימים לאירוע, אירוע בדיקה, אין מחיר). קודם שומרים את האירוע. מטא קוראת את הקובץ כל שעה. הוא מצייר מחדש רק כשמשהו שמודפס על הקריאייטיב השתנה; כדי לכפות ציור מחדש של תמונה שתוקנה - או כמה אירועים בבת אחת - משתמשים ב\"אירועים ספציפיים לפיד\" ב[פיד מטא](/meta-feed).",
      ),
      t(
        "A missing crest or artist cut-out makes a weaker ad: one team instead of team vs team, the artist in a small circle, or no picture at all. Upload it once - a crest to the logo library (Assets), a cut-out to the artist card (Templates → Artists) - and every event of that team or artist is redrawn on the next creative run, no per-event step. Main's /product-feed lists what is missing.",
        "סמל קבוצה או cut-out של אמן שחסרים מייצרים מודעה חלשה: קבוצה אחת במקום קבוצה נגד קבוצה, האמן בעיגול קטן, או בלי תמונה בכלל. מעלים פעם אחת - סמל לספריית הסמלים (Assets), cut-out לכרטיס האמן (תבניות ← אמנים) - וכל האירועים של אותה קבוצה או אמן מצוירים מחדש בהרצת הקריאייטיב הבאה, בלי צעד לכל אירוע.",
      ),
      t(
        "The Creative Generator makes an image by hand for downloads, a designer or the site card - it does NOT feed Meta; only the creative run or \"העלה לפיד עכשיו\" does.",
        "מחולל הקריאייטיב מייצר תמונה ידנית להורדה, למעצב או לכרטיס האתר - הוא לא מזין את מטא; רק ריצת הקריאייטיב או \"העלה לפיד עכשיו\" עושים את זה.",
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
    nav: "/event-tags",
    productType: "events",
    howTo: [
      {
        title: t("Create a tag", "יצירת תגית"),
        steps: [
          t("Open [Tags & Rules](/event-tags) on \"תגיות (Tags)\" and search \"חיפוש תגית (שם, אנגלית או slug)\" first - no duplicates.", "פותחים את [תגיות וחוקים](/event-tags) בלשונית \"תגיות (Tags)\" ומחפשים קודם ב\"חיפוש תגית (שם, אנגלית או slug)\" - בלי כפילויות."),
          t("Type the Hebrew name in \"New tag name (Hebrew)\" and the English one in \"English name (→ feed slug)\" (required - it becomes the slug, e.g. premier-league).", "מקלידים את השם בעברית ב\"New tag name (Hebrew)\" ובאנגלית ב\"English name (→ feed slug)\" (חובה - הוא הופך ל-slug, למשל premier-league)."),
          t("Pick the type (ליגה, קבוצה, אמן, ז'אנר, עיר, ורטיקל, אחר) and click \"Add\". Any tag picker (event editor, category form) can also create one: type it → \"Create \"…\"\".", "בוחרים סוג (ליגה, קבוצה, אמן, ז'אנר, עיר, ורטיקל, אחר) ולוחצים \"Add\". גם כל בורר תגיות (עורך האירוע, טופס הקטגוריה) יכול ליצור: מקלידים ← \"Create \"…\"\"."),
          t("New artists and teams get their tag automatically when created in [Templates](/templates).", "אמנים וקבוצות חדשים מקבלים תגית אוטומטית כשיוצרים אותם ב[תבניות](/templates)."),
        ],
      },
      {
        title: t("Tag events", "תיוג אירועים"),
        steps: [
          t("One event: open it from [Events](/events), pick tags in \"Tags (feed / promo)\" in \"Basic Information\", save. \"קטגוריות (נגזר מהתגיות)\" shows its categories now.", "אירוע אחד: פותחים מ[אירועים](/events), בוחרים תגיות ב-\"Tags (feed / promo)\" בכרטיס \"Basic Information\" ושומרים. \"קטגוריות (נגזר מהתגיות)\" מראה את הקטגוריות שלו עכשיו."),
          t("Many events: in [Events](/events) tick rows → \"Tags (feed)\" → pick tags → \"Add\" or \"Remove\" → \"Apply\". Careful: \"Replace\" first removes ALL other tags from those events.", "הרבה אירועים: ב[אירועים](/events) מסמנים שורות ← \"Tags (feed)\" ← בוחרים תגיות ← \"Add\" או \"Remove\" ← \"Apply\". זהירות: \"Replace\" קודם מוחק את כל שאר התגיות מהאירועים האלה."),
          t("From the tag's side: \"Events\" on a tag → search \"חיפוש אירוע להוספה\" → \"חפש\" → \"הוסף\" (\"הסר\" takes one off).", "מצד התגית: \"Events\" על תגית ← חיפוש ב\"חיפוש אירוע להוספה\" ← \"חפש\" ← \"הוסף\" (\"הסר\" מוריד)."),
        ],
      },
      {
        title: t("Auto-tag events with a rule", "תיוג אוטומטי עם כלל"),
        steps: [
          t("Open the [Rules tab](/event-tags?tab=rules), pick the \"Tag\", then \"Event name contains\" or \"City IATA equals\".", "פותחים את [לשונית הכללים](/event-tags?tab=rules), בוחרים \"Tag\", ואז \"Event name contains\" או \"City IATA equals\"."),
          t("Type the pattern (a word from the Hebrew or English name - Arsenal, any case - or an IATA like LON) → \"Add rule\".", "מקלידים את הדפוס (מילה מהשם בעברית או באנגלית - Arsenal, בלי חשיבות לאותיות - או IATA כמו LON) ← \"Add rule\"."),
          t("New events are tagged on creation; for existing ones click \"Run rules on all events\" (the toast counts the links added). Rules only add, never remove; a league/team tag also adds the football vertical, an artist/genre tag adds music.", "אירועים חדשים מתויגים ביצירה; לקיימים לוחצים \"Run rules on all events\" (ההודעה סופרת קישורים שנוספו). כללים רק מוסיפים, לא מוחקים; תגית ליגה/קבוצה מוסיפה גם ורטיקל כדורגל, תגית אמן/ז'אנר מוסיפה מוזיקה."),
          t("Pause a rule with its switch or \"Delete\" it - tags it already added stay.", "משהים כלל במתג או \"Delete\" - תגיות שכבר הוסיף נשארות."),
        ],
      },
      {
        title: t("Edit or delete a tag", "עריכה או מחיקה של תגית"),
        steps: [
          t("\"Edit\" on the tag → fix \"Name\", \"Name (English - used for the URL slug)\", \"Type\" or \"Active\" → \"Save\". Changing the English name doesn't change an existing slug.", "\"Edit\" על התגית ← מתקנים \"Name\", \"Name (English - used for the URL slug)\", \"Type\" או \"Active\" ← \"Save\". שינוי השם באנגלית לא משנה slug קיים."),
          t("\"Delete\" removes the tag from every event AND every category it composes (the confirm shows how many events). Several: tick them (or \"Select all\") → \"Delete selected (N)\".", "\"Delete\" מוריד את התגית מכל אירוע וגם מכל קטגוריה שהיא מרכיבה (האישור מראה על כמה אירועים). כמה: מסמנים (או \"Select all\") ← \"Delete selected (N)\"."),
        ],
      },
    ],
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
      { label: t("Tag rules", "חוקי תיוג"), href: "/event-tags?tab=rules" },
      { label: t("Categories", "קטגוריות"), href: "/templates/categories" },
    ],
  },
  {
    id: "categories",
    nav: "/templates/categories",
    productType: "events",
    title: t("Categories - the /c/ pages", "קטגוריות - עמודי ה-/c/"),
    intro: t(
      "Categories are the site's /c/ pages and the category tiles. Each one is a node in a tree and collects events through its tags - you never put an event into a category directly.",
      "קטגוריות הן עמודי ה-/c/ באתר ואריחי הקטגוריות. כל קטגוריה היא צומת בעץ ואוספת אירועים דרך התגיות שלה - אף פעם לא מכניסים אירוע לקטגוריה ישירות.",
    ),
    howTo: [
      {
        title: t("Create a category and place it in the tree", "יצירת קטגוריה ומיקום שלה בעץ"),
        steps: [
          t("Open [Categories](/templates/categories) - a tree, sub-categories indented under their parent.", "פותחים את [הקטגוריות](/templates/categories) - עץ, תתי-קטגוריות מוזחות מתחת לאב."),
          t("Under an existing one: the + (\"Add sub-category\") on the parent's row. Top level: [\"Add New Category\"](/templates/categories/new).", "מתחת לקיימת: ה-+ (\"Add sub-category\") בשורת האב. ברמה העליונה: [\"Add New Category\"](/templates/categories/new)."),
          t("\"Name (Hebrew)\", \"Name (English, optional)\"; an empty \"Slug (optional)\" is built from the English name. \"קטגוריית אב\" sets the address /c/<parent>/<slug> (\"- ראשית -\" = top level); a lower \"Display order\" shows first.", "\"Name (Hebrew)\", \"Name (English, optional)\"; \"Slug (optional)\" ריק נבנה מהשם באנגלית. \"קטגוריית אב\" קובעת את הכתובת /c/<אב>/<slug> (\"- ראשית -\" = רמה עליונה); \"Display order\" נמוך יותר מוצג ראשון."),
          t("Add its tags (next recipe) and click \"Create Category\". Page content and featured events come afterwards, on the edit screen.", "מוסיפים תגיות (המתכון הבא) ולוחצים \"Create Category\". תוכן העמוד והאירועים הבולטים מתווספים אחר כך, במסך העריכה."),
        ],
      },
      {
        title: t("Give a category its tags", "הגדרת התגיות של קטגוריה"),
        steps: [
          t("In \"תגיות שמרכיבות את הקטגוריה\" pick the tags - every event carrying ONE of them joins automatically. Missing tag? Type it → \"Create \"…\"\".", "ב\"תגיות שמרכיבות את הקטגוריה\" בוחרים תגיות - כל אירוע שיש לו אחת מהן נכנס אוטומטית. חסרה תגית? מקלידים ← \"Create \"…\"\"."),
          t("A hub that only shows child tiles (leagues, destinations) can stay tagless - the amber warning is fine there.", "צומת-אב שמציג רק אריחי ילדים (ליגות, יעדים) יכול להישאר בלי תגיות - האזהרה הכתומה בסדר שם."),
          t("Save. To check an event, open it in [Events](/events) - \"קטגוריות (נגזר מהתגיות)\" lists its categories.", "שומרים. לבדיקת אירוע פותחים אותו ב[אירועים](/events) - \"קטגוריות (נגזר מהתגיות)\" מציג את הקטגוריות שלו."),
        ],
      },
      {
        title: t("Switch a category live or hide it", "העלאה לאוויר או הסתרה של קטגוריה"),
        steps: [
          t("\"פעיל באתר\" turns on both the homepage tile and the /c/ page - ticked by default on a new category, so untick it before \"Create Category\" if the page isn't ready.", "\"פעיל באתר\" מדליק גם את האריח בדף הבית וגם את עמוד ה-/c/ - מסומן כברירת מחדל בקטגוריה חדשה, אז מורידים לפני \"Create Category\" אם העמוד לא מוכן."),
          t("To hide a live one: open it, untick \"פעיל באתר\", \"Save Changes\" (the Status column shows \"Active\" / \"Hidden\").", "להסתרת קטגוריה חיה: פותחים, מורידים את \"פעיל באתר\", \"Save Changes\" (עמודת Status מציגה \"Active\" / \"Hidden\")."),
          t("Category saves don't refresh the site - click \"Revalidate live site\" at the top of the list to show the change now. A category can be deleted (trash) only after its sub-categories are moved or deleted.", "שמירת קטגוריה לא מרעננת את האתר - לוחצים \"Revalidate live site\" בראש הרשימה כדי להציג עכשיו. אפשר למחוק קטגוריה (פח) רק אחרי שמעבירים או מוחקים את תתי-הקטגוריות שלה."),
        ],
      },
      {
        title: t("Page content, images and featured events", "תוכן עמוד, תמונות ואירועים בולטים"),
        steps: [
          t("Open the category with its pencil. \"Banner image\": upload, paste a URL, or browse storage (folder icon). \"Card art - cut-out + blob (optional)\": \"Upload + cut out\" removes the background, then blob colour, background and zoom.", "פותחים בעיפרון. \"Banner image\": העלאה, URL, או דפדוף באחסון (אייקון התיקייה). \"Card art - cut-out + blob (optional)\": \"Upload + cut out\" מסיר רקע, ואז צבע בלוב, רקע וזום."),
          t("Expand \"תוכן עמוד הקטגוריה\": \"פתיח על הקאבר\", \"כותרת הטקסט השיווקי\", \"טקסט שיווקי / SEO\", \"גלריית תמונות\", \"תמונות רקע לטייל (מתחלפות)\", stadiums, fact cards, FAQ - anything empty isn't shown. Team categories also have \"עמוד קבוצה\".", "פותחים את \"תוכן עמוד הקטגוריה\": \"פתיח על הקאבר\", \"כותרת הטקסט השיווקי\", \"טקסט שיווקי / SEO\", \"גלריית תמונות\", \"תמונות רקע לטייל (מתחלפות)\", אצטדיונים, כרטיסי מידע, שאלות נפוצות - מה שריק לא מוצג. לקטגוריות קבוצה יש גם \"עמוד קבוצה\"."),
          t("Hand-picked events: \"אירועים בולטים וחבילות מומלצות (אוצרות ידנית)\" → search \"חיפוש אירוע להוספה…\" under \"בולטים\" (arrow order = site order); \"חבילות מומלצות\" works the same on the vertical pages. An empty list fills itself.", "אירועים בבחירה ידנית: \"אירועים בולטים וחבילות מומלצות (אוצרות ידנית)\" ← חיפוש ב\"חיפוש אירוע להוספה…\" תחת \"בולטים\" (סדר החצים = הסדר באתר); \"חבילות מומלצות\" עובד אותו דבר בעמודי הוורטיקל. רשימה ריקה מתמלאת לבד."),
          t("\"Save Changes\", then \"Revalidate live site\".", "\"Save Changes\" ואז \"Revalidate live site\"."),
        ],
      },
    ],
    links: [
      { label: t("Categories", "קטגוריות"), href: "/templates/categories" },
      { label: t("New category", "קטגוריה חדשה"), href: "/templates/categories/new" },
    ],
  },
  {
    id: "homepage",
    nav: "/homepage",
    productType: "events",
    howTo: [
      {
        title: t("Reorder or hide a section", "שינוי סדר או הסתרה של סקשן"),
        steps: [
          t("Open [Homepage](/homepage) - each box is one section of the site's homepage, in site order.", "פותחים את [עמוד הבית](/homepage) - כל קופסה היא סקשן אחד בדף הבית של האתר, לפי הסדר באתר."),
          t("Drag a section by its header or use its up/down arrows (the hero is locked first). The eye toggle hides a section (\"hidden\" badge).", "גוררים סקשן מהכותרת או משתמשים בחצים (ההירו נעול ראשון). מתג העין מסתיר סקשן (תג \"hidden\")."),
          t("Click \"Save homepage\" in the bottom bar (\"Discard\" throws away everything since the last save). Allow a minute, then check \"Open live site\".", "לוחצים \"Save homepage\" בסרגל התחתון (\"Discard\" מבטל הכול מאז השמירה האחרונה). מחכים דקה ובודקים ב-\"Open live site\"."),
        ],
      },
      {
        title: t("Move a card inside a carousel", "הזזת כרטיס בתוך קרוסלה"),
        steps: [
          t("Every row shows exactly what the site shows, numbered in site order - the cards the site picks by itself too.", "כל שורה מציגה בדיוק את מה שהאתר מציג, ממוספר לפי הסדר באתר - כולל הכרטיסים שהאתר בוחר לבד."),
          t("Drag a card by its picture to any place (works with a mouse, a finger, or the keyboard: Tab to the picture, Space, arrows, Space). Or use the arrows under it, or click its number and type the new place + Enter.", "גוררים כרטיס מהתמונה שלו לכל מקום (עובד בעכבר, באצבע, או במקלדת: Tab לתמונה, רווח, חצים, רווח). או החצים שמתחתיו, או לחיצה על המספר שלו, הקלדת המקום החדש ו-Enter."),
          t("A card you moved is pinned (green number with a pin) and stays in that place; the site fills every other place by its rule, so new events still come in by themselves. The pin-off icon releases it back to the rule.", "כרטיס שהוזז ננעץ (מספר ירוק עם נעץ) ונשאר במקום הזה; את שאר המקומות האתר ממלא לפי החוק שלו, כך שאירועים חדשים עדיין נכנסים לבד. אייקון הנעץ המבוטל משחרר אותו בחזרה לחוק."),
          t("The eye-off icon hides a card from this row only (chips under the row bring it back). \"הוסף\" searches any event, artist, team or review and puts it at the place you type. \"כמה להציג\" sets the row's length (empty = the default).", "אייקון העין המבוטלת מסתיר כרטיס מהשורה הזו בלבד (צ'יפים מתחת לשורה מחזירים). \"הוסף\" מחפש כל אירוע, אמן, קבוצה או ביקורת ומכניס במקום שמקלידים. \"כמה להציג\" קובע את אורך השורה (ריק = ברירת המחדל)."),
          t("Click \"Save homepage\" - rows you changed carry a \"changed\" tag until then.", "לוחצים \"Save homepage\" - עד אז שורות שהשתנו מסומנות \"changed\"."),
        ],
      },
      {
        title: t("Add a block between sections", "הוספת בלוק בין סקשנים"),
        steps: [
          t("Click the thin \"+ Add block\" line where it should go, pick a type, and type a heading (or leave it empty).", "לוחצים על השורה הדקה \"+ Add block\" במקום הרצוי, בוחרים סוג ומקלידים כותרת (או משאירים ריק)."),
          t("\"סליידר אירועים\": add events with \"הוסף\" and/or pick a category under it - the category's events fill the row around yours (with neither, the block is not shown).", "\"סליידר אירועים\": מוסיפים אירועים עם \"הוסף\" ו/או בוחרים קטגוריה מתחת - האירועים שלה ממלאים את השורה סביב שלכם (בלי אף אחד מהם הבלוק לא מוצג)."),
          t("\"באנרים\": upload each \"Banner image\" (it must be uploaded here, not a pasted outside URL), optional \"קישור (לא חובה)\" (/c/... or https://...) and \"כותרת על התמונה (לא חובה)\"; \"באנר נוסף\" up to 3.", "\"באנרים\": מעלים כל \"Banner image\" (חייב לעלות כאן, לא URL חיצוני), \"קישור (לא חובה)\" (/c/... או https://...) ו\"כותרת על התמונה (לא חובה)\"; \"באנר נוסף\" עד 3."),
          t("\"טקסט\": plain paragraphs with a blank line between - no HTML or links. \"סליידר יעדים\": \"+ קטגוריה\" and/or \"כל הילדים של: …\". \"גלריית תמונות\": up to 12 uploaded images (\"תמונה נוספת\"), each with an optional caption.", "\"טקסט\": פסקאות פשוטות עם שורה ריקה ביניהן - בלי HTML וקישורים. \"סליידר יעדים\": \"+ קטגוריה\" ו/או \"כל הילדים של: …\". \"גלריית תמונות\": עד 12 תמונות שמועלות כאן (\"תמונה נוספת\"), לכל אחת תיאור לא חובה."),
          t("Click \"Save homepage\". To delete a block later: its trash icon, then save again.", "לוחצים \"Save homepage\". למחיקת בלוק בהמשך: הפח שלו ושמירה נוספת."),
        ],
      },
      {
        title: t("Open or close the Euro Trip on the site", "הפעלה וכיבוי של היורו טריפ באתר"),
        steps: [
          t("Find the \"יורו טריפ\" row on [Homepage](/homepage) - it starts hidden.", "מוצאים את השורה \"יורו טריפ\" ב[עמוד הבית](/homepage) - היא מתחילה מוסתרת."),
          t("Turn its eye toggle on: the homepage gets a way into the Euro Trip and the site's Euro Trip pages open. Hidden = those pages do not exist on the site. Only an admin can flip it.", "מדליקים את מתג העין שלה: דף הבית מקבל כניסה ליורו טריפ ועמודי היורו טריפ באתר נפתחים. מוסתרת = העמודים האלה לא קיימים באתר. רק מנהל יכול להדליק או לכבות."),
          t("Click \"Save homepage\". Only the trips marked \"פעיל\" in [Trips](/events/trips) show there.", "לוחצים \"Save homepage\". באתר מוצגים רק הטריפים שמסומנים \"פעיל\" ב[טריפים](/events/trips)."),
        ],
      },
      {
        title: t("Rename a section", "שינוי כותרת של סקשן"),
        steps: [
          t("Click the pencil next to the section's title (the hero has no heading, so no pencil).", "לוחצים על העיפרון ליד כותרת הסקשן (להירו אין כותרת ולכן אין עיפרון)."),
          t("Type the heading the site should show and press Enter - the section gets a \"renamed\" badge. Clear the field to bring back the default.", "מקלידים את הכותרת שהאתר יציג ולוחצים Enter - הסקשן מקבל תג \"renamed\". מרוקנים את השדה כדי להחזיר את ברירת המחדל."),
          t("Click \"Save homepage\".", "לוחצים \"Save homepage\"."),
        ],
      },
    ],
    title: t("Homepage layout", "עמוד הבית"),
    intro: t(
      "A dummy of the customer site's homepage that shows every carousel exactly as the site does - the cards the site picks by itself included, read from the site itself. Sections are dragged into order or hidden; inside every carousel any card can be moved to any place and stays there, while the site keeps filling the other places by its rule.",
      "עמוד דמה של דף הבית באתר שמציג כל קרוסלה בדיוק כמו באתר - כולל הכרטיסים שהאתר בוחר לבד, כפי שהאתר עצמו מחשב אותם. גוררים סקשנים לסדר או מסתירים; בתוך כל קרוסלה אפשר להזיז כל כרטיס לכל מקום והוא נשאר שם, והאתר ממשיך למלא את שאר המקומות לפי החוק שלו.",
    ),
    points: [
      t(
        "Pinned = stays in its place. Every card you move, add or pin keeps the place it shows at; all other places follow the row's automatic rule. A pinned card that cannot show (sold out, or an artist/team with nothing on sale) is listed under the row as 'not in place' - the cards after it move up one; click its chip to release it.",
        "נעוץ = נשאר במקום שלו. כל כרטיס שמזיזים, מוסיפים או נועצים שומר על המקום שבו הוא מוצג; כל שאר המקומות לפי החוק האוטומטי של השורה. נעוץ שלא יכול להופיע (אזל, או אמן/קבוצה בלי אירוע זמין) מופיע מתחת לשורה כ'לא במקומם' - הכרטיסים שאחריו עולים מקום אחד; לחיצה על הצ'יפ משחררת אותו.",
      ),
      t(
        "Hero ring - always first. Every artist/team with an available event, artist-team alternating; pinned ones keep their place.",
        "הירו - תמיד ראשון. כל אמן/קבוצה עם אירוע זמין, אמן-קבוצה לסירוגין; נעוצים שומרים על המקום שלהם.",
      ),
      t(
        "Most wanted - one row of 12 unless you set another length: events marked Prioritized, then auto-fill (never VIP, never plain sports events). On a card, the crossed star drops the event's Prioritized flag at once (not part of Save).",
        "המבוקשים ביותר — שורה אחת של 12 אם לא נקבע אחרת: אירועים מסומנים Prioritized, ואז השלמה אוטומטית (לא VIP, לא אירועי ספורט רגילים). בכרטיס, הכוכב המבוטל מוריד את סימון ה-Prioritized מיד (לא חלק מ-Save).",
      ),
      t(
        "Newest - one row of 12 unless you set another length: the most recently created events, skipping what Most wanted shows. The add search lists the newest uploads first.",
        "החדשים ביותר — שורה אחת של 12 אם לא נקבע אחרת: האירועים שנוצרו לאחרונה, בלי מה שהמבוקשים מציגים. החיפוש של 'הוסף' מציג את ההעלאות האחרונות ראשונות.",
      ),
      t(
        "One card per artist / home team - a row shows one date of an artist (the site's 'see all dates' strip leads to the rest), and an artist Most wanted shows does not come back in Newest under another date.",
        "כרטיס אחד לאמן / לקבוצת בית - שורה מציגה תאריך אחד של אמן (פס 'לכל התאריכים' באתר מוביל לשאר), ואמן שמופיע במבוקשים לא חוזר בחדשים בתאריך אחר.",
      ),
      t(
        "Hide from a row - the crossed eye on a card takes it out of that row only (it stays everywhere else on the site); hidden cards wait as chips under the row, click to bring one back. Pinning a hidden card brings it back too.",
        "הסתרה משורה — העין המבוטלת בכרטיס מוציאה אותו מהשורה הזו בלבד (הוא נשאר בכל מקום אחר באתר); כרטיסים מוסתרים מחכים כצ'יפים מתחת לשורה, לחיצה מחזירה. גם נעיצה של כרטיס מוסתר מחזירה אותו.",
      ),
      t(
        "Football / Artists rows - every active team/artist, those with an available event first, by name. Only a team/artist with an available event can hold a pinned place.",
        "שורות כדורגל / אמנים — כל קבוצה/אמן פעילים, מי שיש לו אירוע זמין קודם, לפי שם. רק קבוצה/אמן עם אירוע זמין יכולים להחזיק מקום נעוץ.",
      ),
      t(
        "More events (the grid) and Customer reviews have the same control - move, pin, hide, length. More events shows its first 5 on a phone and 20 on a computer before 'show more'.",
        "אירועים נוספים (הגריד) ולקוחות משתפים מקבלים את אותה שליטה - הזזה, נעיצה, הסתרה, אורך. אירועים נוספים מציג 5 ראשונים בטלפון ו-20 במחשב לפני 'הצג עוד'.",
      ),
      t(
        "If the board cannot read the site, a red line says so and the rows show only their pinned cards - editing and saving still work.",
        "אם הלוח לא מצליח לקרוא את האתר, פס אדום אומר זאת והשורות מציגות רק את הנעוצים - עריכה ושמירה עדיין עובדות.",
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
    nav: "/tasks",
    productType: "events",
    howTo: [
      {
        title: t("Create a task and assign it", "ליצור משימה ולשבץ אותה"),
        steps: [
          t("Open [Tasks](/tasks) and click \"New task\".", "פותחים את [המשימות](/tasks) ולוחצים \"New task\"."),
          t("Fill in \"Title\" (required) and, if useful, \"Description\", \"Priority\" and \"Due date\".", "ממלאים \"Title\" (חובה) ולפי הצורך \"Description\", \"Priority\" ו-\"Due date\"."),
          t("Pick the \"Board\": פיתוח, שיווק, תפעול or תמחור. Dev adds a \"Phase\" field; Marketing adds \"Channel\" and \"Progress\". If a board pill is selected above the tabs, the form opens on that board - you can still change it.", "בוחרים \"Board\": פיתוח, שיווק, תפעול או תמחור. פיתוח מוסיף שדה \"Phase\"; שיווק מוסיף \"Channel\" ו-\"Progress\". אם נבחר תג לוח מעל הלשוניות, הטופס נפתח כבר על הלוח הזה - ואפשר לשנות."),
          t("Choose a person in \"Assign to\" - they get an email. Everyone can assign a new task to anyone; for an editor the form starts on themselves. Later an editor can hand on a task assigned to them or one they opened (admins: any task).", "בוחרים אדם ב-\"Assign to\" - הוא מקבל מייל. כל אחד יכול לשייך משימה חדשה לכל אחד; אצל עורך הטופס נפתח עליו עצמו. אחר כך עורך יכול להעביר הלאה משימה שמשויכת אליו או שהוא פתח (מנהלים: כל משימה)."),
          t("Files: \"Attach file\" adds up to 5 images or PDFs (2.5MB each), or paste a screenshot with Ctrl+V. They appear as the first comment in the task's thread.", "קבצים: \"Attach file\" מוסיף עד 5 תמונות או קובצי PDF (עד 2.5MB כל אחד), או מדביקים צילום מסך עם Ctrl+V. הם מופיעים כתגובה הראשונה בפתיל המשימה."),
          t("Splitting it right away: in \"תתי-משימות\" type each part, pick its owner and click \"הוסף\". Every part is created as its own task under the new one.", "לחלק כבר עכשיו: ב-\"תתי-משימות\" מקלידים כל חלק, בוחרים אחראי ולוחצים \"הוסף\". כל חלק נוצר כמשימה משלו מתחת למשימה החדשה."),
          t("Click \"Create task\". The toast tells you whether the email to the assignee actually went out.", "לוחצים \"Create task\". ההודעה הקופצת אומרת אם המייל למשובץ באמת יצא."),
          t("Shortcut: in [Roadmap](/tasks?tab=roadmap) or [Marketing](/tasks?tab=marketing), the + next to a phase or channel opens the form with that phase or channel already set.", "קיצור דרך: ב-[Roadmap](/tasks?tab=roadmap) או ב-[Marketing](/tasks?tab=marketing), ה-+ ליד שלב או ערוץ פותח את הטופס כשהשלב או הערוץ כבר מוגדרים."),
        ],
      },
      {
        title: t("Find your work and move it along", "למצוא את העבודה שלכם ולקדם אותה"),
        steps: [
          t("The pills above the tabs (\"הכל\", \"פיתוח\", \"שיווק\", \"תפעול\", \"תמחור\") narrow both the table and the Kanban to one board, e.g. [the Pricing board](/tasks?board=pricing). The number on each pill counts OPEN tasks only.", "התגים מעל הלשוניות (\"הכל\", \"פיתוח\", \"שיווק\", \"תפעול\", \"תמחור\") מצמצמים גם את הטבלה וגם את הקאנבן ללוח אחד, למשל [לוח התמחור](/tasks?board=pricing). המספר על כל תג סופר משימות פתוחות בלבד."),
          t("The owner menu next to the search picks whose tasks you see: \"כל המשימות\", \"המשימות שלי\" (the default for editors) or \"ששייכתי לאחרים\" - tasks you handed to someone else. Admins also get \"לפי משתמש\": one person's tasks, or \"ללא שיוך\". Each line shows its open count.", "תפריט הבעלים ליד החיפוש קובע של מי המשימות שרואים: \"כל המשימות\", \"המשימות שלי\" (ברירת המחדל לעורכים) או \"ששייכתי לאחרים\" - משימות שהעברתם למישהו אחר. למנהלים יש גם \"לפי משתמש\": המשימות של אדם אחד, או \"ללא שיוך\". בכל שורה מופיע מספר הפתוחות."),
          t("Pick \"Open\", \"In review\", \"Done\" or \"All\", and use \"Search tasks...\" to find a task by its title. \"Open\" is the work still to do; a task set to \"In review\" leaves it and waits under \"In review\" - the ones waiting for YOUR check are at the top, tagged \"לבדיקה שלך\".", "בוחרים \"Open\", \"In review\", \"Done\" או \"All\", ומחפשים משימה לפי כותרת ב-\"Search tasks...\". \"Open\" היא העבודה שעוד צריך לעשות; משימה שעוברת ל-\"In review\" יורדת משם ומחכה תחת \"In review\" - אלה שמחכות לבדיקה שלכם למעלה, עם תג \"לבדיקה שלך\"."),
          t("Change the row's \"Status\": \"To do\", \"In progress\", \"Paused\", \"In review\", \"Done\", \"Cancelled\". Editors can change it only on their own tasks - and on a task waiting for their review.", "משנים את ה-\"Status\" בשורה: \"To do\", \"In progress\", \"Paused\", \"In review\", \"Done\", \"Cancelled\". עורכים יכולים לשנות רק במשימות שלהם - ובמשימה שמחכה לבדיקה שלהם."),
          t("Finished your side? Set the status to \"In review\". Whoever opened the task gets an email, and it shows up under their \"המשימות שלי\" with a \"לבדיקה שלך\" tag (and in their dashboard \"My tasks\"). The task stays assigned to you.", "סיימתם את הצד שלכם? מעבירים את הסטטוס ל-\"In review\". מי שפתח את המשימה מקבל מייל, והיא מופיעה אצלו ב-\"המשימות שלי\" עם תג \"לבדיקה שלך\" (וגם ב-\"My tasks\" בדשבורד). המשימה נשארת משובצת אליכם."),
          t("Reviewing: \"Done\" approves it, \"In progress\" sends it back to work - write what is missing in the thread. The assignee gets an email either way.", "בודקים: \"Done\" מאשר, \"In progress\" מחזיר לעבודה - כותבים בפתיל מה חסר. המשובץ מקבל מייל בשני המקרים."),
          t("Someone else should review it? In the task form, \"Reviewers\" picks who the task goes back to instead of (or as well as) the person who opened it - e.g. Alon opened it, but Tom checks it, or both. Every reviewer gets the email and sees it under their tasks. Anyone can set this when creating a task; on an existing task, admins.", "מישהו אחר צריך לבדוק? בטופס המשימה, \"Reviewers\" קובע למי המשימה חוזרת במקום (או בנוסף ל)מי שפתח אותה - למשל אלון פתח, אבל תום בודק, או שניהם. כל בודק מקבל את המייל ורואה אותה במשימות שלו. ביצירת משימה כל אחד יכול לקבוע את זה; במשימה קיימת - מנהלים."),
          t("A \"Do: …\" link under the title jumps to the exact control that fixes the problem. \"באתר\" opens the page on the site.", "קישור \"Do: …\" מתחת לכותרת קופץ לפקד המדויק שמתקן את הבעיה. \"באתר\" פותח את העמוד באתר."),
          t("No answer? The bell at the end of the row (and \"תזכורת\" at the top of the task form) emails a reminder to whoever holds the next move - the assignee, or the reviewers of a task \"In review\". It asks once, can be sent once an hour, and is written in the thread. It shows for whoever opened, assigned, holds or reviews the task, and for admins.", "אין תשובה? הפעמון בסוף השורה (ו-\"תזכורת\" בראש טופס המשימה) שולח מייל תזכורת למי שהצעד הבא אצלו - המשובץ, או הבודקים של משימה ב-\"In review\". הוא שואל פעם אחת, אפשר לשלוח פעם בשעה, והתזכורת נרשמת בפתיל. הוא מופיע למי שפתח, שייך, מחזיק או בודק את המשימה, ולמנהלים."),
          t("Past the deadline with no answer: when a task's due date has passed and its assignee has not commented, changed the status or written anything since, it gets a red \"באיחור, בלי מענה\" tag. Whoever opened it sees a banner above the tabs (\"הצג אותן\" = the owner menu's \"באיחור, בלי מענה\") and, Sunday to Thursday at 09:30, one email listing all of them - again every 3 days while nothing moves.", "עבר תאריך היעד ואין מענה: כשתאריך היעד עבר והמשובץ לא הגיב, לא שינה סטטוס ולא כתב כלום מאז, המשימה מקבלת תג אדום \"באיחור, בלי מענה\". מי שפתח אותה רואה פס מעל הלשוניות (\"הצג אותן\" = \"באיחור, בלי מענה\" בתפריט הבעלים), ובימים א'-ה' ב-09:30 מקבל מייל אחד עם כולן - ושוב כל 3 ימים כל עוד שום דבר לא זז."),
          t("Prefer cards? In [Kanban](/tasks?tab=kanban), drag a card to another status column (on a phone, use the card's status menu). \"קיבוץ:\" groups the cards by \"פאזה\" or \"משובץ\". The board fills the screen and each column scrolls on its own; the arrow at the top of a column folds it to a thin strip (it still takes a dropped card) so the others get the room. A card is always a general task: its sub-tasks are not cards of their own - the card counts them (\"2/5\") and they open inside it. A part of yours that sits under someone else's task shows as that task's card.", "מעדיפים כרטיסים? ב-[Kanban](/tasks?tab=kanban) גוררים כרטיס לעמודת סטטוס אחרת (בטלפון - תפריט הסטטוס שבכרטיס). \"קיבוץ:\" מקבץ את הכרטיסים לפי \"פאזה\" או \"משובץ\". הלוח ממלא את המסך וכל עמודה נגללת בפני עצמה; החץ בראש עמודה מקפל אותה לפס צר (עדיין אפשר לשחרר עליו כרטיס) כדי לפנות מקום לאחרות. כרטיס הוא תמיד משימה כללית: תתי-המשימות שלה אינן כרטיסים משלהן - הכרטיס סופר אותן (\"2/5\") והן נפתחות בתוכו. חלק שלכם שיושב תחת משימה של מישהו אחר מופיע ככרטיס של אותה משימה."),
        ],
      },
      {
        title: t("Discuss a task in its thread", "לדבר על משימה בפתיל שלה"),
        steps: [
          t("Click the task's row (or its speech-bubble button). The thread opens right under the row.", "לוחצים על שורת המשימה (או על כפתור בועת השיחה). הפתיל נפתח מיד מתחת לשורה."),
          t("Write in \"הוסף תגובה\". Type @ and pick a name to mention a teammate - they get the comment by email.", "כותבים ב-\"הוסף תגובה\". מקלידים @ ובוחרים שם כדי לתייג עמית - הוא מקבל את התגובה במייל."),
          t("To add a screenshot, paste it with Ctrl+V, drag an image in, or use the paperclip. It is shrunk automatically. The paperclip also takes a PDF (up to 2.5MB).", "כדי להוסיף צילום מסך, מדביקים עם Ctrl+V, גוררים תמונה פנימה או לוחצים על אטב הנייר. התמונה מוקטנת אוטומטית. אטב הנייר מקבל גם PDF (עד 2.5MB)."),
          t("A picture lands where you are writing: a marker \"[תמונה 1]\" appears at the cursor, on its own line, and after sending the picture is drawn at that spot - so you can write a line, paste the screenshot that shows it, and go on writing. Move the marker to move the picture; delete the marker and the picture drops to the row under the comment. The writing box grows as you type.", "תמונה נכנסת איפה שכותבים: בסמן מופיע סימון \"[תמונה 1]\" בשורה משלו, ואחרי השליחה התמונה מוצגת בדיוק שם - אפשר לכתוב שורה, להדביק את צילום המסך שמדגים אותה, ולהמשיך לכתוב. מזיזים את הסימון כדי להזיז את התמונה; מוחקים את הסימון והתמונה יורדת לשורה שמתחת לתגובה. תיבת הכתיבה גדלה עם הטקסט."),
          t("Click \"שלח\" or press Ctrl+Enter. The creator, the assignee and everyone already in the thread get an email.", "לוחצים \"שלח\" או Ctrl+Enter. יוצר המשימה, המשובץ וכל מי שכבר בפתיל מקבלים מייל."),
          t("A mint bubble with \"חדשה\" or \"N חדשות\" means comments you haven't read yet. Opening the thread clears it. Your own comment has a pencil (edit) and a bin (delete).", "בועה במנטה עם \"חדשה\" או \"N חדשות\" = תגובות שעוד לא קראתם. פתיחת הפתיל מנקה את הסימון. בתגובה שלכם יש עיפרון (עריכה) ופח (מחיקה)."),
        ],
      },
      {
        title: t("Split work between people, or change many tasks at once", "לחלק עבודה בין כמה אנשים, או לשנות הרבה משימות בבת אחת"),
        steps: [
          t("Open the general task: click its row, or open the dialog with the pencil (admins) or the eye icon. (A brand-new task can be split in the \"New task\" form itself.)", "פותחים את המשימה הכללית: לוחצים על השורה, או פותחים את הדיאלוג בעיפרון (מנהלים) או באייקון העין. (משימה חדשה אפשר לחלק כבר בטופס \"New task\".)"),
          t("In \"תתי-משימות\", type the part in \"חלק חדש במשימה…\", pick its owner (admins) and click \"הוסף\". Each part becomes a task of its own, shown under the parent, which counts how many are done. In the Kanban and the Roadmap a part is not a card - it lives inside its task's card.", "ב-\"תתי-משימות\" מקלידים את החלק ב-\"חלק חדש במשימה…\", בוחרים אחראי (מנהלים) ולוחצים \"הוסף\". כל חלק הופך למשימה בפני עצמה, שמוצגת מתחת למשימת האב, שסופרת כמה הושלמו. ב-Kanban וב-Roadmap חלק אינו כרטיס - הוא נמצא בתוך הכרטיס של המשימה שלו."),
          t("Only an admin or the general task's owner or creator can split it, one level only.", "רק מנהל או האחראי/היוצר של המשימה הכללית יכולים לחלק אותה, ברמה אחת בלבד."),
          t("Many tasks at once (admins): tick their rows in the Tasks tab - a bar appears with \"N selected\".", "הרבה משימות בבת אחת (מנהלים): מסמנים את השורות בלשונית Tasks - מופיע סרגל עם \"N selected\"."),
          t("\"שייך ל…\" assigns them all, \"ללוח…\" moves them to another board and \"סטטוס…\" sets the status. The person receiving them gets ONE email. \"נקה בחירה\" clears the ticks.", "\"שייך ל…\" משבץ את כולן, \"ללוח…\" מעביר ללוח אחר ו-\"סטטוס…\" קובע סטטוס. מי שמקבל אותן מקבל מייל אחד. \"נקה בחירה\" מנקה את הסימון."),
        ],
      },
      {
        title: t("Clear the Pricing and Creative gaps queues", "לנקות את תורי התמחור והקריאייטיב"),
        steps: [
          t("Open [Pricing](/tasks?tab=pricing). It lists every red price light and frozen price change, and all staff can see it.", "פותחים את [Pricing](/tasks?tab=pricing). הלשונית מציגה כל רמזור אדום וכל שינוי מחיר קפוא, וכל הצוות רואה אותה."),
          t("Narrow the list with \"מקור\", \"סקופ\" and the $ gap slider. \"רק בלי משימה\" is on by default - switch it off to see rows someone already took.", "מצמצמים עם \"מקור\", \"סקופ\" וסרגל הפער בדולרים. \"רק בלי משימה\" דלוק כברירת מחדל - מכבים אותו כדי לראות שורות שמישהו כבר לקח."),
          t("\"לתקן\" jumps to the price field that fixes the row. \"באתר\" opens the event on the site. \"משימה\" opens a tracked task on the תמחור board.", "\"לתקן\" קופץ לשדה המחיר שמתקן את השורה. \"באתר\" פותח את האירוע באתר. \"משימה\" פותח משימה עוקבת בלוח תמחור."),
          t("\"טופל\" means you dealt with the row without changing a price. A red light stays hidden until the nightly check and comes back if it is still red.", "\"טופל\" = טיפלתם בשורה בלי לשנות מחיר. רמזור אדום נשאר מוסתר עד הבדיקה הלילית וחוזר אם הוא עדיין אדום."),
          t("For missing visuals, open [Creative gaps](/tasks?tab=gaps): \"Do\" goes to the fix, \"Create task\" hands the job to someone else, and \"Done\" means it is already on the site.", "לוויזואלים חסרים פותחים את [Creative gaps](/tasks?tab=gaps): \"Do\" מוביל לתיקון, \"Create task\" מעביר את העבודה למישהו אחר, ו-\"Done\" אומר שזה כבר באתר."),
        ],
      },
      {
        title: t("Set up a weekly recurring rule (admins)", "להגדיר כלל שבועי חוזר (מנהלים)"),
        steps: [
          t("Open [Task rules](/tasks?tab=rules) (admins - editors don't see this tab) and click \"כלל חדש\".", "פותחים את [Task rules](/tasks?tab=rules) (מנהלים - עורכים לא רואים את הלשונית) ולוחצים \"כלל חדש\"."),
          t("Fill in \"שם הכלל\" and pick the \"תחום\": רמזור מחירים, שינויי מחיר, פערים ויזואליים or מותאם אישית.", "ממלאים \"שם הכלל\" ובוחרים \"תחום\": רמזור מחירים, שינויי מחיר, פערים ויזואליים או מותאם אישית."),
          t("Pick the \"מצב\": \"סיכום שבועי אחד\" (one summary task) or \"משימה לכל פריט\" (one task per item, up to 25 per run), and set that domain's thresholds.", "בוחרים \"מצב\": \"סיכום שבועי אחד\" (משימת סיכום אחת) או \"משימה לכל פריט\" (משימה לכל פריט, עד 25 בריצה), וקובעים את הספים של התחום."),
          t("Choose \"יום בשבוע\" (in UTC - the check runs every day at 06:00 UTC), \"משויך ל-\", \"עדיפות\" and \"יעד (board)\", then click \"שמירה\".", "בוחרים \"יום בשבוע\" (לפי UTC - הבדיקה רצה כל יום ב-06:00 UTC), \"משויך ל-\", \"עדיפות\" ו-\"יעד (board)\", ולוחצים \"שמירה\"."),
          t("\"תצוגה מקדימה\" shows what the rule would create without writing anything. \"הרץ עכשיו\" runs it right away, and the \"פעיל\" switch pauses it.", "\"תצוגה מקדימה\" מראה מה הכלל היה יוצר בלי לכתוב כלום. \"הרץ עכשיו\" מריץ אותו מיד, ומתג \"פעיל\" משהה אותו."),
        ],
      },
    ],
    title: t("Tasks", "משימות"),
    intro: t(
      "The team's shared work board. Everyone sees every task; admins can touch anything, an editor changes status and progress only on tasks assigned to them.",
      "לוח העבודה המשותף לצוות. כולם רואים כל משימה; מנהלים יכולים לגעת בהכול, ועורך משנה סטטוס והתקדמות רק במשימות ששויכו אליו.",
    ),
    points: [
      t(
        "Statuses: to do → in progress → paused → in review → done (or cancelled) - paused and in review still count as open tasks. In review = the assignee finished and handed the task back to whoever opened it. Priorities: urgent / high / medium / low - your dashboard widget sorts by them. A task can also carry a board (dev / marketing / ops), a phase, a marketing channel and a progress percentage.",
        "סטטוסים: לביצוע → בתהליך → מושהה → בבדיקה → בוצע (או בוטל) — מושהה ובבדיקה עדיין נחשבים משימה פתוחה. בבדיקה = המשובץ סיים והחזיר את המשימה למי שפתח אותה. עדיפויות: דחוף / גבוה / בינוני / נמוך — הווידג'ט בדשבורד ממוין לפיהן. למשימה יש גם לוח (dev / marketing / ops), פאזה, ערוץ שיווקי ואחוז התקדמות.",
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
        "The board also has a Kanban view (the Kanban tab) alongside the table - drag a card to change its status. The board pills above both (הכל / פיתוח / שיווק / תפעול / תמחור) narrow the table, its counts and the Kanban together to one board at a time.",
        "ללוח יש גם תצוגת קאנבן (לשונית Kanban) לצד הטבלה — גוררים כרטיס כדי לשנות סטטוס. תגי הלוח מעל שתיהן (הכל / פיתוח / שיווק / תפעול / תמחור) מצמצמים יחד את הטבלה, הספירות והקאנבן ללוח אחד בכל פעם.",
      ),
      t(
        "Four boards since 28.09: Dev, Marketing, Ops and Pricing. Every task the price light or the price-changes screen opens lands on Pricing (it used to fill Ops - 32 of its 37 open tasks were price lights), and so do the weekly price rules. Admins can tick several rows in the table and, from the bar that appears, assign them to one person, move them to another board or set their status in one go - the person receiving them gets ONE email listing them all. A general task can be split into sub-tasks, one per person: open the task (row or dialog), add a part with its owner under the sub-tasks panel, and each part becomes a task of its own (its own status, thread and email) shown right under its parent, which counts x/y done. One level only; an admin or the general task's owner splits it.",
        "ארבעה לוחות מ־28.09: פיתוח, שיווק, תפעול ותמחור. כל משימה שהרמזור או מסך שינויי המחיר פותחים נוחתת בתמחור (לפני כן מילאה את תפעול - 32 מתוך 37 המשימות הפתוחות שם היו רמזור), וכך גם הכללים השבועיים של המחירים. מנהל יכול לסמן כמה שורות בטבלה, ובסרגל שנפתח לשייך את כולן לאדם אחד, להעביר ללוח אחר או לעדכן סטטוס במכה - ומי שמקבל אותן מקבל מייל אחד עם כולן. משימה כללית אפשר לחלק לתתי-משימות, אחת לכל אחראי: פותחים את המשימה (שורה או דיאלוג), מוסיפים חלק עם אחראי בחלונית תתי-המשימות, וכל חלק הופך למשימה בפני עצמה (סטטוס, פתיל ומייל משלה) שמוצגת מתחת למשימת האב, שסופרת כמה הושלמו. רמה אחת בלבד; מחלק מנהל או האחראי על המשימה הכללית.",
      ),
      t(
        "The Roadmap tab is the product road map that used to be a separate app: every Dev-board task laid out by its phase (1-7), with done/total and a progress bar per phase. The Marketing tab does the same for the Marketing board by channel, with each campaign's progress. Click a card to open the task; the + next to a phase or channel creates a task already placed there. Both show the whole team - filter by name or search inside the tab.",
        "לשונית Roadmap היא מפת הדרכים של המוצר שהייתה פעם אפליקציה נפרדת: כל משימות לוח הפיתוח מסודרות לפי השלב שלהן (1-7), עם הושלם/סה״כ ופס התקדמות לכל שלב. לשונית Marketing עושה אותו דבר ללוח השיווק לפי ערוץ, עם ההתקדמות של כל קמפיין. לחיצה על כרטיס פותחת את המשימה; ה־+ ליד שלב או ערוץ יוצר משימה שכבר משובצת שם. שתיהן מציגות את כל הצוות - מסננים לפי שם או מחפשים בתוך הלשונית.",
      ),
      t(
        "The Pricing tab (visible to everyone, not just admins) lists every open pricing problem - red price lights and frozen price-change rows - in one place. The gap slider narrows the list to a range, both ends (say $0-$150 to see only the small gaps), and every row links to the event's page on the site. Each row has three buttons: \"משימה\" opens a tracked task for it, \"לתקן\" jumps straight to the field that actually fixes it, and \"טופל\" records that you dealt with it without touching a price - a price light stays hidden until the next nightly check (and comes back if it is still red), a frozen price row is marked reviewed with the note 'סומן כטופל' in front of the sync's original note. That mark is final - nothing reopens it. Only a price-change row closed through its TASK can come back: reopening that task restores the row and its original note.",
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
    nav: "/partners",
    productType: "events",
    howTo: [
      {
        title: t("Create a partner (admins)", "יצירת שותף (מנהלים)"),
        steps: [
          t("Open [Partners](/partners) and click \"Add Partner\" (admins).", "פותחים את [השותפים](/partners) ולוחצים \"Add Partner\" (מנהלים)."),
          t("Fill \"Tracking Code\" - it goes into every link and coupon and can't be changed later.", "ממלאים \"Tracking Code\" - הקוד נכנס לכל קישור וקופון ואי אפשר לשנות אותו אחר כך."),
          t("\"Partner Type\": סוכן (books for customers, is invoiced) or משפיען (brings traffic with a code) - also their portal role.", "\"Partner Type\": סוכן (מזמין עבור לקוחות ומקבל חשבונית) או משפיען (מביא תנועה עם קוד) - זה גם התפקיד שלו בפורטל."),
          t("\"Partner Name\", \"Email\" (the portal login, gets the monthly report) and \"Password\" (8+ characters, not shown again - pass it on now).", "\"Partner Name\", \"Email\" (שם המשתמש לפורטל, מקבל את הדוח החודשי) ו-\"Password\" (8+ תווים, לא מוצג שוב - מעבירים עכשיו)."),
          t("Set \"Commercial terms\" (next recipe), attach the agreement under \"Cooperation agreement\", then \"Save Partner\" → \"Create Partner\" - the partner and their portal login are created together.", "מגדירים \"Commercial terms\" (המתכון הבא), מצרפים הסכם ב-\"Cooperation agreement\", ואז \"Save Partner\" ← \"Create Partner\" - השותף והכניסה שלו לפורטל נוצרים יחד."),
        ],
      },
      {
        title: t("Change commission, follower discount or terms (admins)", "שינוי עמלה, הנחת עוקבים או תנאים (מנהלים)"),
        steps: [
          t("In [Partners](/partners), the \"Partners list\" tab → the row's ⋯ → \"Edit\" (admins).", "ב[שותפים](/partners), לשונית \"Partners list\" ← ⋯ בשורה ← \"Edit\" (מנהלים)."),
          t("\"Commission Basis\": \"דולר לכרטיס\" ($ per ticket) or \"אחוז ממחיר החבילה\" (% of the package). Only paid reservations earn commission.", "\"Commission Basis\": \"דולר לכרטיס\" (דולרים לכרטיס) או \"אחוז ממחיר החבילה\" (אחוז מהחבילה). רק הזמנות ששולמו מקבלות עמלה."),
          t("\"Follower Discount ($)\" is what the partner's customers get off. Careful: 1-10 counts as a PERCENT of the order, above 10 as dollars per person.", "\"Follower Discount ($)\" היא ההנחה ללקוחות של השותף. שימו לב: 1-10 נחשב אחוז מההזמנה, מעל 10 - דולרים לאדם."),
          t("If they apply: \"Site Credit ($ per ticket)\" (0 = not in the deal), \"Coupon Cap\" (empty = the commission rate), \"Voucher Payment\" (agents). Starting fresh on a code with old bookings? \"Portal History From\" hides earlier bookings in the portal only.", "אם רלוונטי: \"Site Credit ($ per ticket)\" (0 = לא בהסכם), \"Coupon Cap\" (ריק = שיעור העמלה), \"Voucher Payment\" (סוכנים). מתחיל מחדש על קוד עם הזמנות ישנות? \"Portal History From\" מסתיר הזמנות קודמות בפורטל בלבד."),
          t("To pause a partner switch \"Status\" off (no portal, no monthly report) - better than Delete, which is permanent. \"Save Partner\" → \"Save Changes\"; new rates apply to new bookings only.", "להשהיית שותף מכבים את \"Status\" (בלי פורטל, בלי דוח חודשי) - עדיף על Delete, שהוא סופי. \"Save Partner\" ← \"Save Changes\"; תעריפים חדשים חלים רק על הזמנות חדשות."),
        ],
      },
      {
        title: t("Give an influencer their coupon (admins)", "קופון למשפיען (מנהלים)"),
        steps: [
          t("Open the existing influencer's editor (\"Partners list\" → ⋯ → \"Edit\") - the coupon box doesn't appear while creating one.", "פותחים את העורך של משפיען קיים (\"Partners list\" ← ⋯ ← \"Edit\") - תיבת הקופון לא מופיעה בזמן היצירה."),
          t("Make sure \"Follower Discount ($)\" is filled - the coupon is built from it.", "מוודאים ש-\"Follower Discount ($)\" מלא - הקופון נבנה ממנו."),
          t("In \"Influencer coupon\" click \"Create coupon\": code = tracking code + value (AVIRAN30). Copy it with the copy icon.", "ב-\"Influencer coupon\" לוחצים \"Create coupon\": הקוד = קוד מעקב + ערך (AVIRAN30). מעתיקים עם אייקון ההעתקה."),
          t("Saving a new follower discount renames the coupon (AVIRAN30 → AVIRAN25) and the old code stops working; \"Re-sync\" re-applies the current terms but never switches a coupon that was turned off back on (do that in /coupons). Orders with the code count as the influencer's.", "שמירת הנחת עוקבים חדשה משנה את שם הקופון (AVIRAN30 ← AVIRAN25) והקוד הישן מפסיק לעבוד; \"Re-sync\" מחיל מחדש את התנאים אבל לא מדליק קופון שכובה (מדליקים ב-/coupons). הזמנות עם הקוד נספרות למשפיען."),
        ],
      },
      {
        title: t("Check a partner's performance", "בדיקת הביצועים של שותף"),
        steps: [
          t("\"Insights\" compares all partners. For one partner, \"Partners list\" → click the name (or ⋯ → \"View performance\").", "\"Insights\" משווה בין כל השותפים. לשותף אחד: \"Partners list\" ← לחיצה על השם (או ⋯ ← \"View performance\")."),
          t("Pick \"Period:\" - the cards show commission earned and pending, paid reservations, sales, conversion and average order.", "בוחרים \"Period:\" - הכרטיסים מציגים עמלה שנצברה וממתינה, הזמנות ששולמו, מכירות, המרה וממוצע הזמנה."),
          t("\"Pending commission\" lists paid bookings not yet in a monthly report. If a report went out by hand, tick those rows → \"Mark as reported\".", "\"Pending commission\" מציג הזמנות ששולמו ועוד לא בדוח חודשי. אם דוח נשלח ידנית, מסמנים את השורות ← \"Mark as reported\"."),
        ],
      },
      {
        title: t("See the portal as the partner, get their tracking link", "כניסה לפורטל בתור השותף וקבלת קישור המעקב"),
        steps: [
          t("Superadmin: \"Partners list\" → ⋯ → \"Login as agent\" / \"Login as affiliate\" opens the portal as them in a new tab (your login is unaffected).", "סופר-אדמין: \"Partners list\" ← ⋯ ← \"Login as agent\" / \"Login as affiliate\" פותח את הפורטל בתור השותף בלשונית חדשה (ההתחברות שלכם לא מושפעת)."),
          t("If your user is linked to a partner: your name at the bottom of the sidebar → \"מצב סוכן\" opens [the portal](/portal) as that partner.", "אם המשתמש שלכם מקושר לשותף: השם שלכם בתחתית הסיידבר ← \"מצב סוכן\" פותח את [הפורטל](/portal) בתור אותו שותף."),
          t("In the portal, \"הלינקים שלי\" shows \"הלינק הכללי שלכם\" and builds links for an event or any site page. By hand: add ?utm_source=<tracking code>&utm_medium=influencer to a site address.", "בפורטל, \"הלינקים שלי\" מציג את \"הלינק הכללי שלכם\" ובונה קישורים לאירוע או לכל עמוד באתר. ידנית: מוסיפים ?utm_source=<קוד מעקב>&utm_medium=influencer לכתובת באתר."),
        ],
      },
    ],
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
    id: "meta-feed",
    nav: "/meta-feed",
    productType: "events",
    title: t("Meta product feed", "פיד המוצרים למטא"),
    intro: t(
      "The state of the file Meta reads. The feed is built live from the catalog; publishing copies it into the fixed file registered in Meta Commerce Manager, and Meta fetches that file by itself every hour.",
      "מצב הקובץ שמטא קוראת. הפיד נבנה חי מהקטלוג; פרסום מעתיק אותו לקובץ הקבוע שרשום ב-Commerce Manager של מטא, ומטא מושכת את הקובץ בעצמה כל שעה.",
    ),
    howTo: [
      {
        title: t("Read the screen", "קריאת המסך"),
        steps: [
          t("Open [Meta Product Feed](/meta-feed). \"בריאות הסנכרונים\" shows when each sync last wrote data - a red badge is late, a red banner counts the late ones. All red = the scheduled syncs stopped: tell a developer and use \"סנכרן הכל (כל ה־API)\" meanwhile.", "פותחים את [פיד המוצרים למטא](/meta-feed). \"בריאות הסנכרונים\" מראה מתי כל סנכרון כתב נתונים לאחרונה - תג אדום = באיחור, באנר אדום סופר כמה. הכול אדום = הסנכרונים המתוזמנים הפסיקו: מעדכנים מפתח ובינתיים \"סנכרן הכל (כל ה־API)\"."),
          t("\"קריאטיבים: X מתוך Y\" = how many future events already have an ad creative.", "\"קריאטיבים: X מתוך Y\" = לכמה אירועים עתידיים כבר יש קריאייטיב."),
          t("Under \"סטטוס הקבצים\", only \"Meta - Activities (הפיד הפעיל)\" with \"פעיל במטא\" is the file Meta reads; the E-commerce files are for Google Merchant. Each shows age, size and public URL.", "תחת \"סטטוס הקבצים\", רק \"Meta - Activities (הפיד הפעיל)\" עם \"פעיל במטא\" הוא הקובץ שמטא קוראת; קבצי ה-E-commerce הם ל-Google Merchant. לכל אחד גיל, גודל וכתובת ציבורית."),
        ],
      },
      {
        title: t("Publish the feed now, or run every sync by hand", "פרסום הפיד עכשיו, או הרצת כל הסנכרונים ידנית"),
        steps: [
          t("After editing events, click \"סנכרן פיד עכשיו\" - \"הפיד סונכרן\" says how many events went into the file. It only republishes the file (no prices, providers or creatives); Meta picks it up within the hour.", "אחרי עריכת אירועים לוחצים \"סנכרן פיד עכשיו\" - \"הפיד סונכרן\" אומר כמה אירועים נכנסו לקובץ. זה רק מפרסם מחדש (בלי מחירים, ספקים או קריאייטיבים); מטא מושכת תוך שעה."),
          t("When the health badges are red, an admin clicks \"סנכרן הכל (כל ה־API)\" (admins; editors ask an admin). It runs seven steps in order (XS2Event, LIVE, TixStock events, TixStock prices, ticket prices, feed creatives, publish), each with ✓ / ✗ - keep the tab open; it can take many minutes.", "כשתגי הבריאות אדומים, מנהל לוחץ \"סנכרן הכל (כל ה־API)\" (מנהלים; עורכים מבקשים ממנהל). הוא מריץ שבעה שלבים לפי הסדר (XS2Event, LIVE, אירועי TixStock, מחירי TixStock, מחירי כרטיסים, קריאייטיבים, פרסום), כל אחד עם ✓ / ✗ - משאירים את הלשונית פתוחה; זה יכול לקחת הרבה דקות."),
          t("It ends with \"כל הסנכרונים הושלמו\" or \"הסנכרון הסתיים עם N כשלים\" - a failed step's ✗ line shows the error.", "בסוף: \"כל הסנכרונים הושלמו\" או \"הסנכרון הסתיים עם N כשלים\" - שורת ה-✗ של שלב שנכשל מציגה את השגיאה."),
        ],
      },
      {
        title: t("Redraw chosen events and push them now", "ציור מחדש והעלאה של אירועים שבחרתם"),
        steps: [
          t("You fixed an event (a picture, a name, a price) or just created one and do not want to wait for the cron: under \"אירועים ספציפיים לפיד\" search by name, English name or id, and tick one or more events (up to 20 per click) - the picks show as chips.", "תיקנתם אירוע (תמונה, שם, מחיר) או יצרתם אחד עכשיו ולא רוצים לחכות ל-cron: תחת \"אירועים ספציפיים לפיד\" מחפשים לפי שם, שם באנגלית או מזהה, ומסמנים אירוע אחד או כמה (עד 20 בלחיצה) - הבחירות מופיעות כצ'יפים."),
          t("Click \"צייר מחדש והעלה לפיד\". Each event is redrawn from scratch - even when nothing on it changed, unlike the editor's \"העלה לפיד עכשיו\" which only redraws what changed - under a new image address, so Meta fetches the new picture instead of its cached one; then the file is published once.", "לוחצים \"צייר מחדש והעלה לפיד\". כל אירוע מצויר מחדש - גם אם לא השתנה בו כלום, בשונה מ\"העלה לפיד עכשיו\" בעורך שמצייר רק מה שהשתנה - תחת כתובת תמונה חדשה, כך שמטא מושכת את התמונה החדשה במקום זו שבמטמון שלה; ואז הקובץ מפורסם פעם אחת."),
          t("A line per event says what happened: ✓ in the feed, ⚠ redrawn but not in the file (the reason follows - sold out, under 3 days away, test event, no price), ✗ failed. The last line is the publish. Meta reads the file within the hour.", "שורה לכל אירוע אומרת מה קרה: ✓ בפיד, ⚠ צויר אבל לא בקובץ (הסיבה אחריו - אזל, פחות מ-3 ימים, אירוע בדיקה, אין מחיר), ✗ נכשל. השורה האחרונה היא הפרסום. מטא קוראת את הקובץ תוך שעה."),
        ],
      },
      {
        title: t("Find out why an event is missing from Meta", "בדיקה למה אירוע לא מופיע במטא"),
        steps: [
          t("Open the event from [Events](/events), save, and click \"העלה לפיד עכשיו\" - it makes the creative if needed and republishes.", "פותחים את האירוע מ[אירועים](/events), שומרים ולוחצים \"העלה לפיד עכשיו\" - מייצר קריאייטיב אם צריך ומפרסם מחדש."),
          t("\"האירוע בפיד\" = in the file, Meta shows it after its next hourly read. \"האירוע לא נכנס לפיד\" lists why: deleted, test event, under 3 days away, sold out, or no creative (almost always = no price to calculate).", "\"האירוע בפיד\" = בקובץ, מטא תציג אחרי הקריאה השעתית הבאה. \"האירוע לא נכנס לפיד\" מפרט למה: נמחק, אירוע בדיקה, פחות מ-3 ימים, אזל, או אין קריאייטיב (כמעט תמיד = אין מחיר לחשב)."),
          t("Fix the reason (usually the price fields or ticket availability), save and click again. No reason found? Ask a developer to check the main site's /product-feed.", "מתקנים את הסיבה (לרוב שדות המחיר או זמינות כרטיסים), שומרים ולוחצים שוב. לא נמצאה סיבה? מבקשים ממפתח לבדוק את /product-feed באתר הראשי."),
        ],
      },
    ],
    links: [{ label: t("Meta product feed", "פיד מטא"), href: "/meta-feed" }],
  },
  {
    id: "coupons",
    nav: "/coupons",
    productType: "events",
    title: t("Coupons", "קופונים"),
    intro: t(
      "Discount codes customers type on the order summary. The bigger discount wins - a coupon never adds on top of a partner's follower discount. Codes are saved in capitals and match whatever case the customer types.",
      "קודי הנחה שלקוחות מקלידים בסיכום ההזמנה. ההנחה הגדולה מנצחת - קופון אף פעם לא מתווסף להנחת העוקבים של שותף. הקודים נשמרים באותיות גדולות ומזוהים בלי קשר לאותיות שהלקוח מקליד.",
    ),
    howTo: [
      {
        title: t("Create a coupon", "יצירת קופון"),
        steps: [
          t("Open [Coupons](/coupons) and click \"Add Coupon\".", "פותחים את [הקופונים](/coupons) ולוחצים \"Add Coupon\"."),
          t("\"Code\": letters, numbers, dashes or underscores, up to 64, unique. Pick \"Type\" (\"Percent (%)\" or \"Fixed ($)\") and \"Value\" (a percent can't pass 100).", "\"Code\": אותיות, מספרים, מקף או קו תחתון, עד 64, ייחודי. בוחרים \"Type\" (\"Percent (%)\" או \"Fixed ($)\") ו-\"Value\" (אחוז לא עובר 100)."),
          t("\"Event restriction\": \"All events\" or one event. To credit the sales to a partner, pick them in \"Attribute to affiliate\" (not when the order already came through its own affiliate).", "\"Event restriction\": \"All events\" או אירוע אחד. לזקיפת המכירות לשותף בוחרים אותו ב-\"Attribute to affiliate\" (לא חל כשההזמנה כבר הגיעה דרך שותף משלה)."),
          t("Keep \"Active\" on and click \"Create Coupon\" - it works on the site right away.", "משאירים \"Active\" דלוק ולוחצים \"Create Coupon\" - עובד באתר מיד."),
        ],
      },
      {
        title: t("Per person or per order", "לאדם או להזמנה"),
        steps: [
          t("Only a \"Fixed ($)\" coupon has the \"Per person\" switch.", "רק לקופון \"Fixed ($)\" יש את המתג \"Per person\"."),
          t("On: the amount comes off every ticket, like the follower discount ($50 × 4 travellers = $200). Off: once per order.", "דלוק: הסכום יורד מכל כרטיס, כמו הנחת העוקבים (50$ × 4 נוסעים = 200$). כבוי: פעם אחת להזמנה."),
          t("A \"Percent (%)\" coupon always applies to the whole order. \"/ person\" next to the discount in the table marks a per-person coupon.", "קופון \"Percent (%)\" תמיד חל על כל ההזמנה. \"/ person\" ליד ההנחה בטבלה מסמן קופון לאדם."),
        ],
      },
      {
        title: t("Limit, pause or remove a coupon", "הגבלה, השהיה או מחיקה של קופון"),
        steps: [
          t("The pencil on the row: \"Valid until\" (empty = \"No expiry\"), \"Max uses\" (empty = unlimited; \"Uses\" shows used / max, \"Paid\" how many were paid), \"Event restriction\" → \"Save Changes\".", "העיפרון בשורה: \"Valid until\" (ריק = \"No expiry\"), \"Max uses\" (ריק = ללא הגבלה; \"Uses\" מציג שימושים / מקסימום, \"Paid\" כמה שולמו), \"Event restriction\" ← \"Save Changes\"."),
          t("To stop a coupon, switch off \"Active\" - immediate, and it can go back on any time.", "כדי לעצור קופון מכבים את \"Active\" - מיד, ואפשר להדליק שוב מתי שרוצים."),
          t("The trash icon (admins) deletes it for good, usage counts included (past orders keep their discount). Switching off is almost always better.", "הפח (מנהלים) מוחק לצמיתות, כולל ספירת השימושים (הזמנות קודמות שומרות את ההנחה). כמעט תמיד עדיף לכבות."),
          t("Rows marked \"influencer\" belong to a partner - change them in the partner editor in [Partners](/partners) (admins); saving the partner updates the code and value but never switches a coupon back on.", "שורות עם \"influencer\" שייכות לשותף - משנים אותן בעורך השותף ב[שותפים](/partners) (מנהלים); שמירת השותף מעדכנת קוד וערך אבל אף פעם לא מדליקה קופון שכובה."),
        ],
      },
    ],
    links: [{ label: t("Coupons", "קופונים"), href: "/coupons" }],
  },
  {
    id: "forms",
    nav: "/forms",
    productType: "events",
    howTo: [
      {
        title: t("Build a new form", "בניית טופס חדש"),
        steps: [
          t("Open [Forms](/forms) and click \"New form\" - an empty draft opens in the builder.", "פותחים את [הטפסים](/forms) ולוחצים \"New form\" - טיוטה ריקה נפתחת בבונה."),
          t("\"Form language\": \"English only\", \"עברית בלבד\" or \"Both - client can switch\" (then \"Opens in\"). Text boxes get EN / עב tabs; one language is enough.", "\"Form language\": \"English only\", \"עברית בלבד\" או \"Both - client can switch\" (ואז \"Opens in\"). לתיבות הטקסט יש לשוניות EN / עב; מספיקה שפה אחת."),
          t("Fill \"Form title\" (\"Description\" and \"Thank-you message\" are optional). \"Add question\" → pick a type (Short text, Number, Yes / No, Star rating…), write it, mark \"Required\" if needed; choice questions need options.", "ממלאים \"Form title\" (\"Description\" ו-\"Thank-you message\" לא חובה). \"Add question\" ← בוחרים סוג (Short text, Number, Yes / No, Star rating…), כותבים, מסמנים \"Required\" לפי הצורך; לשאלות בחירה מוסיפים אפשרויות."),
          t("Arrows reorder questions. \"Show only if\" shows a question after a given Yes/No answer - save first, a just-added question can't be a condition yet.", "החצים מסדרים שאלות. \"Show only if\" מציג שאלה אחרי תשובה מסוימת בשאלת Yes/No - שומרים קודם, שאלה שרק נוספה עוד לא יכולה להיות תנאי."),
          t("Style it under \"Design\" (theme, \"Accent colour\", \"Logo\", \"Cover image\"), check the \"Preview\", and click \"Save\" (\"• unsaved changes\" shows until you do).", "מעצבים תחת \"Design\" (ערכת צבע, \"Accent colour\", \"Logo\", \"Cover image\"), בודקים את ה-\"Preview\" ולוחצים \"Save\" (\"• unsaved changes\" מופיע עד אז)."),
        ],
      },
      {
        title: t("Trip details, traveller count, Google review", "פרטי טיול, מספר נוסעים, ביקורת גוגל"),
        steps: [
          t("Details filled once per trip (escort, departure date): add a question and switch on \"Staff field\" - clients never see it.", "פרטים שממלאים פעם אחת לטיול (מלווה, תאריך יציאה): מוסיפים שאלה ומדליקים \"Staff field\" - הלקוחות לא רואים אותה."),
          t("Group size: a \"Number\" question with \"Travellers count\" on - the trips report adds it up (one per form).", "גודל הקבוצה: שאלת \"Number\" עם \"Travellers count\" דלוק - דוח הטיולים מסכם אותה (אחת לטופס)."),
          t("Google review prompt: \"Review link (optional)\" (or a Google button) and \"Min. average\", then mark the star questions that count with \"Google score\". Save.", "הפניה לביקורת בגוגל: \"Review link (optional)\" (או אחד מכפתורי Google) ו-\"Min. average\", ואז מסמנים \"Google score\" על שאלות הכוכבים שנספרות. שומרים."),
          t("Every star question shows \"1 = Poor\" and \"5 = Excellent\" under the stars, so the client knows which way is good.", "מתחת לכל שאלת כוכבים כתוב \"1 = גרוע\" ו-\"5 = מצוין\", כדי שהלקוח יידע לאיזה כיוון זה טוב."),
        ],
      },
      {
        title: t("A form per series, a question per hotel", "טופס לכל סדרה, שאלה לכל מלון"),
        steps: [
          t("In [Forms](/forms) click \"New series form\": pick the series (BBC, FPAR…) and the form to copy the questions from → \"Create draft\". The copy opens in the builder; the base form is not touched. An existing form gets its series from \"Series\" at the top of the builder (saved at once).", "ב[טפסים](/forms) לוחצים \"New series form\": בוחרים את הסדרה (BBC, FPAR…) ואת הטופס שממנו מעתיקים שאלות ← \"Create draft\". העותק נפתח בבונה; טופס הבסיס לא משתנה. לטופס קיים בוחרים סדרה ב-\"Series\" בראש הבונה (נשמר מיד)."),
          t("Every trip of the series answers the same questions; another series' form is edited on its own. A series without a form of its own keeps using the general form.", "כל הטיולים של הסדרה עונים על אותן שאלות; טופס של סדרה אחרת נערך בנפרד. סדרה בלי טופס משלה ממשיכה להשתמש בטופס הכללי."),
          t("Escort feedback (the escort's own report on the trip): in \"New series form\" pick \"Who answers\" → \"The escort\" and \"Start with\" → \"Only the trip details\", then add the questions (hotels included). Its trip link goes to the escort, not the group. An existing form switches with \"Who answers\" in the builder.", "משוב מלווים (הדוח של המלווה עצמו על הטיול): ב-\"New series form\" בוחרים \"Who answers\" ← \"The escort\" ו-\"Start with\" ← \"Only the trip details\", ומוסיפים את השאלות (כולל מלונות). לינק הטיול שלו נשלח למלווה, לא לקבוצה. טופס קיים עובר עם \"Who answers\" בבונה."),
          t("A hotel: \"Add question\" → \"Hotel rating (city + hotel)\", type the city and the hotel name - the question reads \"איך היה המלון ב<city>?\" and the client sees the hotel's name under it. One question per city of the route. Any star question can become one with \"Hotel question\".", "מלון: \"Add question\" ← \"Hotel rating (city + hotel)\", כותבים עיר ושם מלון - השאלה נקראת \"איך היה המלון ב<עיר>?\" והלקוח רואה את שם המלון מתחתיה. שאלה לכל עיר במסלול. כל שאלת כוכבים יכולה להפוך לכזו עם \"Hotel question\"."),
          t("The hotel changed? Edit its name in the question and save. Answers already in stay with the hotel they were given for.", "המלון התחלף? משנים את השם בשאלה ושומרים. תשובות שכבר נכנסו נשארות על המלון שעליו ניתנו."),
          t("Same question on many series: save the form, then the copy-plus icon on the question → tick forms (\"All series\" ticks every series form) → \"Copy\". It lands at the end of each form; place it there.", "אותה שאלה בהרבה סדרות: שומרים את הטופס, ואז אייקון ההעתקה עם הפלוס בשאלה ← מסמנים טפסים (\"All series\" מסמן את כל טפסי הסדרות) ← \"Copy\". השאלה נוספת בסוף כל טופס; ממקמים אותה שם."),
          t("[Hotels report](/forms/hotels) (button in [Forms](/forms)): every hotel across every series, the weakest first - average, answers, a 1★-5★ bar, trips, series and the weakest trip. \"Travellers only\" / \"Escorts only\" splits whose ratings count. Click a hotel for its low answers and what was written.", "[דוח מלונות](/forms/hotels) (כפתור ב[טפסים](/forms)): כל מלון בכל הסדרות, מהחלש לחזק - ממוצע, תשובות, פס 1★-5★, טיולים, סדרות והטיול החלש. \"Travellers only\" / \"Escorts only\" מפריד בין דירוגי נוסעים למלווים. לחיצה על מלון מציגה את התשובות הנמוכות ומה נכתב."),
        ],
      },
      {
        title: t("Go live and share the link", "העלאה לאוויר ושיתוף הקישור"),
        steps: [
          t("Save, then change the status at the top from \"Draft\" to \"Live\" - it saves by itself and confirms the public link works. \"Closed\" stops new answers.", "שומרים, ואז מחליפים את הסטטוס למעלה מ-\"Draft\" ל-\"Live\" - נשמר לבד ומאשר שהקישור הציבורי עובד. \"Closed\" עוצר תשובות חדשות."),
          t("\"Copy link\" copies the shared /f/ link (Live only); \"Open\" shows the client's page; the slug is under \"Public link\".", "\"Copy link\" מעתיק את קישור ה-/f/ המשותף (רק כש-Live); \"Open\" מציג את עמוד הלקוח; הכתובת תחת \"Public link\"."),
          t("For an external forms operator, switch on \"Visible to forms operators (build, trip links, responses, report)\" and save - the operator can then edit that form, publish it and make series forms from it (never delete it). \"Duplicate\" in the row menu in [Forms](/forms) copies the form as a new draft.", "למפעיל טפסים חיצוני מדליקים \"Visible to forms operators (build, trip links, responses, report)\" ושומרים - המפעיל יכול אז לערוך את הטופס, להעלות אותו לאוויר ולבנות ממנו טפסי סדרה (לא למחוק). \"Duplicate\" בתפריט השורה ב[טפסים](/forms) מעתיק את הטופס כטיוטה חדשה."),
        ],
      },
      {
        title: t("Create a trip link or send personal invites", "יצירת קישור טיול או שליחת הזמנות אישיות"),
        steps: [
          t("Click \"Send\" in the builder (or \"Send / invites\" in the row menu) - the form must be Live.", "לוחצים \"Send\" בבונה (או \"Send / invites\" בתפריט השורה) - הטופס חייב להיות Live."),
          t("\"Trip link\" (only if the form has a \"Staff field\"): \"Departure\" → pick the trip (a series form lists its series, a general form every series) - it fills the trip code and the departure date. Or type \"Trip code\" by hand (letters + number, e.g. BBC 124). Optional \"Travellers on the trip\", the escort's name (it suggests names already used) → \"Create trip link & copy\". One link for the whole group; every answer carries the trip details.", "\"Trip link\" (רק אם יש בטופס \"Staff field\"): \"Departure\" ← בוחרים את הטיול (טופס סדרה מציג את הסדרה שלו, טופס כללי את כל הסדרות) - הוא ממלא קוד טיול ותאריך יציאה. או כותבים \"Trip code\" ביד (אותיות + מספר, למשל BBC 124). אם רוצים \"Travellers on the trip\", שם המלווה (מוצעים שמות שכבר נכתבו) ← \"Create trip link & copy\". קישור אחד לכל הקבוצה; כל תשובה נושאת את פרטי הטיול."),
          t("Personal emailed links (staff only): paste \"Name, email@example.com\" one per line, pick \"Email language\" → \"Send … invites\". The table tracks \"Sent\" / \"Opened\" / \"Filled\" / \"Failed\"; the link icon copies, the circular arrow resends.", "קישורים אישיים במייל (צוות בלבד): מדביקים \"Name, email@example.com\" שורה לכל נמען, בוחרים \"Email language\" ← \"Send … invites\". הטבלה עוקבת \"Sent\" / \"Opened\" / \"Filled\" / \"Failed\"; אייקון הקישור מעתיק, החץ העגול שולח שוב."),
        ],
      },
      {
        title: t("Read the report and fix an answer", "קריאת הדוח ותיקון תשובה"),
        steps: [
          t("\"Trips report\" in the builder or row menu (or click the response count in [Forms](/forms)). Filter by \"Code letters\", \"Code number\", \"Escort\", \"Departure from\" or \"Year\".", "\"Trips report\" בבונה או בתפריט השורה (או לחיצה על מספר התשובות ב[טפסים](/forms)). מסננים לפי \"Code letters\", \"Code number\", \"Escort\", \"Departure from\" או \"Year\"."),
          t("Click a trip for its per-question averages and responses; click the trip's travellers number to set the trip size.", "לחיצה על טיול מציגה ממוצע לכל שאלה ואת התשובות; לחיצה על מספר הנוסעים של הטיול קובעת את גודל הטיול."),
          t("Click a response for all its answers. \"עריכה\" → fix → \"שמור\" corrects text, number, email, phone and date answers only - ratings and choices stay as the client gave them.", "לחיצה על תשובה מציגה את כל התשובות שבה. \"עריכה\" ← מתקנים ← \"שמור\" מתקן רק טקסט, מספר, מייל, טלפון ותאריך - דירוגים ובחירות נשארים כמו שהלקוח ענה."),
          t("An irrelevant response (a test, a duplicate, the wrong form): open it → \"מחיקה\" → confirm. It leaves the report, the averages, the Excel and the PDF at once; \"ביטול\" in the message that pops up brings it back. Forms operators can do this too.", "תשובה לא רלוונטית (בדיקה, כפילות, טופס לא נכון): פותחים אותה ← \"מחיקה\" ← מאשרים. היא יוצאת מיד מהדוח, מהממוצעים, מהאקסל ומה-PDF; \"ביטול\" בהודעה שקופצת מחזיר אותה. גם מפעילי טפסים יכולים."),
          t("A trip you don't need (a duplicate, a typo in the code or the date): the bin at the end of its row → confirm. It leaves the report and the links list and its link stops taking answers; \"ביטול\" in the message brings it back. Only an empty trip can go - a trip with responses keeps its row until they are deleted.", "טיול שלא צריך (כפילות, טעות בקוד או בתאריך): הפח בסוף השורה שלו ← מאשרים. הוא יוצא מהדוח ומרשימת הקישורים, והקישור שלו מפסיק לקבל תשובות; \"ביטול\" בהודעה מחזיר אותו. רק טיול ריק אפשר למחוק - טיול עם משובים נשאר עד שמוחקים אותם."),
        ],
      },
      {
        title: t("Compare escorts and trips", "השוואת מלווים וטיולים"),
        steps: [
          t("In the trips report, the \"Escort\" filter suggests every escort's name; \"Departure from\" / \"Departure to\" set a date range. The cards, the tabs and the PDF all follow the filters.", "בדוח הטיולים, מסנן \"Escort\" מציע את שמות כל המלווים; \"Departure from\" / \"Departure to\" קובעים טווח תאריכים. הכרטיסים, הלשוניות וה-PDF כולם הולכים לפי הסינון."),
          t("\"Escorts\" tab: one row per escort - how many trips, first and last departure, responses, average, and \"Last trip vs before\" (their latest trip against their earlier ones). Click a row for the trips in date order and their per-question average against everyone; \"Show their trips\" filters the report to them.", "לשונית \"Escorts\": שורה לכל מלווה - כמה טיולים, יציאה ראשונה ואחרונה, תשובות, ממוצע, ו-\"Last trip vs before\" (הטיול האחרון מול הקודמים שלו). לחיצה על שורה מציגה את הטיולים לפי תאריך ואת הממוצע שלו לכל שאלה מול כולם; \"Show their trips\" מסנן את הדוח אליו."),
          t("Open a trip in the \"Trips\" tab: when its escort led earlier trips, a table compares this trip with them per question (\"This trip\" / \"Earlier\" / \"Change\") and with all other trips.", "פותחים טיול בלשונית \"Trips\": אם המלווה שלו הוביל טיולים קודמים, טבלה משווה את הטיול הזה אליהם בכל שאלה (\"This trip\" / \"Earlier\" / \"Change\") ולכל שאר הטיולים."),
          t("\"Questions\" tab: every star question over the filtered trips, weakest first.", "לשונית \"Questions\": כל שאלות הכוכבים על הטיולים המסוננים, מהחלשה לחזקה."),
        ],
      },
      {
        title: t("Export the feedback to PDF", "ייצוא המשובים ל-PDF"),
        steps: [
          t("\"Export PDF\" above the report exports what the filters show: page 1 is the summary (totals, average per question, the trips), then one page per family with all its answers. \"PDF of this trip\" inside an open trip exports that trip alone - with the comparison to the escort's earlier trips.", "\"Export PDF\" מעל הדוח מייצא את מה שהסינון מציג: עמוד 1 הוא הסיכום (סכומים, ממוצע לכל שאלה, הטיולים), ואחריו עמוד לכל משפחה עם כל התשובות שלה. \"PDF of this trip\" בתוך טיול פתוח מייצא רק את הטיול הזה - כולל ההשוואה לטיולים הקודמים של המלווה."),
          t("A new tab opens with the print window: pick \"Save as PDF\" as the destination and save. \"הדפסה / שמירה כ-PDF\" at the top opens it again.", "נפתחת לשונית חדשה עם חלון ההדפסה: בוחרים יעד \"שמירה כ-PDF\" ושומרים. \"הדפסה / שמירה כ-PDF\" למעלה פותח אותו שוב."),
        ],
      },
    ],
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
    id: "assets",
    nav: "/assets",
    productType: "events",
    title: t("Assets - the crest library", "Assets - ספריית הסמלים"),
    intro: t(
      "The football crest library. The site, the team pages and the creative generator all take a team's crest from here, matched by the team's English name.",
      "ספריית סמלי הכדורגל. האתר, עמודי הקבוצות ומחולל הקריאייטיב לוקחים מכאן את הסמל של קבוצה, לפי השם שלה באנגלית.",
    ),
    howTo: [
      {
        title: t("Upload a team crest", "העלאת סמל קבוצה"),
        steps: [
          t("Open [Assets](/assets) and search for the team first - its crest may already be there.", "פותחים את [Assets](/assets) ומחפשים קודם את הקבוצה - ייתכן שהסמל כבר קיים."),
          t("In \"העלאת לוגו חדש\" pick the file under \"Logo file (PNG/SVG/WebP, max 2MB)\" - a transparent, tightly cropped PNG works best.", "ב\"העלאת לוגו חדש\" בוחרים קובץ תחת \"Logo file (PNG/SVG/WebP, max 2MB)\" - הכי טוב PNG שקוף וחתוך צמוד."),
          t("\"Name (English)\" exactly as the team is written on the events (Real Madrid); the Hebrew name in \"שם (עברית, אופציונלי)\" lets a Hebrew search find it.", "\"Name (English)\" בדיוק כמו שהקבוצה כתובה באירועים (Real Madrid); השם בעברית ב\"שם (עברית, אופציונלי)\" מאפשר חיפוש בעברית."),
          t("Click \"Upload logo\" - \"Logo added\" = live, and the site refreshes by itself. A red \"הלוגו לא הועלה\" says what to fix (size, file type, or that English name already exists); \"באג בצד השרת\" = tell the developer.", "לוחצים \"Upload logo\" - \"Logo added\" = באוויר, והאתר מתרענן לבד. \"הלוגו לא הועלה\" באדום אומר מה לתקן (גודל, סוג קובץ, או שהשם באנגלית כבר קיים); \"באג בצד השרת\" = מעדכנים את המפתח."),
        ],
      },
      {
        title: t("Find a crest, or close a missing-crest gap", "חיפוש סמל, או סגירת חוסר סמל"),
        steps: [
          t("Type part of the name in \"חפש לוגו (עברית או אנגלית)...\" - both names are searched.", "מקלידים חלק מהשם ב\"חפש לוגו (עברית או אנגלית)...\" - החיפוש עובר על שני השמות."),
          t("From [Creative gaps](/tasks?tab=gaps), \"Do\" on a missing-crest row opens Assets with the team already searched.", "מ[חוסרי קריאייטיב](/tasks?tab=gaps), \"Do\" בשורת סמל חסר פותח את Assets עם הקבוצה כבר בחיפוש."),
          t("Nothing found? Shorten to the core name (\"Tottenham\", not \"Tottenham Hotspur FC\") before uploading, so you don't add a second copy.", "לא נמצא? מקצרים לשם העיקרי (\"Tottenham\" ולא \"Tottenham Hotspur FC\") לפני שמעלים, כדי לא להוסיף עותק שני."),
          t("The upload clears the team's crest gap by itself (the radar matches the library by English name, Hebrew name, or the same club without \"FC\").", "ההעלאה סוגרת את חוסר הסמל של הקבוצה מעצמה (הרדאר מתאים לספרייה לפי שם באנגלית, שם בעברית, או אותו מועדון בלי \"FC\")."),
        ],
      },
      {
        title: t("Rename or replace a crest", "שינוי שם או החלפה של סמל"),
        steps: [
          t("The pencil on a crest → \"Edit logo names\" → fix the English or Hebrew name → \"Save\".", "העיפרון על סמל ← \"Edit logo names\" ← מתקנים את השם באנגלית או בעברית ← \"Save\"."),
          t("To replace the image: the trash icon → \"Delete\" (crest and file are gone for good), then upload the new file under the same English name.", "להחלפת תמונה: הפח ← \"Delete\" (הסמל והקובץ נמחקים לצמיתות), ואז מעלים את הקובץ החדש באותו שם באנגלית."),
          t("A crest can also be uploaded from the team's page in [Football Teams](/templates/football) - \"Upload crest to library\" files it here.", "אפשר להעלות סמל גם מעמוד הקבוצה ב[קבוצות כדורגל](/templates/football) - \"Upload crest to library\" שומר אותו כאן."),
        ],
      },
    ],
    links: [{ label: t("Assets (crests)", "Assets (סמלים)"), href: "/assets" }],
  },
  {
    id: "storage",
    nav: "/storage",
    productType: "events",
    title: t("Storage - raw files", "Storage - קבצים"),
    intro: t(
      "A raw file browser over the site's media buckets - to get a file's direct URL, or upload a file outside the regular forms.",
      "דפדפן קבצים ישיר על דליי המדיה של האתר - כדי לקבל URL ישיר של קובץ, או להעלות קובץ מחוץ לטפסים הרגילים.",
    ),
    howTo: [
      {
        title: t("Find a file and copy its URL", "מציאת קובץ והעתקת ה-URL שלו"),
        steps: [
          t("Open [Storage](/storage) and click a bucket card. Images uploaded from Templates and the Homepage board are in [templates](/storage?bucket=templates); crests are in \"football-logos\".", "פותחים את [Storage](/storage) ולוחצים על כרטיס דלי. תמונות מהתבניות ומלוח עמוד הבית נמצאות ב-[templates](/storage?bucket=templates); הסמלים ב-\"football-logos\"."),
          t("Click a folder to open it; the path above the list (or the back arrow) goes up.", "לחיצה על תיקייה פותחת אותה; הנתיב מעל הרשימה (או החץ אחורה) מעלה רמה."),
          t("There is no search: files sort by name and form uploads start with a timestamp, so the newest are at the bottom.", "אין חיפוש: קבצים ממוינים לפי שם, והעלאות מטפסים מתחילות בחותמת זמן - החדשים בתחתית."),
          t("Click the file name for the preview, then \"Copy URL\" (\"Open\" and \"Download\" are next to it).", "לחיצה על שם הקובץ פותחת תצוגה מקדימה, ואז \"Copy URL\" (\"Open\" ו-\"Download\" לידו)."),
        ],
      },
      {
        title: t("Upload, replace or delete a file", "העלאה, החלפה או מחיקה של קובץ"),
        steps: [
          t("Open the right bucket and folder (\"New Folder\" → \"Folder Name\" → \"Create Folder\" for a new one), click \"Upload Files\" and drag files in or click the box - several at once is fine.", "פותחים את הדלי והתיקייה הנכונים (\"New Folder\" ← \"Folder Name\" ← \"Create Folder\" לתיקייה חדשה), לוחצים \"Upload Files\" וגוררים קבצים או לוחצים על התיבה - אפשר כמה בבת אחת."),
          t("Wait for \"Upload complete\". A same-named file in that folder makes the upload fail - rename and retry.", "מחכים ל-\"Upload complete\". קובץ באותו שם בתיקייה מכשיל את ההעלאה - משנים שם ומנסים שוב."),
          t("Files can't be overwritten: upload the new version under a new name and paste its URL where the old one was used.", "אי אפשר לדרוס קובץ: מעלים גרסה חדשה בשם חדש ומדביקים את ה-URL שלה במקום הישן."),
          t("Delete only a file nothing uses: trash icon → type \"delete this file\" → \"Delete\". It is permanent; a page still pointing at it shows a broken image.", "מוחקים רק קובץ שאף אחד לא משתמש בו: פח ← מקלידים \"delete this file\" ← \"Delete\". המחיקה סופית; עמוד שעדיין מפנה אליו יציג תמונה שבורה."),
        ],
      },
    ],
    links: [{ label: t("Storage", "Storage"), href: "/storage" }],
  },
  {
    id: "locations",
    nav: "/locations",
    productType: "events",
    title: t("Locations - cities and hotels", "מיקומים - ערים ומלונות"),
    intro: t(
      "The cities events happen in, each with coordinates and an optional IATA code. The IATA drives flight pricing and the automatic lookup in the wizard and the AI Uploader - which places each show on the nearest location within 50 km, or by the city's name or its \"שמות נוספים\", and asks to create a location when a show has none (keep this table growing); \"טען מלונות\" loads a city's hotels before it goes on sale.",
      "הערים שבהן יש אירועים, כל אחת עם קואורדינטות וקוד IATA לא חובה. ה-IATA מניע את תמחור הטיסות ואת הזיהוי האוטומטי בוויזרד וב-AI Uploader - ששם כל הופעה על הלוקיישן הקרוב עד 50 ק\"מ, או לפי שם העיר או \"שמות נוספים\" שלה, ושואל ליצור מיקום כשלהופעה אין (כדאי להמשיך להרחיב את הטבלה); \"טען מלונות\" טוען את המלונות של עיר לפני שהיא עולה למכירה.",
    ),
    howTo: [
      {
        title: t("Add a city", "הוספת עיר"),
        steps: [
          t("Open [Locations](/locations) and search \"Search locations...\" first (name or IATA) - it may already exist. Then \"Add Location\".", "פותחים את [המיקומים](/locations) ומחפשים קודם ב-\"Search locations...\" (שם או IATA) - ייתכן שהעיר קיימת. ואז \"Add Location\"."),
          t("\"Location Name *\": the city as customers should see it (ליברפול). \"Latitude *\" / \"Longitude *\": the city centre (e.g. from Google Maps) - hotels load around this point.", "\"Location Name *\": העיר כמו שהלקוחות צריכים לראות (ליברפול). \"Latitude *\" / \"Longitude *\": מרכז העיר (למשל מגוגל מפות) - המלונות נטענים סביב הנקודה."),
          t("\"City IATA Code\": the code flights are searched by (LON, BCN). Leave it empty for a city with no flights of its own, like Liverpool reached on a London flight.", "\"City IATA Code\": הקוד שלפיו מחפשים טיסות (LON, BCN). משאירים ריק לעיר בלי טיסות משלה, כמו ליברפול שמגיעים אליה בטיסה ללונדון."),
          t("Optional \"Country Code\" (GB) and \"שמות נוספים\": the other spellings suppliers print for the city (Rome, Roma; Munich, München), comma-separated - the AI Uploader joins a TixStock and a LiveTickets show of one city by them, and a spelling you add holds for every later run. Click \"Create Location\", then load its hotels.", "\"Country Code\" לא חובה (GB) ו-\"שמות נוספים\": הכתיבים האחרים שהספקים מדפיסים לעיר (Rome, Roma; Munich, München), מופרדים בפסיק - ה-AI Uploader מחבר לפיהם הופעה של TixStock והופעה של LiveTickets באותה עיר, וכתיב שהוספתם תקף לכל ריצה מאוחרת. לוחצים \"Create Location\" ואז טוענים מלונות."),
        ],
      },
      {
        title: t("Load a city's hotels (\"טען מלונות\")", "טעינת מלונות לעיר (\"טען מלונות\")"),
        steps: [
          t("On the city's card in [Locations](/locations), the bottom line says \"מלונות: לא נטען\", \"נטען חלקית\", or the hotel count and date.", "בכרטיס העיר ב[מיקומים](/locations), השורה התחתונה אומרת \"מלונות: לא נטען\", \"נטען חלקית\", או מספר המלונות והתאריך."),
          t("Click \"טען מלונות\" and keep the tab open - about 12 hotels a step, 15-20 minutes for a whole city. \"עצירה\" stops; if it shows \"המשך טעינה\", click it to carry on.", "לוחצים \"טען מלונות\" ומשאירים את הלשונית פתוחה - כ-12 מלונות לצעד, 15-20 דקות לעיר שלמה. \"עצירה\" עוצר; אם מופיע \"המשך טעינה\", לוחצים כדי להמשיך."),
          t("Done when the line shows a count and a date; \"רענון מלונות\" reloads later. The same button is on the Location and Lodging cards in the event editor.", "מסתיים כשהשורה מציגה מספר ותאריך; \"רענון מלונות\" טוען מחדש בהמשך. אותו כפתור נמצא בכרטיסי Location ו-Lodging בעורך האירוע."),
        ],
      },
      {
        title: t("Fix or remove a city", "תיקון או מחיקה של עיר"),
        steps: [
          t("The pencil on the city's card → fix → \"Update Location\". A new name shows on the site (customers filter by it).", "העיפרון בכרטיס העיר ← מתקנים ← \"Update Location\". שם חדש מופיע באתר (הלקוחות מסננים לפיו)."),
          t("New coordinates are a new point for hotels - run \"טען מלונות\" again.", "קואורדינטות חדשות = נקודה חדשה למלונות - מריצים שוב \"טען מלונות\"."),
          t("The trash icon deletes the city for good (\"This action cannot be undone\") - only for a duplicate or a mistake.", "הפח מוחק את העיר לצמיתות (\"This action cannot be undone\") - רק לכפילות או לטעות."),
        ],
      },
    ],
    links: [{ label: t("Locations", "מיקומים"), href: "/locations" }],
  },
  {
    id: "templates",
    nav: "/templates",
    productType: "events",
    title: t("Templates - artist, team and blog pages", "תבניות - עמודי אמנים, קבוצות ובלוג"),
    intro: t(
      "The site's content pages outside events: artists, football teams and blog posts (categories have their own screen). Each page is edited in one form - text, hero image, blob card art and gallery; missing visuals show up in the gaps radar automatically.",
      "עמודי התוכן של האתר מחוץ לאירועים: אמנים, קבוצות כדורגל ופוסטים בבלוג (לקטגוריות מסך משלהן). כל עמוד נערך בטופס אחד - טקסט, תמונה ראשית, ארט בלוב לכרטיס וגלריה; חוסרים ויזואליים מופיעים ברדאר אוטומטית.",
    ),
    howTo: [
      {
        title: t("Open and save a team or artist page", "פתיחה ושמירה של עמוד קבוצה או אמן"),
        steps: [
          t("Open [Templates](/templates) and pick \"Artists\" or \"Football Teams\" - or go straight to [Artists](/templates/artists) / [Football Teams](/templates/football).", "פותחים את [התבניות](/templates) ובוחרים \"Artists\" או \"Football Teams\" - או ישר ל[אמנים](/templates/artists) / [קבוצות כדורגל](/templates/football)."),
          t("Search \"Search name, English, or slug…\" and click the pencil. On an existing page leave \"Slug (optional)\" alone - it's the page address.", "מחפשים ב-\"Search name, English, or slug…\" ולוחצים על העיפרון. בעמוד קיים לא נוגעים ב-\"Slug (optional)\" - זו כתובת העמוד."),
          t("\"Save\" (on the form or the sticky bar); \"Active (visible on the site)\" controls whether it shows. Template saves don't refresh the site - click \"Revalidate live site\" on the list.", "\"Save\" (בטופס או בסרגל הצף); \"Active (visible on the site)\" קובע אם מוצג. שמירת תבנית לא מרעננת את האתר - לוחצים \"Revalidate live site\" ברשימה."),
        ],
      },
      {
        title: t("Hero image and blob card art", "תמונה ראשית וארט בלוב לכרטיס"),
        steps: [
          t("\"Hero image\": upload (the file field below it), paste a URL, or browse storage (folder icon); clear the URL to remove.", "\"Hero image\": העלאה (שדה הקובץ שמתחתיו), הדבקת URL, או דפדוף באחסון (אייקון התיקייה); ריקון ה-URL מסיר."),
          t("\"Card art - cut-out + blob (optional)\" → \"Upload + cut out\" (the background is removed), then \"Blob colour\" and \"Background - blob / photo\"; fit with \"Cut-out zoom\", \"Cut-out position ↔ / ↕\" and \"Background zoom\".", "\"Card art - cut-out + blob (optional)\" ← \"Upload + cut out\" (הרקע מוסר), ואז \"Blob colour\" ו-\"Background - blob / photo\"; מתאימים עם \"Cut-out zoom\", \"Cut-out position ↔ / ↕\" ו-\"Background zoom\"."),
          t("Save. A page with card art doesn't need a hero image too - the gaps radar accepts either. A new cut-out redraws every ad of that artist on the next creative run.", "שומרים. עמוד עם ארט לכרטיס לא צריך גם תמונה ראשית - הרדאר מקבל כל אחד מהם. cut-out חדש מצייר מחדש את כל המודעות של האמן בריצת הקריאייטיב הבאה."),
        ],
      },
      {
        title: t("Gallery, bio and videos", "גלריה, ביוגרפיה וסרטונים"),
        steps: [
          t("\"Bio\": plain paragraphs with a blank line between.", "\"Bio\": פסקאות פשוטות עם שורה ריקה ביניהן."),
          t("\"Gallery images\": \"Add from storage\" (several), \"Upload + cut out\" or \"Add by URL\"; × on a photo removes it.", "\"Gallery images\": \"Add from storage\" (כמה), \"Upload + cut out\" או \"Add by URL\"; × על תמונה מסיר."),
          t("An artist has TWO groups of pictures. \"Mood gallery (גלריית אווירה)\" shows on the artist page only. \"Event variety (גיוון אירועים)\" is what the site's event cards and the Meta feed ads rotate through, one picture per event - cut-outs only. A new picture joins the mood gallery, \"Upload + cut out\" joins event variety; \"To events\" / \"To mood\" on a picture moves it. A mood photo never reaches an event card or an ad.", "לאמן יש שתי קבוצות תמונות. \"Mood gallery (גלריית אווירה)\" מוצגת רק בעמוד האמן. \"Event variety (גיוון אירועים)\" היא מה שכרטיסי האירועים באתר והמודעות בפיד של מטא מתחלפים ביניהן, תמונה לכל אירוע - רק cut-out. תמונה חדשה נכנסת לגלריית האווירה, \"Upload + cut out\" נכנס לגיוון האירועים; הכפתור \"To events\" / \"To mood\" על התמונה מעביר אותה. תמונת אווירה לעולם לא מגיעה לכרטיס אירוע או למודעה."),
          t("\"Hero video (YouTube URL)\" loops inside the hero circle. \"Performance videos\" and \"Banners\" take one item per line: \"youtube_url | label\" and \"image_url | link_url | title\". Save, then \"Revalidate live site\".", "\"Hero video (YouTube URL)\" מתנגן בלופ בעיגול ההירו. \"Performance videos\" ו-\"Banners\" מקבלים פריט בשורה: \"youtube_url | label\" ו-\"image_url | link_url | title\". שומרים ואז \"Revalidate live site\"."),
        ],
      },
      {
        title: t("Add a new artist or team", "הוספת אמן או קבוצה חדשים"),
        steps: [
          t("Click [\"Add New Artist\"](/templates/artists/new) or [\"Add New Team\"](/templates/football/new).", "לוחצים [\"Add New Artist\"](/templates/artists/new) או [\"Add New Team\"](/templates/football/new)."),
          t("\"Name (Hebrew)\" and \"Name English (events match key)\" - the English name must match how it's written on the events.", "\"Name (Hebrew)\" ו-\"Name English (events match key)\" - השם באנגלית חייב להתאים לכתיב באירועים."),
          t("Saving a new one also creates its tag, an auto-tag rule and a category page under the artists/teams hub, and tags existing events - check [Tags & Rules](/event-tags) after.", "שמירה של חדש יוצרת גם תגית, כלל תיוג אוטומטי ועמוד קטגוריה תחת צומת האמנים/הקבוצות, ומתייגת אירועים קיימים - בודקים אחר כך ב[תגיות וחוקים](/event-tags)."),
          t("A team: upload the crest in \"Crest - football logos library\" with \"Upload crest to library\" (transparent PNG, up to 2MB, English name first). For the homepage hero or rows, use [Homepage](/homepage).", "קבוצה: מעלים סמל ב-\"Crest - football logos library\" עם \"Upload crest to library\" (PNG שקוף, עד 2MB, קודם שם באנגלית). להירו או לשורות בדף הבית - [עמוד הבית](/homepage)."),
        ],
      },
      {
        title: t("Write a blog post", "כתיבת פוסט לבלוג"),
        steps: [
          t("Open [Blog](/templates/blog) → \"Add New Post\".", "פותחים את [הבלוג](/templates/blog) ← \"Add New Post\"."),
          t("Have HTML? Paste into \"Paste article HTML (auto-fill)\" → \"Fill fields\" (title, SEO title, preview, body - not saved yet).", "יש HTML? מדביקים ב-\"Paste article HTML (auto-fill)\" ← \"Fill fields\" (כותרת, כותרת SEO, תקציר, גוף - עוד לא נשמר)."),
          t("Check \"Title\", \"Author\", \"Preview text\" and the \"Body\" editor (its \"HTML\" tab takes raw HTML); add \"Hero image\" and optional post art.", "בודקים \"Title\", \"Author\", \"Preview text\" ואת עורך ה-\"Body\" (הלשונית \"HTML\" מקבלת HTML גולמי); מוסיפים \"Hero image\" וארט לא חובה."),
          t("Keep \"Active (visible on the site)\" ticked to publish; \"Save\", then \"Revalidate live site\".", "משאירים \"Active (visible on the site)\" מסומן לפרסום; \"Save\" ואז \"Revalidate live site\"."),
        ],
      },
    ],
    links: [
      { label: t("Templates", "תבניות"), href: "/templates" },
      { label: t("Artists", "אמנים"), href: "/templates/artists" },
      { label: t("Football teams", "קבוצות כדורגל"), href: "/templates/football" },
      { label: t("Blog", "בלוג"), href: "/templates/blog" },
    ],
  },
  {
    id: "users",
    nav: "/users",
    productType: "events",
    title: t("Users & roles", "משתמשים ותפקידים"),
    adminOnly: true,
    intro: t(
      "Admins create and manage every login here, for staff and partners alike. There is no invite email and no \"forgot password\" link: an admin creates each account and resets passwords. An admin manages editors, agents, affiliates and forms operators; only a superadmin manages admin, superadmin and office_manager accounts.",
      "כאן מנהלים יוצרים ומנהלים כל כניסה למערכת, גם של צוות וגם של שותפים. אין מייל הזמנה ואין קישור \"שכחתי סיסמה\": מנהל יוצר כל חשבון ומאפס סיסמאות. מנהל (admin) מנהל עורכים, סוכנים, משפיענים ומפעילי טפסים; רק superadmin מנהל חשבונות admin, superadmin ו-office_manager.",
    ),
    howTo: [
      {
        title: t("Add a user", "הוספת משתמש"),
        steps: [
          t("Open [Users](/users) and click \"Add user\" (admins).", "פותחים את [המשתמשים](/users) ולוחצים \"Add user\" (מנהלים)."),
          t("Fill in \"Email\" and a \"Temporary password\" (8+ characters) - a throwaway, never one the person uses elsewhere. The email can't be changed later.", "ממלאים \"Email\" ו-\"Temporary password\" (8 תווים ומעלה) - סיסמה זמנית, אף פעם לא סיסמה שהאדם משתמש בה במקום אחר. את המייל אי אפשר לשנות אחר כך."),
          t("Add a \"Display name\" and pick the \"Role\": editor for catalog staff, forms_operator for someone who only works in Forms. For agent, affiliate or office_manager, pick the partner under \"Partner\" (required) and attach the signed contract under \"Contract\" if you have it.", "מוסיפים \"Display name\" ובוחרים \"Role\": editor לצוות הקטלוג, forms_operator למי שעובד רק בטפסים. ל-agent, affiliate או office_manager בוחרים שותף ב-\"Partner\" (חובה) ומצרפים חוזה חתום ב-\"Contract\" אם יש."),
          t("Click \"Create user\" - the toast confirms the person \"can now sign in\".", "לוחצים \"Create user\" - ההודעה מאשרת שהאדם \"can now sign in\"."),
          t("Give access privately. Anyone with a Google email can use \"Continue with Google\"; otherwise hand over the temporary password in person or by phone, never in a task thread or group chat.", "מעבירים את הגישה בפרטי. מי שיש לו מייל Google יכול להיכנס עם \"Continue with Google\"; אחרת מוסרים את הסיסמה הזמנית פנים אל פנים או בטלפון, אף פעם לא בפתיל משימה או בקבוצה."),
        ],
      },
      {
        title: t("Change a role or details", "שינוי תפקיד או פרטים"),
        steps: [
          t("In [Users](/users), open the ⋯ menu at the end of the person's row → \"Edit\" (admins).", "ב[משתמשים](/users) פותחים את תפריט ה-⋯ בסוף השורה של האדם ← \"Edit\" (מנהלים)."),
          t("Change \"Role\", \"Display name\", \"Phone\" or the \"Partner\" link, then click \"Save changes\".", "משנים \"Role\", \"Display name\", \"Phone\" או את קישור ה-\"Partner\", ולוחצים \"Save changes\"."),
          t("A new staff role applies on the person's next click (their menu updates after they sign in again); a move to a partner or forms role needs a new sign-in.", "תפקיד צוות חדש חל כבר בלחיצה הבאה של האדם (התפריט שלו מתעדכן אחרי כניסה מחדש); מעבר לתפקיד שותף או טפסים דורש כניסה מחדש."),
          t("Linking a partner to a staff user (\"Partner (optional - dual-role)\") adds \"מצב סוכן\" to their menu. A row with no ⋯ menu can only be managed by a superadmin; nobody can change their own role.", "קישור שותף למשתמש צוות (\"Partner (optional - dual-role)\") מוסיף לו \"מצב סוכן\" בתפריט. שורה בלי תפריט ⋯ מנוהלת רק על ידי superadmin; אף אחד לא משנה את התפקיד של עצמו."),
        ],
      },
      {
        title: t("Switch a user off (or back on)", "השבתת משתמש (או החזרה)"),
        steps: [
          t("In [Users](/users), turn off the \"Active\" switch on the person's row (admins). Users are never deleted.", "ב[משתמשים](/users) מכבים את מתג ה-\"Active\" בשורה של האדם (מנהלים). משתמשים אף פעם לא נמחקים."),
          t("Sign-in is refused from then on, by password and by Google. Partners and forms operators are cut off at their next click.", "מאותו רגע הכניסה נחסמת, בסיסמה וב-Google. שותפים ומפעילי טפסים מנותקים כבר בלחיצה הבאה."),
          t("Staff are cut off at their next click too - no waiting for the session to expire.", "גם איש צוות מנותק כבר בלחיצה הבאה - בלי לחכות שהחיבור יפוג."),
          t("Switch it back on to restore access - role, partner link and history are kept. You can't switch off your own account.", "מדליקים שוב כדי להחזיר גישה - התפקיד, קישור השותף וההיסטוריה נשמרים. אי אפשר להשבית את החשבון של עצמכם."),
        ],
      },
      {
        title: t("Reset a password", "איפוס סיסמה"),
        steps: [
          t("In [Users](/users), the row's ⋯ menu → \"Reset password\" (admins).", "ב[משתמשים](/users), תפריט ה-⋯ בשורה ← \"Reset password\" (מנהלים)."),
          t("Best: the person types the new password into \"New password\" themselves. Otherwise set a throwaway (8+ characters) - never ask for a password they use elsewhere.", "הכי טוב שהאדם יקליד בעצמו את הסיסמה החדשה ב-\"New password\". אחרת קובעים סיסמה זמנית (8 תווים ומעלה) - אף פעם לא מבקשים סיסמה שהוא משתמש בה במקום אחר."),
          t("Click \"Reset password\". The old one stops working at once, and the [Audit Log](/audit-log) records \"password_reset\" without the password.", "לוחצים \"Reset password\". הסיסמה הישנה מפסיקה לעבוד מיד, ו[לוג הביקורת](/audit-log) רושם \"password_reset\" בלי הסיסמה עצמה."),
          t("Staff can't change their own password, but a Google email can skip passwords with \"Continue with Google\". Partners change theirs in their portal profile (\"שינוי סיסמה\").", "לצוות אין מקום לשנות סיסמה בעצמו, אבל עם מייל Google אפשר לוותר על סיסמה עם \"Continue with Google\". שותפים משנים סיסמה בפרופיל שלהם בפורטל (\"שינוי סיסמה\")."),
        ],
      },
    ],
    points: [
      t(
        "Roles: superadmin and admin manage everything including users; editor works the catalog and their own tasks; forms_operator sees only Forms; office_manager / agent / affiliate are portal-side partner roles and never see this dashboard.",
        "תפקידים: superadmin ו־admin מנהלים הכול כולל משתמשים; editor עובד על הקטלוג והמשימות שלו; forms_operator רואה רק טפסים; office_manager / agent / affiliate הם תפקידי פורטל ולא רואים את הדשבורד הזה.",
      ),
    ],
    rules: [
      t(
        "Database schema changes ship as migration files applied from the main branch only - never by hand, never from a feature branch. If you're not sure, ask before touching.",
        "שינויי סכמה עוברים כקבצי מיגרציה שמוחלים רק מה־branch הראשי — לעולם לא ידנית ולא מ־feature branch. לא בטוחים? שואלים לפני שנוגעים.",
      ),
    ],
  },
  {
    id: "audit-log",
    nav: "/audit-log",
    productType: "events",
    title: t("Audit log - who changed what", "לוג ביקורת - מי שינה מה"),
    adminOnly: true,
    intro: t(
      "A read-only record of what people did in the backoffice: who, when, from which IP and what changed, plus sign-ins and failed sign-ins. It shows only the newest 200 rows that match your filters (500 for one entity), so filter before you scroll. The fastest way in is the \"History\" button at the top of an event, flight or hotel page - the log opens on that one entity. Rows are kept 30 days. Automatic changes such as the nightly price sync are not recorded here - those are on Price Changes.",
      "תיעוד לקריאה בלבד של מה שאנשים עשו בבק-אופיס: מי, מתי, מאיזו כתובת IP ומה השתנה, וגם כניסות וכניסות שנכשלו. מוצגות רק 200 השורות האחרונות שמתאימות לסינון (500 לישות אחת), אז קודם מסננים ואחר כך גוללים. הדרך המהירה פנימה היא כפתור \"History\" בראש דף של אירוע, טיסה או מלון - הלוג נפתח על הישות הזאת בלבד. שורות נשמרות 30 יום. שינויים אוטומטיים כמו סנכרון המחירים הלילי לא נרשמים כאן - הם במסך שינויי המחיר.",
    ),
    howTo: [
      {
        title: t("Find who changed an event", "לגלות מי שינה אירוע"),
        steps: [
          t("Open the event and click \"History\" at the top - the log opens on that event alone, newest first, every row named by the event. Done.", "פותחים את האירוע ולוחצים \"History\" למעלה - הלוג נפתח על האירוע הזה בלבד, מהחדש לישן, וכל שורה נושאת את שם האירוע. זהו."),
          t("From the log itself: set \"Entity type\" to \"event\", type the number into \"Entity ID\" and leave \"All actions\" (price-light and price-change decisions have their own action names that the Action list doesn't include).", "מהלוג עצמו: בוחרים \"Entity type\" = \"event\", מקלידים את המספר ב-\"Entity ID\" ומשאירים \"All actions\" (להחלטות רמזור ושינויי מחיר יש שמות פעולה משלהן שלא ברשימת ה-Action)."),
          t("Set \"From\" / \"To\" around the day of the change and click \"Apply\". Dates are UTC days - widen the range by a day for an evening change.", "קובעים \"From\" / \"To\" סביב היום של השינוי ולוחצים \"Apply\". התאריכים הם ימי UTC - לשינוי בערב מרחיבים ביום."),
          t("Look for \"event #1234\" in \"Entity\"; \"Actor\" shows who did it (\"-\" = no signed-in person). Click the row to see exactly what changed.", "מחפשים \"event #1234\" בעמודת \"Entity\"; \"Actor\" מראה מי עשה את זה (\"-\" = לא היה אדם מחובר). לוחצים על השורה כדי לראות מה בדיוק השתנה."),
        ],
      },
      {
        title: t("Find who changed a price", "לגלות מי שינה מחיר"),
        steps: [
          t("Filter the same way (\"event\", \"All actions\", dates, \"Apply\").", "מסננים באותה דרך (\"event\", \"All actions\", תאריכים, \"Apply\")."),
          t("A hand edit in the event form is an \"update\" row - look inside for base_flight_price, base_hotel_price or a markup field (ticket_only_markup, event_additional_markup…).", "עריכה ידנית בטופס האירוע היא שורת \"update\" - מחפשים בפנים base_flight_price, base_hotel_price או שדה markup (ticket_only_markup, event_additional_markup…)."),
          t("\"base_price.approve_review\" = someone clicked \"אשר עדכון\" in [Price Changes](/price-changes); \"base_price.resolve_review\" = \"עודכן באירוע\". Rows starting \"price_light.\" are price-light decisions (price_light.repriced = \"הוזל\", price_light.override = \"דריסה\").", "\"base_price.approve_review\" = מישהו לחץ \"אשר עדכון\" ב[שינויי המחיר](/price-changes); \"base_price.resolve_review\" = \"עודכן באירוע\". שורות שמתחילות ב-\"price_light.\" הן החלטות רמזור (price_light.repriced = \"הוזל\", price_light.override = \"דריסה\")."),
          t("No matching row? Then the nightly sync changed it - look the event up on [Price Changes](/price-changes) (admins).", "אין שורה מתאימה? אז הסנכרון הלילי שינה את המחיר - מחפשים את האירוע ב[שינויי המחיר](/price-changes) (מנהלים)."),
        ],
      },
      {
        title: t("Find who changed a flight or a hotel", "לגלות מי שינה טיסה או מלון"),
        steps: [
          t("Open the flight in [Offline Flights](/offline-flights) (the eye icon) or the hotel in [Offline Hotels](/offline-hotels). Under the ID, \"Last change: update by … on …\" says who touched it last.", "פותחים את הטיסה ב[טיסות האופליין](/offline-flights) (אייקון העין) או את המלון ב[מלונות האופליין](/offline-hotels). מתחת למזהה, \"Last change: update by … on …\" אומר מי נגע בה אחרון."),
          t("\"History\" at the top opens every change of it - the \"create\" row with the values typed in, then each edit with before and after.", "\"History\" למעלה פותח את כל השינויים שלה - שורת ה-\"create\" עם הערכים שהוקלדו, ואחריה כל עריכה עם לפני ואחרי."),
          t("A wrong date (a landing in July on a May flight) stands out: the row names the field in amber, and the details show the old and the new value side by side.", "תאריך שגוי (נחיתה ביולי על טיסה של מאי) בולט: השורה מונה את השדה בכתום, והפרטים מראים את הערך הישן והחדש זה לצד זה."),
        ],
      },
      {
        title: t("See what one person did, or why they can't sign in", "לראות מה אדם מסוים עשה, או למה הוא לא מצליח להיכנס"),
        steps: [
          t("Type part of their email into \"Actor email\", add dates if you like, and click \"Apply\". Sign-ins show as \"login\".", "מקלידים חלק מהמייל שלו ב-\"Actor email\", מוסיפים תאריכים אם רוצים, ולוחצים \"Apply\". כניסות מופיעות כ-\"login\"."),
          t("Can't sign in? Set \"Action\" to \"login_failed\", click \"Apply\" and open their row.", "לא מצליח להיכנס? בוחרים \"Action\" = \"login_failed\", לוחצים \"Apply\" ופותחים את השורה שלו."),
          t("The reason: \"inactive_account\" = switched off in [Users](/users), \"invalid_credentials\" = wrong password, \"no_profile\" / \"no_account\" = no user with that email.", "הסיבה: \"inactive_account\" = מושבת ב[משתמשים](/users), \"invalid_credentials\" = סיסמה שגויה, \"no_profile\" / \"no_account\" = אין משתמש עם המייל הזה."),
        ],
      },
      {
        title: t("Read the changes", "לקרוא את השינויים"),
        steps: [
          t("\"What changed\" on the row itself names the fields that moved - a time, date or price in amber - so most questions are answered without opening it. Click the row for the details (click again to close): an edit lists only the fields that changed, by the form's own names, each with \"Before\" and \"After\"; dates read 20/05/2027 14:00.", "\"What changed\" על השורה עצמה מונה את השדות שזזו - שעה, תאריך או מחיר בכתום - אז רוב השאלות נענות בלי לפתוח אותה. לחיצה על השורה פותחת את הפרטים (לחיצה נוספת סוגרת): עריכה מציגה רק את השדות שהשתנו, בשמות של הטופס, כל אחד עם \"Before\" ו-\"After\"; תאריכים נקראים 20/05/2027 14:00."),
          t("Looking for a value, not a person? Type it into \"Search the rows on screen\" - \"20/07\", a flight number, a name - and the rows on screen narrow to the ones that carry it. Every row names its entity (\"LY123 TLV→CDG 20/05/2027\", the event's name) and links to its page; \"history\" under the name narrows the log to that entity.", "מחפשים ערך ולא אדם? מקלידים אותו ב-\"Search the rows on screen\" - \"20/07\", מספר טיסה, שם - והשורות על המסך מצטמצמות לאלה שנושאות אותו. כל שורה נושאת את שם הישות שלה (\"LY123 TLV→CDG 20/05/2027\", שם האירוע) ומקשרת לדף שלה; \"history\" מתחת לשם מצמצם את הלוג לישות הזאת."),
          t("A deleted event shows is_deleted with the date it was hidden - events are never really deleted.", "אירוע שנמחק מציג is_deleted עם התאריך שבו הוסתר - אירועים אף פעם לא נמחקים באמת."),
          t("A bulk edit from the events table has no event number in \"Entity\" and shows only the new values - use the time and the person to work out what they edited.", "עריכה מרובה מטבלת האירועים מופיעה בלי מספר אירוע ב-\"Entity\" ומציגה רק את הערכים החדשים - לפי השעה ולפי מי שביצע מבינים מה הוא ערך."),
        ],
      },
    ],
  },
  // Mega Family (tours) - guide-content-tours.ts, every section tagged "tours".
  ...TOURS_GUIDE_SECTIONS,
];

export const GUIDE_UI: Record<string, L> = {
  subtitle: t(
    "Every screen of the system, in the sidebar's order: what it is for, how to do each job step by step, and the rules that keep production safe. Every link opens the screen in a new tab, so this guide stays open beside it.",
    "כל מסך במערכת, לפי הסדר של התפריט: למה הוא משמש, איך עושים כל פעולה צעד אחר צעד, והחוקים ששומרים על הפרודקשן. כל קישור פותח את המסך בלשונית חדשה, כך שהמדריך נשאר פתוח לצידו.",
  ),
  rules: t("Iron rules", "חוקי ברזל"),
  open: t("Open", "פתח"),
  openScreen: t("Open the screen", "פתח את המסך"),
  howItWorks: t("How it works", "איך זה עובד"),
  searchPlaceholder: t("Search the guide - a screen, a button, a task…", "חיפוש במדריך - מסך, כפתור, פעולה…"),
  noResults: t("Nothing in the guide matches that. Try another word, or English / Hebrew.", "אין במדריך תוצאה לחיפוש הזה. נסו מילה אחרת, או באנגלית / עברית."),
  adminBadge: t("Admins only", "מנהלים בלבד"),
  onThisPage: t("Contents", "תוכן העניינים"),
};
