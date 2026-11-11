// Run: npx tsx scripts/tixstock-customer-email-selftest.ts
// The e-mail and the WhatsApp text staff send a customer once the tickets were checked
// (lib/tixstock-booking/customer-email.ts), and which stored files ride as attachments. Pure - no mail is sent.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.6.
import assert from "node:assert/strict";
import { MAX_ATTACH_BYTES, attachmentsWithin, customerTicketEmail, seatsLine, sentPatch, whatsappTicketText } from "../lib/tixstock-booking/customer-email";

const it = (name: string, run: () => void): void => {
  run();
  console.log("ok -", name);
};

const PAGE = "https://www.mega-events.co.il/ticket/" + "t".repeat(43);
const mail = (over: Partial<Parameters<typeof customerTicketEmail>[0]> = {}) =>
  customerTicketEmail({
    eventName: "Juventus - Como",
    eventDate: "12/06/2027",
    seats: "Curva Sud, אזור 101, שורה 5",
    ticketType: "eTicket",
    restrictions: ["Away fans section", "Age: 16+"],
    deliveryNote: null,
    pageUrl: PAGE,
    externalTransfer: false,
    mobileLinks: [],
    ...over,
  });

it("rtl", () => {
  assert.match(mail().html, /^<div dir="rtl"/);
});

it("the event, the seats and the page link are there", () => {
  const m = mail();
  assert.match(m.subject, /Juventus - Como/);
  for (const part of ["Juventus - Como", "12/06/2027", "Curva Sud, אזור 101, שורה 5", "eTicket"]) assert.ok(m.html.includes(part), part);
  assert.ok(m.html.includes(`href="${PAGE}"`));
  assert.ok(m.text.includes(PAGE));
  assert.equal(/<[a-z]/i.test(m.text), false, "the text part has no html");
});

it("restrictions listed", () => {
  const m = mail();
  for (const line of ["Away fans section", "Age: 16+"]) {
    assert.ok(m.html.includes(line), line);
    assert.ok(m.text.includes(line), line);
  }
  assert.equal(mail({ restrictions: [] }).html.includes("<ul"), false, "no empty list");
});

it("external transfer copy", () => {
  const m = mail({ externalTransfer: true });
  assert.ok(m.html.includes("הכרטיסים מועברים אליך ישירות על ידי הספק - בדקו את תיבת המייל"));
  assert.ok(m.html.includes(PAGE));
  assert.ok(m.text.includes("הכרטיסים מועברים אליך ישירות על ידי הספק - בדקו את תיבת המייל"));
});

it("mobile links listed", () => {
  const links = ["https://tickets.example/a?x=1&y=2", "https://tickets.example/b"];
  const m = mail({ mobileLinks: links });
  assert.ok(m.html.includes('<a href="https://tickets.example/a?x=1&amp;y=2"'));
  assert.ok(m.html.includes('<a href="https://tickets.example/b"'));
  for (const link of links) assert.ok(m.text.includes(link));
});

it("a seller's link that is not an http(s) URL never becomes a link in the mail", () => {
  const m = mail({ mobileLinks: ["javascript:alert(1)", " data:text/html,x", "https://tickets.example/ok"] });
  assert.equal(m.html.includes("javascript:"), false);
  assert.equal(m.html.includes("data:text"), false);
  assert.equal(m.text.includes("javascript:"), false);
  assert.ok(m.html.includes('<a href="https://tickets.example/ok"'));
});

it("what a seller or a customer typed is escaped", () => {
  const m = mail({ eventName: '<b>X</b> & "Y"', restrictions: ["<script>alert(1)</script>"], deliveryNote: "<i>soon</i>" });
  assert.equal(m.html.includes("<script>"), false);
  assert.equal(m.html.includes("<b>X</b>"), false);
  assert.equal(m.html.includes("<i>soon</i>"), false);
  assert.ok(m.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

it("the delivery note shows only when there is one", () => {
  assert.ok(mail({ deliveryNote: "מסירה עד 09/06/2027" }).html.includes("מסירה עד 09/06/2027"));
  assert.equal(mail({ deliveryNote: null }).html.includes("מסירה עד"), false);
});

it("whatsapp text", () => {
  const text = whatsappTicketText({ eventName: "Juventus - Como", pageUrl: PAGE });
  assert.ok(text.includes("Juventus - Como"));
  assert.ok(text.includes(PAGE));
  assert.equal(/<[a-z]/i.test(text), false, "no html tags");
});

it("the PDFs ride with the mail only while they fit together", () => {
  assert.equal(MAX_ATTACH_BYTES, 10 * 1024 * 1024);
  const file = (bytes: number, name: string) => ({ filename: name, bytes });
  assert.deepEqual(attachmentsWithin([file(4_000_000, "a"), file(5_000_000, "b")]).map((f) => f.filename), ["a", "b"]);
  // Over the limit the customer gets the link alone - never some of the tickets.
  assert.deepEqual(attachmentsWithin([file(6_000_000, "a"), file(5_000_000, "b")]), []);
  assert.deepEqual(attachmentsWithin([]), []);
});

it("the seats line names the category, then the section and the row when the listing has them", () => {
  assert.equal(seatsLine({ category: "Curva Sud", section: "101", row: "5" }), "Curva Sud, אזור 101, שורה 5");
  assert.equal(seatsLine({ category: "Curva Sud", section: null, row: null }), "Curva Sud");
  assert.equal(seatsLine({ category: "", section: null, row: "5" }), "שורה 5");
});

it("sending marks the booking once: who and when stay the first sender's, the channel is added, the tickets are released", () => {
  const first = sentPatch({ sent_to_customer_at: null, sent_channels: [], released_to_customer_at: null }, "email", "staff@x", "2026-11-11T10:00:00Z");
  assert.deepEqual(first, { sent_to_customer_at: "2026-11-11T10:00:00Z", sent_to_customer_by: "staff@x", sent_channels: ["email"], released_to_customer_at: "2026-11-11T10:00:00Z" });
  const second = sentPatch({ sent_to_customer_at: "2026-11-11T10:00:00Z", sent_channels: ["email"], released_to_customer_at: "2026-11-11T10:00:00Z" }, "whatsapp", "other@x", "2026-11-11T11:00:00Z");
  assert.deepEqual(second, { sent_channels: ["email", "whatsapp"] });
  const again = sentPatch({ sent_to_customer_at: "2026-11-11T10:00:00Z", sent_channels: ["email"], released_to_customer_at: "2026-11-11T10:00:00Z" }, "email", "other@x", "2026-11-11T11:00:00Z");
  assert.deepEqual(again, { sent_channels: ["email"] });
  // `updated_at` is the clock of the row's last STATUS change (the sweep and the card read it): a send leaves it alone.
  assert.equal("updated_at" in first, false);
});

console.log("tixstock-customer-email-selftest: all passed");
