// scripts/tours-site-content-selftest.ts - `npx tsx scripts/tours-site-content-selftest.ts`
// Pure only: the site documents of a tours company (lib/tours/site-content.ts) and the plain
// text of an imported page (lib/tours/wp-html.ts). No DB, no network.
//
// What it guards: a document saved before a field existed still opens (and loses nothing), a
// term page nobody arranged opens as the layout the site always drew, and Elementor markup
// comes out as the small vocabulary the visual editor can hold.
import {
  defaultTermLayout,
  FOOTER_TILE_MODE_LABELS,
  FOOTER_TILE_MOBILE_LABELS,
  NO_TERM_EXTRAS,
  SITE_DOC_SCHEMAS,
  homeSchema,
  readFooterTiles,
  readPictureTileMode,
  readSiteDoc,
  readTermSections,
  sectionProblem,
  splitTermExtras,
  termSectionsSchema,
  type HomeSection,
} from "../lib/tours/site-content";
import { REASONS_TITLE, termExtrasSections, unwrapImportedHtml } from "../lib/tours/term-extras";
import { EMPTY_EASY, PAGE_NOTES, aboutMenuFromHtml, cleanEasy, easyFromHtml, easyLayoutOfPath, hotTilesFromExtras, leadersSiteText, mediaPath, readEasy, simplifyHtml } from "../lib/tours/wp-html";
import { canFeedReviews, formReviewCandidate, formReviewRef, formReviewShape, type FormReviewField } from "../lib/tours/form-reviews";
import { isSimpleHtml } from "../components/tours/content/shared";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ---- a home document saved by the first version of the editor (round 10)
const oldTab = { key: "all", label: "כל המבחר", icon: "", show: "all", world: "", allLabel: "הכל", color: "", search: "filters", featuredTitle: "הנמכרים", featured: ["a", "b"] };
const oldHome = {
  sections: [
    { id: "hero", type: "hero", visible: true, titleBold: "קבוצה אחת.", titleRest: "", text: "", slides: [{ image: "/media/a.jpg", alt: "", href: "" }] },
    { id: "tours", type: "tours", visible: true, gridTitle: "מוצרים", tabs: [oldTab, { ...oldTab, key: "sale", show: "sale", featuredTitle: "", featured: [] }], salePills: [] },
    { id: "dest", type: "destinations", visible: true, title: "יעדים", items: [{ slug: "x", image: "" }] },
    { id: "ban", type: "banners", visible: true, title: "", items: [] },
    { id: "rev", type: "reviews", visible: true, title: "", items: [{ name: "דנה", text: "מעולה" }] },
  ],
};
const home = readSiteDoc("home", oldHome);
check("an old home document opens with every section", home.sections.map((s) => s.type), ["hero", "tours", "destinations", "banners", "reviews"]);
const finder = home.sections[1] as Extract<HomeSection, { type: "tours" }>;
check("its single featured row becomes a row of the tile", finder.tabs[0].rows, [{ id: "row_all", title: "הנמכרים", source: "manual", term: "", tours: ["a", "b"], limit: 12 }]);
check("a tile without a featured row has no rows", finder.tabs[1].rows, []);
check("a tile starts with the general banner and automatic pills", [finder.tabs[0].banner.slides.length, finder.tabs[0].pillTags, finder.tabs[0].term], [0, [], ""]);
const dest = home.sections[2] as Extract<HomeSection, { type: "destinations" }>;
check("tiles stay picked by hand until staff choose automatic", [dest.mode, dest.items.length], ["manual", 1]);
const reviews = home.sections[4] as Extract<HomeSection, { type: "reviews" }>;
check("reviews stay typed until staff choose Google", [reviews.source, reviews.items.length], ["manual", 1]);
check("the home page follows the footer rule until it chooses", home.footerTiles, { mode: "default", title: "", items: [], mobile: "default" });
check("the document as the editor holds it saves as is", homeSchema.safeParse(home).success, true);

