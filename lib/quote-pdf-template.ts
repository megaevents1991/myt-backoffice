/**
 * Renders a self-contained RTL Hebrew HTML document for a partner quote,
 * which the render route (`app/api/quotes/[id]/pdf/route.ts`) feeds to
 * chromium's `page.setContent()` to produce the downloadable PDF.
 *
 * SECURITY: `quote`/`partner` fields originate from partner-submitted data
 * (see `lib/actions/quote-actions.ts` `createQuote`) and are rendered
 * server-side into raw HTML — every interpolated string MUST go through
 * `esc()`. Numbers are formatted here (server-side) rather than trusting
 * any client-supplied formatted string.
 */

export interface QuoteLineItemInput {
  label: string;
  qty: number;
  unit_price: number;
}

export interface QuoteForPdf {
  id: number;
  created_at: string;
  customer_name: string | null;
  title: string | null;
  line_items: QuoteLineItemInput[];
  total: number | null;
  notes: string | null;
  valid_until: string | null;
  /** Partner-coded site order link → the "register & pay" CTA; null = info-only. */
  payment_link?: string | null;
}

export interface PartnerBrandingForPdf {
  name_hebrew: string | null;
  logo_url: string | null;
  email: string | null;
  phone: string | null;
}

/** Escapes `&<>"'` so untrusted strings are safe to interpolate into HTML text/attributes. */
function esc(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

/** USD currency formatting, always computed server-side (never trust a client-formatted string). */
function fmtUSD(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(safe);
}

/** DD/MM/YYYY, tolerant of both `date` columns (YYYY-MM-DD) and `timestamptz` strings. */
function fmtDate(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

export function renderQuoteHtml(args: {
  quote: QuoteForPdf;
  partner: PartnerBrandingForPdf;
}): string {
  const { quote, partner } = args;

  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const computedTotal = lineItems.reduce(
    (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unit_price) || 0),
    0,
  );
  const grandTotal = typeof quote.total === "number" && Number.isFinite(quote.total)
    ? quote.total
    : computedTotal;

  const rowsHtml = lineItems
    .map((item) => {
      const qty = Number.isFinite(item.qty) ? item.qty : 0;
      const unitPrice = Number.isFinite(item.unit_price) ? item.unit_price : 0;
      const lineTotal = qty * unitPrice;
      return `
        <tr>
          <td>${esc(item.label)}</td>
          <td class="num">${esc(String(qty))}</td>
          <td class="num">${esc(fmtUSD(unitPrice))}</td>
          <td class="num">${esc(fmtUSD(lineTotal))}</td>
        </tr>`;
    })
    .join("");

  // http(s) only — the HTML is rendered by server-side Chromium, so any other
  // scheme (file:, data:, internal targets) is an SSRF vector.
  const safeLogoUrl =
    partner.logo_url && /^https?:\/\//i.test(partner.logo_url.trim())
      ? partner.logo_url.trim()
      : null;
  const logoHtml = safeLogoUrl
    ? `<img class="logo" src="${esc(safeLogoUrl)}" alt="" onerror="this.style.display='none'">`
    : "";

  const contactParts = [partner.phone, partner.email].filter((v): v is string => !!v);
  const contactHtml = contactParts.map((v) => esc(v)).join(" &middot; ");

  const titleHtml = quote.title
    ? `<div class="quote-subtitle">${esc(quote.title)}</div>`
    : "";

  const notesHtml = quote.notes
    ? `
      <div class="notes">
        <div class="notes-label">הערות</div>
        <div class="notes-body">${esc(quote.notes)}</div>
      </div>`
    : "";

  // href AND visible text both escaped; the action already restricted the URL
  // to our own site carrying the agent's code.
  const paymentHtml = quote.payment_link
    ? `
      <div class="pay-cta">
        <a class="pay-btn" href="${esc(quote.payment_link)}">להרשמה ותשלום מאובטח באתר ›</a>
        <div class="pay-url">${esc(quote.payment_link)}</div>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<title>הצעת מחיר #${esc(String(quote.id))}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', Arial, 'Noto Sans Hebrew', sans-serif;
    color: #1f2430;
    background: #ffffff;
    font-size: 14px;
    line-height: 1.5;
  }
  .page { padding: 8mm 4mm; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1f2430;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  .logo { max-height: 64px; max-width: 200px; object-fit: contain; }
  .partner-info { text-align: left; }
  .partner-name { font-size: 18px; font-weight: 700; }
  .partner-contact { font-size: 12px; color: #555b66; margin-top: 4px; }
  h1.title { font-size: 24px; margin: 0 0 4px; }
  .quote-subtitle { font-size: 15px; color: #444a55; margin-bottom: 16px; }
  .meta { margin-bottom: 20px; }
  .meta-row { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eceef1; }
  .meta-label { font-weight: 600; min-width: 100px; color: #555b66; }
  .meta-value { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th {
    background: #1f2430;
    color: #ffffff;
    padding: 10px 8px;
    text-align: right;
    font-size: 13px;
  }
  thead th.num, td.num { text-align: left; }
  tbody td { padding: 8px; border-bottom: 1px solid #eceef1; font-size: 13px; }
  tfoot td { padding: 10px 8px; font-weight: 700; font-size: 15px; border-top: 2px solid #1f2430; }
  .pay-cta { margin: 24px 0 20px; text-align: center; }
  .pay-btn {
    display: inline-block; padding: 12px 28px; border-radius: 999px;
    background: #0A1A14; color: #5BFF95; font-weight: 700; font-size: 15px;
    text-decoration: none;
  }
  .pay-url { margin-top: 8px; font-size: 10px; color: #888e99; direction: ltr; word-break: break-all; }
  .notes { margin-bottom: 20px; padding: 10px 12px; background: #f7f8fa; border-radius: 6px; }
  .notes-label { font-weight: 600; margin-bottom: 4px; }
  .notes-body { white-space: pre-wrap; font-size: 13px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #eceef1; font-size: 11px; color: #888e99; text-align: center; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-wrap">${logoHtml}</div>
      <div class="partner-info">
        <div class="partner-name">${esc(partner.name_hebrew)}</div>
        <div class="partner-contact">${contactHtml}</div>
      </div>
    </div>

    <h1 class="title">הצעת מחיר #${esc(String(quote.id))}</h1>
    ${titleHtml}

    <div class="meta">
      <div class="meta-row">
        <div class="meta-label">תאריך</div>
        <div class="meta-value">${esc(fmtDate(quote.created_at))}</div>
      </div>
      <div class="meta-row">
        <div class="meta-label">לקוח</div>
        <div class="meta-value">${esc(quote.customer_name)}</div>
      </div>
      <div class="meta-row">
        <div class="meta-label">בתוקף עד</div>
        <div class="meta-value">${esc(fmtDate(quote.valid_until))}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>פריט</th>
          <th class="num">כמות</th>
          <th class="num">מחיר ליחידה</th>
          <th class="num">סה"כ</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">סה"כ לתשלום</td>
          <td class="num">${esc(fmtUSD(grandTotal))}</td>
        </tr>
      </tfoot>
    </table>

    ${paymentHtml}
    ${notesHtml}

    <div class="footer">הצעה זו אינה מהווה התחייבות. המחירים בדולר ארה"ב.</div>
  </div>
</body>
</html>`;
}
