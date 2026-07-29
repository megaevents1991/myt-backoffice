export const runtime = "nodejs";

import { supabase } from "@/lib/supabase-server";
import nodemailer from "nodemailer";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import { guardCronRoute } from "@/lib/auth/guards";
import {
  PAID_STATUS,
  commissionForReservation,
  commissionForReservations,
  countReservationTickets,
  countTickets,
  type CommissionTerms,
} from "@/lib/partner-commission";

interface Reservation {
  main_contact_first_name: string;
  event_order_info: any;
  created_at: string;
  accounting_number: number;
  /** Both are needed to price a reservation — see lib/partner-commission.ts. */
  status: string;
  user_shown_price: number | null;
}

interface PartnerData {
  partnerName: string;
  terms: CommissionTerms;
  email: string;
  reservations: Reservation[];
  supplier_number?: number | null;
}

interface PartnerReportProps {
  partnerName: string;
  period: string;
  year: string;
  totalReservations: number;
  totalTickets: number;
  reservations: Reservation[];
  terms: CommissionTerms;
  supplier_number?: number | null;
}

/**
 * Reservations billed per run. Below PostgREST's 1000-row cap so a truncated
 * response is impossible; a full batch is reported rather than assumed away.
 */
const BILLING_BATCH_SIZE = 900;

/**
 * Stamp reservations as billed. Returns a reason string on failure, null on
 * success.
 *
 * `.in("id", [])` is a perfectly valid request that matches nothing and returns
 * no error, so an id list that came out empty or malformed would look like a
 * clean success and the same rows would be billed again every run. The count
 * is checked rather than trusted.
 */
async function markBilled(
  rows: { id: number }[],
  trackingCode: string,
): Promise<string | null> {
  const ids = rows.map((r) => r.id).filter((id) => typeof id === "number");
  if (ids.length !== rows.length) {
    return `expected ${rows.length} reservation ids for ${trackingCode}, resolved ${ids.length}`;
  }
  if (ids.length === 0) return null;

  const { error } = await supabase
    .from("reservations")
    .update({ billed_at: new Date().toISOString() })
    .in("id", ids);
  return error ? JSON.stringify(error) : null;
}