// ---- what a save is refused for
check("a tile by tag needs its tag", sectionProblem({ ...finder, tabs: [{ ...finder.tabs[0], show: "tag", term: "" }] }), 'choose the tag of the tile "כל המבחר"');
check("a tile's row by world needs its world", sectionProblem({ ...finder, tabs: [{ ...finder.tabs[0], rows: [{ id: "r", title: "שורה", source: "world", term: "", tours: [], limit: 8 }] }] }), 'choose the world of the row "שורה" in the tile "כל המבחר"');
check("automatic tiles by world need the world", sectionProblem({ ...dest, mode: "auto", source: "world", term: "" }), "choose the world the tiles come from");
check("picked tiles need nothing more", sectionProblem(dest), null);
check("a part of a term page is refused on the home page", homeSchema.safeParse({ ...home, sections: [...home.sections, { id: "b", visible: true, type: "term_tours" }] }).success, false);

// ---- the footer document and a page's own tiles
const footer = readSiteDoc("footer", { discoverTitle: "גלו", discover: [], newsletterTitle: "", newsletterNote: "", contactTitle: "", columns: [{ heading: "כללי", links: [] }] });
check("an old footer document: tiles everywhere but the tour pages", footer.discoverOn, { home: true, pages: true, terms: true, tours: false });
check("an old footer document: a phone shows the desktop columns", [footer.mobileColumns, footer.mobileAccordion, footer.columns.length], [[], false, 1]);
check("an unreadable choice of a page follows the rule", readFooterTiles({ mode: "banana" }).mode, "default");
check("an old contact document has no Google profile", readSiteDoc("general", { name: "מגה" }).googlePlaceId, "");

// ---- term pages
const types = (sections: HomeSection[]) => sections.map((s) => (s.visible ? s.type : `(${s.type})`));
check("a world nobody arranged", types(readTermSections("audiences", undefined)), ["subcategories", "term_tours", "term_description", "lead_form", "reviews"]);
check("a tag nobody arranged", types(readTermSections("tags", null)), ["term_tours", "term_description", "lead_form", "reviews"]);
check("a destination nobody arranged", types(readTermSections("destinations", [])), ["term_description", "term_tours", "lead_form"]);
check("a category nobody arranged: its description is there, switched off", types(readTermSections("categories", [])), ["term_tours", "(term_description)", "lead_form"]);
const text: HomeSection = { id: "t1", visible: true, type: "text", title: "", html: "<p>שלום</p>" };
check("sections a world already had sit where the site drew them", types(readTermSections("audiences", [text])), ["subcategories", "text", "term_tours", "term_description", "lead_form", "reviews"]);
const arranged = [text, { id: "b_term_tours", visible: true, type: "term_tours" }];
check("an arranged page is read as stored, and gets back a part it lacks", types(readTermSections("tags", arranged)), ["text", "term_tours", "term_description"]);
check("the default of a kind passes its own check", termSectionsSchema("audiences").safeParse(defaultTermLayout("audiences")).success, true);
check("a page without its tour list is refused", termSectionsSchema("tags").safeParse([text]).success, false);
check("sub-categories belong to a world only", termSectionsSchema("tags").safeParse([...defaultTermLayout("tags"), { id: "s", visible: true, type: "subcategories" }]).success, false);
check("the home page's hero is not for a term page", termSectionsSchema("tags").safeParse([...defaultTermLayout("tags"), home.sections[0]]).success, false);

// ---- the plain text of an imported page
const widget = (kind: string, inner: string) => `<div class="elementor-element elementor-widget elementor-widget-${kind}" data-id="x"><div class="elementor-widget-container">${inner}</div></div>`;
const legalHtml = `<div class="elementor">${widget("text-editor", '<h4 class="x"><strong><a href="/info/terms/">תנאים</a></strong></h4><p style="color:red">שורה<br/>שנייה</p><p>&nbsp;</p><div class="wrap"><p>בתוך עטיפה</p></div>')}</div>`;
const legal = easyFromHtml("legal", legalHtml);
check("a legal page: its text, simplified", legal.body, '<h3><strong><a href="/terms/">תנאים</a></strong></h3><p>שורה<br>שנייה</p><p>בתוך עטיפה</p>');
check("the simplified text is what the visual editor can hold", isSimpleHtml(legal.body), true);
check("a script never survives", simplifyHtml('<p onclick="x()">א</p><script>alert(1)</script><span class="b">ב</span>'), "<p>א</p>ב");

