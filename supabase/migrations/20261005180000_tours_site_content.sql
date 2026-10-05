-- The site chrome and the home page of a tours company, edited in the backoffice (Alon's road map, 05.10.2026).
--
-- Until now the header menus, the footer, the contact details and every section of
-- the home page were constants in the site's code (mega-family lib/site.ts,
-- components/home/home-data.ts), so only a developer could change them. They are
-- now four documents per company:
--   general - name, logo, phone, WhatsApp, email, address, social links, the lead form texts
--   header  - the mega menus, the plain links and the mobile menu
--   footer  - the "discover" tiles, the newsletter texts and the link columns
--   home    - the ordered sections of the home page (hero, tour tabs, banners, sliders, reviews...)
-- The backoffice edits them (Website > Homepage, Website > Header & Footer); the site
-- reads them at build time through <schema>.site_content, like every other view.
--
-- The documents of Mega Family are seeded with exactly what the site shows today,
-- so the first build after this migration looks the same. A document that is
-- missing is not an error: the site falls back to its committed file.
--
-- Worlds: an audience term is a "world" of the group. Its settings (brand name,
-- colour, the key its tours carry in tours.packages.brand, a link to another site)
-- live in tours.terms.data, which the terms view already exposes - no new column.
-- The three audiences that match today's card colours get their key here
-- (family / events / organized); nothing on the site reads the key until a colour is set.
--
-- Additive only. Mega Events is untouched: nothing in public changes except the
-- body of provision_company(), which only tours companies' views come from.
-- provision_company() is copied verbatim from 20261004100000 with one addition:
-- the <schema>.site_content view.
-- Rollback: section 15 of supabase/rollback/20261001_multi_company.sql.

