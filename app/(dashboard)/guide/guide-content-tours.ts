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
          t("Every flight becomes a sub-tour (a date) of the tour, with the flight's dates, route and seats, as a draft without prices. The answer lists what was created; \"Set prices in Pricing\" opens the sheet.", "כל טיסה הופכת לתת-טיול (תאריך) של הטיול, עם התאריכים, המסלול והמושבים של הטיסה, כטיוטה בלי מחירים. התשובה מפרטת מה נוצר; \"Set prices in Pricing\" פותח את הטבלה."),
          t("In [Pricing](/tours/pricing) type the six room prices of each sub-tour (or paste them from Excel), tick \"On site\" and \"Save\". Then \"Revalidate Pages\".", "ב[תמחור](/tours/pricing) מקלידים את ששת מחירי החדר של כל תת-טיול (או מדביקים מאקסל), מסמנים \"On site\" ו-\"Save\". ואז \"Revalidate Pages\"."),
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
    nav: "/tours/approvals",
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
          t("The tabs: \"Details\", \"Images\", \"Description\", \"Itinerary\", \"Dates & Prices\", \"Hotels\", \"FAQ\", \"SEO\", \"Categories & Tags\". \"Ready for the site\" above them says which one still needs work.", "הלשוניות: \"Details\", \"Images\", \"Description\", \"Itinerary\", \"Dates & Prices\", \"Hotels\", \"FAQ\", \"SEO\", \"Categories & Tags\". \"Ready for the site\" מעליהן אומר איזו עוד צריכה עבודה."),
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
    title: t("Departures - every date on one board", "יציאות - כל התאריכים בלוח אחד"),
    intro: t(
      "Every departure date of every tour, grouped by series - the board that replaced the team's sheet. Publish, set the sale status, date tags and double-room price right in the row; click a code for the full departure card.",
      "כל תאריך יציאה של כל טיול, מקובץ לפי סדרה - הלוח שהחליף את הגיליון של הצוות. מפרסמים, קובעים סטטוס מכירה, תגיות תאריך ומחיר חדר זוגי ישר בשורה; לחיצה על קוד פותחת את כרטיס היציאה המלא.",
    ),
    howTo: [
      {
        title: t("Find the dates you need", "למצוא את התאריכים"),
        steps: [
          t("Open [Departures](/tours/departures). It starts on this year and next; the filters pick the sale status and \"Published\" / \"Draft\".", "פותחים את [היציאות](/tours/departures). הלוח נפתח על השנה הזאת והבאה; המסננים בוחרים סטטוס מכירה ו-\"Published\" / \"Draft\"."),
          t("\"More filters\": season, series, tour page, and the switches \"No live flight\", \"No price\", \"Upcoming only\", \"Deleted\". \"Clear\" resets.", "\"More filters\": עונה, סדרה, עמוד טיול, והמתגים \"No live flight\", \"No price\", \"Upcoming only\", \"Deleted\". \"Clear\" מאפס."),
          t("The filters live in the address - copy it to share the same view. Click a series heading to fold it; \"Collapse all\" / \"Expand all\".", "המסננים נשמרים בכתובת - מעתיקים אותה כדי לשתף את אותה תצוגה. לחיצה על כותרת סדרה מקפלת אותה; \"Collapse all\" / \"Expand all\"."),
        ],
      },
      {
        title: t("Work in the row", "לעבוד בתוך השורה"),
        steps: [
          t("\"Published\": the switch puts the date on the site or takes it off (after the next Revalidate Pages).", "\"Published\": המתג מעלה את התאריך לאתר או מוריד אותו (אחרי ה-Revalidate Pages הבא)."),
          t("\"Sale status\": \"Open\", \"Guaranteed\", \"Last places\", \"Sold out\", \"Closed\". To stop selling a date, set \"Closed\".", "\"Sale status\": \"Open\", \"Guaranteed\", \"Last places\", \"Sold out\", \"Closed\". כדי להפסיק למכור תאריך, בוחרים \"Closed\"."),
          t("\"Date tags\" and \"Double-room price\": click to edit; Enter saves and moves to the next row, like a spreadsheet.", "\"Date tags\" ו-\"Double-room price\": לוחצים לעריכה; Enter שומר ועובר לשורה הבאה, כמו בגיליון."),
          t("\"Active promotion\", \"Flight\" and \"Seats\" open the matching tab of the date's card.", "\"Active promotion\", \"Flight\" ו-\"Seats\" פותחים את הלשונית המתאימה בכרטיס התאריך."),
        ],
      },
      {
        title: t("Edit a date in its card", "לערוך תאריך בכרטיס שלו"),
        steps: [
          t("Click the code. At the top: \"Published on the site\", the sale status, and \"Delete\" (or \"Restore\").", "לוחצים על הקוד. למעלה: \"Published on the site\", סטטוס המכירה, ו-\"Delete\" (או \"Restore\")."),
          t("\"General\": dates and route, date labels and the red \"Card badge\", age rules, flight and meeting time, Docket and capacity → \"Save Changes\".", "\"General\": תאריכים ומסלול, תגיות התאריך ו-\"Card badge\" האדום, כללי גיל, טיסה ושעת התכנסות, Docket וקיבולת ← \"Save Changes\"."),
          t("\"Prices\": the six room prices with \"What the customer sees\" → \"Save Prices\". \"Promotions\": \"Add Promotion\" (type, value, \"Valid until\", \"Show on the date card\").", "\"Prices\": ששת מחירי החדר עם \"What the customer sees\" ← \"Save Prices\". \"Promotions\": \"Add Promotion\" (סוג, ערך, \"Valid until\", \"Show on the date card\")."),
          t("\"Flights\": \"Find Matching Blocks\" → direction and seats → \"Allocate\". \"Reservations\": allocated, sold, left, and \"Add Reservation\".", "\"Flights\": \"Find Matching Blocks\" ← כיוון ומושבים ← \"Allocate\". \"Reservations\": מוקצה, נמכר, נשאר, ו-\"Add Reservation\"."),
        ],
      },
      {
        title: t("Many dates at once, and new dates", "הרבה תאריכים בבת אחת, ותאריכים חדשים"),
        steps: [
          t("Tick rows → \"Publish\", \"Unpublish\", \"Set sale status…\", \"Copy Prices\" or \"Add Promotion\". Rows that could not change are listed with the reason.", "מסמנים שורות ← \"Publish\", \"Unpublish\", \"Set sale status…\", \"Copy Prices\" או \"Add Promotion\". שורות שלא השתנו מופיעות עם הסיבה."),
          t("\"Add Departure\": series, departure and return date, season → \"Create Departure\" (a draft).", "\"Add Departure\": סדרה, תאריך יציאה וחזרה, עונה ← \"Create Departure\" (טיוטה)."),
          t("\"More\" → \"Paste Prices\": paste rows from a sheet - a code, then the six prices → \"Apply N Rows\". \"More\" also has \"Series & Seasons\" and \"Export to Excel\".", "\"More\" ← \"Paste Prices\": מדביקים שורות מגיליון - קוד ואחריו ששת המחירים ← \"Apply N Rows\". ב-\"More\" יש גם \"Series & Seasons\" ו-\"Export to Excel\"."),
        ],
      },
    ],
    points: [
      t("A date's code is the series code + month + two-digit day: BBC on 3 July = BBC703.", "קוד התאריך הוא קוד הסדרה + חודש + יום בשתי ספרות: BBC ב-3 ביולי = BBC703."),
      t("\"Seats\" reads Allocated / Sold / Left. Only live blocks count (\"Confirmed by airline\", \"Handed to operations\", \"Ticketed\"); sold = the reservations.", "\"Seats\" מציג Allocated / Sold / Left. רק בלוקים חיים נספרים (\"Confirmed by airline\", \"Handed to operations\", \"Ticketed\"); נמכר = ההזמנות."),
      t("A date with flight seats shows \"Last places\" on the site at 5 seats or fewer and \"Sold out\" at none - on its own, and back again when a cancellation frees seats. The board marks it (\"Sold out on site\"). \"Closed\" and a \"Sold out\" you set by hand always win.", "תאריך עם מושבי טיסה מוצג באתר כ-\"Last places\" כשנשארו 5 מושבים או פחות, וכ-\"Sold out\" כשלא נשאר - לבד, וחוזר כשביטול מפנה מקום. הלוח מסמן את זה (\"Sold out on site\"). \"Closed\" ו-\"Sold out\" שקבעתם ידנית תמיד גוברים."),
      t("A percent-off-the-order discount and a fixed discount per traveler can't be active together on one date.", "הנחה באחוזים על ההזמנה והנחה קבועה לנוסע לא יכולות להיות פעילות יחד על אותו תאריך."),
      t("A tours agent sees this board read-only: published dates only, with no cost, docket or notes.", "סוכן טיולים רואה את הלוח הזה לקריאה בלבד: רק תאריכים מפורסמים, בלי עלויות, docket או הערות."),
    ],
    rules: [
      t("A date is published only with dates, both cities, a currency and a double-room price.", "תאריך מתפרסם רק עם תאריכים, שתי הערים, מטבע ומחיר חדר זוגי."),
      t("Delete is soft: the date leaves the site and comes back through the \"Deleted\" filter → \"Restore\", as a draft.", "המחיקה רכה: התאריך יורד מהאתר וחוזר דרך המסנן \"Deleted\" ← \"Restore\", כטיוטה."),
    ],
    links: [{ label: t("Departures board", "לוח היציאות"), href: "/tours/departures" }],
  },
  {
    id: "tours-pricing",
    nav: "/tours/pricing",
    productType: "tours",
    title: t("Pricing - every sub-tour in one sheet", "תמחור - כל תתי-הטיול בטבלה אחת"),
    intro: t(
      "The organized tours as one sheet: the tour's name as a header row, its sub-tours (dates) under it, then the next tour. The same sheet sits in each tour page, on the \"Dates & Prices\" tab. Nothing is saved until you click \"Save\".",
      "הטיולים המאורגנים כטבלה אחת: שם הטיול כשורת כותרת, תתי-הטיול (התאריכים) שלו מתחתיו, ואז הטיול הבא. אותה טבלה נמצאת בכל עמוד טיול, בלשונית \"Dates & Prices\". שום דבר לא נשמר עד שלוחצים \"Save\".",
    ),
    howTo: [
      {
        title: t("Edit like a spreadsheet", "לערוך כמו בגיליון"),
        steps: [
          t("Open [Pricing](/tours/pricing). \"Prices\" shows the six room prices per person (double room first), the currency, on the site or not, the status, the seats and the flight's cost; \"Details\" shows capacity, labels, meeting time, baggage, meal, transfers, connections, ages, senior discount and notes.", "פותחים את [התמחור](/tours/pricing). \"Prices\" מציג את ששת מחירי החדר לאדם (זוגי ראשון), המטבע, באתר או לא, הסטטוס, המושבים ועלות הטיסה; \"Details\" מציג קיבולת, תגיות, שעת התכנסות, כבודה, ארוחה, העברות, קונקשן, גילאים, הנחת גיל הזהב והערות."),
          t("Click a cell and type, or double-click or press Enter; Enter saves the cell and goes down, Tab goes right, Escape cancels. Delete empties a cell. A tick cell switches with Enter or the space bar.", "לוחצים על תא ומקלידים, או לחיצה כפולה או Enter; Enter שומר את התא ויורד, Tab זז ימינה, Escape מבטל. Delete מרוקן תא. תא של וי מתחלף ב-Enter או ברווח."),
          t("Paste a block copied from Excel or Google Sheets: it fills from the cell you stand on, to the right and down.", "מדביקים בלוק שהועתק מאקסל או מגוגל שיטס: הוא ממלא מהתא שעומדים עליו, ימינה ולמטה."),
          t("Changed cells turn yellow and a bar shows how many changes wait - \"Save\" or \"Discard\". A cell with a value that means nothing turns red and blocks Save until it is fixed.", "תאים ששונו נצבעים צהוב ופס מראה כמה שינויים מחכים - \"Save\" או \"Discard\". תא עם ערך שאין לו משמעות נצבע אדום וחוסם את Save עד שמתקנים."),
        ],
      },
      {
        title: t("Many sub-tours at once", "הרבה תתי-טיול בבת אחת"),
        steps: [
          t("Tick rows (or a tour's header row for all its dates) → \"Set for selected\": a column and a value; for prices also \"Add\" an amount or \"Add %\" (a negative number lowers).", "מסמנים שורות (או את שורת הכותרת של טיול לכל התאריכים שלו) ← \"Set for selected\": עמודה וערך; למחירים גם \"Add\" סכום או \"Add %\" (מספר שלילי מוריד)."),
          t("With rows ticked, pasting one value puts it in that column of every ticked row.", "כשיש שורות מסומנות, הדבקה של ערך אחד שמה אותו בעמודה הזאת בכל השורות המסומנות."),
          t("Filters: search by tour or code, season, \"No double price\", \"Not on the site\", and \"Past dates\".", "מסננים: חיפוש לפי טיול או קוד, עונה, \"No double price\", \"Not on the site\", ו-\"Past dates\"."),
        ],
      },
    ],
    points: [
      t("The prices are final, per person, and include the flight. The \"Flight\" column is what the flight costs per seat - to see the margin; it is never added to the price.", "המחירים סופיים, לאדם, וכוללים טיסה. עמודת \"Flight\" היא העלות של הטיסה למושב - כדי לראות רווח; היא אף פעם לא מתווספת למחיר."),
      t("A code opens the sub-tour's card in a new tab (promotions, flights, sales). The dates themselves change there, or follow the flight they were made from.", "קוד פותח את הכרטיס של התת-טיול בלשונית חדשה (הטבות, טיסות, מכירות). את התאריכים עצמם משנים שם, או שהם עוקבים אחרי הטיסה שממנה נוצרו."),
      t("Each saved row is checked again: a row someone else changed since you opened the sheet is not saved and is listed with the reason, your edit kept.", "כל שורה שנשמרת נבדקת שוב: שורה שמישהו אחר שינה מאז שפתחתם את הטבלה לא נשמרת ומופיעה עם הסיבה, והעריכה שלכם נשארת."),
    ],
    rules: [
      t("A sub-tour on the site keeps its double-room price and everything the site needs; to empty it, untick \"On site\" in the same save.", "תת-טיול שבאתר שומר את מחיר החדר הזוגי וכל מה שהאתר צריך; כדי לרוקן אותו, מורידים את הסימון \"On site\" באותה שמירה."),
    ],
    links: [{ label: t("Pricing", "תמחור"), href: "/tours/pricing" }],
  },
  {
    id: "tours-flights",
    nav: "/offline-flights",
    productType: "tours",
    title: t("Offline flights - the company's flight blocks", "טיסות אופליין - בלוקי הטיסה של החברה"),
    intro: t(
      "The group seats the company holds with airlines. The same screen as Mega Events, showing only this company's flights; a block is allocated to tour dates, never linked to events.",
      "המושבים הקבוצתיים שהחברה מחזיקה מול חברות התעופה. אותו מסך של מגה אירועים, שמציג רק את הטיסות של החברה הזאת; בלוק מוקצה לתאריכי טיולים, אף פעם לא מקושר לאירועים.",
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
      t("\"Columns\" → \"Group Operations\" adds the block's fields: season / pool, contract, first cancellation date, names due, cancellation fee and more. \"Export inventory\" downloads the list.", "\"Columns\" ← \"Group Operations\" מוסיף את שדות הבלוק: עונה / מאגר, חוזה, מועד ביטול ראשון, מועד שמות, דמי ביטול ועוד. \"Export inventory\" מוריד את הרשימה."),
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
    id: "tours-pages",
    nav: "/tours/pages",
    productType: "tours",
    title: t("Content pages", "עמודי תוכן"),
    intro: t(
      "The free-form pages of the site: about, FAQ, terms, contact and the blog posts. A page's address is fixed; you edit its title, content and SEO.",
      "העמודים החופשיים של האתר: אודות, שאלות נפוצות, תקנון, צור קשר ופוסטים בבלוג. הכתובת של עמוד קבועה; עורכים את הכותרת, התוכן וה-SEO.",
    ),
    howTo: [
      {
        title: t("Edit a page", "לערוך עמוד"),
        steps: [
          t("Open [Content Pages](/tours/pages), search by title or path and click the page.", "פותחים את [עמודי התוכן](/tours/pages), מחפשים לפי כותרת או נתיב ולוחצים על העמוד."),
          t("Change \"Title\", \"Page content\" and the \"SEO\" title and description. \"Active on site\" off hides the page.", "משנים \"Title\", \"Page content\" ואת כותרת ותיאור ה-\"SEO\". כיבוי \"Active on site\" מסתיר את העמוד."),
          t("\"Save\", then \"Revalidate Pages\".", "\"Save\", ואז \"Revalidate Pages\"."),
        ],
      },
    ],
    points: [
      t("Pages come from the site import - there is no new or delete here. The \"Path\" can't change: menus and other pages link to it.", "העמודים הגיעו מייבוא האתר - אין כאן יצירה או מחיקה. את ה-\"Path\" אי אפשר לשנות: תפריטים ועמודים אחרים מקשרים אליו."),
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
      "The destinations, audiences, tags and other categories the site filters and groups by. Each one has a page on the site with a name, description and hero images.",
      "היעדים, הקהלים, התגיות ושאר הקטגוריות שהאתר מסנן ומקבץ לפיהם. לכל אחד יש עמוד באתר עם שם, תיאור ותמונות ראש.",
    ),
    howTo: [
      {
        title: t("Edit a category", "לערוך קטגוריה"),
        steps: [
          t("Open [Categories & Tags](/tours/terms) and pick the kind: \"Destinations\", \"Audiences\", \"Tags\", \"Packages\", \"Artists\", \"Holiday villages\", \"Categories\".", "פותחים את [הקטגוריות והתגיות](/tours/terms) ובוחרים סוג: \"Destinations\", \"Audiences\", \"Tags\", \"Packages\", \"Artists\", \"Holiday villages\", \"Categories\"."),
          t("Click one: \"Name\", \"Position in list\" (lower comes first), \"Active on site\", \"Description\" (also the search-engine description) and \"Hero images\".", "לוחצים על אחת: \"Name\", \"Position in list\" (נמוך קודם), \"Active on site\", \"Description\" (גם התיאור למנועי חיפוש) ו-\"Hero images\"."),
          t("\"Save\", then \"Revalidate Pages\".", "\"Save\", ואז \"Revalidate Pages\"."),
        ],
      },
      {
        title: t("Put a tour in a category", "לשייך טיול לקטגוריה"),
        steps: [
          t("Open the tour in [Tours](/tours/packages) → \"Categories & Tags\" tab → tick it → \"Save\".", "פותחים את הטיול ב[טיולים](/tours/packages) ← לשונית \"Categories & Tags\" ← מסמנים ← \"Save\"."),
          t("The category's own page lists its tours (\"Tour pages in this category\") - read only; each chip opens that tour.", "בעמוד הקטגוריה עצמה מופיעים הטיולים שלה (\"Tour pages in this category\") - לקריאה בלבד; כל תג פותח את הטיול."),
        ],
      },
    ],
    points: [
      t("The audience decides the homepage tabs: the families, sports & music, and couples, women & solo tabs list the tours ticked under that audience.", "הקהל קובע את הלשוניות של עמוד הבית: הלשוניות של משפחות, ספורט ומוזיקה, וזוגות, נשים ויחידים מציגות את הטיולים שסומנו תחת אותו קהל."),
      t("Categories come from the site import - there is no new or delete here, and a slug can't change.", "הקטגוריות הגיעו מייבוא האתר - אין כאן יצירה או מחיקה, ואת ה-slug אי אפשר לשנות."),
    ],
    links: [{ label: t("Categories & tags", "קטגוריות ותגיות"), href: "/tours/terms" }],
  },
  {
    id: "tours-hotels",
    nav: "/tours/hotels",
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