const item = (title: string, body: string) => `<details class="e-n-accordion-item"><summary><div class="e-n-accordion-item-title-text"> ${title} </div></summary>${widget("text-editor", body)}</details>`;
const faqHtml = `<div>${widget("text-editor", '<h5 class="h4 text-primary"><strong>פתיחה</strong></h5>')}${widget("n-accordion", item("שאלות כלליות", "<p><strong>שאלה?</strong></p><p>תשובה</p>") + item("מזוודות", '<div role="tab"><p>משקל</p></div>'))}</div>`;
const faq = easyFromHtml("faq", faqHtml);
check("a FAQ page: its opening text", faq.intro, "<h3><strong>פתיחה</strong></h3>");
check("a FAQ page: its topics, in order", faq.faq, [{ q: "שאלות כלליות", a: "<p><strong>שאלה?</strong></p><p>תשובה</p>" }, { q: "מזוודות", a: "<p>משקל</p>" }]);
check("what staff saved wins over the imported text, field by field", readEasy("faq", { intro: "<p>חדש</p>" }, faqHtml), { ...EMPTY_EASY, intro: "<p>חדש</p>", faq: faq.faq });
check(
  "a save keeps the fields of the layout only, and drops a topic without a title",
  cleanEasy("faq", { ...EMPTY_EASY, body: "<p>לא שייך</p>", heading: "כותרת", intro: " <p>פתיחה</p> ", image: "/media/x.jpg", faq: [{ q: " נושא ", a: "<p>א</p><script>x</script>" }, { q: "", a: "<p>ריק</p>" }] }),
  { ...EMPTY_EASY, intro: "<p>פתיחה</p>", faq: [{ q: "נושא", a: "<p>א</p>" }] },
);
check("untouched text compares equal, so nothing is stored", JSON.stringify(cleanEasy("faq", readEasy("faq", undefined, faqHtml))) === JSON.stringify(cleanEasy("faq", faq)), true);

