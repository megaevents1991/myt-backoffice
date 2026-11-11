// What staff send a customer once the tickets were checked: the e-mail (with the ticket-page link, and the PDFs
// when they fit) and the WhatsApp text staff copy. Pure - nothing is sent from here.
// Everything a seller or a customer typed is escaped, and a seller's link becomes a link only as an http(s) URL.
// Selftest: scripts/tixstock-customer-email-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.6.
import { safeHttpUrl } from "./rules";

/** The PDFs ride as attachments only while their total stays under this; over it the mail carries the link alone. */
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024;

const EXTERNAL_TRANSFER_LINE = "הכרטיסים מועברים אליך ישירות על ידי הספק - בדקו את תיבת המייל";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function customerTicketEmail(v: {
  eventName: string;
  eventDate: string;
  seats: string;
  ticketType: string;
  restrictions: string[];
  deliveryNote: string | null;
  pageUrl: string;
  externalTransfer: boolean;
  mobileLinks: string[];
}): { subject: string; html: string; text: string } {
  const subject = `הכרטיסים שלכם ל-${v.eventName}`;
  const links = v.mobileLinks.flatMap((link) => {
    const safe = safeHttpUrl(link);
    return safe ? [safe] : [];
  });
  const lead = v.externalTransfer ? EXTERNAL_TRANSFER_LINE : "הכרטיסים שלכם מוכנים.";

  const rows: Array<[string, string]> = [
    ["אירוע", v.eventName],
    ["תאריך", v.eventDate],
    ["מיקום", v.seats],
    ["סוג כרטיס", v.ticketType],
  ];
  const html =
    `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111">` +
    `<p>שלום,</p>` +
    `<p><strong>${esc(lead)}</strong></p>` +
    rows
      .filter(([, value]) => value.trim() !== "")
      .map(([label, value]) => `<p style="margin:2px 0"><strong>${label}:</strong> ${esc(value)}</p>`)
      .join("") +
    (v.deliveryNote ? `<p>${esc(v.deliveryNote)}</p>` : "") +
    (v.restrictions.length > 0
      ? `<p style="margin-bottom:2px"><strong>הגבלות והטבות:</strong></p><ul>${v.restrictions.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
      : "") +
    (links.length > 0
      ? `<p style="margin-bottom:2px"><strong>כרטיסים לנייד:</strong></p>` +
        links.map((link, i) => `<p style="margin:2px 0"><a href="${esc(link)}">כרטיס ${i + 1}</a></p>`).join("")
      : "") +
    `<p><a href="${esc(v.pageUrl)}">לצפייה בכרטיסים</a></p>` +
    `<p dir="ltr" style="font-size:13px;color:#555">${esc(v.pageUrl)}</p>` +
    `</div>`;

  const text = [
    "שלום,",
    lead,
    ...rows.filter(([, value]) => value.trim() !== "").map(([label, value]) => `${label}: ${value}`),
    ...(v.deliveryNote ? [v.deliveryNote] : []),
    ...(v.restrictions.length > 0 ? ["הגבלות והטבות:", ...v.restrictions.map((line) => `- ${line}`)] : []),
    ...(links.length > 0 ? ["כרטיסים לנייד:", ...links] : []),
    `לצפייה בכרטיסים: ${v.pageUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** The message staff paste into WhatsApp: plain text, the event and the ticket page. */
export function whatsappTicketText(v: { eventName: string; pageUrl: string }): string {
  return `שלום, הכרטיסים שלכם ל-${v.eventName} מוכנים.\nלצפייה בכרטיסים: ${v.pageUrl}`;
}

/**
 * The files that ride with the mail: all of them while their total fits `MAX_ATTACH_BYTES`, none otherwise - a
 * customer never gets some of the tickets as attachments and has to guess where the rest are.
 */
export function attachmentsWithin<T extends { bytes: number }>(files: readonly T[]): T[] {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  return total <= MAX_ATTACH_BYTES ? [...files] : [];
}

/** Where the tickets are, in one line: the category, then the section and the row when the listing names them. */
export function seatsLine(listing: { category: string; section: string | null; row: string | null }): string {
  return [listing.category.trim(), listing.section ? `אזור ${listing.section}` : "", listing.row ? `שורה ${listing.row}` : ""]
    .filter((part) => part !== "")
    .join(", ");
}

/**
 * What a send writes on the booking row. Who sent and when are the FIRST send's; a later send in another channel
 * only adds its channel. Sending is also what releases the tickets to the customer's page.
 */
export function sentPatch(
  row: { sent_to_customer_at: string | null; sent_channels: string[]; released_to_customer_at: string | null },
  channel: "email" | "whatsapp",
  actor: string,
  atIso: string,
): Record<string, unknown> {
  return {
    ...(row.sent_to_customer_at === null ? { sent_to_customer_at: atIso, sent_to_customer_by: actor } : {}),
    sent_channels: row.sent_channels.includes(channel) ? row.sent_channels : [...row.sent_channels, channel],
    ...(row.released_to_customer_at === null ? { released_to_customer_at: atIso } : {}),
    // `updated_at` is left alone: it is the clock of the row's last status change.
  };
}