create table if not exists tours.site_content (
  company_id uuid not null references public.companies(id),
  key text not null check (key in ('general', 'header', 'footer', 'home')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,                                      -- who saved it last (an email, or the migration)
  primary key (company_id, key)
);

alter table tours.site_content enable row level security;
grant all on table tours.site_content to service_role;

-- ---------------------------------------------------------------- seed: Mega Family, as the site is today
insert into tours.site_content (company_id, key, data, updated_by)
select v.company_id, v.key, v.data, v.updated_by
from (values
  ((select id from public.companies where slug = 'mega-family'), 'general', $doc${"address":"ראול ולנברג 6, רמת החייל, תל אביב","addressShort":["ראול ולנברג 6,","רמת רחל תל אביב"],"companyLegal":"מגה תיירות בע\"מ ח.פ 511910804","copyright":"כל הזכויות שמורות למגה תיירות © 2026","description":"קבוצה אחת. חמישה עולמות שונים של חופשות. כל עולם בקבוצת מגה תיירות מתמחה בסוג חופשה אחר - בחרו את שלכם, ואנחנו נדאג לכל השאר","email":"megaweb@megatr.co.il","facebook":"https://www.facebook.com/megatravelil","fax":"03-6481251","hours":["א'-ה' : 09:00-17:00","ימי שישי : 09:00-13:00"],"instagram":"https://www.instagram.com/megatr_il/","leadOptions":["לזוגות נשים ויחידים","מחזיק מקום","משפחות","ספורט ומוזיקה"],"leadTitle":"לא מצאתם את מה שחיפשתם? כתבו לנו ונמצא חופשה במיוחד בשבילכם","logo":"/media/2025/12/megatr-logo.png","name":"מגה תיירות","phone":"03-7684800","poweredBy":{"href":"https://www.eviltwin.io/","label":"Evil twin"},"tagline":"קבוצה אחת. חמישה עולמות שונים של חופשות.","whatsapp":"054-2272554","youtube":"#"}$doc$::jsonb, 'migration 20261005180000'),
  ((select id from public.companies where slug = 'mega-family'), 'header', $doc${"links":[{"href":"#","label":"ביטוח נסיעות לחו״ל"}],"menus":[{"heading":"היעדים שלנו","items":[{"children":[{"href":"/destinations/ארהב-מזרח/","label":"ארה\"ב מזרח"},{"href":"/destinations/ארהב-מערב/","label":"ארה\"ב מערב"}],"href":"#","label":"ארצות הברית"},{"children":[{"href":"/destinations/אוסטריה/","label":"אוסטריה"},{"href":"/destinations/איטליה/","label":"איטליה"},{"href":"/destinations/אנגליה/","label":"אנגליה"},{"href":"/destinations/בלגיה/","label":"בלגיה"},{"href":"/destinations/גרמניה/","label":"גרמניה"},{"href":"/destinations/הולנד/","label":"הולנד"},{"href":"/destinations/הונגריה/","label":"הונגריה"},{"href":"/destinations/ספרד/","label":"ספרד"},{"href":"/destinations/צרפת/","label":"צרפת"},{"href":"/destinations/שוויץ/","label":"שוויץ"}],"href":"#","label":"אירופה"},{"href":"#","label":"תאילנד"},{"href":"/destinations/איחוד-האמירויות/","label":"איחוד האמיריות"}],"label":"היעדים שלנו"},{"heading":"המוצרים שלנו","items":[{"children":[{"href":"/product-tag/בר-בת-מצווה/","label":"טיולי בר/בת מצווה"},{"href":"/product-tag/חמישיות/","label":"טיולי חמישיות"},{"href":"/product-tag/טיולי-כוכב/","label":"טיולי כוכב"},{"href":"/product-tag/טיולי-מסורת/","label":"טיולי מסורת"},{"href":"/product-tag/משפחות-קלאסי/","label":"טיולים קלאסיים"},{"href":"/product-tag/יעדים-רחוקים/","label":"יעדים רחוקים"}],"href":"/audience/משפחות/","label":"מגה פמילי – טיולים וחבילות למשפחות"},{"children":[{"href":"/product-tag/הופעות/","label":"מוזיקה"},{"href":"/product-tag/ספורט/","label":"ספורט"},{"href":"/product-tag/פסטיבל/","label":"פסטיבלים"}],"href":"/audience/ספורט-ומוזיקה/","label":"מגה איבנטס – חבילות ספורט ומוזיקה"},{"href":"/product-tag/טיולי-נושא/","label":"מגה קונפסט – טיולי נושא"},{"href":"/product-tag/טיולי-נשים/","label":"מגה ליידיס – טיולי נשים"},{"href":"/product-tag/טיולי-קהל-רחב/","label":"מגה מאורגן – טיולים לזוגות ויחידים"}],"label":"המוצרים שלנו"},{"heading":"","items":[{"href":"/about/since-1994/","label":"מי אנחנו"},{"href":"/contact/","label":"צור קשר"},{"href":"/mega-blog/","label":"מגה בלוג"},{"href":"/faq/","label":"שאלות נפוצות"},{"href":"/cancellation-form/","label":"ביטול הזמנה"},{"href":"/cancellation-policy/","label":"מדיניות ביטולים"}],"label":"מידע כללי"}],"mobile":[{"children":[{"children":[{"href":"/destinations/ארהב-מזרח/","label":"ארה\"ב מזרח"},{"href":"/destinations/ארהב-מערב/","label":"ארה\"ב מערב"}],"href":"#","label":"ארצות הברית"},{"children":[{"href":"/destinations/אוסטריה/","label":"אוסטריה"},{"href":"/destinations/איטליה/","label":"איטליה"},{"href":"/destinations/אנגליה/","label":"אנגליה"},{"href":"/destinations/בלגיה/","label":"בלגיה"},{"href":"/destinations/גרמניה/","label":"גרמניה"},{"href":"/destinations/הולנד/","label":"הולנד"},{"href":"/destinations/הונגריה/","label":"הונגריה"},{"href":"/destinations/ספרד/","label":"ספרד"},{"href":"/destinations/צרפת/","label":"צרפת"},{"href":"/destinations/שוויץ/","label":"שוויץ"}],"href":"#","label":"אירופה"},{"href":"#","label":"תאילנד"},{"children":[{"href":"/destinations/איחוד-האמירויות/","label":"איחוד האמיריות"}],"href":"#","label":"מזרח התיכון"}],"href":"#","label":"היעדים שלנו"},{"children":[{"children":[{"href":"/product-tag/בר-בת-מצווה/","label":"טיולי בר/בת מצווה"},{"href":"/product-tag/חמישיות/","label":"טיולי חמישיות"},{"href":"/product-tag/טיולי-כוכב/","label":"טיולי כוכב"},{"href":"/product-tag/טיולי-מסורת/","label":"טיולי מסורת"},{"href":"/product-tag/משפחות-קלאסי/","label":"טיולים קלאסיים"},{"href":"/product-tag/יעדים-רחוקים/","label":"יעדים רחוקים"}],"href":"/audience/משפחות/","label":"מגה פמילי – טיולים וחבילות למשפחות"},{"children":[{"href":"/product-tag/הופעות/","label":"מוזיקה"},{"href":"/product-tag/ספורט/","label":"ספורט"},{"href":"/product-tag/פסטיבל/","label":"פסטיבלים"}],"href":"/audience/ספורט-ומוזיקה/","label":"מגה איבנטס – חבילות ספורט ומוזיקה"},{"href":"/product-tag/טיולי-נושא/","label":"מגה קונפסט – טיולי נושא"},{"href":"/product-tag/טיולי-נשים/","label":"מגה ליידיס – טיולי נשים"},{"href":"/product-tag/טיולי-קהל-רחב/","label":"מגה מאורגן – טיולים לזוגות ויחידים"}],"href":"#","label":"המוצרים שלנו"},{"children":[{"href":"/about/since-1994/","label":"מי אנחנו"},{"href":"/contact/","label":"צור קשר"},{"href":"/mega-blog/","label":"מגה בלוג"},{"href":"/מלווי-הקבוצות-שלנו/","label":"מלווי קבוצות שלנו"},{"href":"/faq/","label":"שאלות נפוצות"},{"href":"/cancellation-form/","label":"ביטול הזמנה"},{"href":"/cancellation-policy/","label":"מדיניות ביטולים"}],"href":"#","label":"מידע כללי"},{"href":"#","label":"ביטוח נסיעות לחו״ל"}]}$doc$::jsonb, 'migration 20261005180000'),
  ((select id from public.companies where slug = 'mega-family'), 'footer', $doc${"columns":[{"heading":"קישורים מועילים","links":[{"href":"https://www.boi.org.il/roles/markets/exchangerates/","label":"אתר נתבג"},{"href":"https://www.rail.co.il/","label":"רכבת ישראל"},{"href":"https://www.boi.org.il/roles/markets/exchangerates/","label":"שערי מטבע"},{"href":"https://he.thetimenow.com/worldclock.php","label":"שעון עולמי"},{"href":"https://www.dutyfree.co.il/","label":"דיוטי פרי"},{"href":"https://weather.com/en-GB/weather/today/l/UKXX0085:1:UK","label":"מזג אוויר בעולם"},{"href":"https://www.gov.il/he/departments/ministry_of_health/govil-landing-page","label":"משרד הבריאות"}]},{"heading":"כללי","links":[{"href":"/","label":"בית"},{"href":"/about/","label":"מי אנחנו"},{"href":"/faq/","label":"שאלות נפוצות"},{"href":"/מלווי-הקבוצות-שלנו/","label":"המדריכים שלנו"}]},{"heading":"תנאים ואחריות","links":[{"href":"/terms-and-conditions/","label":"תנאי שימוש באתר"},{"href":"/cancellation-policy-tours/","label":"תנאים והגבלת אחריות טיולים מאורגנים"},{"href":"/cancellation-policy/","label":"תנאים והגבלת אחריות כללי"},{"href":"/cancellation-form/","label":"ביטול הזמנה"},{"href":"/accessability/","label":"הצהרת נגישות"},{"href":"/privacy-terms/","label":"מדיניות פרטיות"}]},{"heading":"יעדים מומלצים","links":[{"href":"/destinations/ארהב-מזרח/","label":"ארצות הברית"},{"href":"/destinations/איטליה/","label":"איטליה"},{"href":"/destinations/הולנד/","label":"הולנד"},{"href":"/destinations/גרמניה/","label":"היער השחור"},{"href":"/destinations/צרפת/","label":"צרפת"},{"href":"/destinations/אנגליה/","label":"אנגליה"},{"href":"/destinations/גרמניה/","label":"גרמניה"}]},{"heading":"מגה Family","links":[{"href":"/product-tag/משפחות-קלאסי/","label":"קלאסיים"},{"href":"/product-tag/חמישיות/","label":"קצרים"},{"href":"/product-tag/בר-בת-מצווה/","label":"בת/בר מצווה"},{"href":"/audience/משפחות/","label":"חגים"},{"href":"/product-tag/טיולי-מסורת/","label":"מסורת"},{"href":"/product-category/כפר-נופש/","label":"כפר נופש"},{"href":"/audience/משפחות/","label":"פסח באוויר!"}]},{"heading":"מגה Events","links":[{"href":"/product-tag/הופעות/","label":"אירועי מוזיקה"},{"href":"/product-tag/ספורט/","label":"אירועי ספורט"},{"href":"/audience/ספורט-ומוזיקה/","label":"חבילות ספורט ומוזיקה בחגים"}]},{"heading":"מגה מאורגן","links":[{"href":"/audience/לזוגות-נשים-ויחידים/","label":"יחידים"},{"href":"/audience/לזוגות-נשים-ויחידים/","label":"זוגות"},{"href":"/product-tag/טיולי-נשים/","label":"נשים"},{"href":"/product-tag/טיולי-קהל-רחב/","label":"מאורגנים בעברית"}]}],"contactTitle":"שמרו על קשר","discover":[{"href":"/about/","icon":"/media/2026/03/noun-hello-7171727-1.png","label":"מי אנחנו"},{"href":"/faq/","icon":"/media/2026/03/noun-questions-5452103-1.png","label":"שאלות נפוצות"},{"href":"/מלווי-הקבוצות-שלנו/","icon":"/media/2026/03/Vector1.png","label":"מלווי הקבוצות שלנו"},{"href":"https://www.instagram.com/megatr_il/","icon":"/media/2026/03/instagram_21.png","label":"לאינסטגרם"}],"discoverTitle":"בואו לגלות עוד","newsletterNote":"מבטיחים לא לשלוח יותר מדי מיילים","newsletterTitle":"מוזמנים להרשם לניוזלטר שלנו להטבות מבצעים וטיפים"}$doc$::jsonb, 'migration 20261005180000'),
  ((select id from public.companies where slug = 'mega-family'), 'home', $doc${"sections":[{"id":"hero","slides":[{"alt":"","href":"","image":"/media/2026/07/banner-1.webp"},{"alt":"","href":"","image":"/media/2026/07/banner-2.webp"},{"alt":"","href":"","image":"/media/2026/07/banner-3.webp"}],"text":"כל עולם בקבוצת מגה תיירות מתמחה בסוג חופשה אחר – בחרו את שלכם, ואנחנו נדאג לכל השאר","titleBold":"קבוצה אחת.","titleRest":"חמישה עולמות שונים של חופשות.","type":"hero","visible":true},{"gridTitle":"מוצרים במבצע","id":"tours","salePills":[{"label":"כל המבצעים","tag":""},{"label":"חמישיות","tag":"חמישיות"},{"label":"טיולי כוכב","tag":"טיולי-כוכב"},{"label":"טיולי נושא","tag":"טיולי-נושא"},{"label":"טיולי קהל רחב","tag":"טיולי-קהל-רחב"},{"label":"מוזיקה","tag":"הופעות"},{"label":"משפחות קלאסי","tag":"משפחות-קלאסי"}],"tabs":[{"allLabel":"כל המבצעים","color":"","featured":[],"featuredTitle":"","icon":"/media/2026/04/sales-1.svg","key":"sale","label":"מבצעים","search":"filters","show":"sale","world":""},{"allLabel":"כל המוצרים","color":"","featured":["אבירים-ואצילים"],"featuredTitle":"הטיולים הכי נמכרים","icon":"/media/2026/04/entire-1.svg","key":"all","label":"כל המבחר","search":"filters","show":"all","world":""},{"allLabel":"כל המשפחות","color":"#A61C14","featured":["תמרים-ומגדלים"],"featuredTitle":"טיולי ראש השנה","icon":"/media/2026/04/family-1.svg","key":"family","label":"מאורגנים למשפחות","search":"filters","show":"world","world":"משפחות"},{"allLabel":"כל האירועים","color":"#055e6a","featured":[],"featuredTitle":"","icon":"/media/2026/04/sports-music-1.svg","key":"events","label":"ספורט ומוזיקה","search":"text","show":"world","world":"ספורט-ומוזיקה"},{"allLabel":"כל הטיולים","color":"","featured":[],"featuredTitle":"","icon":"/media/2026/04/women-couple-singles-1.svg","key":"organized","label":"לזוגות, נשים ויחידים","search":"filters","show":"world","world":"לזוגות-נשים-ויחידים"}],"type":"tours","visible":true},{"id":"lead","title":"","type":"lead_form","visible":true},{"id":"artists","items":[{"image":"/media/2026/07/Untitled-design-92.png","slug":"andre-rieu"},{"image":"/media/2026/07/Untitled-design-93.png","slug":"אריאנה-גרנדה"},{"image":"/media/2026/07/Untitled-design-96.png","slug":"בון-גובי"},{"image":"/media/2026/07/Untitled-design-98.png","slug":"ברונו-מארס"}],"title":"האמנים הגדולים בעולם","type":"artists","visible":true},{"id":"banners","items":[{"buttonColor":"rgba(221,51,51,0.91)","cta":"לתיאום שיחת יעוץ חינם","href":"https://api.whatsapp.com/send/?phone=0542272554&text&type=phone_number&app_absent=0","image":"/media/2026/07/ספורט-ומוזיקה.webp","newTab":true,"overlayColor":"rgba(30,115,190,0.52)","subtitle":"זכרון משפחתי לכל החיים","title":"טיול בר/בת מצווה"},{"buttonColor":"rgba(10,26,20,0.86)","cta":"בקרו באתר החדש שלנו","href":"https://www.mega-events.co.il/","image":"/media/2026/07/shutterstock_298767080-2-scaled-1.jpg","newTab":false,"overlayColor":"rgba(91,255,149,0.53)","subtitle":"בוחרים בונים טסים","title":"ספורט ומוזיקה"}],"title":"ההזדמנויות שאסור לפספס","type":"banners","visible":true},{"id":"reasons","items":[{"icon":"/media/2026/07/3930266.png","text":"מהשיחה הראשונה ועד החזרה הביתה, הצוות והמדריכים שלנו מלווים אתכם לאורך כל הדרך.","title":"ליווי אישי לאורך כל הדרך"},{"icon":"/media/2026/03/1.png","text":"טיולים מאורגנים, חבילות להופעות, אירועי ספורט ונופש הכל במקום אחד.","title":"מגוון יעדים וחוויות"},{"icon":"/media/2026/07/3772298-200.png","text":"אנחנו דואגים לכל הפרטים כדי שאתם תוכלו ליהנות מהחוויה בלי דאגות.","title":"חופשה בראש שקט"},{"icon":"/media/2026/07/3395949.png","text":"שלושה עשורים של ניסיון בעולם התיירות עם אלפי מטיילים מרוצים.","title":"30+ שנות ניסיון"}],"title":"כל הסיבות לטייל איתנו","type":"reasons","visible":true},{"id":"reviews","items":[{"name":"מאת השישייה","text":"סטפני ועדן בג, מאיה ואגם אריה, כרמית ואגם חודידה אני ושתי חברות שלי סגרנו טיול לשוויץ/ איטליה לכבוד הבת מצווה של בנותינו… לא ציפינו שככה נהיה מרוצים. צחקנו מלא, המדריכים דאגו לנו לסיפורים מרתקים וידע רחב בכל נושא במיוחד על האיזורים שביקרנו בהלם בטיול. דאגו לנו לכל הצרכים שלנו, התחשבו בכל אחד ואחד ולא עזבו אותנו לרגע אפילו בטיסה חזור הייתי כבר בטיול מאורגן (עם חברה אחרת) והפער שהרגשנו הוא גדול. בקיצור היינו מרוצות מכל הבחינות ובמיוחד מצביקה המדריך. זה טיול שלא נשכח לעולם!"},{"name":"בלה חזן","text":"ב12/07 נסעתי עם חברתכם לטיול משפחות לאיטליה ושוויץ. זאת פעם ראשונה שאני נוסעת עם חברת מגה פמילי, כמובן עם הרבה חששות מה יהיה ואיך תהיה הקבוצה והמדריך. ברצוני לציין לשבח את המדריך שהיה תמיד עם חיוך על הפנים, ותמיד זמין לכל פניה ובעיה. נתן הרגשה שיש מי שדואג לנו ואפשר להיות רגועים גם במהלך הנסיעה וגם לפני הנסיעה.  שמחתי על ההחלטה לצאת אתכם לטיול ואני אשמח להצטרף לטיולים נוספים בעתיד."},{"name":"מירי","text":"ברצוני להודות בשמי ובם משפחתי למגה תיירות.\nזו פעם ראשונה שמשפחתי יוצאת לטיול מאורגן והיו קצת חששות איך יתנהל כל הטיול, אבל להפתעתי הצליח לנו הן מבחינת נהג מדהים וחברה מקדימים. כמובן המדריכה המדהימה בלה, מלאת יידע סבלנות יוצאת דופם, נעימה לילדים ולהורים וכל הזמן דאגה לאטרקציות וכיף לכולם. אז שוב תודה ענקית לבלה ולמגה תיירות"},{"name":"משפחת עובדיה","text":"ברצוני להביע את הערכתנו ותודתנו על חוויה קסומה בטיול משפחות בפסח בהנהגתה של בלהה קרן,\nנסיונה, גישתה החיובית, הדאגה, והאכפתיות של בלהה הפכה את הטיול זה להצלחה מבחינתנו,\nהיינו 3 דורות וכולנו קבלנו את המענה המתאים מבחינה לוגיסטית / תפעולית , מבחינה מקצועית והעשרתית וחשוב מכל בנעם, אכפתיות וסבלנות.  החשיבה על הפרטים הקטנים, הצ'ופרים לאורך כל הדרך, החידונים בשעות הנסיעה, הדרכה מענינת ומגוונת ויצירת החיבור בין חברי הקבוצה  כל אלה ועוד אינם מובנים מעליהם ועל כך תודתנו לבלהה.    שוב תודות לכם ולבלהה על כל המבחר – ישר כח !   בברכה  משפחת מילמן ומשפחת פרבר"}],"title":"מה אומרים עלינו","type":"reviews","visible":true},{"id":"destinations","items":[{"image":"/media/2026/07/istock-627854506_da160d5e.jpg","slug":"איטליה"},{"image":"/media/2026/06/shutterstock_2288627095-2-scaled.jpg","slug":"אנגליה"},{"image":"/media/2026/07/shutterstock_2487675965-3-scaled-1.jpg","slug":"הולנד"},{"image":"/media/2026/06/shutterstock_2632699855-1-scaled.jpg","slug":"צרפת"},{"image":"/media/2026/07/shutterstock_2696397099-scaled-1.jpg","slug":"איחוד-האמירויות"},{"image":"/media/2026/06/shutterstock_2463238867-1-scaled.jpg","slug":"ספרד"}],"title":"בחרו את היעד שלכם ואנחנו נדאג לכל השאר","type":"destinations","visible":true}]}$doc$::jsonb, 'migration 20261005180000')
) as v (company_id, key, data, updated_by)
where v.company_id is not null
on conflict (company_id, key) do nothing;

-- ---------------------------------------------------------------- worlds: the key of the three existing audiences
update tours.terms t
set data = t.data || jsonb_build_object('worldKey', w.world_key)
from (values
  ('משפחות', 'family'),
  ('ספורט-ומוזיקה', 'events'),
  ('לזוגות-נשים-ויחידים', 'organized')
) as w (slug, world_key)
where t.kind = 'audiences'
  and t.slug = w.slug
  and t.company_id = (select id from public.companies where slug = 'mega-family')
  and not (t.data ? 'worldKey');

-- ---------------------------------------------------------------- provision_company
-- Copied verbatim from 20261004100000; new: the site_content view.
create or replace function public.provision_company(p_slug text)
returns void
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  c public.companies%rowtype;
  s text;
begin
  select * into c from public.companies where slug = p_slug;
  if not found then
    raise exception 'company % not found', p_slug;
  end if;
  s := c.schema_name;

  execute format('create schema if not exists %I', s);
  execute format('grant usage on schema %I to anon, authenticated, service_role', s);

  if 'tours' = any (c.product_types) then
    -- catalog ---------------------------------------------------------------
    execute format('drop view if exists %I.packages cascade', s);
    execute format($v$create view %I.packages with (security_barrier) as
      select * from tours.packages
      where company_id = %L and is_active and is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.package_itineraries cascade', s);
    execute format($v$create view %I.package_itineraries with (security_barrier) as
      select * from tours.package_itineraries where company_id = %L$v$, s, c.id);

    -- seasons of a tour: what a season says instead of the tour page (null = the tour's own)
    execute format('drop view if exists %I.package_seasons cascade', s);
    execute format($v$create view %I.package_seasons with (security_barrier) as
      select id, package_id, name, position, itinerary_id, description_html, attractions, included, not_included,
             hero_image, gallery, tags
      from tours.package_seasons where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.terms cascade', s);
    execute format($v$create view %I.terms with (security_barrier) as
      select * from tours.terms where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.package_terms cascade', s);
    execute format($v$create view %I.package_terms with (security_barrier) as
      select pt.* from tours.package_terms pt
      join tours.packages p on p.id = pt.package_id
      where p.company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.series cascade', s);
    execute format($v$create view %I.series with (security_barrier) as
      select * from tours.series where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.series_terms cascade', s);
    execute format($v$create view %I.series_terms with (security_barrier) as
      select st.* from tours.series_terms st
      join tours.series sr on sr.id = st.series_id
      where sr.company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.hotels cascade', s);
    execute format($v$create view %I.hotels with (security_barrier) as
      select * from tours.hotels where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.cars cascade', s);
    execute format($v$create view %I.cars with (security_barrier) as
      select * from tours.cars where company_id = %L$v$, s, c.id);

    execute format('drop view if exists %I.instructors cascade', s);
    execute format($v$create view %I.instructors with (security_barrier) as
      select * from tours.instructors where company_id = %L and is_active$v$, s, c.id);

    execute format('drop view if exists %I.cms_pages cascade', s);
    execute format($v$create view %I.cms_pages with (security_barrier) as
      select * from tours.cms_pages where company_id = %L and is_active$v$, s, c.id);

    -- the site chrome and the home page: one document per key (general, header, footer, home)
    execute format('drop view if exists %I.site_content cascade', s);
    execute format($v$create view %I.site_content with (security_barrier) as
      select key, data, updated_at from tours.site_content where company_id = %L$v$, s, c.id);

    -- departures: published only, internal columns left out -------------------
    execute format('drop view if exists %I.departures cascade', s);
    execute format($v$create view %I.departures with (security_barrier) as
      select d.id, d.package_id, d.series_id, d.code, d.season_year, d.start_date, d.end_date, d.season, d.currency,
             -- the status the site shows: the operator's closed / sold_out win; otherwise the seats decide
             -- (flight seats allocated and none left: sold_out; 5 or fewer: last_places, the backoffice's
             -- LAST_PLACES_THRESHOLD). The seat counts themselves stay internal.
             case
               when d.sale_status in ('closed', 'sold_out') then d.sale_status
               when st.allocated_seats > 0 and st.remaining <= 0 then 'sold_out'
               when st.allocated_seats > 0 and st.remaining <= 5 then 'last_places'
               else d.sale_status
             end as sale_status,
             d.card_badge, d.date_labels, d.arrival_airport, d.return_airport, d.itinerary_id,
             d.meeting_at, d.flight_mode, d.flight_price, d.baggage_included, d.meal_included, d.transfers_included,
             d.connection_out, d.connection_back, d.child_max_age, d.senior_min_age, d.senior_discount,
             d.markup_percent, d.markup_fixed, d.legacy_product_id, d.site_id, d.data, d.season_id
      from tours.departures d
      left join tours.departure_stats st on st.departure_id = d.id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.departure_prices cascade', s);
    execute format($v$create view %I.departure_prices with (security_barrier) as
      select dp.departure_id, dp.pax_type, dp.room_position, dp.price
      from tours.departure_prices dp
      join tours.departures d on d.id = dp.departure_id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.departure_options cascade', s);
    execute format($v$create view %I.departure_options with (security_barrier) as
      select o.id, o.departure_id, o.kind, o.position, o.ref_code, o.label, o.board, o.nights,
             o.stay_order, o.max_people, o.price, o.price_unit, o.room_prices
      from tours.departure_options o
      join tours.departures d on d.id = o.departure_id
      where d.company_id = %L and d.is_published and d.is_deleted is null$v$, s, c.id);

    execute format('drop view if exists %I.promotions cascade', s);
    execute format($v$create view %I.promotions with (security_barrier) as
      select id, departure_id, series_id, kind, value, label, valid_until, show_on_card
      from tours.promotions
      where company_id = %L and is_active$v$, s, c.id);  -- valid_until is shown, not enforced: the site decides (WordPress never hid an expired discount)

    -- the live flight block(s) of a published departure: schedule only ---------
    execute format('drop view if exists %I.departure_flights cascade', s);
    execute format($v$create view %I.departure_flights with (security_barrier) as
      select fa.departure_id, fa.legs, f.id as flight_id, f.block_status,
             f.airline_code, f.inbound_airline_code, f.metadata_name, f.metadata_logo, f.stops,
             f.outbound_flight_number, f.outbound_departure_airport, f.outbound_arrival_airport,
             f.outbound_departure_time, f.outbound_arrival_time, f.outbound_stop_airport, f.outbound_stop_duration,
             f.outbound_check_bags_included,
             f.inbound_flight_number, f.inbound_departure_airport, f.inbound_arrival_airport,
             f.inbound_departure_time, f.inbound_arrival_time, f.inbound_stop_airport, f.inbound_stop_duration,
             f.inbound_check_bags_included
      from tours.flight_allocations fa
      join public.flights f on f.id = fa.flight_id
      join tours.departures d on d.id = fa.departure_id
      where f.company_id = %L and d.company_id = %L
        and f.is_deleted is not true
        and f.block_status in ('confirmed','operational','ticketed')
        and d.is_published and d.is_deleted is null$v$, s, c.id, c.id);

    -- online booking: one entry point for the site (tours.site_booking) ----
    execute format($f$create or replace function %I.site_booking(p_action text, p_args jsonb default '{}'::jsonb)
      returns jsonb
      language sql
      security definer
      set search_path = public, pg_temp
      as $body$ select tours.site_booking(%L::uuid, p_action, p_args) $body$$f$, s, c.id);
    execute format('revoke all on function %I.site_booking(text, jsonb) from public', s);
    execute format('grant execute on function %I.site_booking(text, jsonb) to anon, authenticated, service_role', s);
  end if;

  -- forms ---------------------------------------------------------------------
  execute format($f$create or replace function %I.submit_lead(
      p_kind text, p_name text, p_phone text, p_email text, p_message text,
      p_payload jsonb default '{}'::jsonb, p_source_path text default null, p_utm jsonb default '{}'::jsonb)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $body$
    declare new_id uuid;
    begin
      if coalesce(btrim(p_name), '') = '' and coalesce(btrim(p_phone), '') = '' and coalesce(btrim(p_email), '') = '' then
        raise exception 'empty lead';
      end if;
      if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 16000 then
        raise exception 'payload too large';
      end if;
      insert into public.leads (company_id, kind, name, phone, email, message, payload, source_path, utm)
      values (%L,
              left(coalesce(nullif(btrim(p_kind), ''), 'lead'), 40),
              left(p_name, 300), left(p_phone, 40), left(p_email, 120), left(p_message, 4000),
              coalesce(p_payload, '{}'::jsonb), left(p_source_path, 300), coalesce(p_utm, '{}'::jsonb))
      returning id into new_id;
      return new_id;
    end
    $body$$f$, s, c.id);
  execute format('revoke all on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) from public', s);
  execute format('grant execute on function %I.submit_lead(text, text, text, text, text, jsonb, text, jsonb) to anon, authenticated, service_role', s);

  execute format('grant select on all tables in schema %I to anon, authenticated, service_role', s);
end
$fn$;

select public.reprovision_all_companies();