// ---- the imported pages that were still HTML: about, contact, the cancellation form, the blog, the leaders
check("every about page has the about editor", ["/about/", "/about/our-team/", "/about/a/b/", "/aboutus/"].map(easyLayoutOfPath), ["about", "about", null, null]);
check("the pages with a plain editor, by address", ["/contact/", "/cancellation-form/", "/mega-blog/", "/מלווי-הקבוצות-שלנו/", "/faq/", "/new-page/"].map(easyLayoutOfPath), ["contact", "form_page", "blog", "leaders", "faq_home", null]);
const heading = (text: string) => widget("heading", `<h2 class="elementor-heading-title elementor-size-default">${text}</h2>`);
const aboutHtml = `<div>${heading("סינון אודות")}${heading("מאז 1994")}${widget("text-editor", "<p>אנחנו <strong>מגה</strong></p>")}${widget("image", '<img decoding="async" width="1024" height="683" src="https://newsite.megatr.co.il/wp-content/uploads/2025/12/team-1024x683.jpg" class="attachment-large" alt="הצוות" />')}${heading("הכי חמים במגה פמילי")}</div>`;
check("an about page: its heading (not a template's), its text and its picture", easyFromHtml("about", aboutHtml), {
  ...EMPTY_EASY,
  heading: "מאז 1994",
  body: "<p>אנחנו <strong>מגה</strong></p>",
  image: "/media/2025/12/team.jpg",
  imageAlt: "הצוות",
});
check("a picture staff chose replaces the imported one, the rest stays", readEasy("about", { image: "https://cdn.example/new.jpg" }, aboutHtml).image, "https://cdn.example/new.jpg");
check("a WordPress upload is served from /media/, in its original size", mediaPath("https://newsite.megatr.co.il/wp-content/uploads/2026/07/a%20b-300x200.png"), "/media/2026/07/a b.png");
const contactHtml = `<div>${heading("לא מצאתם?")}${widget("text-editor", "<p>כתבו לנו</p>")}${heading("טופס")}</div>`;
check("the contact page: two headings and the opening text", easyFromHtml("contact", contactHtml), { ...EMPTY_EASY, heading: "לא מצאתם?", intro: "<p>כתבו לנו</p>", heading2: "טופס" });
check("the contact page without headings opens with the words the site prints", easyFromHtml("contact", "").heading2, "כתבו לנו ונמצא חופשה במיוחד בשבילכם");
const formHtml = `<div>${widget("text-editor", "<p>לפני</p>")}${widget("form", "<form></form>")}${widget("text-editor", "<p>אחרי</p>")}</div>`;
check("the cancellation page: the text above the form and the text under it", easyFromHtml("form_page", formHtml), { ...EMPTY_EASY, intro: "<p>לפני</p>", after: "<p>אחרי</p>" });
check("the blog page opens with the words the site prints", easyFromHtml("blog", "").heading, "מגה בלוג - מסביב לעולם עם מגה תיירות");
const extras = { instructorsPage: { subtitle: ["הכירו את הצוות", "המסור שלנו"], notFoundTitle: "לא מצאתם?", notFoundHtml: '<p class="x">כ-100 מלווים</p>' } };
check("the leaders page opens with the words the site keeps for it", easyFromHtml("leaders", "", leadersSiteText(extras)), {
  ...EMPTY_EASY,
  heading: "הכירו את הצוות המסור שלנו",
  heading2: "לא מצאתם?",
  after: "<p>כ-100 מלווים</p>",
});
check("no extras row: the leaders page still opens, with the built-in words", easyFromHtml("leaders", "", leadersSiteText(null)).heading2, "לא מצאתם את מה שחיפשתם?");
check("a save of the leaders page keeps its three fields", cleanEasy("leaders", { ...EMPTY_EASY, heading: " שורה ", heading2: "כותרת", after: "<p>טקסט</p><script>x</script>", body: "<p>לא שייך</p>" }), {
  ...EMPTY_EASY,
  heading: "שורה",
  heading2: "כותרת",
  after: "<p>טקסט</p>",
});
check("the old shop addresses are left out of the list, the home page is not", [PAGE_NOTES["/cart/"]?.retired, PAGE_NOTES["/shop/"]?.retired, PAGE_NOTES["/"]?.retired, PAGE_NOTES["/"]?.href], [true, true, undefined, "/tours/homepage"]);

