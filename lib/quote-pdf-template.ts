/**
 * Renders a self-contained RTL Hebrew HTML document for a partner quote,
 * which the render route (`app/api/quotes/[id]/pdf/route.ts`) feeds to
 * chromium's `page.setContent()` to produce the downloadable PDF.
 *
 * Styled in the main site's brand (forest `#0A1A14` / mint `#5BFF95`) - the
 * customer receiving this offer knows the site it points at.
 *
 * SECURITY: `quote`/`partner` fields originate from partner-submitted data
 * (see `lib/actions/quote-actions.ts` `createQuote`) and are rendered
 * server-side into raw HTML - every interpolated string MUST go through
 * `esc()`. Numbers are formatted here (server-side) rather than trusting
 * any client-supplied formatted string.
 */

export interface QuoteLineItemInput {
  label: string;
  qty: number;
  unit_price: number;
  /** Per-line "יבוצע ע"י" - the agent's name on rows they added, "מגה
   *  איבנטס" on the package row (doc 2026-08-30 item 5). Optional: quotes
   *  from before the stamp render without the line. */
  performed_by?: string | null;
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
  /**
   * Who is handling this offer, for the customer's eyes: the agent who built
   * it, or "מגה איבנטס" when it came from us (doc 2026-08-30, item 5 -
   * "שיהיה רשום ללקוח יבוצע ע"י שם הסוכן"). Omitted → the chip is not shown.
   */
  handled_by?: string | null;
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
    (sum, item) =>
      sum + (Number(item.qty) || 0) * (Number(item.unit_price) || 0),
    0,
  );
  const grandTotal =
    typeof quote.total === "number" && Number.isFinite(quote.total)
      ? quote.total
      : computedTotal;

  const rowsHtml = lineItems
    .map((item, i) => {
      const qty = Number.isFinite(item.qty) ? item.qty : 0;
      const unitPrice = Number.isFinite(item.unit_price) ? item.unit_price : 0;
      const lineTotal = qty * unitPrice;
      // The fulfiller sits under the label, not in its own column - the
      // 4-column grid stays intact for old quotes without the stamp.
      const performedBy = item.performed_by
        ? `<div class="performed-by">יבוצע ע"י ${esc(item.performed_by)}</div>`
        : "";
      return `
        <tr class="${i % 2 === 0 ? "even" : "odd"}">
          <td class="item-label">${esc(item.label)}${performedBy}</td>
          <td class="num">${esc(String(qty))}</td>
          <td class="num">${esc(fmtUSD(unitPrice))}</td>
          <td class="num strong">${esc(fmtUSD(lineTotal))}</td>
        </tr>`;
    })
    .join("");

  // http(s) only - the HTML is rendered by server-side Chromium, so any other
  // scheme (file:, data:, internal targets) is an SSRF vector.
  const safeLogoUrl =
    partner.logo_url && /^https?:\/\//i.test(partner.logo_url.trim())
      ? partner.logo_url.trim()
      : null;
  const logoHtml = safeLogoUrl
    ? `<div class="logo-card"><img class="logo" src="${esc(safeLogoUrl)}" alt="" onerror="this.parentNode.style.display='none'"></div>`
    : "";

  const contactParts = [partner.phone, partner.email].filter(
    (v): v is string => !!v,
  );
  const contactHtml = contactParts
    .map((v) => esc(v))
    .join("&nbsp;&nbsp;·&nbsp;&nbsp;");

  const notesHtml = quote.notes
    ? `
      <div class="notes">
        <div class="notes-label">פרטי ההצעה</div>
        <div class="notes-body">${esc(quote.notes)}</div>
      </div>`
    : "";

  // href AND visible text both escaped; the action already restricted the URL
  // to our own site carrying the agent's code.
  const paymentHtml = quote.payment_link
    ? `
      <div class="pay-cta">
        <a class="pay-btn" href="${esc(quote.payment_link)}">להרשמה ותשלום מאובטח באתר&nbsp;›</a>
        <div class="pay-hint">הקישור פותח את החבילה בדיוק כפי שהורכבה עבורכם</div>
        <div class="pay-url">${esc(quote.payment_link)}</div>
      </div>`
    : "";

  const validityHtml = quote.valid_until
    ? `<div class="chip"><div class="chip-label">בתוקף עד</div><div class="chip-value">${esc(fmtDate(quote.valid_until))}</div></div>`
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<title>הצעת מחיר #${esc(String(quote.id))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Assistant', Arial, 'Noto Sans Hebrew', sans-serif;
    color: #17211c;
    background: #ffffff;
    font-size: 13px;
    line-height: 1.55;
  }

  .band {
    background: #0A1A14;
    color: #ffffff;
    border-radius: 14px;
    padding: 22px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  .band-right { min-width: 0; }
  .eyebrow {
    display: inline-block;
    color: #5BFF95;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.08em;
    margin-bottom: 6px;
  }
  .band h1 { font-size: 24px; font-weight: 800; line-height: 1.25; }
  .band .partner-line { margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.85); }
  .band .partner-line b { color: #ffffff; }
  .logo-card {
    background: #ffffff;
    border-radius: 12px;
    padding: 10px 14px;
    flex-shrink: 0;
  }
  .logo { max-height: 56px; max-width: 170px; object-fit: contain; display: block; }

  .chips { display: flex; gap: 10px; margin: 16px 0 20px; }
  .chip {
    flex: 1;
    border: 1px solid #e3e9e5;
    border-radius: 10px;
    padding: 10px 14px;
    background: #fafcfa;
  }
  .chip-label { font-size: 10px; color: #6b7671; font-weight: 600; letter-spacing: 0.04em; }
  .chip-value { font-size: 14px; font-weight: 700; margin-top: 2px; }

  .items { border: 1px solid #e3e9e5; border-radius: 12px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #eefcf3;
    color: #0A1A14;
    padding: 11px 14px;
    text-align: right;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    border-bottom: 1px solid #d9efe1;
  }
  thead th.num { text-align: left; }
  .performed-by { margin-top: 2px; font-size: 10px; color: #6b7671; }
  tbody td { padding: 11px 14px; font-size: 13px; border-bottom: 1px solid #eef2ef; }
  tbody tr.odd td { background: #fafcfa; }
  tbody tr:last-child td { border-bottom: none; }
  td.num { text-align: left; direction: ltr; white-space: nowrap; }
  td.strong { font-weight: 700; }
  .item-label { font-weight: 600; }

  .total-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0A1A14;
    color: #ffffff;
    border-radius: 0 0 11px 11px;
    padding: 13px 14px;
  }
  .total-row .label { font-size: 13px; font-weight: 600; }
  .total-row .value { font-size: 20px; font-weight: 800; color: #5BFF95; direction: ltr; }

  .pay-cta { margin: 26px 0 6px; text-align: center; }
  .pay-btn {
    display: inline-block;
    padding: 13px 34px;
    border-radius: 999px;
    background: #5BFF95;
    color: #0A1A14;
    font-weight: 800;
    font-size: 15px;
    text-decoration: none;
  }
  .pay-hint { margin-top: 8px; font-size: 11px; color: #6b7671; }
  .pay-url { margin-top: 4px; font-size: 9px; color: #9aa39e; direction: ltr; word-break: break-all; }

  .notes {
    margin-top: 20px;
    padding: 13px 16px;
    background: #fafcfa;
    border: 1px solid #e3e9e5;
    border-right: 3px solid #5BFF95;
    border-radius: 10px;
  }
  .notes-label { font-weight: 700; font-size: 11px; color: #0A1A14; margin-bottom: 5px; letter-spacing: 0.04em; }
  .notes-body { white-space: pre-wrap; font-size: 12px; color: #33403a; }

  .footer {
    margin-top: 30px;
    padding-top: 12px;
    border-top: 1px solid #e3e9e5;
    font-size: 10px;
    color: #9aa39e;
    text-align: center;
    line-height: 1.7;
  }
  .footer b { color: #6b7671; }
</style>
</head>
<body>
  <div class="band">
    <div class="band-right">
      <span class="eyebrow">הצעת מחיר · ${esc(String(quote.id))}</span>
      <h1>${esc(quote.title || "הצעת מחיר")}</h1>
      <div class="partner-line">
        הוכן עבורכם על ידי <b>${esc(partner.name_hebrew || "")}</b>${
          contactHtml ? ` &nbsp;·&nbsp; ${contactHtml}` : ""
        }
      </div>
    </div>
    ${logoHtml}
  </div>

  <div class="chips">
    <div class="chip"><div class="chip-label">לקוח</div><div class="chip-value">${esc(quote.customer_name || "-")}</div></div>
    <div class="chip"><div class="chip-label">תאריך ההצעה</div><div class="chip-value">${esc(fmtDate(quote.created_at))}</div></div>
    ${
      quote.handled_by
        ? `<div class="chip"><div class="chip-label">בוצע ע"י</div><div class="chip-value">${esc(
            quote.handled_by,
          )}</div></div>`
        : ""
    }
    ${validityHtml}
  </div>

  <div class="items">
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
    </table>
    <div class="total-row">
      <div class="label">סה"כ לתשלום</div>
      <div class="value">${esc(fmtUSD(grandTotal))}</div>
    </div>
  </div>

  ${paymentHtml}
  ${notesHtml}

  <div class="footer">
    ${partner.name_hebrew ? `<b>${esc(partner.name_hebrew)}</b>${contactHtml ? ` · ${contactHtml}` : ""}<br>` : ""}
    הצעה זו אינה מהווה התחייבות. המחירים בדולר ארה"ב וכפופים לזמינות בעת ההזמנה.
  </div>
</body>
</html>`;
}
