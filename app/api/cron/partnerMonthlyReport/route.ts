export const runtime = "nodejs";

import { supabase } from "@/lib/supabase-server";
import nodemailer from "nodemailer";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import { guardCronRoute } from "@/lib/auth/guards";

interface Reservation {
  main_contact_first_name: string;
  event_order_info: any;
  created_at: string;
  accounting_number: number;
}

interface PartnerData {
  partnerName: string;
  commission: number;
  email: string;
  reservations: Reservation[];
  supplier_number?: number | null;
}

interface PartnerReportProps {
  partnerName: string;
  month: string;
  year: string;
  totalReservations: number;
  totalTickets: number;
  reservations: Reservation[];
  commission: number;
  supplier_number?: number | null;
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
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const firstDayOfMonth = new Date(
      previousMonth.getFullYear(),
      previousMonth.getMonth(),
      1,
    );
    const lastDayOfMonth = new Date(
      previousMonth.getFullYear(),
      previousMonth.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    const { data: reservations, error } = (await supabase
      .from("reservations")
      .select("*")
      .eq("status", "Paid")
      .not("aff_partner_tracking_code", "is", null) // Exclude null tracking codes
      .neq("aff_partner_tracking_code", "") // Also exclude empty string tracking codes
      .gte("created_at", firstDayOfMonth.toISOString()) // Greater than or equal to first day of month
      .lte("created_at", lastDayOfMonth.toISOString())) as {
      data: any[] | null;
      error: any;
    }; // Less than or equal to last day of month

    if (error) {
      console.error("Error fetching reservations:", error);
      return new Response("Error fetching reservations", { status: 500 });
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
        .select("*")
        .eq("partner_tracking_code", trackingCode)
        .single()) as { data: any | null; error: any };
      if (partnerError) {
        console.error(
          `Error fetching partner data for tracking code ${trackingCode}:`,
          partnerError,
        );
        continue;
      }
      if (!partnerData || partnerData.email === "support@mega-events.co.il") {
        console.log(
          `skipping ${trackingCode}, as this is workaround for purchased user`,
        );
        continue;
      }

      const result = await sendMonthlyReportEmail({
        partnerName: partnerData?.name_hebrew,
        commission: partnerData?.commission,
        email: partnerData.email,
        reservations: partnerReservations as Reservation[],
        supplier_number: partnerData?.supplier_number,
      } as PartnerData);

      if (result.ok) {
        sent.push({ partner: partnerData?.name_hebrew, email: partnerData.email });
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
  month,
  year,
  totalReservations,
  totalTickets,
  commission,
  reservations,
  supplier_number = null,
}: PartnerReportProps) => {
  if (supplier_number) {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monthly Partner Reservations Report - ${month} ${year}</title>
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
            <p>${month} ${year}</p>
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
              <span>${totalTickets * commission}</span>
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
                  const tickets = events.reduce(
                    (s, e) => s + (Number(e.number_of_ticket) || 0),
                    0,
                  );

                  return `
                <tr>
                  <td>${reservation.main_contact_first_name}</td>
                  <td>${eventName}</td>
                  <td>${eventLocation}</td>
                  <td>${tickets}</td>
                  <td>${formattedDate}</td>
                  <td>${tickets * commission}</td>
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
        <title>Monthly Partner Reservations Report - ${month} ${year}</title>
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
            <p>${month} ${year}</p>
          </div>
          
          <p dir="rtl" class="rtl-text">היי ${partnerName},</p>
          
          <p dir="rtl" class="rtl-text">תודה על שותפותך!
אנחנו שמחים לשתף אותך בדוח ההזמנות החודשי שלך עבור ${month} ${year}.</p>
          
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
              <span>${totalTickets * commission}</span>
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
                  const tickets = events.reduce(
                    (s, e) => s + (Number(e.number_of_ticket) || 0),
                    0,
                  );

                  return `
                <tr>
                  <td>${reservation.main_contact_first_name}</td>
                  <td>${eventName}</td>
                  <td>${eventLocation}</td>
                  <td>${tickets}</td>
                  <td>${formattedDate}</td>
                  <td>${tickets * commission}</td>
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
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1);

  const month = previousMonth.toLocaleString("default", { month: "long" });
  const year = previousMonth.getFullYear().toString();

  const totalReservations = partnerData.reservations.length;
  const totalTickets = partnerData.reservations.reduce((sum, reservation) => {
    const events = normalizeReservationEventOrderInfo(
      reservation.event_order_info,
    );
    const tickets = events.reduce(
      (s, e) => s + (Number(e.number_of_ticket) || 0),
      0,
    );
    return sum + tickets;
  }, 0);

  const emailHtmlForPartner = generateEmailHtml({
    partnerName: partnerData.partnerName,
    month,
    year,
    totalReservations,
    totalTickets,
    commission: partnerData.commission,
    reservations: partnerData.reservations,
  });

  const emailHtmlToOrly = generateEmailHtml({
    partnerName: partnerData.partnerName,
    month,
    year,
    totalReservations,
    totalTickets,
    reservations: partnerData.reservations,
    commission: partnerData.commission,
    supplier_number: partnerData.supplier_number,
  });

  try {
    await transporter.sendMail({
      from: "alon@mega-events.co.il",
      to: partnerData.email,
      subject: `Monthly Partner Activity Report - ${month} ${year}`,
      html: emailHtmlForPartner,
    });
    await transporter.sendMail({
      from: "alon@mega-events.co.il",
      to: "alon@megatr.co.il, office@megatr.co.il",
      subject: `Monthly Partner Report - ${month} ${year} - Supplier Number ${partnerData.supplier_number}`,
      html: emailHtmlToOrly,
    });
    console.log(`Email sent to ${partnerData.partnerName} - ${month} ${year}`);
    return { ok: true as const };
  } catch (error) {
    console.error(`Error sending to ${partnerData.partnerName}: `, error);
    return { ok: false as const, error: String(error) };
  }
}