// ---- the menu of the about pages and the picture tiles under them
const oldHeader = readSiteDoc("header", { menus: [], links: [{ label: "צור קשר", href: "/contact/" }], mobile: [] });
check("a header saved before the about menu existed opens, with no about links of its own", [oldHeader.links.length, oldHeader.aboutMenu], [1, []]);
const oldFooter = readSiteDoc("footer", { discoverTitle: "בואו לגלות עוד", discover: [], newsletterTitle: "", newsletterNote: "", contactTitle: "", columns: [] });
check("a footer saved before the picture tiles existed opens: the row shows, with no tiles of its own", [oldFooter.discoverTitle, oldFooter.hotVisible, oldFooter.hotTitle, oldFooter.hot], ["בואו לגלות עוד", true, "", []]);
const navItem = (href: string, text: string) => `<li class="menu-item"><a class="elementor-item" href="${href}">${text}</a></li>`;
const navHtml = (items: string) => `<div class="elementor-element elementor-widget elementor-widget-nav-menu" data-id="n"><nav class="elementor-nav-menu--main"><ul>${items}</ul></nav><nav class="elementor-nav-menu--dropdown"><ul>${items}</ul></nav></div>`;
const aboutNav = navHtml(navItem("/about/since-1994/", "מאז 1994") + navItem("https://newsite.megatr.co.il/about/our-team/", "הצוות <b>שלנו</b>") + navItem("#", "ריק"));
check("the about menu as the pages came with it: each link once, in order, as a path of the site", aboutMenuFromHtml(`<div>${aboutNav}${widget("text-editor", "<p>טקסט</p>")}</div>`), [
  { label: "מאז 1994", href: "/about/since-1994/" },
  { label: "הצוות שלנו", href: "/about/our-team/" },
]);
check("a page with no menu has no about links", aboutMenuFromHtml(legalHtml), []);
const hotExtras = { instructorsPage: { hotTitle: " הכי חמים ", hotTiles: [{ name: "איטליה", href: "/destinations/איטליה/", image: "https://newsite.megatr.co.il/wp-content/uploads/2025/12/italy-300x200.jpg" }, { name: "", href: "/", image: "/media/x.jpg" }, { name: "קצרים", image: "/media/2025/12/Shorts.jpg" }] } };
check("the picture tiles as the site came with them", hotTilesFromExtras(hotExtras), {
  title: "הכי חמים",
  tiles: [
    { label: "איטליה", href: "/destinations/איטליה/", image: "/media/2025/12/italy.jpg" },
    { label: "קצרים", href: "/", image: "/media/2025/12/Shorts.jpg" },
  ],
});
check("no extras row: no picture tiles to open with", hotTilesFromExtras(undefined), { title: "", tiles: [] });
const footerWithHot = { ...oldFooter, hot: [{ label: "איטליה", href: "/destinations/איטליה/", image: "/media/2025/12/italy.jpg" }] };
check("a footer with a picture tile is valid", SITE_DOC_SCHEMAS.footer.safeParse(footerWithHot).success, true);
check("a picture tile needs a name", SITE_DOC_SCHEMAS.footer.safeParse({ ...footerWithHot, hot: [{ label: " ", href: "/", image: "" }] }).success, false);
check("ten picture tiles are refused", SITE_DOC_SCHEMAS.footer.safeParse({ ...footerWithHot, hot: Array.from({ length: 10 }, () => footerWithHot.hot[0]) }).success, false);

// ---- reviews picked from a feedback form
const oldReviews = home.sections.find((s) => s.type === "reviews");
check("a review typed before stars existed has none, and no mark", oldReviews?.type === "reviews" ? oldReviews.items : null, [{ name: "דנה", text: "מעולה", rating: 0, ref: "" }]);
const field = (id: number, type: string, position: number, more: Partial<FormReviewField> = {}): FormReviewField => ({ id, type, position, staffOnly: false, reviewScore: false, max: 5, ...more });
const feedback = formReviewShape([
  field(59, "long_text", 17),
  field(5, "short_text", 1, { staffOnly: true }),
  field(7, "date", 2, { staffOnly: true }),
  field(9, "short_text", 4),
  field(18, "rating", 13),
  field(12, "rating", 7, { reviewScore: true }),
  field(13, "rating", 8, { reviewScore: true }),
]);
check("a form's review: the customer's name, the first scored rating, the free text, the staff's trip fields", [feedback.name?.id, feedback.rating?.id, feedback.texts.map((f) => f.id), feedback.trip.map((f) => f.id)], [9, 12, [59], [5, 7]]);
check("a form with no free text cannot feed reviews", canFeedReviews(formReviewShape([field(1, "short_text", 0), field(2, "rating", 1)])), false);
const answer = { id: 301, submittedAt: "2026-08-20T10:00:00Z", answers: { "5": "רונית", "7": "2026-08-12", "9": " משפחת כהן ", "12": 5, "13": 3, "59": " היה מושלם\nתודה " } };
check("an answer as a review", formReviewCandidate(feedback, answer, "BBC-124"), { id: 301, name: "משפחת כהן", text: "היה מושלם\nתודה", rating: 5, date: "2026-08-20T10:00:00Z", trip: "BBC-124 · רונית · 12.08.2026" });
check("stars alone are not a review", formReviewCandidate(feedback, { ...answer, answers: { ...answer.answers, "59": "  " } }), null);
check("a rating on another scale is read out of 5", formReviewCandidate(formReviewShape([field(1, "long_text", 0), field(2, "rating", 1, { max: 10 })]), { id: 1, submittedAt: "", answers: { "1": "טוב", "2": 8 } })?.rating, 4);
check("no stars given = no stars shown", formReviewCandidate(feedback, { ...answer, answers: { "59": "טקסט" } })?.rating, 0);
check("a picked review carries the mark of its answer", formReviewRef(301), "form:301");
const picked = { id: "rev", type: "reviews", visible: true, title: "", items: [{ name: "משפחת כהן", text: "היה מושלם", rating: 5, ref: "form:301" }] };
check("a picked review is saved with its stars and its mark", homeSchema.safeParse({ sections: [picked] }).success, true);
check("six stars are refused", homeSchema.safeParse({ sections: [{ ...picked, items: [{ ...picked.items[0], rating: 6 }] }] }).success, false);

