export const runtime = "nodejs";

import { supabase } from "@/lib/supabase-server";
import nodemailer from "nodemailer";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";

interface Reservation {
  main_contact_first_name: string;
  event_order_info: any;
  created_at: string;
  accounting_number: number;
}

interface PromoterData {
  promoterName: string;
  commission: number;
  email: string;
  reservations: Reservation[];
  purchaseDate: string;
}

interface PromoterReportProps {
  promoterName: string;
  totalReservations: number;
  totalTickets: number;
  reservations: Reservation[];
  commission: number;
  purchaseDate: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (
    url.searchParams.get("key") !== `monthlyAlonSecret` ||
    !process.env.NEXT_SECRET_EMAIL_SERVER_USER ||
    !process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  console.log("Cron job started!");

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

    for (const [trackingCode, promoterReservations] of Object.entries(
      reports,
    )) {
      console.log(`Generating report for tracking code: ${trackingCode}`);

      // Calculate the date exactly 29 days ago
      const today = new Date();
      const twentyNineDaysAgo = new Date(today);
      twentyNineDaysAgo.setDate(today.getDate() - 29);
      const target_date = twentyNineDaysAgo.toISOString().split("T")[0]; // Format as YYYY-MM-DD

      const { data: promoterData, error: partnerError } = (await supabase
        .from("partners")
        .select("*")
        .eq("partner_tracking_code", trackingCode)
        .eq("created_at", target_date)
        .single()) as { data: any | null; error: any };

      if (!promoterData) {
        console.log(
          `Skipping ${trackingCode}, as it's not exactly 29 days since creation`,
        );
        continue;
      }
      if (partnerError) {
        console.error(
          `Error fetching promoter data for tracking code ${trackingCode}:`,
          partnerError,
        );
        continue;
      }
      if (promoterData.email != "support@mega-events.co.il") {
        console.log(
          `skipping ${trackingCode}, as this is workaround for purchased user`,
        );
        continue;
      }

      await sendPost28DaysReportEmail({
        promoterName: promoterData?.name_hebrew,
        commission: promoterData?.commission,
        email: promoterData.email,
        reservations: promoterReservations as Reservation[],
        purchaseDate: promoterData.created_at,
      } as PromoterData);
    }
  } catch (error) {
    console.error("Error generating monthly reports:", error);
  }

  return new Response("Cron job executed");
}

const generateEmailHtml = ({
  promoterName,
  totalReservations,
  totalTickets,
  commission,
  reservations,
  purchaseDate,
}: PromoterReportProps) => {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monthly Promoter Reservations Report for: ${promoterName} - Initial purchase ${purchaseDate}</title>
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
            <h1 dir="rtl">דו"ח הזמנות מסכם של 28 יום</h1>
            <p>${promoterName}</p>
          </div>
          
          <p dir="rtl" class="rtl-text">היי אלון,</p>
          
          <p dir="rtl" class="rtl-text">ללקוח הר"מ היו חברים שרכשו, עלינו לתת לו החזר עפ"י המבצע</p>
          
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
          
          <p dir="rtl" class="rtl-text">בברכה,<br>
          Mega Events</p>
          
          <div class="footer">
            <p>Mega-Events.co.il - All rights reserved.</p>
            <p>תל אביב, ישראל</p>
            <p>
              <a href="mailto:alon@mega-events.co.il">alon@mega-events.co.il</a> | 
              <a href="https://www.mega-events.co.il">www.mega-events.co.il</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
};

async function sendPost28DaysReportEmail(promoterData: PromoterData) {
  const totalReservations = promoterData.reservations.length;
  const totalTickets = promoterData.reservations.reduce((sum, reservation) => {
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
    promoterName: promoterData.promoterName,
    totalReservations,
    totalTickets,
    commission: promoterData.commission,
    reservations: promoterData.reservations,
    purchaseDate: promoterData.purchaseDate,
  });

  const transporter = await nodemailer.createTransport({
    host: "smtp.zeptomail.com",
    port: 587,
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  });

  try {
    await transporter.verify();
    await transporter.sendMail({
      // @todo: complete this route and logic
      from: "alon@mega-events.co.il",
      to: "alon@megatr.co.il",
      cc: "alon@mega-events.co.il",
      subject: `Refund to Promoter - Activity Report`,
      html: emailHtmlForPartner,
    });
  } catch (error) {
    console.error("Error: ", error);
  }
  console.log(`Email sent to ${promoterData.promoterName}`);
  return true;
}
