// The Mega Family part of the guide: every section here is tagged "tours", so
// only a company that sells tours reads it (guide-model.ts sectionsFor). Same
// shape and voice as guide-content.ts, which appends these after the Mega
// Events sections. Button names are quoted exactly as the screens print them
// (English); the Hebrew text explains around them.
//
// Keep it honest: the screens live in components/tours/** and app/(dashboard)/tours/**.
// When a tours flow changes, update its section here in the same change.

import type { GuideSection, L } from "./guide-content";

const t = (en: string, he: string): L => ({ en, he });

export const TOURS_GUIDE_SECTIONS: GuideSection[] = [
  // ------------------------------------------------------------------ start here
  {
    id: "create-tour",
    nav: "start",
    productType: "tours",
    title: t("How to create a new tour", "איך מקימים טיול חדש"),
    intro: t(
      "\"Add Tour\" builds a whole tour on one page - details, series, first dates, prices, flights, itinerary, what's included, hotels, group leaders, pictures and categories; a new category, tag or group leader is created right there. The tour's own page edits all of it later and adds FAQ, SEO and more dates. Nothing reaches the customer site until the tour is active, its dates are published and someone clicks \"Revalidate Pages\".",
      "\"Add Tour\" בונה טיול שלם בעמוד אחד - פרטים, סדרה, תאריכים ראשונים, מחירים, טיסות, מסלול יום-יום, מה כלול, מלונות, מלווים, תמונות וקטגוריות; קטגוריה, תגית או מלווה חדשים יוצרים במקום. עמוד הטיול עצמו עורך את כל זה אחר כך ומוסיף שאלות נפוצות, SEO ועוד תאריכים. שום דבר לא מגיע לאתר הלקוחות עד שהטיול פעיל, התאריכים שלו מפורסמים ומישהו לוחץ \"Revalidate Pages\".",
    ),
    howTo: [
      {
        title: t("The usual way: the tour, then its flight series", "הדרך הרגילה: הטיול, ואז סדרת הטיסות שלו"),
        steps: [
          t("Build the tour in \"Add Tour\" (below): its page, and in \"Series & Route\" its code - the tour code. Leave \"Dates\" empty.", "בונים את הטיול ב-\"Add Tour\" (למטה): העמוד שלו, וב-\"Series & Route\" הקוד שלו - קוד הטיול. משאירים את \"Dates\" ריק."),
          t("Open [New series](/offline-flights/series/new), tick \"Organized tour\" and type the tour code. A code that does not exist yet asks for \"New tour name\" and creates the tour as a draft. Fill the flights and click \"Create N flight(s)\".", "פותחים [סדרה חדשה](/offline-flights/series/new), מסמנים \"Organized tour\" ומקלידים את קוד הטיול. קוד שעוד לא קיים מבקש \"New tour name\" ויוצר את הטיול כטיוטה. ממלאים את הטיסות ולוחצים \"Create N flight(s)\"."),
          t("Every flight becomes a sub-tour (a date) of the tour, with the flight's dates, route and seats, as a draft without prices. The answer lists what was created; \"Set prices in Departures\" opens the sheet.", "כל טיסה הופכת לתת-טיול (תאריך) של הטיול, עם התאריכים, המסלול והמושבים של הטיסה, כטיוטה בלי מחירים. התשובה מפרטת מה נוצר; \"Set prices in Departures\" פותח את הטבלה."),
          t("In [Departures](/tours/departures?view=prices) → \"Prices\" type the six room prices of each sub-tour (or paste them from Excel); on \"Departures\" give each date its \"Season\", tick \"On site\" and \"Save\". Then \"Revalidate Pages\".", "ב[יציאות](/tours/departures?view=prices) ← \"Prices\" מקלידים את ששת מחירי החדר של כל תת-טיול (או מדביקים מאקסל); ב-\"Departures\" נותנים לכל תאריך \"Season\", מסמנים \"On site\" ו-\"Save\". ואז \"Revalidate Pages\"."),
        ],
      },
      {
        title: t("1. Fill in Add Tour", "1. ממלאים את Add Tour"),
        steps: [
          t("Open [Tours](/tours/packages) and click \"Add Tour\" (or go straight to [Add Tour](/tours/packages/new)). It is one page of cards, like Add Event.", "פותחים את [הטיולים](/tours/packages) ולוחצים \"Add Tour\" (או ישר ל[הוספת טיול](/tours/packages/new)). זה עמוד אחד של כרטיסים, כמו הוספת אירוע."),
          t("\"Basic Information\": \"Tour name\" and \"Subtitle\". \"Slug\" (the end of the tour's address on the site) fills itself from the name until you type it by hand. Then \"Days\", \"Nights\", \"Countries\" as the site shows them (\"3 מדינות\"), \"Seasons\" (\"Add Season\" - the first one also labels the dates) and \"Card color on site\".", "\"Basic Information\": \"Tour name\" ו-\"Subtitle\". \"Slug\" (סוף הכתובת של הטיול באתר) מתמלא לבד מהשם עד שמקלידים אותו ידנית. אחר כך \"Days\", \"Nights\", \"Countries\" כמו שהאתר מציג (\"3 מדינות\"), \"Seasons\" (\"Add Season\" - העונה הראשונה מסמנת גם את התאריכים) ו-\"Card color on site\" (צבע הכרטיס באתר)."),
          t("\"Series & Route\": the \"Series code\" (2-8 English letters and digits, e.g. BBC) starts every date code - BBC + 1203 = BBC1203. Then \"Arrival airport\" and \"Return airport\" (3 letters, e.g. LHR), \"Currency\", \"Seats per date\" and \"Child up to age\". They apply to every date.", "\"Series & Route\": \"Series code\" (2-8 אותיות וספרות באנגלית, למשל BBC) פותח כל קוד תאריך - BBC + 1203 = BBC1203. אחר כך \"Arrival airport\" ו-\"Return airport\" (3 אותיות, למשל LHR), \"Currency\", \"Seats per date\" ו-\"Child up to age\". הם חלים על כל התאריכים."),
          t("\"Dates\": \"Add Date\" for each departure; the return date follows the nights by itself. Every date is created as an unpublished draft. More dates, or a whole season, can be added later on the tour page.", "\"Dates\": \"Add Date\" לכל יציאה; תאריך החזרה מתעדכן לבד לפי הלילות. כל תאריך נוצר כטיוטה לא מפורסמת. עוד תאריכים, או עונה שלמה, מוסיפים אחר כך בעמוד הטיול."),
          t("\"Prices\": the price per person by room, in the series currency, the same for every new date. The site needs at least \"Adult in a double room\"; one date's prices change later in its card.", "\"Prices\": מחיר לאדם לפי הרכב החדר, במטבע של הסדרה, זהה לכל התאריכים החדשים. האתר צריך לפחות את \"Adult in a double room\" (מבוגר בחדר זוגי); מחירים של תאריך אחד משנים אחר כך בכרטיס שלו."),
          t("\"Offline Flights\": each date lists the flight blocks that fly within 2 days of it. Tick the ones that serve it and set \"Seats\". No block yet? \"New Flight\" opens [Offline Flights](/offline-flights/new) in a new tab - create the block there, come back and click \"Refresh\".", "\"Offline Flights\": לכל תאריך מופיעים בלוקי הטיסה שטסים בטווח של יומיים ממנו. מסמנים את אלה שמשרתים אותו וקובעים \"Seats\". אין עדיין בלוק? \"New Flight\" פותח את [הטיסות האופליין](/offline-flights/new) בלשונית חדשה - יוצרים שם את הבלוק, חוזרים ולוחצים \"Refresh\"."),
          t("\"Hotels\": pick one in \"Choose a hotel from the catalog…\" → \"Add from Catalog\", or \"New Hotel\"; set this tour's \"Nights\" and \"Board\". The order here is the order on the site.", "\"Hotels\": בוחרים ב-\"Choose a hotel from the catalog…\" ← \"Add from Catalog\", או \"New Hotel\"; קובעים לטיול הזה \"Nights\" ו-\"Board\" (בסיס אירוח). הסדר כאן הוא הסדר באתר."),
          t("\"Images & Description\": \"Hero image (top of the page)\" and \"Card image (in lists)\" - \"Upload\" a picture or paste its address (/media/... or https://) - and the \"Tour description\".", "\"Images & Description\": \"Hero image (top of the page)\" ו-\"Card image (in lists)\" - מעלים תמונה ב-\"Upload\" או מדביקים כתובת (/media/... או https://) - ואת \"Tour description\"."),
          t("\"Itinerary\": \"Add Day\" for each day, then open it - \"Title (the day's route)\", \"Subtitle\", \"Image\", \"Day description\".", "\"Itinerary\": \"Add Day\" לכל יום, ואז פותחים אותו - \"Title (the day's route)\", \"Subtitle\", \"Image\", \"Day description\"."),
          t("\"What's Included\": the \"Included\" and \"Not included\" lists, and \"Additional info\".", "\"What's Included\": רשימות \"Included\" ו-\"Not included\" (כלול / לא כלול), ו-\"Additional info\"."),
          t("\"Group Leaders\": who escorts the tour - the site lists them on the tour page. Pick one and click \"Add\", or type a new name → \"New Group Leader\" (finish their picture and text later on [Group Leaders](/tours/instructors)). The leader of each date is set later in that date's card.", "\"Group Leaders\": מי מלווה את הטיול - האתר מציג אותם בעמוד הטיול. בוחרים ולוחצים \"Add\", או מקלידים שם חדש ← \"New Group Leader\" (את התמונה והטקסט משלימים אחר כך ב[מלווים](/tours/instructors)). המלווה של כל תאריך נקבע אחר כך בכרטיס של התאריך."),
          t("\"Categories & Tags\": tick its destinations, audiences and tags - or type a new one in the card of its kind and click \"Add\"; it is created and ticked at once. The audience decides the homepage tab the tour shows under - a tour with no audience is missing from those tabs.", "\"Categories & Tags\": מסמנים יעדים, קהלים ותגיות - או מקלידים חדש בכרטיס של הסוג שלו ולוחצים \"Add\"; הוא נוצר ומסומן מיד. הקהל (Audiences) קובע באיזו לשונית של עמוד הבית הטיול מופיע - טיול בלי קהל חסר בלשוניות האלה."),
        ],
      },
      {
        title: t("2. Create it and read \"Ready for the site\"", "2. יוצרים וקוראים את \"Ready for the site\""),
        steps: [
          t("Click \"Create Tour\" in the bar at the bottom. It stays disabled, with the reason beside it, until the name, slug, series code, airports and dates are valid.", "לוחצים \"Create Tour\" בסרגל התחתון. הכפתור מושבת, והסיבה כתובה לידו, עד שהשם, ה-slug, קוד הסדרה, שדות התעופה והתאריכים תקינים."),
          t("The tour is created inactive with its dates unpublished, and its page opens on \"Dates & Prices\". If a step could not be done, a red toast lists it - finish it on the page.", "הטיול נוצר לא פעיל, התאריכים שלו לא מפורסמים, והעמוד שלו נפתח על \"Dates & Prices\". אם שלב כלשהו לא בוצע, הודעה אדומה מפרטת אותו - משלימים אותו בעמוד."),
          t("At the top, \"Ready for the site\" shows the steps: Details, Images, Description, Itinerary, Categories, Dates, Prices, Flights, On sale, Active, Revalidate. Green = done. Hover a step to see what is missing; click it to open the tab that fixes it.", "למעלה, \"Ready for the site\" מציג את השלבים: Details, Images, Description, Itinerary, Categories, Dates, Prices, Flights, On sale, Active, Revalidate. ירוק = בוצע. ריחוף מעל שלב מראה מה חסר; לחיצה פותחת את הלשונית שמתקנת אותו."),
        ],
      },
      {
        title: t("3. Finish the tour page", "3. משלימים את עמוד הטיול"),
        steps: [
          t("\"Itinerary\": edit the days, or \"Add Day\". Sold in the opposite direction too? \"New Variant\" copies the saved itinerary with its own arrival and return cities.", "\"Itinerary\": עורכים את הימים או \"Add Day\". נמכר גם בכיוון ההפוך? \"New Variant\" מעתיק את המסלול השמור עם ערי נחיתה וחזרה משלו."),
          t("The leader of a date: open the date's card → \"Group leader\" (in \"Internal\"). It is for operations only - the site shows the tour's group leaders, not the date's.", "המלווה של תאריך: פותחים את כרטיס התאריך ← \"Group leader\" (באזור \"Internal\"). זה לתפעול בלבד - האתר מציג את המלווים של הטיול, לא של התאריך."),
          t("\"FAQ\": \"Add Question\" and its answer. \"SEO\": the title and description search engines show.", "\"FAQ\": \"Add Question\" והתשובה שלה. \"SEO\": הכותרת והתיאור שמנועי החיפוש מציגים."),
          t("Click \"Save\" in the bottom bar after editing. The toast reminds you the site changes only after Revalidate Pages.", "לוחצים \"Save\" בסרגל התחתון אחרי עריכה. ההודעה מזכירה שהאתר משתנה רק אחרי Revalidate Pages."),
          t("\"Dates & Prices\": click a date to open its card - \"Prices\", \"Flights\", \"Promotions\", \"Reservations\", and the switch that puts it on the site. A red \"Add price\" or an amber \"Link a flight\" in a row opens the tab that is missing.", "\"Dates & Prices\": לוחצים על תאריך כדי לפתוח את הכרטיס שלו - \"Prices\", \"Flights\", \"Promotions\", \"Reservations\", והמתג שמעלה אותו לאתר. \"Add price\" אדום או \"Link a flight\" כתום בשורה פותחים את הלשונית שחסרה."),
          t("More dates: \"Add Date\" for one, \"Add Season\" for a weekly run between two dates (it can copy prices and promotions from an existing date) → \"Create N Departures\". They all come in as drafts.", "עוד תאריכים: \"Add Date\" לתאריך אחד, \"Add Season\" לסדרה שבועית בין שני תאריכים (אפשר להעתיק מחירים ומבצעים מתאריך קיים) ← \"Create N Departures\". כולם נכנסים כטיוטות."),
        ],
      },
      {
        title: t("4. Put it on sale", "4. מעלים למכירה"),
        steps: [
          t("\"Details\" tab: switch \"Active on site\" on and click \"Save\". An inactive tour is left out of the site build.", "לשונית \"Details\": מדליקים את \"Active on site\" ולוחצים \"Save\". טיול לא פעיל לא נכנס לבנייה של האתר."),
          t("Publish its dates: in each date's card turn on \"Published on the site\" (many at once: tick them on the [Departures](/tours/departures) board → \"Publish\"). A date without a double-room price, cities or currency is refused (\"Can't publish yet: …\"). A date with no live flight block is published, and the site says flight details will follow.", "מפרסמים את התאריכים: בכרטיס של כל תאריך מדליקים את \"Published on the site\" (הרבה בבת אחת: מסמנים אותם ב[לוח היציאות](/tours/departures) ← \"Publish\"). תאריך בלי מחיר חדר זוגי, ערים או מטבע נחסם (\"Can't publish yet: …\"). תאריך בלי בלוק טיסה חי מתפרסם, והאתר כותב שפרטי הטיסה יעודכנו."),
          t("Click \"Revalidate Pages\" at the top of the page and confirm. The site rebuilds in about a minute; until then visitors see the previous version.", "לוחצים \"Revalidate Pages\" בראש העמוד ומאשרים. האתר נבנה מחדש תוך כדקה; עד אז המבקרים רואים את הגרסה הקודמת."),
          t("Once the tour is active, \"View on Site\" opens its page on the site.", "כשהטיול פעיל, \"View on Site\" פותח את העמוד שלו באתר."),
        ],
      },
      {
        title: t("5. After it is live", "5. אחרי שהוא באוויר"),
        steps: [
          t("Every form a customer sends from the site lands in [Leads](/tours/leads).", "כל טופס שלקוח שולח מהאתר נוחת ב[לידים](/tours/leads)."),
          t("Open the lead and click \"Create Reservation\". The customer's details are filled in (and the date, when the lead came from a date's page). Set the travelers and click \"Save Reservation\" - they count on the date's seats at once, and the lead turns \"Done\".", "פותחים את הליד ולוחצים \"Create Reservation\". פרטי הלקוח כבר ממולאים (וגם התאריך, כשהליד הגיע מעמוד של תאריך). קובעים את מספר הנוסעים ולוחצים \"Save Reservation\" - הם נספרים מיד על המושבים של התאריך, והליד עובר ל-\"Done\"."),
          t("Watch the seats on the [Departures](/tours/departures) board. \"Last places\" and \"Sold out\" follow the seats on their own - nothing to change by hand.", "עוקבים אחרי המושבים ב[לוח היציאות](/tours/departures). \"Last places\" ו-\"Sold out\" מתעדכנים לבד לפי המושבים - אין מה לשנות ידנית."),
        ],
      },
    ],
    flow: {
      title: t("From a new tour to a booking", "מטיול חדש להזמנה"),
      steps: [
        { label: t("Add Tour", "Add Tour"), sub: t("the whole tour on one page", "הטיול כולו בעמוד אחד") },
        { label: t("Tour page", "עמוד הטיול"), sub: t("FAQ, SEO, more dates - until Ready for the site", "שאלות, SEO, עוד תאריכים - עד Ready for the site") },
        { label: t("Active + dates published", "פעיל + תאריכים מפורסמים") },
        { label: t("Revalidate Pages", "Revalidate Pages"), sub: t("the site rebuilds", "האתר נבנה מחדש") },
        { label: t("Lead", "ליד") },
        { label: t("Reservation", "הזמנה"), sub: t("counts on the date's seats", "נספרת על המושבים של התאריך") },
      ],
    },
    rules: [
      t("Nothing reaches the customer site before \"Revalidate Pages\" - saving only stores it in the backoffice.", "שום דבר לא מגיע לאתר הלקוחות לפני \"Revalidate Pages\" - שמירה רק שומרת בבק-אופיס."),
      t("Once a tour has dates, its slug - its address on the site - is locked.", "ברגע שיש לטיול תאריכים, ה-slug שלו - הכתובת שלו באתר - ננעל."),
      t("Created a tour by mistake? \"Delete Tour\" (Details tab) removes it with its dates while nothing was sold on it and no date is on the site; otherwise switch it off with \"Active on site\". The slug and series code stay taken.", "נוצר טיול בטעות? \"Delete Tour\" (לשונית Details) מוחק אותו עם התאריכים שלו כל עוד לא נמכר בו כלום ואף תאריך לא באתר; אחרת מכבים אותו ב-\"Active on site\". ה-slug וקוד הסדרה נשארים תפוסים."),
    ],
    links: [
      { label: t("Add Tour", "הוספת טיול"), href: "/tours/packages/new" },
      { label: t("Tours", "טיולים"), href: "/tours/packages" },
      { label: t("Departures board", "לוח היציאות"), href: "/tours/departures" },
    ],
  },
  {
    id: "publish-site",
    nav: "start",
    productType: "tours",
    title: t("Revalidate Pages - when changes reach the site", "Revalidate Pages - מתי שינויים מגיעים לאתר"),
    intro: t(
      "The customer site is built from the backoffice data, and only when someone clicks \"Revalidate Pages\". Saving a tour, a date, a page or a hotel stores it here; the site shows it after the next revalidate.",
      "אתר הלקוחות נבנה מהנתונים של הבק-אופיס, ורק כשמישהו לוחץ \"Revalidate Pages\". שמירה של טיול, תאריך, עמוד או מלון שומרת אותם כאן; האתר מציג אותם אחרי ה-Revalidate הבא.",
    ),
    howTo: [
      {
        title: t("Publish the site", "לפרסם את האתר"),
        steps: [
          t("Save first - the bar at the bottom of an editor says when something is not saved yet.", "קודם שומרים - הסרגל בתחתית העורך אומר כשמשהו עוד לא נשמר."),
          t("Click \"Revalidate Pages\" at the top of a tours screen: the Dashboard, Tours and every tour, Departures, the Website screens, Settings.", "לוחצים \"Revalidate Pages\" בראש מסך טיולים: הדשבורד, הטיולים וכל טיול, היציאות, מסכי האתר, ההגדרות."),
          t("Confirm \"Revalidate the site?\" with \"Revalidate Pages\". The toast says the build has started.", "מאשרים את \"Revalidate the site?\" עם \"Revalidate Pages\". ההודעה אומרת שהבנייה התחילה."),
          t("Give it about a minute. Until the build finishes visitors see the previous version, so revalidate once after a round of changes, not after each one.", "נותנים לזה כדקה. עד שהבנייה מסתיימת המבקרים רואים את הגרסה הקודמת, אז עושים Revalidate פעם אחת אחרי סבב שינויים ולא אחרי כל שינוי."),
        ],
      },
    ],
    points: [
      t("Beside the button: \"Last revalidated: …\", \"Last attempt failed: …\" (red), \"Not revalidated from here yet\" or \"Site connection not set up\". Hover it to see who clicked it.", "ליד הכפתור: \"Last revalidated: …\", \"Last attempt failed: …\" (באדום), \"Not revalidated from here yet\" או \"Site connection not set up\". ריחוף מראה מי לחץ."),
      t("\"Site connection not set up\" means the site's deploy hook is missing. A company admin adds it in [Settings](/tours/settings), under \"Revalidate Pages\".", "\"Site connection not set up\" אומר שחסר ה-deploy hook של האתר. מנהל החברה מוסיף אותו ב[הגדרות](/tours/settings), תחת \"Revalidate Pages\"."),
      t("Nothing publishes on its own - it is always this button. Every attempt, failed ones too, is recorded with who clicked it.", "שום דבר לא מתפרסם לבד - תמיד דרך הכפתור הזה. כל ניסיון, גם כושל, נרשם עם מי שלחץ."),
      t("In a tour's \"Ready for the site\", the \"Revalidate\" step turns green only when the site was rebuilt after the tour's last change.", "ב-\"Ready for the site\" של טיול, השלב \"Revalidate\" נהיה ירוק רק כשהאתר נבנה מחדש אחרי השינוי האחרון בטיול."),
    ],
    rules: [
      t("Saved is not live. A change is on the site only after \"Revalidate Pages\" and a finished build.", "נשמר זה עוד לא באוויר. שינוי נמצא באתר רק אחרי \"Revalidate Pages\" ובנייה שהסתיימה."),
    ],
  },
  {
    id: "tours-getting-around",
    nav: "start",
    productType: "tours",
    title: t("Getting around", "התמצאות במערכת"),
    intro: t(
      "The sidebar holds the company's screens by area: Overview, Products, Website, Admin. You see only this company's screens, and only those your role may open.",
      "הסיידבר מקבץ את המסכים של החברה לפי אזור: Overview, Products, Website, Admin. רואים רק את המסכים של החברה הזאת, ורק את אלה שהתפקיד שלכם יכול לפתוח.",
    ),
    howTo: [
      {
        title: t("Use this guide", "להשתמש במדריך הזה"),
        steps: [
          t("On any screen, \"Guide\" at the right of the top bar opens this guide in a new tab, right at the part about that screen.", "בכל מסך, \"Guide\" בצד ימין של הסרגל העליון פותח את המדריך הזה בלשונית חדשה, ישר בחלק של אותו מסך."),
          t("The guide follows the sidebar: the same groups and screens, in the same order. Every link in it opens in a new tab, so the guide stays open beside your work.", "המדריך בנוי כמו התפריט: אותן קבוצות ואותם מסכים, באותו סדר. כל קישור בו נפתח בלשונית חדשה, כך שהמדריך נשאר פתוח ליד העבודה."),
          t("The search box reads Hebrew and English together - type a button's name (\"Revalidate Pages\") or a job (\"ליד\", \"מלון\").", "תיבת החיפוש קוראת עברית ואנגלית יחד - מקלידים שם של כפתור (\"Revalidate Pages\") או פעולה (\"ליד\", \"מלון\")."),
        ],
      },
      {
        title: t("Jump to any screen", "לקפוץ לכל מסך"),
        steps: [
          t("Press Ctrl+K (Cmd+K on a Mac), or click \"Search\" in the top bar.", "לוחצים Ctrl+K (Cmd+K במק), או \"Search\" בסרגל העליון."),
          t("Type part of a screen's name or a Hebrew word - \"יציאות\" finds Departures, \"לידים\" finds Leads. Enter opens it.", "מקלידים חלק משם המסך או מילה בעברית - \"יציאות\" מוצא את Departures, \"לידים\" מוצא את Leads. Enter פותח."),
          t("\"Website\" and \"Admin\" start folded: click the heading to open them. Ctrl+B folds the whole sidebar to icons.", "\"Website\" ו-\"Admin\" מתחילים מקופלים: לוחצים על הכותרת כדי לפתוח. Ctrl+B מקפל את כל הסיידבר לאייקונים."),
        ],
      },
      {
        title: t("Work in another company", "לעבור לחברה אחרת"),
        steps: [
          t("Working in more than one company? The company name in the top bar switches between them. Each opens on its own home screen, with its own menu and its own guide.", "עובדים ביותר מחברה אחת? שם החברה בסרגל העליון מחליף ביניהן. כל חברה נפתחת במסך הבית שלה, עם התפריט והמדריך שלה."),
        ],
      },
    ],
    links: [{ label: t("Open the dashboard", "פתח את הדשבורד"), href: "/tours" }],
  },

  // -------------------------------------------------------------------- overview
  {
    id: "tours-dashboard",
    nav: "/tours",
    productType: "tours",
    title: t("Dashboard - the company at a glance", "דשבורד - החברה במבט אחד"),
    intro: t(
      "Tours, reservations and leads at a glance. Every number opens the screen that holds its rows.",
      "טיולים, הזמנות ולידים במבט אחד. כל מספר פותח את המסך שמחזיק את השורות שלו.",
    ),
    howTo: [
      {
        title: t("Start the day", "לפתוח את היום"),
        steps: [
          t("The top cards: \"Tours on Sale\", \"Departures (60 Days)\", \"Seats Left\", \"Reservations\" and \"New Leads\" (waiting for a reply). Click one to open its screen.", "הכרטיסים למעלה: \"Tours on Sale\", \"Departures (60 Days)\", \"Seats Left\", \"Reservations\" ו-\"New Leads\" (ממתינים לתשובה). לחיצה פותחת את המסך שלו."),
          t("\"My tasks\" lists your open tasks; \"All tasks\" opens the [board](/tasks).", "\"My tasks\" מציג את המשימות הפתוחות שלכם; \"All tasks\" פותח את [הלוח](/tasks)."),
          t("Admins also get \"Needs attention\": flight blocks waiting for approval, cancellation decisions due in 14 days, dates published without a flight or a price, hotels not in the catalog. \"Approvals\" opens the screen that settles them.", "מנהלים מקבלים גם את \"Needs attention\": בלוקי טיסה שממתינים לאישור, החלטות ביטול ב-14 הימים הקרובים, תאריכים שפורסמו בלי טיסה או בלי מחיר, מלונות שלא בקטלוג. \"Approvals\" פותח את המסך שמטפל בהם."),
          t("\"Statistics\" counts leads and reservations by period and lists the top tours; \"Leads Over Time\" draws the leads by day (\"Last 7 days\" … \"Last year\").", "\"Statistics\" סופר לידים והזמנות לפי תקופה ומציג את הטיולים המובילים; \"Leads Over Time\" מצייר את הלידים לפי יום (\"Last 7 days\" … \"Last year\")."),
        ],
      },
    ],
    points: [
      t("Reservation counts leave cancellation rows out. \"Revalidate Pages\" sits at the top here too.", "ספירת ההזמנות לא כוללת שורות ביטול. גם כאן \"Revalidate Pages\" נמצא למעלה."),
    ],
    links: [{ label: t("Dashboard", "דשבורד"), href: "/tours" }],
  },
  {
    id: "tours-reservations",
    nav: "/tours/reservations",
    productType: "tours",
    title: t("Reservations - bookings and cancellations", "הזמנות - הזמנות וביטולים"),
    intro: t(
      "Bookings taken by phone, by agents or in the office - one row per booking or cancellation, with the customer and the Docket number. The site has no online booking yet. The travelers count on the departure's seats the moment the row is saved.",
      "הזמנות שנלקחו בטלפון, דרך סוכנים או במשרד - שורה לכל הזמנה או ביטול, עם הלקוח ומספר ה-Docket. באתר עוד אין הזמנה אונליין. הנוסעים נספרים על המושבים של היציאה ברגע שהשורה נשמרת.",
    ),
    howTo: [
      {
        title: t("Add a reservation", "להוסיף הזמנה"),
        steps: [
          t("Open [Reservations](/tours/reservations) and click \"Add Reservation\".", "פותחים את [ההזמנות](/tours/reservations) ולוחצים \"Add Reservation\"."),
          t("\"Departure\": search by code, date or tour. A date not yet on the site carries a \"Draft\" tag.", "\"Departure\": מחפשים לפי קוד, תאריך או טיול. תאריך שעוד לא באתר מסומן \"Draft\"."),
          t("\"Type\": \"Booking\" (seats taken) or \"Cancellation\" (seats given back), then \"Travelers\".", "\"Type\": \"Booking\" (מושבים נלקחים) או \"Cancellation\" (מושבים חוזרים), ואז \"Travelers\"."),
          t("Fill \"Customer\", \"Phone\", \"Email\", \"Docket\" (the accounting number) and \"Note\", then \"Save Reservation\".", "ממלאים \"Customer\", \"Phone\", \"Email\", \"Docket\" (מספר הנהלת החשבונות) ו-\"Note\", ואז \"Save Reservation\"."),
          t("Shortcuts: from a lead, \"Create Reservation\" fills the customer in; from a date's card, the \"Reservations\" tab → \"Add Reservation\" fixes the date and its Docket.", "קיצורי דרך: מליד, \"Create Reservation\" ממלא את פרטי הלקוח; מכרטיס של תאריך, לשונית \"Reservations\" ← \"Add Reservation\" קובעת את התאריך וה-Docket שלו."),
        ],
      },
      {
        title: t("Find or fix a reservation", "למצוא או לתקן הזמנה"),
        steps: [
          t("The tabs \"All\", \"Bookings\", \"Cancellations\" and the search (customer, phone, docket or tour) narrow the list. \"Departure\" in a row opens that date's card.", "הלשוניות \"All\", \"Bookings\", \"Cancellations\" והחיפוש (לקוח, טלפון, docket או טיול) מצמצמים את הרשימה. \"Departure\" בשורה פותח את הכרטיס של התאריך."),
          t("A saved row can't be edited. Typo? Delete it (the bin → \"Delete\") and add it again.", "שורה שנשמרה לא נערכת. טעות? מוחקים אותה (הפח ← \"Delete\") ומוסיפים מחדש."),
          t("A customer cancels: add a \"Cancellation\" row with the travelers given back - the booking row stays as history.", "לקוח מבטל: מוסיפים שורת \"Cancellation\" עם הנוסעים שחוזרים - שורת ההזמנה נשארת כהיסטוריה."),
        ],
      },
    ],
    points: [
      t("A row holds the customer, the travelers count, the Docket and a note - not passenger names or payments. A missing Docket shows \"TBD\".", "שורה מחזיקה את הלקוח, מספר הנוסעים, ה-Docket והערה - לא שמות נוסעים ולא תשלומים. Docket חסר מוצג כ-\"TBD\"."),
      t("Seats on a date: Allocated (on live flight blocks) - Sold (these rows) = Left. The card's \"Reservations\" tab warns when a date is oversold.", "מושבים בתאריך: Allocated (בבלוקי טיסה חיים) פחות Sold (השורות האלה) = Left. לשונית \"Reservations\" בכרטיס מתריעה כשתאריך נמכר מעבר למושבים."),
    ],
    rules: [
      t("Deleting only marks the row deleted: it stops counting on the seats and stays recoverable.", "מחיקה רק מסמנת את השורה כמחוקה: היא מפסיקה להיספר על המושבים ונשארת ניתנת לשחזור."),
    ],
    links: [{ label: t("Reservations", "הזמנות"), href: "/tours/reservations" }],
  },
  {
    id: "tours-bookings",
    nav: "/tours/bookings",
    productType: "tours",
    title: t("Online Bookings - what customers booked on the site", "הזמנות אונליין - מה שלקוחות הזמינו באתר"),
    intro: t(
      "At the end of a booking on the site the customer either sends a request (a rep calls back) or pays by card on the CreditGuard page. Each one is a row here and a lead in Leads. The price is computed by the system from the date's prices, never taken from the customer's browser.",
      "בסוף הזמנה באתר הלקוח שולח בקשה (נציג חוזר אליו) או משלם בכרטיס בדף של CreditGuard. כל אחת היא שורה כאן וליד בלידים. המחיר מחושב במערכת לפי המחירים של התאריך, אף פעם לא לפי מה שהדפדפן של הלקוח שלח.",
    ),
    howTo: [
      {
        title: t("Handle a request", "לטפל בבקשה"),
        steps: [
          t("Open [Online Bookings](/tours/bookings) and click the row: the panel shows the rooms, the passengers and the price the customer saw.", "פותחים את [הזמנות אונליין](/tours/bookings) ולוחצים על השורה: החלונית מציגה את החדרים, הנוסעים והמחיר שהלקוח ראה."),
          t("Call the customer. When the trip is sold, click \"Create Reservation\": it adds the seats to the departure.", "מתקשרים ללקוח. כשהטיול נמכר, לוחצים \"Create Reservation\": זה מוסיף את המושבים ליציאה."),
          t("Set the status, the receipt number and \"Confirmation sent\" - each saves at once.", "קובעים סטטוס, מספר קבלה ו-\"Confirmation sent\" - כל אחד נשמר מיד."),
        ],
      },
      {
        title: t("A card payment", "תשלום בכרטיס"),
        steps: [
          t("\"Paid\" means CreditGuard confirmed exactly the amount the system computed. The seats were added to the departure by themselves.", "\"Paid\" אומר ש-CreditGuard אישר בדיוק את הסכום שהמערכת חישבה. המושבים נוספו ליציאה לבד."),
          t("Send the customer the confirmation, issue the receipt, type its number, and set \"Done\".", "שולחים ללקוח את האישור, מפיקים קבלה, מקלידים את המספר שלה, ומסמנים \"Done\"."),
          t("\"Check payment\": CreditGuard reported a charge with another amount. Check the transaction in CreditGuard; when it is right, set \"Paid\".", "\"Check payment\": CreditGuard דיווח על חיוב בסכום אחר. בודקים את העסקה ב-CreditGuard; אם היא תקינה, מסמנים \"Paid\"."),
          t("\"Waiting for payment\": the customer reached the payment page and did not pay. Call them.", "\"Waiting for payment\": הלקוח הגיע לדף התשלום ולא שילם. מתקשרים אליו."),
        ],
      },
    ],
    points: [
      t("The charge is in shekels: today's rate from the [Rates](/tours/rates) screen when it was typed in, otherwise the automatic rate plus the margin.", "החיוב בשקלים: השער של היום ממסך [השערים](/tours/rates) אם הוזן, אחרת השער האוטומטי ועוד המרווח."),
      t("Only dates with prices in the price table can be paid online. On the others the customer sends a request.", "רק תאריכים עם מחירים בטבלת המחירים אפשר לשלם אונליין. בשאר הלקוח שולח בקשה."),
      t("Refunds are done by hand in CreditGuard; then set the booking \"Cancelled\" and remove its seats in Reservations.", "החזרים נעשים ידנית ב-CreditGuard; אחר כך מסמנים את ההזמנה \"Cancelled\" ומורידים את המושבים שלה בהזמנות."),
    ],
    links: [
      { label: t("Online Bookings", "הזמנות אונליין"), href: "/tours/bookings" },
      { label: t("Leads", "לידים"), href: "/tours/leads" },
    ],
  },
  {
    id: "tours-leads",
    nav: "/tours/leads",
    productType: "tours",
    title: t("Leads - every form from the site", "לידים - כל טופס מהאתר"),
    intro: t(
      "Every form sent from the website: lead form, contact, cancellation request, newsletter and advisor request. Open a lead to set its status, assign it to a teammate or turn it into a reservation.",
      "כל טופס שנשלח מהאתר: טופס ליד, צור קשר, בקשת ביטול, ניוזלטר ובקשת יועץ. פותחים ליד כדי לקבוע סטטוס, לשייך לעמית או להפוך אותו להזמנה.",
    ),
    howTo: [
      {
        title: t("Work the inbox", "לעבוד על תיבת הלידים"),
        steps: [
          t("Open [Leads](/tours/leads). The tabs \"New\", \"In progress\", \"Done\", \"Spam\" (and \"All\") split the list; \"All types\" and the search narrow it.", "פותחים את [הלידים](/tours/leads). הלשוניות \"New\", \"In progress\", \"Done\", \"Spam\" (ו-\"All\") מחלקות את הרשימה; \"All types\" והחיפוש מצמצמים."),
          t("Click a row: the panel shows the message, \"Source Page\" (the site page it came from), \"More from the form\" and \"Campaign (UTM)\". Click the phone to dial, the email to write.", "לוחצים על שורה: החלונית מציגה את ההודעה, \"Source Page\" (העמוד באתר שממנו הגיע), \"More from the form\" ו-\"Campaign (UTM)\". לחיצה על הטלפון מחייגת, על המייל כותבת."),
          t("Set \"Status\" and \"Assigned To\" in the panel - each saves at once.", "קובעים \"Status\" ו-\"Assigned To\" בחלונית - כל אחד נשמר מיד."),
        ],
      },
      {
        title: t("Turn a lead into a reservation", "להפוך ליד להזמנה"),
        steps: [
          t("In the lead's panel click \"Create Reservation\". Name, phone and email are filled in, the message goes into the note, and a lead from a date's page brings that date.", "בחלונית הליד לוחצים \"Create Reservation\". שם, טלפון ומייל כבר ממולאים, ההודעה נכנסת להערה, וליד מעמוד של תאריך מביא את התאריך."),
          t("Check the departure and the travelers, then \"Save Reservation\". The lead turns \"Done\" by itself.", "בודקים את היציאה ואת מספר הנוסעים, ואז \"Save Reservation\". הליד עובר ל-\"Done\" לבד."),
        ],
      },
      {
        title: t("Export to Excel", "לייצא לאקסל"),
        steps: [
          t("Set the tab, type and search you want, then \"Export to Excel\" - the file holds exactly those leads, with the form details and the UTM.", "קובעים לשונית, סוג וחיפוש, ואז \"Export to Excel\" - הקובץ מכיל בדיוק את הלידים האלה, עם פרטי הטופס וה-UTM."),
        ],
      },
    ],
    points: [
      t("A new lead arrives as \"New\" with no owner. A lead can be assigned only to a member of the company's staff.", "ליד חדש מגיע כ-\"New\" בלי אחראי. אפשר לשייך ליד רק לאיש צוות של החברה."),
      t("New-lead notifications by email go to the \"Leads email\" set in [Settings](/tours/settings).", "התראות מייל על לידים חדשים נשלחות ל-\"Leads email\" שמוגדר ב[הגדרות](/tours/settings)."),
    ],
    links: [{ label: t("Leads", "לידים"), href: "/tours/leads" }],
  },
  {
    id: "tours-tasks",
    nav: "/tasks",
    productType: "tours",
    title: t("Tasks", "משימות"),
    intro: t(
      "The company's own work board - another company's tasks are not here. Everyone sees every task; admins can touch anything, an editor changes the status of their own tasks.",
      "לוח העבודה של החברה עצמה - משימות של חברה אחרת לא כאן. כולם רואים כל משימה; מנהלים יכולים לגעת בהכול, ועורך משנה סטטוס רק במשימות שלו.",
    ),
    howTo: [
      {
        title: t("Create a task and assign it", "ליצור משימה ולשבץ אותה"),
        steps: [
          t("Open [Tasks](/tasks) and click \"New task\".", "פותחים את [המשימות](/tasks) ולוחצים \"New task\"."),
          t("Fill \"Title\" and, if useful, \"Description\", \"Priority\", \"Due date\" and \"Attachments\".", "ממלאים \"Title\" ולפי הצורך \"Description\", \"Priority\", \"Due date\" ו-\"Attachments\"."),
          t("Pick \"Assign to\" - they get an email - and, if someone else should check the work, \"Reviewers\". Click \"Create task\".", "בוחרים \"Assign to\" - הוא מקבל מייל - ואם מישהו אחר צריך לבדוק את העבודה, גם \"Reviewers\". לוחצים \"Create task\"."),
        ],
      },
      {
        title: t("Move your work along", "לקדם את העבודה"),
        steps: [
          t("\"Open\" / \"Done\" / \"All\" and the owner menu (\"המשימות שלי\", \"ששייכתי לאחרים\", \"באיחור, בלי מענה\"…) pick what you see.", "\"Open\" / \"Done\" / \"All\" ותפריט הבעלים (\"המשימות שלי\", \"ששייכתי לאחרים\", \"באיחור, בלי מענה\"…) קובעים מה רואים."),
          t("Change the row's \"Status\". Finished? \"In review\" hands it back to whoever opened it (or the reviewers) by email; they set \"Done\" or send it back to \"In progress\".", "משנים את ה-\"Status\" בשורה. סיימתם? \"In review\" מחזיר את המשימה במייל למי שפתח אותה (או לבודקים); הם מסמנים \"Done\" או מחזירים ל-\"In progress\"."),
          t("Click a row to open its thread: comment, @mention a teammate, paste a screenshot with Ctrl+V. Prefer cards? [Kanban](/tasks?tab=kanban).", "לחיצה על שורה פותחת את הפתיל: כותבים תגובה, מתייגים עמית עם @, מדביקים צילום מסך עם Ctrl+V. מעדיפים כרטיסים? [Kanban](/tasks?tab=kanban)."),
          t("Admins: tick several rows → \"שייך ל…\" or \"סטטוס…\" for all of them at once.", "מנהלים: מסמנים כמה שורות ← \"שייך ל…\" או \"סטטוס…\" לכולן בבת אחת."),
        ],
      },
    ],
    points: [
      t("This board is plain: the \"Tasks\" and \"Kanban\" tabs only - no boards, phases, pricing or creative queues (those belong to Mega Events).", "הלוח הזה פשוט: רק הלשוניות \"Tasks\" ו-\"Kanban\" - בלי לוחות, שלבים, תמחור או תורי קריאייטיב (אלה של מגה אירועים)."),
      t("Statuses: \"To do\", \"In progress\", \"Paused\", \"In review\", \"Done\", \"Cancelled\" - paused and in review still count as open.", "סטטוסים: \"To do\", \"In progress\", \"Paused\", \"In review\", \"Done\", \"Cancelled\" - מושהה ובבדיקה עדיין נחשבות פתוחות."),
      t("Flight-block deadlines can become tasks: on [Reports](/tours/reports), \"צור משימות למועדים קרובים\" opens one task per deadline in the next 7 days, skipping those that already have one.", "מועדים של בלוקי טיסה יכולים להפוך למשימות: ב[דוחות](/tours/reports), \"צור משימות למועדים קרובים\" פותח משימה לכל מועד ב-7 הימים הקרובים, ומדלג על מה שכבר יש לו משימה."),
    ],
    links: [
      { label: t("Tasks board", "לוח משימות"), href: "/tasks" },
      { label: t("Kanban view", "תצוגת קאנבן"), href: "/tasks?tab=kanban" },
    ],
  },
  {
    id: "tours-approvals",
    // the screen is off the menu for now (lib/nav.ts `hidden`); its guide sits with the dashboard, which links to it
    nav: "/tours",
    productType: "tours",
    adminOnly: true,
    title: t("Approvals - what waits for a manager", "אישורים - מה שמחכה למנהל"),
    intro: t(
      "Decisions only a manager makes, and data the import could not settle on its own. Handle a row in place and it leaves the list. Admins only.",
      "החלטות שרק מנהל מקבל, ונתונים שהייבוא לא הצליח לסדר לבד. מטפלים בשורה במקום והיא יוצאת מהרשימה. למנהלים בלבד.",
    ),
    howTo: [
      {
        title: t("Approve or cancel a flight block", "לאשר או לבטל בלוק טיסה"),
        steps: [
          t("\"Drafts waiting for approval to book\": \"Approve to Book\" - operations then asks the airline for the seats.", "\"Drafts waiting for approval to book\": \"Approve to Book\" - התפעול פונה אז לחברת התעופה לבקש את המושבים."),
          t("\"Decide before the cancellation date\" (within 14 days): \"Keep\" notes the decision and marks the block reviewed; \"Cancel Flight Block\" asks who cancelled, the fee, the date and the reason - it can't be undone.", "\"Decide before the cancellation date\" (בתוך 14 יום): \"Keep\" רושם את ההחלטה ומסמן את הבלוק כנבדק; \"Cancel Flight Block\" שואל מי ביטל, דמי ביטול, תאריך וסיבה - ואין דרך חזרה."),
          t("\"Live flight blocks not reviewed yet\": \"Mark Reviewed\" per row, or tick several → \"Mark N Reviewed\".", "\"Live flight blocks not reviewed yet\": \"Mark Reviewed\" בכל שורה, או מסמנים כמה ← \"Mark N Reviewed\"."),
        ],
      },
      {
        title: t("Fix what is on the site but incomplete", "לתקן מה שבאתר אבל לא שלם"),
        steps: [
          t("\"Published without a live flight\": the screen suggests blocks on the same cities within 2 days. Type \"Seats\" and \"Allocate\".", "\"Published without a live flight\": המסך מציע בלוקים לאותן ערים בטווח של יומיים. מקלידים \"Seats\" ו-\"Allocate\"."),
          t("\"Published with no price\": type the double-room price → \"Save Price\", or \"Take Off Site\" (it leaves the site at the next revalidate).", "\"Published with no price\": מקלידים מחיר חדר זוגי ← \"Save Price\", או \"Take Off Site\" (התאריך יורד מהאתר ב-Revalidate הבא)."),
          t("\"Hotels not in catalog\": pick the catalog hotel → \"Save\". A suggested match says so - check it is the right hotel.", "\"Hotels not in catalog\": בוחרים את המלון מהקטלוג ← \"Save\". התאמה מוצעת מסומנת ככזאת - בודקים שזה המלון הנכון."),
        ],
      },
    ],
    points: [
      t("\"Data problems\" counts what is still wrong in the data (allocations off by date or route, dates with no seats left, confirmed blocks with no PNR or contract); \"Open Data Problems\" lists them.", "\"Data problems\" סופר מה שעדיין לא תקין בנתונים (הקצאות שלא מתאימות בתאריך או במסלול, תאריכים בלי מושבים, בלוקים מאושרים בלי PNR או חוזה); \"Open Data Problems\" מציג אותם."),
      t("Nothing is queued: every list is worked out again on each load and after each action. Every decision goes on the block's timeline with your name.", "שום דבר לא עומד בתור: כל רשימה מחושבת מחדש בכל טעינה ואחרי כל פעולה. כל החלטה נרשמת בציר הזמן של הבלוק עם השם שלכם."),
    ],
    links: [
      { label: t("Approvals", "אישורים"), href: "/tours/approvals", adminOnly: true },
      { label: t("Data problems", "בעיות נתונים"), href: "/tours/exceptions", adminOnly: true },
    ],
  },

  // -------------------------------------------------------------------- products
  {
    id: "tours-packages",
    nav: "/tours/packages",
    productType: "tours",
    title: t("Tours - the tour pages", "טיולים - עמודי הטיולים"),
    intro: t(
      "Every tour of the site: its page, dates, prices, flights and hotels. Open a tour to edit it; changes reach the site after you save and revalidate. A new tour starts at \"Add Tour\" - step by step under Start here.",
      "כל טיול באתר: העמוד שלו, התאריכים, המחירים, הטיסות והמלונות. פותחים טיול כדי לערוך אותו; שינויים מגיעים לאתר אחרי שמירה ופרסום. טיול חדש מתחיל ב-\"Add Tour\" - צעד אחר צעד תחת מתחילים כאן.",
    ),
    howTo: [
      {
        title: t("Find a tour", "למצוא טיול"),
        steps: [
          t("Open [Tours](/tours/packages). \"With content\", \"No content\" and \"All\" split the list; search by name, slug or series code.", "פותחים את [הטיולים](/tours/packages). \"With content\", \"No content\" ו-\"All\" מחלקים את הרשימה; מחפשים לפי שם, slug או קוד סדרה."),
          t("\"Upcoming Dates on Site\" counts each tour's published future dates. Click a row to open the tour.", "\"Upcoming Dates on Site\" סופר את התאריכים העתידיים המפורסמים של כל טיול. לחיצה על שורה פותחת את הטיול."),
        ],
      },
      {
        title: t("Edit a tour", "לערוך טיול"),
        steps: [
          t("The tabs: \"Details\", \"Images\", \"Description\", \"Itinerary\", \"Seasons\", \"Dates & Prices\", \"Hotels\", \"FAQ\", \"SEO\", \"Categories & Tags\". \"Ready for the site\" above them says which one still needs work.", "הלשוניות: \"Details\", \"Images\", \"Description\", \"Itinerary\", \"Seasons\", \"Dates & Prices\", \"Hotels\", \"FAQ\", \"SEO\", \"Categories & Tags\". \"Ready for the site\" מעליהן אומר איזו עוד צריכה עבודה."),
          t("\"Details\" opens with \"Series code\": the English code of the series (CBP), shown large. A tour with no series yet gets its code there (\"Save Code\"); the code is locked once dates were built from it.", "\"Details\" נפתחת ב-\"Series code\": הקוד באנגלית של הסדרה (CBP), בגדול. טיול שעוד אין לו סדרה מקבל שם את הקוד (\"Save Code\"); הקוד ננעל אחרי שנבנו ממנו תאריכים."),
          t("\"Description\" holds the \"Tour description\", \"Attractions\", \"Included\", \"Not included\", \"Additional info\", \"Booking terms\" and \"Cancellation terms\". \"Images\" holds the hero, the card image and the \"Gallery\" (its order is the site's order).", "ב-\"Description\": \"Tour description\", \"Attractions\", \"Included\", \"Not included\", \"Additional info\", \"Booking terms\" ו-\"Cancellation terms\". ב-\"Images\": תמונת הראש, תמונת הכרטיס וה-\"Gallery\" (הסדר שלה הוא הסדר באתר)."),
          t("A text field offers \"HTML & Preview\" or \"Visual Editor\" (the visual editor turns off when the HTML is too complex for it).", "שדה טקסט מציע \"HTML & Preview\" או \"Visual Editor\" (העורך הוויזואלי נכבה כשה-HTML מורכב מדי בשבילו)."),
          t("Click \"Save\" in the bottom bar, then \"Revalidate Pages\" when you are done.", "לוחצים \"Save\" בסרגל התחתון, ואז \"Revalidate Pages\" כשמסיימים."),
        ],
      },
      {
        title: t("Take a tour off the site", "להוריד טיול מהאתר"),
        steps: [
          t("\"Details\" tab: switch \"Active on site\" off, \"Save\", then \"Revalidate Pages\". The tour and its data stay in the backoffice.", "לשונית \"Details\": מכבים את \"Active on site\", \"Save\", ואז \"Revalidate Pages\". הטיול והנתונים שלו נשארים בבק-אופיס."),
          t("\"Delete Tour\" (same tab) only works for a tour with no series and no dates - such a tour can only be deactivated. Delete is soft: the data is kept.", "\"Delete Tour\" (באותה לשונית) עובד רק לטיול בלי סדרה ובלי תאריכים - טיול כזה אפשר רק להשבית. המחיקה רכה: הנתונים נשמרים."),
        ],
      },
    ],
    points: [
      t("\"No content\" tours were created by the data import so their series has a page. Add a description or an image and save - it then counts as a tour with content.", "טיולים ב-\"No content\" נוצרו בייבוא הנתונים כדי שלסדרה שלהם יהיה עמוד. מוסיפים תיאור או תמונה ושומרים - ואז הוא נחשב טיול עם תוכן."),
      t("Itinerary variants: every tour has a main itinerary; a variant serves dates sold in the other direction. On the site, each date shows the variant whose arrival and return cities match its route.", "גרסאות מסלול: לכל טיול יש מסלול ראשי; גרסה משרתת תאריכים שנמכרים בכיוון השני. באתר, כל תאריך מציג את הגרסה שערי הנחיתה והחזרה שלה מתאימות למסלול שלו."),
      t("The \"Hotels\" tab copies a hotel from the catalog into the tour. A later edit in the catalog does not change the tour - update it here too.", "לשונית \"Hotels\" מעתיקה מלון מהקטלוג לטיול. עריכה מאוחרת בקטלוג לא משנה את הטיול - מעדכנים גם כאן."),
      t("\"Seasons\": a season is more than a word on a date. \"New Season\" → its name, \"Itinerary of this season\", then tick \"Dates of this season\" and \"Create Season\". Under \"What this season says instead of the tour page\" fill only what differs - description, attractions, included / not included, images; an empty field shows the tour's own. \"Add Promotion to its dates\" puts a discount or a gift on every upcoming date of the season.", "\"Seasons\": עונה היא יותר ממילה על תאריך. \"New Season\" ← השם שלה, \"Itinerary of this season\", ואז מסמנים את \"Dates of this season\" ו-\"Create Season\". תחת \"What this season says instead of the tour page\" ממלאים רק מה ששונה - תיאור, אטרקציות, כלול / לא כלול, תמונות; שדה ריק מציג את של הטיול. \"Add Promotion to its dates\" שם הנחה או מתנה על כל תאריך עתידי של העונה."),
      t("A date with no season is counted on the \"Seasons\" tab and marked on the \"Ready for the site\" strip. On the site, a customer who picks a date sees the content of that date's season.", "תאריך בלי עונה נספר בלשונית \"Seasons\" ומסומן בפס \"Ready for the site\". באתר, לקוח שבוחר תאריך רואה את התוכן של העונה של אותו תאריך."),
      t("\"Itinerary\" → a variant → \"Dates on this variant\": tick the dates that run it and \"Save the dates of this variant\". A date given no variant shows its season's variant, else the main itinerary.", "\"Itinerary\" ← גרסה ← \"Dates on this variant\": מסמנים את התאריכים שרצים עליה ו-\"Save the dates of this variant\". תאריך שלא קיבל גרסה מציג את הגרסה של העונה שלו, ואם אין - את המסלול הראשי."),
    ],
    rules: [
      t("An inactive tour is left out of the site build, whatever its dates say.", "טיול לא פעיל לא נכנס לבנייה של האתר, לא משנה מה מצב התאריכים שלו."),
    ],
    links: [
      { label: t("Tours", "טיולים"), href: "/tours/packages" },
      { label: t("Add Tour", "הוספת טיול"), href: "/tours/packages/new" },
    ],
  },
  {
    id: "tours-departures",
    nav: "/tours/departures",
    productType: "tours",
    title: t("Departures - every date and price in one sheet", "יציאות - כל התאריכים והמחירים בטבלה אחת"),
    intro: t(
      "Departures and Pricing are one table. The organized tours as a spreadsheet: the tour's name as a header row, its dates (sub-tours) under it, then the next tour. \"Departures\", \"Prices\" and \"Details\" only switch the columns. The same sheet sits in each tour page, on the \"Dates & Prices\" tab. Nothing is saved until you click \"Save\".",
      "היציאות והתמחור הם טבלה אחת. הטיולים המאורגנים כגיליון: שם הטיול כשורת כותרת, התאריכים (תתי-הטיול) שלו מתחתיו, ואז הטיול הבא. \"Departures\", \"Prices\" ו-\"Details\" רק מחליפים עמודות. אותה טבלה נמצאת בכל עמוד טיול, בלשונית \"Dates & Prices\". שום דבר לא נשמר עד שלוחצים \"Save\".",
    ),
    howTo: [
      {
        title: t("The three column sets", "שלוש קבוצות העמודות"),
        steps: [
          t("Open [Departures](/tours/departures). \"Departures\" shows what the site shows on each date: \"On site\", the dates and route, \"Season\", \"Status\", \"Labels\" (up to 3), \"Bar/Bat Mitzvah\", the double-room price, \"Discount\", \"Gift\", the flight, the seats and the \"Docket\".", "פותחים את [היציאות](/tours/departures). \"Departures\" מציג את מה שהאתר מציג על כל תאריך: \"On site\", התאריכים והמסלול, \"Season\", \"Status\", \"Labels\" (עד 3), \"Bar/Bat Mitzvah\", מחיר החדר הזוגי, \"Discount\", \"Gift\", הטיסה, המושבים ו-\"Docket\"."),
          t("\"Prices\" shows the six room prices per person (double room first) next to the flight's cost. \"Details\" shows the currency, capacity, \"Season\", \"Itinerary\", \"Card badge\", meeting time, transfers, ages, senior discount and notes.", "\"Prices\" מציג את ששת מחירי החדר לאדם (זוגי ראשון) ליד עלות הטיסה. \"Details\" מציג מטבע, קיבולת, \"Season\", \"Itinerary\", \"Card badge\", שעת התכנסות, העברות, גילאים, הנחת גיל הזהב והערות."),
          t("Filters: search by tour or code, the tour, the season, the status, and the ticks \"No season\", \"No flight\", \"No double price\", \"Not on the site\", \"Past dates\".", "מסננים: חיפוש לפי טיול או קוד, הטיול, העונה, הסטטוס, והסימונים \"No season\", \"No flight\", \"No double price\", \"Not on the site\", \"Past dates\"."),
        ],
      },
      {
        title: t("Edit like a spreadsheet", "לערוך כמו בגיליון"),
        steps: [
          t("Click a cell and type, or double-click or press Enter; Enter saves the cell and goes down, Tab goes right, Escape cancels. Delete empties a cell. A tick cell switches with Enter or the space bar; \"Season\", \"Status\" and \"Itinerary\" open a list.", "לוחצים על תא ומקלידים, או לחיצה כפולה או Enter; Enter שומר את התא ויורד, Tab זז ימינה, Escape מבטל. Delete מרוקן תא. תא של וי מתחלף ב-Enter או ברווח; \"Season\", \"Status\" ו-\"Itinerary\" פותחים רשימה."),
          t("Paste a block copied from Excel or Google Sheets: it fills from the cell you stand on, to the right and down.", "מדביקים בלוק שהועתק מאקסל או מגוגל שיטס: הוא ממלא מהתא שעומדים עליו, ימינה ולמטה."),
          t("Changed cells turn yellow and a bar shows how many changes wait - \"Save\" or \"Discard\". A cell with a value that means nothing turns red and blocks Save until it is fixed.", "תאים ששונו נצבעים צהוב ופס מראה כמה שינויים מחכים - \"Save\" או \"Discard\". תא עם ערך שאין לו משמעות נצבע אדום וחוסם את Save עד שמתקנים."),
        ],
      },
      {
        title: t("Many dates at once", "הרבה תאריכים בבת אחת"),
        steps: [
          t("Tick rows (or a tour's header row for all its dates) → \"Set for selected\": a column and a value - the season, the itinerary, the labels, a price, the discount, the gift, any column. For prices also \"Add\" an amount or \"Add %\" (a negative number lowers).", "מסמנים שורות (או את שורת הכותרת של טיול לכל התאריכים שלו) ← \"Set for selected\": עמודה וערך - העונה, המסלול, התגיות, מחיר, ההנחה, המתנה, כל עמודה. למחירים גם \"Add\" סכום או \"Add %\" (מספר שלילי מוריד)."),
          t("With rows ticked, pasting one value puts it in that column of every ticked row.", "כשיש שורות מסומנות, הדבקה של ערך אחד שמה אותו בעמודה הזאת בכל השורות המסומנות."),
          t("What a group of dates says differently from the tour - its description, included / not included, attractions, images, itinerary - is set once on the season (the tour's \"Seasons\" tab) and reaches every date of that season.", "מה שקבוצת תאריכים אומרת אחרת מהטיול - התיאור, כלול / לא כלול, אטרקציות, תמונות, מסלול - נקבע פעם אחת בעונה (לשונית \"Seasons\" של הטיול) ומגיע לכל תאריך של העונה."),
        ],
      },
      {
        title: t("A date's card, and new dates", "כרטיס התאריך, ותאריכים חדשים"),
        steps: [
          t("Click a code: the date's card opens over the sheet. \"General\": dates and route, the season, the itinerary version, labels and the red \"Card badge\", ages, meeting time, Docket and capacity. \"Prices\", \"Promotions\" (every kind, with \"Valid until\"), \"Flights\" and \"Reservations\".", "לוחצים על קוד: כרטיס התאריך נפתח מעל הטבלה. \"General\": תאריכים ומסלול, העונה, גרסת המסלול, תגיות ו-\"Card badge\" האדום, גילאים, שעת התכנסות, Docket וקיבולת. \"Prices\", \"Promotions\" (כל הסוגים, עם \"Valid until\"), \"Flights\" ו-\"Reservations\"."),
          t("\"Add Departure\": series, departure and return date → \"Create Departure\" (a draft). A date opened this way has no flight yet: price it, put it on the site and sell it; link the flight when it exists.", "\"Add Departure\": סדרה, תאריך יציאה וחזרה ← \"Create Departure\" (טיוטה). לתאריך שנפתח כך אין עדיין טיסה: מתמחרים, מעלים לאתר ומוכרים; את הטיסה מקשרים כשהיא קיימת."),
          t("\"More\" → \"Classic board\" opens the old board: vacation packages, deleted dates (\"Deleted\" → \"Restore\") and \"Export to Excel\".", "\"More\" ← \"Classic board\" פותח את הלוח הישן: חבילות נופש, תאריכים מחוקים (\"Deleted\" ← \"Restore\") ו-\"Export to Excel\"."),
        ],
      },
    ],
    points: [
      t("A date's code is the series code + month + two-digit day: BBC on 3 July = BBC703.", "קוד התאריך הוא קוד הסדרה + חודש + יום בשתי ספרות: BBC ב-3 ביולי = BBC703."),
      t("The prices are final, per person, and include the flight. \"Flight cost\" is what the flight costs per seat - to see the margin; it is never added to the price.", "המחירים סופיים, לאדם, וכוללים טיסה. \"Flight cost\" היא העלות של הטיסה למושב - כדי לראות רווח; היא אף פעם לא מתווספת למחיר."),
      t("\"Season\" is one of the tour's seasons. A date with \"No season\" is marked in amber, counted on the tour's header row and on its \"Ready for the site\" strip - assign it before it goes live.", "\"Season\" היא אחת מהעונות של הטיול. תאריך עם \"No season\" מסומן בכתום, נספר בשורת הכותרת של הטיול ובפס \"Ready for the site\" שלו - משייכים אותו לפני שהוא עולה לאוויר."),
      t("\"Labels\" holds up to 3 labels the site shows on the date. \"Bar/Bat Mitzvah\" marks the date as a bar / bat mitzvah date - the site shows \"מועד בר/בת מצווה\" on it.", "\"Labels\" מחזיק עד 3 תגיות שהאתר מציג על התאריך. \"Bar/Bat Mitzvah\" מסמן את התאריך כמועד בר/בת מצווה - האתר מציג עליו \"מועד בר/בת מצווה\"."),
      t("\"Discount\" is a discount per traveler on that date - the site shows the old price crossed out. \"Gift\" is a gift of that date, shown on its card on the site. Other promotions (a percent, a named discount, the series') show under \"More promotions\" and are edited in the card.", "\"Discount\" היא הנחה לנוסע בתאריך הזה - האתר מציג את המחיר הישן מחוק. \"Gift\" היא מתנה של התאריך, שמופיעה על הכרטיס שלו באתר. הטבות אחרות (אחוז, הנחה עם שם, של הסדרה) מופיעות ב-\"More promotions\" ונערכות בכרטיס."),
      t("\"Flight\" is read from the flight block itself, like its times, baggage and stops - nothing about the flight is typed here. \"No flight yet\" is not an error: the date can be on the site, which then says \"פרטי הטיסות יעלו בהמשך\".", "\"Flight\" נקרא מבלוק הטיסה עצמו, כמו השעות, הכבודה והעצירות - שום דבר על הטיסה לא מוקלד כאן. \"No flight yet\" אינו שגיאה: התאריך יכול להיות באתר, שכותב אז \"פרטי הטיסות יעלו בהמשך\"."),
      t("A date with flight seats shows \"Last places\" on the site at 5 seats or fewer and \"Sold out\" at none - on its own, and back again when a cancellation frees seats. \"Closed\" and a \"Sold out\" you set yourself always stay.", "תאריך עם מושבי טיסה מציג באתר \"Last places\" ב-5 מושבים או פחות ו-\"Sold out\" כשלא נשארו - לבד, וחוזר כשביטול מפנה מושבים. \"Closed\" ו-\"Sold out\" שקבעתם בעצמכם תמיד נשארים."),
      t("Each saved row is checked again: a row someone else changed since you opened the sheet is not saved and is listed with the reason, your edit kept.", "כל שורה שנשמרת נבדקת שוב: שורה שמישהו אחר שינה מאז שפתחתם את הטבלה לא נשמרת ומופיעה עם הסיבה, והעריכה שלכם נשארת."),
      t("A tours agent sees the old board read-only: published dates only, with no cost, docket or notes.", "סוכן טיולים רואה את הלוח הישן לקריאה בלבד: רק תאריכים מפורסמים, בלי עלות, docket או הערות."),
    ],
    rules: [
      t("A date is published only with dates, both cities, a currency and a double-room price. A flight is not required.", "תאריך מתפרסם רק עם תאריכים, שתי הערים, מטבע ומחיר חדר זוגי. טיסה אינה חובה."),
      t("A date on the site keeps its double-room price and everything the site needs; to empty it, untick \"On site\" in the same save.", "תאריך שבאתר שומר את מחיר החדר הזוגי וכל מה שהאתר צריך; כדי לרוקן אותו, מורידים את הסימון \"On site\" באותה שמירה."),
      t("A percent-off-the-order discount and a fixed discount per traveler can't be active together on one date.", "הנחה באחוזים על ההזמנה והנחה קבועה לנוסע לא יכולות להיות פעילות יחד באותו תאריך."),
    ],
    links: [{ label: t("Departures", "יציאות"), href: "/tours/departures" }],
  },
  {
    id: "tours-flights",
    nav: "/offline-flights",
    productType: "tours",
    title: t("Offline flights - the company's flight blocks", "טיסות אופליין - בלוקי הטיסה של החברה"),
    intro: t(
      "The group seats the company holds with airlines, as a spreadsheet: every flight block, series by series, edited like the departures sheet. \"Details\" is the flight itself and its costs; \"Operations\" is the work on the block - status, seats and every deadline. Both start with \"Tour code\": the sub-tours the flight serves (BBC712). A block is allocated to tour dates, never linked to events.",
      "המושבים הקבוצתיים שהחברה מחזיקה מול חברות התעופה, כגיליון: כל בלוק טיסה, סדרה אחרי סדרה, בעריכה כמו בטבלת היציאות. \"Details\" הוא הטיסה עצמה והעלויות שלה; \"Operations\" הוא העבודה על הבלוק - סטטוס, מושבים וכל המועדים. שתיהן נפתחות ב-\"Tour code\": תתי-הטיול שהטיסה משרתת (BBC712). בלוק מוקצה לתאריכי טיולים, אף פעם לא מקושר לאירועים.",
    ),
    howTo: [
      {
        title: t("Create a flight block", "ליצור בלוק טיסה"),
        steps: [
          t("Open [Offline Flights](/offline-flights) and click \"Add New Flight\".", "פותחים את [הטיסות האופליין](/offline-flights) ולוחצים \"Add New Flight\"."),
          t("Type the airline code and click \"Validate\"; fill the outbound and inbound flights (numbers, airports, times), the price and \"Initial Quantity\" (the seats) → \"Create Flight\".", "מקלידים את קוד חברת התעופה ולוחצים \"Validate\"; ממלאים את טיסות הלוך והחזור (מספרים, שדות, שעות), את המחיר ואת \"Initial Quantity\" (המושבים) ← \"Create Flight\"."),
          t("The same route on many dates: [New series](/offline-flights/series/new). Tick \"Organized tour\" and give the tour code, and every flight becomes a sub-tour of that tour.", "אותו מסלול בהרבה תאריכים: [New series](/offline-flights/series/new). מסמנים \"Organized tour\" ונותנים את קוד הטיול, וכל טיסה הופכת לתת-טיול של הטיול."),
        ],
      },
      {
        title: t("Take a block from draft to ticketed", "להעביר בלוק מטיוטה עד כרטוס"),
        steps: [
          t("Open the flight (the eye → \"View Flight\"). The block panel shows the path: Draft → Approved to book → Requested → Confirmed by airline → Handed to operations → Ticketed.", "פותחים את הטיסה (העין ← \"View Flight\"). חלונית הבלוק מציגה את המסלול: Draft ← Approved to book ← Requested ← Confirmed by airline ← Handed to operations ← Ticketed."),
          t("\"Approve to Book\" is the manager's step. Then \"Request Sent to Airline\", and \"Confirmed by Airline\" - it needs the PNR, the seats, the adult cost, its currency and a contract, and computes the deadlines from the contract.", "\"Approve to Book\" הוא הצעד של המנהל. אחריו \"Request Sent to Airline\", ו-\"Confirmed by Airline\" - הוא דורש PNR, מושבים, עלות מבוגר, מטבע וחוזה, ומחשב את המועדים מהחוזה."),
          t("\"Hand to Operations\", then \"Ticketed\". Along the way: \"Declined\", \"Option\" or \"Cancel Flight Block\".", "\"Hand to Operations\", ואז \"Ticketed\". בדרך: \"Declined\", \"Option\" או \"Cancel Flight Block\"."),
        ],
      },
      {
        title: t("Give a date its seats", "לתת לתאריך מושבים"),
        steps: [
          t("On the block: \"Allocation\" → \"Allocate to Departure\" → the date, the direction and the seats. Or from the date's card → \"Flights\" → \"Find Matching Blocks\".", "בבלוק: \"Allocation\" ← \"Allocate to Departure\" ← התאריך, הכיוון והמושבים. או מכרטיס התאריך ← \"Flights\" ← \"Find Matching Blocks\"."),
          t("Only blocks within 2 days of the date and on its cities are offered. \"Remove\" returns the seats to the block's pool.", "מוצעים רק בלוקים בטווח של יומיים מהתאריך ובערים שלו. \"Remove\" מחזיר את המושבים למאגר של הבלוק."),
        ],
      },
    ],
    points: [
      t("A live block - \"Confirmed by airline\", \"Handed to operations\", \"Ticketed\" - is what counts as a date's seats and turns its \"Flights\" step green.", "בלוק חי - \"Confirmed by airline\", \"Handed to operations\", \"Ticketed\" - הוא מה שנספר כמושבים של תאריך ומדליק בירוק את השלב \"Flights\"."),
      t("The sheet: click a cell and type, paste a block from Excel, tick rows and \"Set for selected\"; changed cells turn yellow until \"Save\". \"Details\": series, airline, both legs (flight, from, to, times), costs, baggage kg, stops, supplier, PNR. \"Operations\": \"Status\" (the next step of the block), \"Seats\", \"Ordered\", \"Allocated\", \"Free\", \"Requested\", \"Option until\", \"Cancel 1\", \"Cancel 2\", \"Names\", \"Ticketing\", \"Payment\", \"Handled by\", \"Reviewed\".", "הטבלה: לוחצים על תא ומקלידים, מדביקים בלוק מאקסל, מסמנים שורות ו-\"Set for selected\"; תאים ששונו נצבעים צהוב עד \"Save\". \"Details\": סדרה, חברת תעופה, שתי הרגליים (טיסה, מ-, אל, שעות), עלויות, כבודה בק\"ג, עצירות, ספק, PNR. \"Operations\": \"Status\" (הצעד הבא של הבלוק), \"Seats\", \"Ordered\", \"Allocated\", \"Free\", \"Requested\", \"Option until\", \"Cancel 1\", \"Cancel 2\", \"Names\", \"Ticketing\", \"Payment\", \"Handled by\", \"Reviewed\"."),
      t("In \"Operations\" a deadline turns amber within a week and red once it has passed. Lowering \"Seats\" releases seats to the airline and is written to the block's timeline; it can't go below the seats already allocated. Declining or cancelling a block needs a reason - click the flight number and do it on the flight's page.", "ב-\"Operations\" מועד נצבע כתום בתוך שבוע ואדום אחרי שעבר. הורדת \"Seats\" משחררת מושבים לחברת התעופה ונכתבת בציר הזמן של הבלוק; אי אפשר לרדת מתחת למושבים שכבר הוקצו. דחייה או ביטול של בלוק דורשים סיבה - לוחצים על מספר הטיסה ועושים זאת בעמוד הטיסה."),
      t("\"Tour code\" links to the sub-tour's card. \"No sub-tour\" marks a flight no date takes seats from yet (filter: \"No sub-tour\"). \"Classic table\" opens the old table: the column picker, delete / restore and \"Export inventory\".", "\"Tour code\" מקשר לכרטיס של התת-טיול. \"No sub-tour\" מסמן טיסה שאף תאריך עוד לא לוקח ממנה מושבים (מסנן: \"No sub-tour\"). \"Classic table\" פותח את הטבלה הישנה: בחירת עמודות, מחיקה / שחזור ו-\"Export inventory\"."),
      t("The block card also holds \"Deadlines\" (\"Recompute from Contract\", \"Record Deposit\"), \"Costs\" and a \"Timeline\" of every step.", "בכרטיס הבלוק יש גם \"Deadlines\" (\"Recompute from Contract\", \"Record Deposit\"), \"Costs\" ו-\"Timeline\" של כל צעד."),
    ],
    rules: [
      t("Approving a block to book, and cancelling one the airline already confirmed, are for the company's admins - here or on [Approvals](/tours/approvals).", "אישור בלוק להזמנה, וביטול בלוק שחברת התעופה כבר אישרה, שמורים למנהלי החברה - כאן או ב[אישורים](/tours/approvals)."),
      t("A sub-tour made from a flight follows it: when the flight's dates change, so do the sub-tour's dates and code - unless it has customers. Then it stays, a task opens, and [Approvals](/tours/approvals) lists it under \"Sub-tours off their flight\".", "תת-טיול שנוצר מטיסה עוקב אחריה: כשתאריכי הטיסה משתנים, משתנים גם התאריכים והקוד של התת-טיול - אלא אם יש לו לקוחות. אז הוא נשאר, נפתחת משימה, ו[האישורים](/tours/approvals) מציגים אותו תחת \"Sub-tours off their flight\"."),
    ],
    links: [
      { label: t("Offline flights", "טיסות אופליין"), href: "/offline-flights" },
      { label: t("New series", "סדרה חדשה"), href: "/offline-flights/series/new" },
    ],
  },

  // --------------------------------------------------------------------- website
  {
    id: "tours-homepage",
    nav: "/tours/homepage",
    productType: "tours",
    title: t("Homepage - the sections of the home page", "עמוד הבית - הסקשנים של דף הבית"),
    intro: t(
      "The home page of the site as a list of sections, top to bottom. Move a section, hide it, open it to edit, add a new one or remove it.",
      "עמוד הבית של האתר כרשימת סקשנים, מלמעלה למטה. מזיזים סקשן, מסתירים, פותחים לעריכה, מוסיפים חדש או מסירים.",
    ),
    howTo: [
      {
        title: t("Change the home page", "לשנות את עמוד הבית"),
        steps: [
          t("Open [Homepage](/tours/homepage). Each row is a section; the arrows move it, the switch hides it, the bin removes it.", "פותחים את [עמוד הבית](/tours/homepage). כל שורה היא סקשן; החצים מזיזים, המתג מסתיר, הפח מסיר."),
          t("Click a row to open it and edit its texts, pictures and links.", "לוחצים על שורה כדי לפתוח אותה ולערוך טקסטים, תמונות וקישורים."),
          t("\"Save\", then \"Revalidate Pages\". \"Discard\" brings back what was there before the last save.", "\"Save\", ואז \"Revalidate Pages\". \"Discard\" מחזיר את מה שהיה לפני השמירה האחרונה."),
        ],
      },
      {
        title: t("Add an automatic tour slider", "להוסיף סליידר טיולים אוטומטי"),
        steps: [
          t("\"Add Section\" → \"Automatic tour slider\". Type the \"Section title\".", "\"Add Section\" ← \"Automatic tour slider\". מקלידים \"Section title\"."),
          t("In \"Which tours\" choose the rule: the tours of a world, a tag, a destination or a category, tours on sale, all tours, or \"Tours I pick\".", "ב-\"Which tours\" בוחרים את הכלל: הטיולים של עולם, תגית, יעד או קטגוריה, טיולים במבצע, כל הטיולים, או \"Tours I pick\"."),
          t("Move the section to its place with the arrows, \"Save\", \"Revalidate Pages\".", "מזיזים את הסקשן למקומו בחצים, \"Save\", \"Revalidate Pages\"."),
        ],
      },
      {
        title: t("Add a banner or a picture", "להוסיף באנר או תמונה"),
        steps: [
          t("\"Add Section\" → \"Banners\" (picture cards with a title and a button) or \"Wide image\" (one picture across the page).", "\"Add Section\" ← \"Banners\" (כרטיסי תמונה עם כותרת וכפתור) או \"Wide image\" (תמונה אחת לרוחב העמוד)."),
          t("\"Upload\" a picture, type the texts, and set the link: type it, or choose a page with \"Pick…\".", "\"Upload\" לתמונה, מקלידים את הטקסטים, וקובעים קישור: מקלידים, או בוחרים עמוד ב-\"Pick…\"."),
        ],
      },
    ],
    points: [
      t("A slider fills itself: a tour that gets the tag shows up after the next \"Revalidate Pages\", with no edit here.", "סליידר מתמלא לבד: טיול שמקבל את התגית מופיע אחרי ה-\"Revalidate Pages\" הבא, בלי לגעת כאן."),
      t("A hidden section stays in the list with its content, so you can bring it back for the next season.", "סקשן מוסתר נשאר ברשימה עם התוכן שלו, כך שאפשר להחזיר אותו בעונה הבאה."),
      t("The reviews of the \"Reviews\" section also show on the world and tag pages.", "הביקורות של הסקשן \"Reviews\" מופיעות גם בעמודי העולמות והתגיות."),
      t("If someone else saved while you were editing, your save is refused instead of overwriting theirs: reload and apply your change again.", "אם מישהו אחר שמר בזמן שערכתם, השמירה שלכם נדחית במקום לדרוס את שלו: טוענים מחדש ומחילים שוב את השינוי."),
    ],
    links: [{ label: t("Homepage", "עמוד הבית"), href: "/tours/homepage" }],
  },
  {
    id: "tours-site",
    nav: "/tours/site",
    productType: "tours",
    title: t("Header & footer", "הדר ופוטר"),
    intro: t(
      "The menus at the top of every page, the mobile menu, the footer, and the contact details the site shows.",
      "התפריטים בראש כל עמוד, התפריט בנייד, הפוטר, ופרטי הקשר שהאתר מציג.",
    ),
    howTo: [
      {
        title: t("Change a menu", "לשנות תפריט"),
        steps: [
          t("Open [Header & Footer](/tours/site) → \"Header menu\". Each card is one menu of the header.", "פותחים את [הדר ופוטר](/tours/site) ← \"Header menu\". כל כרטיס הוא תפריט אחד בהדר."),
          t("Edit a link's label, and its address: type it, or choose a page, a world, a tag, a destination or a tour with \"Pick…\". \"Add Sub-link\" opens a level under it.", "עורכים את התווית של קישור ואת הכתובת שלו: מקלידים, או בוחרים עמוד, עולם, תגית, יעד או טיול ב-\"Pick…\". \"Add Sub-link\" פותח רמה מתחתיו."),
          t("\"Mobile menu\" has its own order; \"Copy from the Header Menu\" rebuilds it from the header.", "ל-\"Mobile menu\" יש סדר משלו; \"Copy from the Header Menu\" בונה אותו מחדש מההדר."),
          t("\"Save\", then \"Revalidate Pages\".", "\"Save\", ואז \"Revalidate Pages\"."),
        ],
      },
      {
        title: t("Change the phone, WhatsApp or social links", "לשנות טלפון, וואטסאפ או רשתות חברתיות"),
        steps: [
          t("Open [Header & Footer](/tours/site) → \"Contact details\".", "פותחים את [הדר ופוטר](/tours/site) ← \"Contact details\"."),
          t("Change the field, \"Save\", \"Revalidate Pages\". The header icons, the footer, the contact page and the forms all read from here.", "משנים את השדה, \"Save\", \"Revalidate Pages\". האייקונים בהדר, הפוטר, עמוד צור קשר והטפסים קוראים מכאן."),
        ],
      },
    ],
    points: [
      t("A link left empty only opens its sub-links.", "קישור שנשאר ריק רק פותח את תתי הקישורים שלו."),
      t("\"Footer\" holds the tiles above the footer, the newsletter texts and the link columns.", "ב-\"Footer\" נמצאים האריחים שמעל הפוטר, הטקסטים של הניוזלטר ועמודות הקישורים."),
    ],
    links: [{ label: t("Header & footer", "הדר ופוטר"), href: "/tours/site" }],
  },
  {
    id: "tours-media",
    nav: "/tours/media",
    productType: "tours",
    title: t("Media - the pictures of the site", "מדיה - התמונות של האתר"),
    intro: t(
      "Every picture that was uploaded to the site, from any screen, newest first.",
      "כל תמונה שהועלתה לאתר, מכל מסך, מהחדשה לישנה.",
    ),
    howTo: [
      {
        title: t("Use a picture that was already uploaded", "להשתמש בתמונה שכבר הועלתה"),
        steps: [
          t("In any image field click \"Library\". The same pictures open in a window.", "בכל שדה תמונה לוחצים \"Library\". אותן תמונות נפתחות בחלון."),
          t("Search by file name or choose a folder, and click the picture. Save the page as usual.", "מחפשים לפי שם קובץ או בוחרים תיקייה, ולוחצים על התמונה. שומרים את העמוד כרגיל."),
        ],
      },
      {
        title: t("Upload pictures ahead of time", "להעלות תמונות מראש"),
        steps: [
          t("Open [Media](/tours/media), choose the folder in \"Upload to\" and click \"Upload Images\". Several files can go at once.", "פותחים את [מדיה](/tours/media), בוחרים תיקייה ב-\"Upload to\" ולוחצים \"Upload Images\". אפשר כמה קבצים יחד."),
          t("\"Copy Address\" copies a picture's address, for a place that takes an address.", "\"Copy Address\" מעתיק את הכתובת של תמונה, למקום שמקבל כתובת."),
        ],
      },
    ],
    points: [
      t("A picture is not deleted from here: a page may still show it.", "תמונה לא נמחקת מכאן: ייתכן שעמוד עדיין מציג אותה."),
    ],
    links: [{ label: t("Media", "מדיה"), href: "/tours/media" }],
  },
  {
    id: "tours-pages",
    nav: "/tours/pages",
    productType: "tours",
    title: t("Content pages", "עמודי תוכן"),
    intro: t(
      "The free-form pages of the site (about, FAQ, terms, contact, guides) and the blog posts. Add a page or a post, write it, switch it on.",
      "העמודים החופשיים של האתר (אודות, שאלות נפוצות, תקנון, צור קשר, מדריכים) והפוסטים בבלוג. מוסיפים עמוד או פוסט, כותבים ומדליקים.",
    ),
    howTo: [
      {
        title: t("Add a page or a blog post", "להוסיף עמוד או פוסט לבלוג"),
        steps: [
          t("Open [Content Pages](/tours/pages) and click \"Add Page or Post\". Choose \"Page\" or \"Blog post\", type the title, \"Add\".", "פותחים את [עמודי התוכן](/tours/pages) ולוחצים \"Add Page or Post\". בוחרים \"Page\" או \"Blog post\", מקלידים כותרת, \"Add\"."),
          t("The editor opens. Write the content, add a \"Picture\" and an \"Opening line\". A post also has a \"Date\".", "העורך נפתח. כותבים את התוכן, מוסיפים \"Picture\" ו-\"Opening line\". לפוסט יש גם \"Date\"."),
          t("Switch on \"Active on site\", \"Save\", then \"Revalidate Pages\". The page is live at its \"Address on the site\"; a post also shows in the blog.", "מדליקים \"Active on site\", \"Save\", ואז \"Revalidate Pages\". העמוד עולה ב-\"Address on the site\" שלו; פוסט מופיע גם בבלוג."),
        ],
      },
      {
        title: t("Edit a page", "לערוך עמוד"),
        steps: [
          t("Open [Content Pages](/tours/pages), pick \"Pages\" or \"Blog posts\", search by title or address and click the row.", "פותחים את [עמודי התוכן](/tours/pages), בוחרים \"Pages\" או \"Blog posts\", מחפשים לפי כותרת או כתובת ולוחצים על השורה."),
          t("Change \"Title\", the content, the \"Picture\" and the \"SEO\" title and description. \"Active on site\" off hides the page.", "משנים \"Title\", את התוכן, את ה-\"Picture\" ואת כותרת ותיאור ה-\"SEO\". כיבוי \"Active on site\" מסתיר את העמוד."),
          t("\"Save\", then \"Revalidate Pages\".", "\"Save\", ואז \"Revalidate Pages\"."),
        ],
      },
    ],
    points: [
      t("A new page starts switched off, so a half-written page never reaches the site.", "עמוד חדש נוצר כבוי, כך שעמוד שלא נגמר לא מגיע לאתר."),
      t("The address of a page you added can change; the address of a page that came with the site is fixed, because menus and other pages link to it.", "את הכתובת של עמוד שהוספתם אפשר לשנות; הכתובת של עמוד שהגיע עם האתר קבועה, כי תפריטים ועמודים אחרים מקשרים אליו."),
      t("To put a new page in a menu, add a link to it in [Header & Footer](/tours/site): \"Pick…\" lists every page.", "כדי לשים עמוד חדש בתפריט, מוסיפים אליו קישור ב[הדר ופוטר](/tours/site): ב-\"Pick…\" מופיעים כל העמודים."),
      t("The preview shows the content without the site's styling, so it looks plainer here than on the site.", "התצוגה המקדימה מציגה את התוכן בלי העיצוב של האתר, אז כאן הוא נראה פשוט יותר מאשר באתר."),
    ],
    links: [{ label: t("Content pages", "עמודי תוכן"), href: "/tours/pages" }],
  },
  {
    id: "tours-terms",
    nav: "/tours/terms",
    productType: "tours",
    title: t("Categories & tags", "קטגוריות ותגיות"),
    intro: t(
      "The destinations, worlds, tags and categories of the site. Each one has a page on the site that fills itself with the tours that carry it.",
      "היעדים, העולמות, התגיות והקטגוריות של האתר. לכל אחד יש עמוד באתר שמתמלא לבד בטיולים שמשויכים אליו.",
    ),
    howTo: [
      {
        title: t("Edit or add a category", "לערוך או להוסיף קטגוריה"),
        steps: [
          t("Open [Categories & Tags](/tours/terms) and pick the kind: \"Destinations\", \"Worlds\", \"Tags\" or \"Categories\". \"Add Category or Tag\" adds a new one.", "פותחים את [הקטגוריות והתגיות](/tours/terms) ובוחרים סוג: \"Destinations\", \"Worlds\", \"Tags\" או \"Categories\". \"Add Category or Tag\" מוסיף חדש."),
          t("Click one: \"Name\", \"Position in list\" (lower comes first), \"Active on site\", \"Line under the title\", \"Description\", \"Hero images\" and the \"SEO\" title.", "לוחצים על אחת: \"Name\", \"Position in list\" (נמוך קודם), \"Active on site\", \"Line under the title\", \"Description\", \"Hero images\" וכותרת ה-\"SEO\"."),
          t("\"Save\", then \"Revalidate Pages\".", "\"Save\", ואז \"Revalidate Pages\"."),
        ],
      },
      {
        title: t("Set up a world", "להגדיר עולם"),
        steps: [
          t("A world is a top category of the site: Mega Family, Mega Events, Mega Ladies... Open it under \"Worlds\" (or add it).", "עולם הוא קטגוריית על של האתר: מגה פמילי, מגה איבנטס, מגה ליידיס... פותחים אותו תחת \"Worlds\" (או מוסיפים)."),
          t("In the \"World\" card set the \"Brand name\", the \"World color\" and a \"Tile picture\". A world that lives on another site gets a \"Link to another site\".", "בכרטיס \"World\" קובעים \"Brand name\", \"World color\" ו-\"Tile picture\". עולם שיושב באתר אחר מקבל \"Link to another site\"."),
          t("To give the world sub-categories, open a tag under \"Tags\" and choose the world in its \"World\" list.", "כדי לתת לעולם תת קטגוריות, פותחים תגית תחת \"Tags\" ובוחרים את העולם ברשימת \"World\" שלה."),
          t("To put a tour in the world, open the tour and choose it in \"World (card color on site)\", and tick the world in the tour's \"Categories & Tags\" tab.", "כדי לשייך טיול לעולם, פותחים את הטיול ובוחרים אותו ב-\"World (card color on site)\", ומסמנים את העולם בלשונית \"Categories & Tags\" של הטיול."),
        ],
      },
      {
        title: t("Put a tour in a category", "לשייך טיול לקטגוריה"),
        steps: [
          t("Open the tour in [Tours](/tours/packages) → \"Categories & Tags\" tab → tick it → \"Save\".", "פותחים את הטיול ב[טיולים](/tours/packages) ← לשונית \"Categories & Tags\" ← מסמנים ← \"Save\"."),
          t("The category's own page lists its tours (\"Tours on this page\") - read only; each chip opens that tour.", "בעמוד הקטגוריה עצמה מופיעים הטיולים שלה (\"Tours on this page\") - לקריאה בלבד; כל תג פותח את הטיול."),
        ],
      },
    ],
    points: [
      t("Nothing is built by hand: a world page, a tag page and a destination page list their tours by themselves, and a home page slider can follow any of them.", "שום דבר לא נבנה ידנית: עמוד עולם, עמוד תגית ועמוד יעד מציגים את הטיולים שלהם לבד, וסליידר בעמוד הבית יכול לעקוב אחרי כל אחד מהם."),
      t("A world with a brand name gets a tile in the \"Worlds\" section of the [home page](/tours/homepage). Its color paints its page, its sub-categories and the cards of its tours.", "עולם עם שם מותג מקבל אריח בסקשן \"Worlds\" של [עמוד הבית](/tours/homepage). הצבע שלו צובע את העמוד שלו, את תת הקטגוריות ואת הכרטיסים של הטיולים שלו."),
      t("A slug can't change: the page's address on the site is made from it.", "את ה-slug אי אפשר לשנות: הכתובת של העמוד באתר נבנית ממנו."),
    ],
    links: [{ label: t("Categories & tags", "קטגוריות ותגיות"), href: "/tours/terms" }],
  },
  {
    id: "tours-hotels",
    // the catalog is off the menu for now (lib/nav.ts `hidden`); its guide sits with Tours, whose Hotels tab uses it
    nav: "/tours/packages",
    productType: "tours",
    title: t("Hotels - the catalog", "מלונות - הקטלוג"),
    intro: t(
      "The hotel catalog: name, code, city, stars, images and description. A tour copies its hotels from here, and a vacation package's date points to a hotel by its code.",
      "קטלוג המלונות: שם, קוד, עיר, כוכבים, תמונות ותיאור. טיול מעתיק ממנו את המלונות שלו, ותאריך של חבילת נופש מצביע על מלון לפי הקוד שלו.",
    ),
    howTo: [
      {
        title: t("Edit a hotel", "לערוך מלון"),
        steps: [
          t("Open [Hotels](/tours/hotels), search by name, city or code, and click the hotel.", "פותחים את [המלונות](/tours/hotels), מחפשים לפי שם, עיר או קוד, ולוחצים על המלון."),
          t("\"Name\", \"Code\", \"City\", \"Stars\", \"Excerpt\" (the card text), \"Main image\", \"Gallery\", \"Hotel description\" and \"Facilities & services\" (\"Add Facility\").", "\"Name\", \"Code\", \"City\", \"Stars\", \"Excerpt\" (הטקסט בכרטיס), \"Main image\", \"Gallery\", \"Hotel description\" ו-\"Facilities & services\" (\"Add Facility\")."),
          t("\"Save\", then \"Revalidate Pages\".", "\"Save\", ואז \"Revalidate Pages\"."),
        ],
      },
      {
        title: t("Put a hotel on a tour", "לשים מלון בטיול"),
        steps: [
          t("Open the tour → \"Hotels\" tab → \"Choose a hotel from the catalog…\" → \"Add from Catalog\", then set this tour's \"Nights\" and \"Board\" → \"Save\".", "פותחים את הטיול ← לשונית \"Hotels\" ← \"Choose a hotel from the catalog…\" ← \"Add from Catalog\", ואז קובעים לטיול הזה \"Nights\" ו-\"Board\" ← \"Save\"."),
          t("It is a copy: a later change here does not reach that tour - update the tour too.", "זה עותק: שינוי מאוחר כאן לא מגיע לטיול - מעדכנים גם את הטיול."),
        ],
      },
    ],
    points: [
      t("The \"Code\" locks while dates point to it - changing it would cut them off.", "ה-\"Code\" ננעל כל עוד תאריכים מצביעים עליו - שינוי היה מנתק אותם."),
      t("Hotels come from the site import. A date whose hotel code is missing from the catalog shows up on [Approvals](/tours/approvals) for an admin to match.", "המלונות הגיעו מייבוא האתר. תאריך שקוד המלון שלו חסר בקטלוג מופיע ב[אישורים](/tours/approvals) כדי שמנהל יתאים."),
    ],
    links: [{ label: t("Hotels", "מלונות"), href: "/tours/hotels" }],
  },
  {
    id: "tours-instructors",
    nav: "/tours/instructors",
    productType: "tours",
    title: t("Group leaders", "מלווים"),
    intro: t(
      "The group leaders shown on the site, in the order they appear there. Each one has a page with a photo, destinations, content and a gallery.",
      "המלווים שמוצגים באתר, בסדר שבו הם מופיעים שם. לכל אחד יש עמוד עם תמונה, יעדים, תוכן וגלריה.",
    ),
    howTo: [
      {
        title: t("Edit a group leader", "לערוך מלווה"),
        steps: [
          t("Open [Group Leaders](/tours/instructors) and click the person.", "פותחים את [המלווים](/tours/instructors) ולוחצים על האדם."),
          t("\"Name\", \"Position in list\" (lower comes first), \"Active on site\", \"Destinations\", \"Excerpt\", \"Image\", \"Page content\" and \"Gallery (thank-you letters, photos)\".", "\"Name\", \"Position in list\" (נמוך קודם), \"Active on site\", \"Destinations\", \"Excerpt\", \"Image\", \"Page content\" ו-\"Gallery (thank-you letters, photos)\"."),
          t("\"Save\", then \"Revalidate Pages\". \"Active on site\" off hides the person.", "\"Save\", ואז \"Revalidate Pages\". כיבוי \"Active on site\" מסתיר את האדם."),
        ],
      },
    ],
    points: [
      t("Group leaders are site content only - they are not linked to tours or dates. They come from the site import; there is no new or delete here.", "המלווים הם תוכן אתר בלבד - הם לא מקושרים לטיולים או לתאריכים. הם הגיעו מייבוא האתר; אין כאן יצירה או מחיקה."),
    ],
    links: [{ label: t("Group leaders", "מלווים"), href: "/tours/instructors" }],
  },

  // ----------------------------------------------------------------------- admin
  {
    id: "tours-users",
    nav: "/users",
    productType: "tours",
    adminOnly: true,
    title: t("Users - the company's people", "משתמשים - האנשים של החברה"),
    intro: t(
      "The people of this company and their role here. The screen manages only the active company's members; superadmins see every company and are not listed.",
      "האנשים של החברה הזאת והתפקיד שלהם בה. המסך מנהל רק את חברי החברה הפעילה; superadmin רואה כל חברה ולא מופיע ברשימה.",
    ),
    howTo: [
      {
        title: t("Add a person", "להוסיף אדם"),
        steps: [
          t("Open [Users](/users) and click \"Add user\".", "פותחים את [המשתמשים](/users) ולוחצים \"Add user\"."),
          t("\"Email\" - an email that already has an account is added to this company, with no new account and no password. A new one needs a \"Temporary password (new accounts)\" (8+ characters).", "\"Email\" - מייל שכבר יש לו חשבון מתווסף לחברה הזאת, בלי חשבון חדש ובלי סיסמה. מייל חדש צריך \"Temporary password (new accounts)\" (8 תווים ומעלה)."),
          t("\"Display name\", \"Role\" (\"Admin\", \"Editor\" or \"Tours agent\") and \"Phone\" → \"Create user\".", "\"Display name\", \"Role\" (\"Admin\", \"Editor\" או \"Tours agent\") ו-\"Phone\" ← \"Create user\"."),
          t("Hand the temporary password over privately - in person or by phone, never in a task thread or a group chat.", "מוסרים את הסיסמה הזמנית בפרטי - פנים אל פנים או בטלפון, אף פעם לא בפתיל משימה או בקבוצה."),
        ],
      },
      {
        title: t("Change, reset or remove", "לשנות, לאפס או להסיר"),
        steps: [
          t("The ⋯ menu at the end of the row → \"Edit\" (name, role, phone → \"Save changes\") or \"Reset password\".", "תפריט ה-⋯ בסוף השורה ← \"Edit\" (שם, תפקיד, טלפון ← \"Save changes\") או \"Reset password\"."),
          t("\"Remove from company\" takes the person out of this company only - the account and its other companies stay. It is refused when this is their only company (unless they are a tours agent): switch \"Active\" off instead.", "\"Remove from company\" מוציא את האדם מהחברה הזאת בלבד - החשבון והחברות האחרות שלו נשארים. זה נחסם כשזאת החברה היחידה שלו (אלא אם הוא סוכן טיולים): במקום זה מכבים את \"Active\"."),
          t("\"Active\" off blocks the account from signing in anywhere. For someone who also works in another company it is locked - use \"Remove from company\".", "כיבוי \"Active\" חוסם את החשבון מכניסה בכל מקום. אצל מי שעובד גם בחברה אחרת הוא נעול - משתמשים ב-\"Remove from company\"."),
        ],
      },
    ],
    points: [
      t("Roles: \"Admin\" runs everything, including Users, Settings and Approvals. \"Editor\" does the daily work: tours, dates, leads, reservations, tasks. \"Tours agent\" sells for the company and sees only the Departures board, read-only.", "תפקידים: \"Admin\" מנהל הכול, כולל משתמשים, הגדרות ואישורים. \"Editor\" עושה את העבודה היומית: טיולים, תאריכים, לידים, הזמנות, משימות. \"Tours agent\" (סוכן טיולים) מוכר בשביל החברה ורואה רק את לוח היציאות, לקריאה בלבד."),
    ],
    rules: [
      t("Only a superadmin can make someone an admin, move someone between tours agent and staff, or change a person who also works in another company - for such a person a company admin sees only \"Remove from company\".", "רק superadmin יכול להפוך מישהו למנהל, להעביר מישהו בין סוכן טיולים לצוות, או לשנות אדם שעובד גם בחברה אחרת - אצל אדם כזה מנהל החברה רואה רק \"Remove from company\"."),
      t("Nobody changes their own role, switches off their own account or removes themselves.", "אף אחד לא משנה את התפקיד של עצמו, לא משבית את החשבון של עצמו ולא מסיר את עצמו."),
    ],
    links: [{ label: t("Users", "משתמשים"), href: "/users", adminOnly: true }],
  },
  {
    id: "tours-settings",
    nav: "/tours/settings",
    productType: "tours",
    adminOnly: true,
    title: t("Settings - the company and its site", "הגדרות - החברה והאתר שלה"),
    intro: t(
      "The company's details: name, site, contact details, brand, email, analytics and the connection that publishes the site. Company admins only.",
      "הפרטים של החברה: שם, אתר, פרטי קשר, מיתוג, מייל, אנליטיקס והחיבור שמפרסם את האתר. למנהלי החברה בלבד.",
    ),
    howTo: [
      {
        title: t("Update the company's details", "לעדכן את פרטי החברה"),
        steps: [
          t("Open [Settings](/tours/settings). \"Company details\": name, legal name, \"Site URL\", \"Default currency\".", "פותחים את [ההגדרות](/tours/settings). \"Company details\": שם, שם משפטי, \"Site URL\", \"Default currency\"."),
          t("\"Contact details\" (shown in the site's header, footer and contact page): phone, WhatsApp, email, address, \"Opening hours\" - one line per range.", "\"Contact details\" (מוצגים בכותרת, בתחתית ובעמוד צור הקשר של האתר): טלפון, וואטסאפ, מייל, כתובת, \"Opening hours\" - שורה לכל טווח."),
          t("\"Brand\" (logo, \"Primary color\"), \"Email\" (\"From\", \"Reply-to\", \"Leads email\") and \"Analytics\" (Google Tag Manager, Meta Pixel).", "\"Brand\" (לוגו, \"Primary color\"), \"Email\" (\"From\", \"Reply-to\", \"Leads email\") ו-\"Analytics\" (Google Tag Manager, Meta Pixel)."),
          t("\"Save\" in the bottom bar, then \"Revalidate Pages\" - the site reads these when it is built.", "\"Save\" בסרגל התחתון, ואז \"Revalidate Pages\" - האתר קורא אותם כשהוא נבנה."),
        ],
      },
      {
        title: t("Connect Revalidate Pages", "לחבר את Revalidate Pages"),
        steps: [
          t("Under \"Revalidate Pages\", paste the site's deploy hook into \"Deploy hook URL\" (it starts with https://api.vercel.com/...) and \"Save\". The badge turns \"Set up\".", "תחת \"Revalidate Pages\" מדביקים את ה-deploy hook של האתר ב-\"Deploy hook URL\" (מתחיל ב-https://api.vercel.com/...) ו-\"Save\". התג עובר ל-\"Set up\"."),
          t("The URL is secret and never shown again. Leave the field empty to keep it; \"Remove URL\" removes it on save.", "הכתובת סודית ולא מוצגת שוב. משאירים את השדה ריק כדי לשמור אותה; \"Remove URL\" מסיר אותה בשמירה."),
        ],
      },
    ],
    points: [
      t("People and roles are not here - they are managed in [Users](/users).", "אנשים ותפקידים לא כאן - מנהלים אותם ב[משתמשים](/users)."),
    ],
    links: [{ label: t("Settings", "הגדרות"), href: "/tours/settings", adminOnly: true }],
  },
];