// ---- what a term page came with from WordPress, as sections of its own (round 14, 08.10)
const extrasRow = {
  terms: {
    "tags/חמישיות": {
      reasons: [{ icon: "https://newsite.megatr.co.il/wp-content/uploads/2026/08/calendar-date.png", title: "קצר ומדויק", text: "טיול קצר" }, { icon: "", title: "", text: "" }],
      destSlider: {
        title: "היעדים המושלמים לחופשת 5 ימים",
        slides: [{ href: "/destinations/פריז/", image: "/media/2026/08/paris.jpg", title: "פריז", text: "5 ימים של קסם", button: "לכל הטיולים" }, { href: "#", image: "", title: "", text: "" }],
      },
    },
    "destinations/ספרד": {
      summary: { title: "ספרד על קצה המזלג", gallery: ["/media/2026/08/a.jpg", "/media/2026/08/b.jpg"], blocks: ['<div class="x"><p>פתיח</p></div>', '<h2 class="y">כותרת</h2><p>טור</p>'] },
    },
  },
};
const tagExtras = termExtrasSections("tags", "חמישיות", extrasRow);
check("a tag's reasons row and destination slider, as sections", [tagExtras.beforeTours.map((s) => s.id), tagExtras.afterLead.map((s) => s.id)], [["x_reasons"], ["x_destSlider"]]);
check("the reasons keep their icon as a site path and get the title the site wrote", tagExtras.beforeTours[0], {
  id: "x_reasons",
  visible: true,
  type: "reasons",
  title: REASONS_TITLE,
  items: [{ icon: "/media/2026/08/calendar-date.png", title: "קצר ומדויק", text: "טיול קצר" }],
});
check("a slide becomes a banner; an empty slide is dropped and a '#' link is no link", tagExtras.afterLead[0].type === "banners" ? tagExtras.afterLead[0].items : null, [
  { title: "פריז", subtitle: "5 ימים של קסם", cta: "לכל הטיולים", href: "/destinations/פריז/", newTab: false, image: "/media/2026/08/paris.jpg", overlayColor: "", buttonColor: "" },
]);
const destExtras = termExtrasSections("destinations", "ספרד", extrasRow);
check("a destination's summary: the intro card and the columns without the imported wrappers", destExtras.afterLead[0], {
  id: "x_summary",
  visible: true,
  type: "summary",
  title: "ספרד על קצה המזלג",
  images: ["/media/2026/08/a.jpg", "/media/2026/08/b.jpg"],
  intro: "<p>פתיח</p>",
  columns: ["<h2>כותרת</h2><p>טור</p>"],
});
check("a term with nothing from WordPress has no extras", termExtrasSections("tags", "אחר", extrasRow), NO_TERM_EXTRAS);
check("no extras row at all", termExtrasSections("tags", "חמישיות", null), NO_TERM_EXTRAS);
const tagPage = readTermSections("tags", undefined, tagExtras);
check("a tag page nobody arranged opens with the reasons above the tour list and the slider after the lead form", tagPage.map((s) => s.id), ["x_reasons", "b_term_tours", "b_term_description", "b_lead_form", "x_destSlider", "b_reviews"]);
check("the page it opens with is a valid page to save", termSectionsSchema("tags").safeParse(tagPage).success, true);
const destPage = readTermSections("destinations", undefined, destExtras);
check("a destination page opens with its summary after the lead form", destPage.map((s) => s.id), ["b_term_description", "b_term_tours", "b_lead_form", "x_summary"]);
check("a summary is no part of the home page", homeSchema.safeParse({ sections: [destPage[3]] }).success, false);
const rearranged = [tagPage[4], tagPage[0], { id: "s_text", visible: true, type: "text", title: "", html: "" }] as HomeSection[];
const split = splitTermExtras(rearranged);
check("the reset tells the parts the page came with from the ones staff added", [split.rest.map((s) => s.id), split.extras.beforeTours.map((s) => s.id), split.extras.afterLead.map((s) => s.id)], [["s_text"], ["x_reasons"], ["x_destSlider"]]);
check("the reset puts them back where the site drew them", defaultTermLayout("tags", split.rest, split.extras).map((s) => s.id), ["s_text", "x_reasons", "b_term_tours", "b_term_description", "b_lead_form", "x_destSlider", "b_reviews"]);

