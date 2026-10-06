// scripts/tours-site-content-selftest.ts - `npx tsx scripts/tours-site-content-selftest.ts`
// Pure only: the site documents of a tours company (lib/tours/site-content.ts) and the plain
// text of an imported page (lib/tours/wp-html.ts). No DB, no network.
//
// What it guards: a document saved before a field existed still opens (and loses nothing), a
// term page nobody arranged opens as the layout the site always drew, and Elementor markup
// comes out as the small vocabulary the visual editor can hold.
import {
  defaultTermLayout,
  homeSchema,
  readFooterTiles,
  readSiteDoc,
  readTermSections,
  sectionProblem,
  termSectionsSchema,
  type HomeSection,
} from "../lib/tours/site-content";
import { cleanEasy, easyFromHtml, readEasy, simplifyHtml } from "../lib/tours/wp-html";
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
check("the home page follows the footer rule until it chooses", home.footerTiles, { mode: "default", title: "", items: [] });
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
check("what staff saved wins over the imported text, field by field", readEasy("faq", { intro: "<p>חדש</p>" }, faqHtml), { body: "", heading: "", intro: "<p>חדש</p>", faq: faq.faq });
check("a save keeps the fields of the layout only, and drops a topic without a title", cleanEasy("faq", { body: "<p>לא שייך</p>", heading: "כותרת", intro: " <p>פתיחה</p> ", faq: [{ q: " נושא ", a: "<p>א</p><script>x</script>" }, { q: "", a: "<p>ריק</p>" }] }), {
  body: "",
  heading: "",
  intro: "<p>פתיחה</p>",
  faq: [{ q: "נושא", a: "<p>א</p>" }],
});
check("untouched text compares equal, so nothing is stored", JSON.stringify(cleanEasy("faq", readEasy("faq", undefined, faqHtml))) === JSON.stringify(cleanEasy("faq", faq)), true);

if (failed) {
  console.error(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