/** DD/MM/YYYY, matching the date column inside the report. */
function formatDay(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** The span the report actually covers, e.g. "28/07/2026 – 30/08/2026". */
function formatPeriod(first: string | undefined, last: string | undefined): string {
  const from = formatDay(first);
  const to = formatDay(last);
  if (!from && !to) return "";
  if (!from || from === to) return to || from;
  return `${from} – ${to}`;
}

const transporter = nodemailer.createTransport({
  host: "smtp.zeptomail.com",
  port: 587,
  auth: {
    user: process.env.NEXT_SECRET_EMAIL_SERVER_USER,
    pass: process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD,
  },
});

export async function GET(req: Request) {
  const denied = await guardCronRoute(req);
  if (denied) return denied;
  if (
    !process.env.NEXT_SECRET_EMAIL_SERVER_USER ||
    !process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD
  ) {
    return new Response("Email server not configured", { status: 500 });
  }
  console.log("Cron job started!");

  // Fail loud if SMTP is unreachable BEFORE looping partners, so a creds/host
  // problem surfaces in the response instead of silently emailing no one.
  try {
    await transporter.verify();
  } catch (verifyError) {
    console.error("SMTP verify failed — aborting, no mail sent:", verifyError);
    return Response.json(
      { ok: false, stage: "smtp_verify", error: String(verifyError) },
      { status: 502 },
    );
  }

  // Per-partner outcomes — returned in the response AND mailed to ops so a
  // partial/total failure can never pass unnoticed again.
  const sent: { partner: string; email: string }[] = [];
  const failed: { partner: string; email: string; error: string }[] = [];

  try {
    // Bill on STATE, not on a date window.
    //
    // This used to select reservations created in the previous calendar month
    // that are Paid now. A reservation created on 28 July and paid on 3 August
    // matched neither run — the August run wanted July-created rows but it
    // wasn't paid yet, the September run wanted August-created rows — so it was
    // never billed and nothing reported the gap.
    //
    // Anything paid and not yet stamped is owed, however long ago it was
    // created. `billed_at` was backfilled to the 2026-07-01 settlement cutoff,
    // so this cannot re-pay history.
    const { data: reservations, error } = (await supabase
      .from("reservations")
      .select("*")
      .eq("status", PAID_STATUS)
      .is("billed_at", null)
      .not("aff_partner_tracking_code", "is", null) // Exclude null tracking codes
      .neq("aff_partner_tracking_code", "")
      // Oldest first, so if the batch ever fills, the money that has been
      // waiting longest goes out rather than an arbitrary slice.
      .order("created_at", { ascending: true })
      .limit(BILLING_BATCH_SIZE)) as {
      data: any[] | null;
      error: any;
    };

    if (error) {
      console.error("Error fetching reservations:", error);
      return new Response("Error fetching reservations", { status: 500 });
    }

    // PostgREST truncates silently at max_rows. Without an explicit cap and
    // this check, a backlog would quietly push billable reservations out of an
    // unordered result and partners would stop being paid on a green run.
    if (reservations && reservations.length >= BILLING_BATCH_SIZE) {
      const message = `Hit the ${BILLING_BATCH_SIZE}-reservation billing cap — more are waiting. Re-run after this one to clear the rest.`;
      console.error(`partnerMonthlyReport: ${message}`);
      failed.push({ partner: "(batch)", email: "-", error: message });
    }

    if (!reservations || reservations.length === 0) {
      console.log("No reservations found");
      return new Response("No reservations found", { status: 200 });
    }

    const reports = reservations.reduce(
      (acc, reservation) => {
        const trackingCode = reservation.aff_partner_tracking_code as string;
        if (!acc[trackingCode]) {
          acc[trackingCode] = [];
        }
        acc[trackingCode].push(reservation);
        return acc;
      },
      {} as Record<string, typeof reservations>,
    );

    for (const [trackingCode, partnerReservations] of Object.entries(reports)) {
      console.log(`Generating report for tracking code: ${trackingCode}`);

      const { data: partnerData, error: partnerError } = (await supabase
        .from("partners")
        .select("name_hebrew,email,commission,commission_type,supplier_number,is_active")
        .eq("partner_tracking_code", trackingCode)
        // maybeSingle, not single: an orphan tracking code is a missing row,
        // not an error. With .single() it raised PGRST116 and hit the `continue`
        // below without ever stamping, so those rows were re-selected on every
        // run for ever and ate into the batch cap.
        .maybeSingle()) as { data: any | null; error: any };
      if (partnerError) {
        console.error(
          `Error fetching partner data for tracking code ${trackingCode}:`,
          partnerError,
        );
        continue;
      }
      // These are never payable, so stamp them. Skipping without stamping used
      // to be harmless — the old date window moved past them after a month. Now
      // they would be re-selected on every run, for ever, until the permanent
      // residue fills the batch and crowds out reservations that ARE owed.
      if (!partnerData || partnerData.email === "support@mega-events.co.il") {
        console.log(
          `skipping ${trackingCode}, as this is workaround for purchased user`,
        );
        const skipError = await markBilled(
          partnerReservations as { id: number }[],
          trackingCode,
        );
        if (skipError) {
          // Nobody was mailed, so this isn't a payment problem — but leaving
          // them unstamped brings the permanent-residue issue back.
          console.error(
            `partnerMonthlyReport: could not stamp non-payable rows for ${trackingCode}:`,
            skipError,
          );
        }
        continue;
      }
      // An inactive partner is deliberately left unbilled: reactivate them and
      // the money is still owed. Bounded by the number of inactive partners.
      if (!partnerData.is_active) {
        console.log(`skipping ${trackingCode}, partner is inactive`);
        continue;
      }

      const result = await sendMonthlyReportEmail({
        partnerName: partnerData?.name_hebrew,
        terms: {
          type: partnerData?.commission_type ?? "fixed_per_ticket",
          rate: partnerData?.commission ?? null,
        },
        email: partnerData.email,
        reservations: partnerReservations as Reservation[],
        supplier_number: partnerData?.supplier_number,
      } as PartnerData);

      if (result.ok) {
        // Stamp only after the report actually went out. Marking them billed
        // first would mean a mail failure silently wrote off the money — the
        // rows would never be picked up again. The cost of this order is a
        // possible duplicate report, which someone will notice; the other way
        // round, nobody ever does.
        const stampError = await markBilled(
          partnerReservations as { id: number }[],
          trackingCode,
        );
        if (stampError) {
          // The partner was paid but the rows still look unbilled, so the next
          // run would pay again. Loud, and reported to ops as a failure.
          console.error(
            `partnerMonthlyReport: ${trackingCode} was emailed but billed_at was not set — the next run will double-bill:`,
            stampError,
          );
          failed.push({
            partner: partnerData?.name_hebrew,
            email: partnerData.email,
            error: `REPORT SENT BUT NOT MARKED BILLED — will double-bill: ${stampError}`,
          });
        } else {
          sent.push({ partner: partnerData?.name_hebrew, email: partnerData.email });
        }
      } else {
        failed.push({
          partner: partnerData?.name_hebrew,
          email: partnerData.email,
          error: result.error ?? "unknown",
        });
      }
    }
  } catch (error) {
    console.error("Error generating monthly reports:", error);
    await sendOpsSummary(sent, failed, String(error)).catch(() => {});
    return Response.json(
      { ok: false, stage: "loop", error: String(error), sent, failed },
      { status: 500 },
    );
  }

  // Always tell ops what happened — counts + the exact partners that failed.
  await sendOpsSummary(sent, failed).catch(() => {});

  console.log(`Cron done. sent=${sent.length} failed=${failed.length}`);
  return Response.json({
    ok: failed.length === 0,
    sentCount: sent.length,
    failedCount: failed.length,
    sent,
    failed,
  });
}

// Emails alon/office a run summary so a silent failure (no mail to anyone, or
// a few partners erroring) is always visible the morning of the 1st.
async function sendOpsSummary(
  sent: { partner: string; email: string }[],
  failed: { partner: string; email: string; error: string }[],
  fatalError?: string,
) {
  const rows = (
    list: { partner: string; email: string; error?: string }[],
  ) =>
    list
      .map(
        (r) =>
          `<tr><td>${r.partner}</td><td>${r.email}</td><td>${r.error ?? "—"}</td></tr>`,
      )
      .join("") || `<tr><td colspan="3">none</td></tr>`;

  const html = `
    <h2>Partner Monthly Report — run summary</h2>
    ${fatalError ? `<p style="color:#c00"><b>FATAL:</b> ${fatalError}</p>` : ""}
    <p>Sent: <b>${sent.length}</b> &nbsp; Failed: <b>${failed.length}</b></p>
    <h3>Sent</h3>
    <table border="1" cellpadding="6"><tr><th>Partner</th><th>Email</th><th></th></tr>${rows(sent)}</table>
    <h3>Failed</h3>
    <table border="1" cellpadding="6"><tr><th>Partner</th><th>Email</th><th>Error</th></tr>${rows(failed)}</table>
  `;

  await transporter.sendMail({
    from: "alon@mega-events.co.il",
    to: "alon@megatr.co.il, office@megatr.co.il",
    subject: `Partner Monthly Report — sent ${sent.length}, failed ${failed.length}${fatalError ? " (FATAL)" : ""}`,
    html,
  });
}

const generateEmailHtml = ({
  partnerName,
  period,
  year,
  totalReservations,
  totalTickets,
  terms,
  reservations,
  supplier_number = null,
}: PartnerReportProps) => {
  // Percentage commission divides, so raw sums render as 133.51999999999998.
  // This is an invoice — always two decimals.
  const money = (amount: number) => amount.toFixed(2);
  // One total, computed the same way the backoffice and the portal compute it.
  const totalCommission = money(commissionForReservations(reservations, terms));
  if (supplier_number) {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monthly Partner Reservations Report - ${period}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f9f9f9;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 1px solid #eaeaea;
          }
          .logo {
            max-width: 150px;
            height: auto;
          }
          h1 {
            color: #2c3e50;
            font-size: 24px;
            margin: 0;
          }
          h2 {
            color: #2c3e50;
            font-size: 20px;
            margin: 20px 0 10px;
          }
          .summary {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .summary-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
          }
          .summary-label {
            font-weight: bold;
          }
          .rtl-text {
            direction: rtl;
            text-align: right;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #eaeaea;
          }
          th {
            background-color: #f1f1f1;
            font-weight: bold;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .footer {
            text-align: center;
            padding: 20px 0;
            font-size: 12px;
            color: #777;
            border-top: 1px solid #eaeaea;
          }
          .highlight {
            color: #e74c3c;
            font-weight: bold;
          }
          @media only screen and (max-width: 600px) {
            .container {
              width: 100%;
              padding: 10px;
            }
            table {
              font-size: 14px;
            }
            th, td {
              padding: 8px 5px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 dir="rtl"> דו"ח הזמנות חודשי לפרטנר ${partnerName} - מספר ספק ${supplier_number}</h1>
            <p>${period}</p>
          </div>         
          <div class="summary">
            <h2>Monthly Summary</h2>
            <div class="summary-item">
              <span class="summary-label">Total Reservations:</span>
              <span>${totalReservations}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Total Tickets Sold:</span>
              <span>${totalTickets}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Total Amount (USD):</span>
              <span>${totalCommission}</span>
            </div>
          </div>

          <p dir="rtl" class="rtl-text">המשווק ישלח חשבונית בימים הקרובים (עד ה- 5 לחודש) עבור הסכום האמור- מספרי הזמנות בגלבוע מופיעים כאן תחת Reservation Number</p>

          <h2>Detailed Reservation Report</h2>
          
          <table>
            <thead>
              <tr>
                <th>Client Email</th>
                <th>Event Name</th>
                <th>Event Location</th>
                <th>Tickets</th>
                <th>Date</th>
                <th>Commission ($)</th>
                <th>Reservation Number</th>
              </tr>
            </thead>
            <tbody>
              ${reservations
                .map((reservation) => {
                  const date = new Date(reservation.created_at);
                  const formattedDate = `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getFullYear()}`;

                  const events = normalizeReservationEventOrderInfo(
                    reservation.event_order_info,
                  );
                  const eventName =
                    events
                      .map((e) => e.name)
                      .filter(Boolean)
                      .join(" | ") || "Unknown";
                  const eventLocation =
                    events
                      .map((e) => e.location_name)
                      .filter(Boolean)
                      .join(" | ") || "Unknown";
                  const tickets = countReservationTickets(reservation);

                  return `
                <tr>
                  <td>${reservation.main_contact_first_name}</td>
                  <td>${eventName}</td>
                  <td>${eventLocation}</td>
                  <td>${tickets}</td>
                  <td>${formattedDate}</td>
                  <td>${money(commissionForReservation(reservation, terms))}</td>
                  <td>${reservation.accounting_number}</td>
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
                    
          <p dir="rtl" class="rtl-text">בברכה,<br>
          Mega Events</p>
          
          <div class="footer">
            <p>© ${year} Mega-Events.co.il - All rights reserved.</p>
            <p>תל אביב, ישראל</p>
            <p>
              <a href="mailto:office@megatr.co.il">office@megatr.co.il</a> | 
              <a href="https://www.mega-events.co.il">www.mega-events.co.il</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
  } else {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monthly Partner Reservations Report - ${period}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f9f9f9;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 1px solid #eaeaea;
          }
          .logo {
            max-width: 150px;
            height: auto;
          }
          h1 {
            color: #2c3e50;
            font-size: 24px;
            margin: 0;
          }
          h2 {
            color: #2c3e50;
            font-size: 20px;
            margin: 20px 0 10px;
          }
          .summary {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          .summary-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
          }
          .summary-label {
            font-weight: bold;
          }
          .rtl-text {
            direction: rtl;
            text-align: right;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #eaeaea;
          }
          th {
            background-color: #f1f1f1;
            font-weight: bold;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .footer {
            text-align: center;
            padding: 20px 0;
            font-size: 12px;
            color: #777;
            border-top: 1px solid #eaeaea;
          }
          .highlight {
            color: #e74c3c;
            font-weight: bold;
          }
          @media only screen and (max-width: 600px) {
            .container {
              width: 100%;
              padding: 10px;
            }
            table {
              font-size: 14px;
            }
            th, td {
              padding: 8px 5px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 dir="rtl">דו"ח הזמנות חודשי</h1>
            <p>${period}</p>
          </div>
          
          <p dir="rtl" class="rtl-text">היי ${partnerName},</p>
          
          <p dir="rtl" class="rtl-text">תודה על שותפותך!
אנחנו שמחים לשתף אותך בדוח ההזמנות שלך עבור ${period}.</p>
          
          <div class="summary">
            <h2>Monthly Summary</h2>
            <div class="summary-item">
              <span class="summary-label">Total Reservations:</span>
              <span>${totalReservations}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Total Tickets Sold:</span>
              <span>${totalTickets}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Total Amount (USD):</span>
              <span>${totalCommission}</span>
            </div>
          </div>
          
          <h2>Detailed Reservation Report</h2>
          
          <table>
            <thead>
              <tr>
                <th>Client Email</th>
                <th>Event Name</th>
                <th>Event Location</th>
                <th>Tickets</th>
                <th>Date</th>
                <th>Commission ($)</th>
                <th>Reservation Number</th>
              </tr>
            </thead>
            <tbody>
              ${reservations
                .map((reservation) => {
                  const date = new Date(reservation.created_at);
                  const formattedDate = `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getFullYear()}`;

                  const events = normalizeReservationEventOrderInfo(
                    reservation.event_order_info,
                  );
                  const eventName =
                    events
                      .map((e) => e.name)
                      .filter(Boolean)
                      .join(" | ") || "Unknown";
                  const eventLocation =
                    events
                      .map((e) => e.location_name)
                      .filter(Boolean)
                      .join(" | ") || "Unknown";
                  const tickets = countReservationTickets(reservation);

                  return `
                <tr>
                  <td>${reservation.main_contact_first_name}</td>
                  <td>${eventName}</td>
                  <td>${eventLocation}</td>
                  <td>${tickets}</td>
                  <td>${formattedDate}</td>
                  <td>${money(commissionForReservation(reservation, terms))}</td>
                  <td>${reservation.accounting_number || "TBD"}</td>
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
          
          <p dir="rtl" class="rtl-text">אנחנו מעריכים מאוד את השותפות עימך, ורואים בך חלק בלתי נפרד מההצלחה שלנו.
אנו מצפים להמשך שיתוף פעולה פורה ולעוד הישגים משותפים גם בחודש הקרוב.<br>
אם יש לך שאלות או הבהרות בנוגע אנו זמינים לכל שאלה.</p>


      <p dir="rtl" class="rtl-text">על מנת שנוכל לשלם לך בהקדם, נבקשך להעביר לנו חשבונית / דרישת תשלום עם הפירוט מעלה עד ה-5 לחודש למייל <a href="mailto:office@megatr.co.il">office@megatr.co.il</a></p>

          <p dir="rtl" class="rtl-text">בברכה,<br>
          Mega Events</p>
          
          <div class="footer">
            <p>© ${year} Mega-Events.co.il - All rights reserved.</p>
            <p>תל אביב, ישראל</p>
            <p>
              <a href="mailto:office@megatr.co.il">office@megatr.co.il</a> | 
              <a href="https://www.mega-events.co.il">www.mega-events.co.il</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
  }
};

async function sendMonthlyReportEmail(partnerData: PartnerData) {
  const now = new Date();

  // The period comes from the reservations, not from "last month". A report now
  // covers everything not previously billed, which after a mail failure, a
  // partner reactivation, or a late payment can span several months — labelling
  // that "July 2026" while the rows inside are dated August is a statement the
  // partner can see is false on the same page.
  const dates = partnerData.reservations
    .map((r) => r.created_at)
    .filter(Boolean)
    .sort();
  const period = formatPeriod(dates[0], dates[dates.length - 1]);
  const year = now.getFullYear().toString();

  const totalReservations = partnerData.reservations.length;
  const totalTickets = countTickets(partnerData.reservations);

  const emailHtmlForPartner = generateEmailHtml({
    partnerName: partnerData.partnerName,
    period,
    year,
    totalReservations,
    totalTickets,
    terms: partnerData.terms,
    reservations: partnerData.reservations,
  });

  const emailHtmlToOrly = generateEmailHtml({
    partnerName: partnerData.partnerName,
    period,
    year,
    totalReservations,
    totalTickets,
    reservations: partnerData.reservations,
    terms: partnerData.terms,
    supplier_number: partnerData.supplier_number,
  });

  try {
    await transporter.sendMail({
      from: "alon@mega-events.co.il",
      to: partnerData.email,
      subject: `Monthly Partner Activity Report - ${period}`,
      html: emailHtmlForPartner,
    });
    await transporter.sendMail({
      from: "alon@mega-events.co.il",
      to: "alon@megatr.co.il, office@megatr.co.il",
      subject: `Monthly Partner Report - ${period} - Supplier Number ${partnerData.supplier_number}`,
      html: emailHtmlToOrly,
    });
    console.log(`Email sent to ${partnerData.partnerName} - ${period}`);
    return { ok: true as const };
  } catch (error) {
    console.error(`Error sending to ${partnerData.partnerName}: `, error);
    return { ok: false as const, error: String(error) };
  }
}