// ---- the tour list and the sub-categories carry picks
const oldBlocks = readTermSections("audiences", [
  { id: "b_subcategories", visible: true, type: "subcategories" },
  { id: "b_term_tours", visible: true, type: "term_tours" },
  { id: "b_term_description", visible: true, type: "term_description" },
]);
check("a page saved before the picks existed opens with none", [oldBlocks[0], oldBlocks[1]], [
  { id: "b_subcategories", visible: true, type: "subcategories", tags: [] },
  { id: "b_term_tours", visible: true, type: "term_tours", tours: [], onlyPicked: false },
]);
check("a tour list with picks is saved", termSectionsSchema("tags").safeParse([{ id: "b_term_tours", visible: true, type: "term_tours", tours: ["a", "b"], onlyPicked: true }]).success, true);
check("twenty-five picks are refused", termSectionsSchema("tags").safeParse([{ id: "b_term_tours", visible: true, type: "term_tours", tours: Array.from({ length: 25 }, (_, i) => `t${i}`), onlyPicked: false }]).success, false);

// ---- an imported description opens without its Elementor wrappers
const wrapped = '<div class="elementor-element elementor-widget-woocommerce-archive-description" data-id="77c27c6">\n<div class="term-description"><h2>קצת על טיולי משפחות</h2>\n<p>טיולים <strong>מאורגנים</strong> למשפחות.</p>\n</div> </div>';
check("a description inside Elementor wrappers opens as its text", unwrapImportedHtml(wrapped), "<h2>קצת על טיולי משפחות</h2>\n<p>טיולים <strong>מאורגנים</strong> למשפחות.</p>");
check("and is simple enough for the visual editor", isSimpleHtml(unwrapImportedHtml(wrapped)), true);
const withPicture = '<div class="x"><p>טקסט</p><img src="/media/a.jpg" alt="תמונה"></div>';
check("a description that carries a picture is left as it is", unwrapImportedHtml(withPicture), withPicture);
check("a description that is already plain is unchanged", unwrapImportedHtml("<p>טקסט</p>"), "<p>טקסט</p>");

// ---- the tiles above the footer on a phone, and the picture tiles of one page
check("a footer saved before the phone switch shows the tiles on phones", readSiteDoc("footer", oldFooter).discoverMobile, true);
check("a page's tiles choice saved before the phone answer follows the rule", readFooterTiles({ mode: "show", title: "", items: [] }).mobile, "default");
check("a page may hide its tiles on phones", readFooterTiles({ mode: "default", title: "", items: [], mobile: "hide" }).mobile, "hide");
check("a page draws its picture tiles unless it said so", [readPictureTileMode(undefined), readPictureTileMode("hide"), readPictureTileMode("x")], ["default", "hide", "default"]);
check("the two tile modes that read alike read differently now", FOOTER_TILE_MODE_LABELS.default !== FOOTER_TILE_MODE_LABELS.show && !FOOTER_TILE_MODE_LABELS.show.startsWith("Always show"), true);
check(
  "the phone choice names both devices, so 'on a computer but not on a phone' can be found by its words",
  Object.values(FOOTER_TILE_MOBILE_LABELS).map((label) => /computer/i.test(label) && /phone/i.test(label)),
  [false, true, true],
);

if (failed) {
  console.error(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
