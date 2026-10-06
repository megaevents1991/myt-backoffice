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
          t("\"Est. Margin\" is $175 (the site markup) per traveller on every Paid booking - an estimate of our margin, not the sum of booking prices.", "\"Est. Margin\" הוא 175$ (תוספת האתר) לכל נוסע בכל הזמנת Paid - הערכה של הרווח שלנו, לא סכום מחירי ההזמנות."),
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
          t("What the customer may swap: \"Closed package\" on = nothing. Or tick only some of \"Ticket\" / \"Flight\" / \"Hotel\" - a ticked piece gets a small \"החלפה\" link on the site, an unticked one is fixed. The same three boxes (and \"Nothing\" / \"Everything\") stay on the card afterwards, under \"The customer may swap\".", "מה הלקוח רשאי להחליף: \"Closed package\" דלוק = כלום. או מסמנים רק חלק מ-\"Ticket\" / \"Flight\" / \"Hotel\" - רכיב מסומן מקבל באתר קישור קטן \"החלפה\", רכיב לא מסומן קבוע. אותן שלוש תיבות (ו-\"Nothing\" / \"Everything\") נשארות אחר כך על הכרטיס, תחת \"The customer may swap\"."),
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
      "One screen per agent running in this system - what it is, what it has learned, every AI call it made, and how well its calls have held up against what staff actually decided. The price-light judge is agent #1; the price advisor (agent #2, 2026-09-17) words and ranks price suggestions from facts the light already computed. More will follow the same shape.",
      "מסך אחד לכל agent שרץ במערכת - מה הוא, מה הוא למד, כל קריאת AI שהוא ביצע, ומידת ההתאמה בין הקריאות שלו לבין מה שהצוות בפועל החליט. שופט הרמזור הוא agent מספר 1; יועץ המחיר (agent מספר 2, 17.09.2026) מנסח ומדרג הצעות מחיר מתוך עובדות שהרמזור עצמו חישב. עוד ילכו בעקבותיהם באותה תצורה.",
    ),
    howTo: [
      {
        title: t("Open an agent and check it is on", "לפתוח agent ולבדוק שהוא דלוק"),
        steps: [
          t("Open [AI Factory](/ai-factory) (admins). Each card shows the agent's status pill, \"עלות החודש\", \"קריאות החודש\" and \"שיעור התאמה\".", "פותחים את [AI Factory](/ai-factory) (מנהלים). בכל כרטיס רואים את תג הסטטוס של הסוכן, \"עלות החודש\", \"קריאות החודש\" ו\"שיעור התאמה\"."),
          t("Click a card (\"לפרטים\"), or go straight to the [Price light judge](/ai-factory/price-light) or the [Price advisor](/ai-factory/price-advisor).", "לוחצים על כרטיס (\"לפרטים\"), או נכנסים ישר ל[שופט הרמזור](/ai-factory/price-light) או ל[יועץ המחיר](/ai-factory/price-advisor)."),
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
          t("Or \"Send to factory\" (admins) - drafts build in the background and [Events Factory](/factory) opens for approval. \"Clear\" empties the selection.", "או \"Send to factory\" (מנהלים) - הטיוטות נבנות ברקע ו[מפעל האירועים](/factory) נפתח לאישור. \"Clear\" מנקה את הבחירה."),
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
        "From any provider row: open the single-event page to create one event, or multi-select rows for Batch create / Send to factory.",
        "מכל שורת ספק: פותחים את עמוד האירוע הבודד ליצירה אחת, או מסמנים כמה שורות ל־Batch create / שליחה למפעל.",
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
    id: "batch-factory",
    nav: "/factory",
    productType: "events",
    howTo: [
      {
        title: t("Send provider events to the factory (admins)", "לשלוח אירועי ספק למפעל (מנהלים)"),
        steps: [
          t("Open a provider page - [TixStock](/tixstock-events), [Sports](/sports-events), [Live](/live-events) or [P1](/p1-events) - and tick the events you want.", "פותחים עמוד ספק - [TixStock](/tixstock-events), [ספורט](/sports-events), [Live](/live-events) או [P1](/p1-events) - ומסמנים את האירועים שרוצים."),
          t("In the bottom bar (\"N selected\") click \"Send to factory\". Each event becomes a draft and [Events Factory](/factory) opens in a new tab.", "בפס שלמטה (\"N selected\") לוחצים \"Send to factory\". כל אירוע הופך לטיוטה ו[מפעל האירועים](/factory) נפתח בלשונית חדשה."),
          t("Drafts are not on the site - nothing reaches customers until you approve. Want to review each event on the full form instead? Use \"Create N events\" (the batch wizard).", "טיוטות לא מופיעות באתר - שום דבר לא מגיע ללקוחות עד שמאשרים. רוצים לעבור על כל אירוע בטופס המלא? \"Create N events\" (וויזרד הבאץ')."),
        ],
      },
      {
        title: t("Let the drafts build", "לתת לטיוטות להיבנות"),
        steps: [
          t("Keep [Events Factory](/factory) open - the build loop starts by itself, one draft at a time (IATA, stadium-memory tickets, live flight/hotel prices).", "משאירים את [מפעל האירועים](/factory) פתוח - לולאת הבנייה מתחילה לבד, טיוטה אחת בכל פעם (IATA, כרטיסים מזיכרון האצטדיון, מחירי טיסה/מלון חיים)."),
          t("The bar shows \"נבנו X מתוך Y\". \"עצור\" stops after the current draft; closing the page pauses, reopening resumes.", "הפס מציג \"נבנו X מתוך Y\". \"עצור\" עוצר אחרי הטיוטה הנוכחית; סגירת הדף משהה, פתיחה מחדש ממשיכה."),
          t("Each row ends \"מוכן\" (complete), \"חסר קלט\" (something missing, amber) or \"שגיאה\" (hover the red text for why).", "כל שורה מסתיימת ב-\"מוכן\" (שלם), \"חסר קלט\" (חסר משהו, בענבר) או \"שגיאה\" (ריחוף על הטקסט האדום מסביר)."),
        ],
      },
      {
        title: t("Fill in what the automation missed", "להשלים מה שהאוטומציה לא מילאה"),
        steps: [
          t("The \"Needs input\" view shows only \"חסר קלט\" rows. Amber cells are what's missing: \"IATA\", \"Flight $\", \"Hotel $\" - type and press Enter; it saves and the status updates.", "התצוגה \"Needs input\" מציגה רק שורות \"חסר קלט\". תאים בענבר הם מה שחסר: \"IATA\", \"Flight $\", \"Hotel $\" - מקלידים ולוחצים Enter; נשמר והסטטוס מתעדכן."),
          t("Typing an IATA doesn't re-quote the flight - fill \"Flight $\" too. The \"Event\" name can also be fixed inline.", "הקלדת IATA לא מתמחרת את הטיסה מחדש - ממלאים גם את \"Flight $\". גם את השם בעמודת \"Event\" אפשר לתקן בגריד."),
          t("An amber \"Tickets\" count (0) can't be fixed here and such a draft is never approved: \"מחק\" it and use the batch wizard or the single-event page. Editing a draft that was already created is refused - edit the event itself.", "ספירת \"Tickets\" בענבר (0) לא מתקנים כאן וטיוטה כזו לא מאושרת: \"מחק\" ואז וויזרד הבאץ' או עמוד האירוע הבודד. עריכת טיוטה שכבר נוצרה נחסמת - עורכים את האירוע עצמו."),
        ],
      },
      {
        title: t("Approve drafts into real events", "לאשר טיוטות לאירועים אמיתיים"),
        steps: [
          t("Open the \"Ready\" view, tick the rows and click \"אשר נבחרים\" - each draft becomes a live catalog event.", "פותחים את התצוגה \"Ready\", מסמנים שורות ולוחצים \"אשר נבחרים\" - כל טיוטה הופכת לאירוע חי בקטלוג."),
          t("The row turns \"נוצר\" with a \"לאירוע\" link - open it and check images, tags and tickets like any event.", "השורה הופכת ל-\"נוצר\" עם קישור \"לאירוע\" - פותחים ובודקים תמונות, תגיות וכרטיסים כמו בכל אירוע."),
          t("Only \"מוכן\" drafts are created - \"חסר קלט\" and \"שגיאה\" rows are skipped, and the toast says how many and why.", "רק טיוטות \"מוכן\" נוצרות - שורות \"חסר קלט\" ו\"שגיאה\" מדולגות, וההודעה אומרת כמה ולמה."),
          t("\"מחק\" asks first, then deletes the selected drafts for good. Created and failed rows clean up after 30 days.", "\"מחק\" מבקש אישור ואז מוחק את הטיוטות המסומנות לצמיתות. שורות שנוצרו או נכשלו מתנקות אחרי 30 יום."),
        ],
      },
    ],
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
        "Multi-team batch (TixStock): selection accumulates across teams with a chips row; \"select all home games of X\" uses the name-starts-with-team rule; crossing into another team - or another venue, as on an artist's tour - resets the dragged form so the previous venue doesn't leak.",
        "באץ' רב־קבוצות (TixStock): הבחירה נצברת בין קבוצות עם שורת צ'יפים; \"בחר את כל משחקי הבית של X\" משתמש בכלל שם־מתחיל־בשם־הקבוצה; מעבר לקבוצה אחרת - או לאולם אחר, כמו בסיבוב הופעות של אמן - מאפס את הטופס הנגרר כדי שהמתחם הקודם לא ידלוף.",
      ),
      t(
        "Stadium memory: a step that lands with no ticket categories copies the TixStock categories of the last event on the same seat map - the stadium's drawing, never the city (banner + undo). The copies carry this game's TixStock id, so live listings reprice them. A generic map (\"General Admission\") remembers nothing. Only football reaches the stadium's OTHER drawings (football drawings of one stadium are the same seating); a concert remembers only its own drawing - each tour has its own stage.",
        "זיכרון אצטדיון: שלב שמגיע בלי קטגוריות כרטיסים מעתיק את קטגוריות ה-TixStock מהאירוע האחרון על אותה מפת מושבים - השרטוט של האצטדיון, לא העיר (באנר + ביטול). ההעתקים נושאים את מזהה ה-TixStock של המשחק הזה, כך שהליסטינגים החיים מתמחרים אותם מחדש. מפה כללית (\"General Admission\") לא זוכרת כלום. רק כדורגל מגיע לשרטוטים האחרים של האצטדיון (שרטוטי כדורגל של אותו אצטדיון הם אותה ישיבה); הופעה זוכרת רק את השרטוט שלה - לכל סיבוב הופעות במה משלו.",
      ),
      t(
        "Save & Next carries only TixStock tickets to the next game. LiveTickets tickets and our own stock belong to ONE game - attach them again on each step (the venue template zones LiveTickets); a banner says how many were left behind.",
        "Save & Next מעביר למשחק הבא רק כרטיסי TixStock. כרטיסי LiveTickets והמלאי שלנו שייכים למשחק אחד - מצרפים אותם מחדש בכל שלב (תבנית האצטדיון משייכת את LiveTickets לאזורים); באנר מראה כמה לא הועברו.",
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
        title: t("Pin items at the front of a carousel", "הצמדת פריטים לתחילת קרוסלה"),
        steps: [
          t("Dashed \"auto\" cards are what the site shows by itself right now. \"Pin\" on one, or the \"Add\" tile at the end of the strip to search an event, artist or team.", "כרטיסים מקווקווים עם \"auto\" הם מה שהאתר מציג לבד כרגע. \"Pin\" על אחד מהם, או אריח \"Add\" בסוף השורה לחיפוש אירוע, אמן או קבוצה."),
          t("Drag pinned cards into order (or the arrows under each); hover and click × to unpin.", "מסדרים מוצמדים בגרירה (או בחצים שמתחת); ריחוף ו-× מבטל הצמדה."),
          t("Most wanted: \"Remove\" on a dashed card drops the event's Prioritized flag at once (not part of Save). Newest: \"Remove\" takes it out of this row only - removed events wait as chips under the row, click to restore.", "המבוקשים: \"Remove\" על כרטיס מקווקו מוריד מיד את סימון ה-Prioritized (לא חלק מ-Save). החדשים: \"Remove\" מוציא רק מהשורה הזו - אירועים שהוסרו מחכים כצ'יפים מתחת, לחיצה מחזירה."),
          t("Click \"Save homepage\".", "לוחצים \"Save homepage\"."),
        ],
      },
      {
        title: t("Add a block between sections", "הוספת בלוק בין סקשנים"),
        steps: [
          t("Click the thin \"+ Add block\" line where it should go, pick a type, and type a heading (or leave it empty).", "לוחצים על השורה הדקה \"+ Add block\" במקום הרצוי, בוחרים סוג ומקלידים כותרת (או משאירים ריק)."),
          t("\"סליידר אירועים\": pin events with \"Add\" and/or pick a category under \"מילוי אוטומטי אחרי הפריטים המוצמדים\" (with neither, the block is not shown).", "\"סליידר אירועים\": מצמידים אירועים עם \"Add\" ו/או בוחרים קטגוריה תחת \"מילוי אוטומטי אחרי הפריטים המוצמדים\" (בלי אף אחד מהם הבלוק לא מוצג)."),
          t("\"באנרים\": upload each \"Banner image\" (it must be uploaded here, not a pasted outside URL), optional \"קישור (לא חובה)\" (/c/... or https://...) and \"כותרת על התמונה (לא חובה)\"; \"באנר נוסף\" up to 3.", "\"באנרים\": מעלים כל \"Banner image\" (חייב לעלות כאן, לא URL חיצוני), \"קישור (לא חובה)\" (/c/... או https://...) ו\"כותרת על התמונה (לא חובה)\"; \"באנר נוסף\" עד 3."),
          t("\"טקסט\": plain paragraphs with a blank line between - no HTML or links. \"סליידר יעדים\": \"+ קטגוריה\" and/or \"כל הילדים של: …\". \"גלריית תמונות\": up to 12 uploaded images (\"תמונה נוספת\"), each with an optional caption.", "\"טקסט\": פסקאות פשוטות עם שורה ריקה ביניהן - בלי HTML וקישורים. \"סליידר יעדים\": \"+ קטגוריה\" ו/או \"כל הילדים של: …\". \"גלריית תמונות\": עד 12 תמונות שמועלות כאן (\"תמונה נוספת\"), לכל אחת תיאור לא חובה."),
          t("Click \"Save homepage\". To delete a block later: its trash icon, then save again.", "לוחצים \"Save homepage\". למחיקת בלוק בהמשך: הפח שלו ושמירה נוספת."),
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
        ],
      },
      {
        title: t("Go live and share the link", "העלאה לאוויר ושיתוף הקישור"),
        steps: [
          t("Save, then change the status at the top from \"Draft\" to \"Live\" - it saves by itself and confirms the public link works. \"Closed\" stops new answers.", "שומרים, ואז מחליפים את הסטטוס למעלה מ-\"Draft\" ל-\"Live\" - נשמר לבד ומאשר שהקישור הציבורי עובד. \"Closed\" עוצר תשובות חדשות."),
          t("\"Copy link\" copies the shared /f/ link (Live only); \"Open\" shows the client's page; the slug is under \"Public link\".", "\"Copy link\" מעתיק את קישור ה-/f/ המשותף (רק כש-Live); \"Open\" מציג את עמוד הלקוח; הכתובת תחת \"Public link\"."),
          t("For an external forms operator, switch on \"Visible to forms operators (trip links, responses, report)\" and save. \"Duplicate\" in the row menu in [Forms](/forms) copies the form as a new draft.", "למפעיל טפסים חיצוני מדליקים \"Visible to forms operators (trip links, responses, report)\" ושומרים. \"Duplicate\" בתפריט השורה ב[טפסים](/forms) מעתיק את הטופס כטיוטה חדשה."),
        ],
      },
      {
        title: t("Create a trip link or send personal invites", "יצירת קישור טיול או שליחת הזמנות אישיות"),
        steps: [
          t("Click \"Send\" in the builder (or \"Send / invites\" in the row menu) - the form must be Live.", "לוחצים \"Send\" בבונה (או \"Send / invites\" בתפריט השורה) - הטופס חייב להיות Live."),
          t("\"Trip link\" (only if the form has a \"Staff field\"): \"Trip code\" (letters + number, e.g. BBC 124), optional \"Travellers on the trip\", the staff answers → \"Create trip link & copy\". One link for the whole group; every answer carries the trip details.", "\"Trip link\" (רק אם יש בטופס \"Staff field\"): \"Trip code\" (אותיות + מספר, למשל BBC 124), אם רוצים \"Travellers on the trip\", תשובות הצוות ← \"Create trip link & copy\". קישור אחד לכל הקבוצה; כל תשובה נושאת את פרטי הטיול."),
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
      "The cities events happen in, each with coordinates and an optional IATA code. The IATA drives flight pricing and the automatic lookup in the wizard and the factory (keep this table growing); \"טען מלונות\" loads a city's hotels before it goes on sale.",
      "הערים שבהן יש אירועים, כל אחת עם קואורדינטות וקוד IATA לא חובה. ה-IATA מניע את תמחור הטיסות ואת הזיהוי האוטומטי בוויזרד ובמפעל (כדאי להמשיך להרחיב את הטבלה); \"טען מלונות\" טוען את המלונות של עיר לפני שהיא עולה למכירה.",
    ),
    howTo: [
      {
        title: t("Add a city", "הוספת עיר"),
        steps: [
          t("Open [Locations](/locations) and search \"Search locations...\" first (name or IATA) - it may already exist. Then \"Add Location\".", "פותחים את [המיקומים](/locations) ומחפשים קודם ב-\"Search locations...\" (שם או IATA) - ייתכן שהעיר קיימת. ואז \"Add Location\"."),
          t("\"Location Name *\": the city as customers should see it (ליברפול). \"Latitude *\" / \"Longitude *\": the city centre (e.g. from Google Maps) - hotels load around this point.", "\"Location Name *\": העיר כמו שהלקוחות צריכים לראות (ליברפול). \"Latitude *\" / \"Longitude *\": מרכז העיר (למשל מגוגל מפות) - המלונות נטענים סביב הנקודה."),
          t("\"City IATA Code\": the code flights are searched by (LON, BCN). Leave it empty for a city with no flights of its own, like Liverpool reached on a London flight.", "\"City IATA Code\": הקוד שלפיו מחפשים טיסות (LON, BCN). משאירים ריק לעיר בלי טיסות משלה, כמו ליברפול שמגיעים אליה בטיסה ללונדון."),
          t("Optional \"Country Code\" (GB). Click \"Create Location\", then load its hotels.", "\"Country Code\" לא חובה (GB). לוחצים \"Create Location\" ואז טוענים מלונות."),
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
      "A read-only record of what people did in the backoffice: who, when, from which IP and what changed, plus sign-ins and failed sign-ins. It shows only the newest 200 rows that match your filters, so filter before you scroll. Automatic changes such as the nightly price sync are not recorded here - those are on Price Changes.",
      "תיעוד לקריאה בלבד של מה שאנשים עשו בבק-אופיס: מי, מתי, מאיזו כתובת IP ומה השתנה, וגם כניסות וכניסות שנכשלו. מוצגות רק 200 השורות האחרונות שמתאימות לסינון, אז קודם מסננים ואחר כך גוללים. שינויים אוטומטיים כמו סנכרון המחירים הלילי לא נרשמים כאן - הם במסך שינויי המחיר.",
    ),
    howTo: [
      {
        title: t("Find who changed an event", "לגלות מי שינה אירוע"),
        steps: [
          t("Open the event and note its number in the breadcrumbs (e.g. \"#1234\").", "פותחים את האירוע ורושמים את המספר שלו מפירורי הלחם (למשל \"#1234\")."),
          t("Open [Audit Log](/audit-log), set \"Entity type\" to \"event\" and leave \"All actions\" (price-light and price-change decisions have their own action names that the Action list doesn't include).", "פותחים את [לוג הביקורת](/audit-log), בוחרים \"Entity type\" = \"event\" ומשאירים \"All actions\" (להחלטות רמזור ושינויי מחיר יש שמות פעולה משלהן שלא ברשימת ה-Action)."),
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
          t("Click a row to open its details (click again to close). An edit lists only the fields that changed, each with \"from\" and \"to\".", "לחיצה על שורה פותחת את הפרטים (לחיצה נוספת סוגרת). עריכה מציגה רק את השדות שהשתנו, כל אחד עם \"from\" ו-\"to\"."),
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
