export const runtime = 'nodejs';

import { supabase } from "@/lib/supabase-server";
import nodemailer from "nodemailer";

interface Reservation {
  main_contact_email: string
  event_order_info: {
    name : string,
    location_name :string,
    number_of_ticket: number
  }
  created_at: string
}

interface PartnerData {
  partnerName: string
  email: string
  reservations: Reservation[]
}

interface PartnerReportProps {
  partnerName: string
  month: string
  year: string
  totalReservations: number
  totalTickets: number
  reservations: Reservation[]
}

export async function GET(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  console.log('Cron job started!');

  try {
    // Get previous month bounds
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const firstDayOfMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 1);
    const lastDayOfMonth = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    
    const { data: reservations, error } = await supabase
      .from('reservations')
      .select('*')
      .eq('status', 'Paid')
      .not('aff_partner_tracking_code', 'is', null) // Exclude null tracking codes
      .neq('aff_partner_tracking_code', '') // Also exclude empty string tracking codes
      .gte('created_at', firstDayOfMonth.toISOString()) // Greater than or equal to first day of month
      .lte('created_at', lastDayOfMonth.toISOString()); // Less than or equal to last day of month

    if (error) {
      console.error('Error fetching reservations:', error);
      return;
    }

    const reports = reservations.reduce((acc, reservation) => {
      const trackingCode = reservation.aff_partner_tracking_code;
      if (!acc[trackingCode]) {
        acc[trackingCode] = [];
      }
      acc[trackingCode].push(reservation);
      return acc;
    }, {});

    for (const [trackingCode, reservations] of Object.entries(reports)) {
      // Implement the logic to generate and store the report for each tracking code
      console.log(`Generating report for tracking code: ${trackingCode}`);

      sendMonthlyReportEmail({
        partnerName: "Gilad",
        email: "gilad@mega-events.co.il",
        reservations: reservations as Reservation[],
      } as PartnerData);
    }
  } catch (error) {
    console.error('Error generating monthly reports:', error);
  }

  return new Response('Cron job executed');
}

const generateEmailHtml = ({
  partnerName,
  month,
  year,
  totalReservations,
  totalTickets,
  reservations,
}: PartnerReportProps) => {
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
          
          <p dir="rtl" class="rtl-text">תודה על שותפותכם!
אנחנו שמחים לשתף אתכם בדוח ההזמנות החודשי שלכם עבור ${month} ${year}.</p>
          
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
              </tr>
            </thead>
            <tbody>
              ${reservations
                .map(
                  (reservation) => {
                    // Format date as dd/mm/yyyy
                    const date = new Date(reservation.created_at);
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
                    
                    return `
                <tr>
                  <td>${reservation.main_contact_email}</td>
                  <td>${reservation.event_order_info.name}</td>
                  <td>${reservation.event_order_info.location_name}</td>
                  <td>${reservation.event_order_info.number_of_ticket}</td>
                  <td>${formattedDate}</td>
                </tr>
              `}
                )
                .join("")}
            </tbody>
          </table>
          
          <p dir="rtl" class="rtl-text">אנחנו מעריכים מאוד את השותפות אתכם, ורואים בכם חלק בלתי נפרד מההצלחה שלנו.
אנו מצפים להמשך שיתוף פעולה פורה ולעוד הישגים משותפים גם בחודש הקרוב.<br>
אם יש לכם שאלות או הבהרות בנוגע לדוח, אל תהססו לפנות לתום, אלון או אלי, אנו נשמח לעזור ולוודא שאתם מקבלים את כל התמיכה הדרושה להצלחתכם.
נשמח שתעבירו לנו חשבונית / חשבון עסקה ע"מ שנוכל לשלם לכם בהקדם.</p>
          
          <p dir="rtl" class="rtl-text">בברכה,<br>
          Mega Events</p>
          
          <div class="footer">
            <p>© ${year} Mega-Events.co.il - All rights reserved.</p>
            <p>תל אביב, ישראל</p>
            <p>
              <a href="mailto:alon@mega-events.co.il">alon@mega-events.co.il</a> | 
              <a href="https://www.mega-events.co.il">www.mega-events.co.il</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `
}

async function sendMonthlyReportEmail(partnerData: PartnerData) {
  // Create date information for the report
  const now = new Date()
  const month = now.toLocaleString("default", { month: "long" })
  const year = now.getFullYear().toString()

  // Calculate totals
  const totalReservations = partnerData.reservations.length
  const totalTickets = partnerData.reservations.reduce((sum, reservation) => sum + reservation.event_order_info.number_of_ticket, 0)

  // Generate the email HTML
  const emailHtml = generateEmailHtml({
    partnerName: partnerData.partnerName,
    month,
    year,
    totalReservations,
    totalTickets,
    reservations: partnerData.reservations,
  })

  // Configure nodemailer transporter
  // Note: In production, use environment variables for these values
  const transporter = nodemailer.createTransport({
    service: "Zoho",
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  });

  // Send email
  try {
    await transporter.verify();
    await transporter.sendMail({
      from: process.env.EMAIL_SERVER_USER,
      to: partnerData.email,
      subject: `Monthly Partner Activity Report - ${month} ${year}`,
      html: emailHtml,
    })
  }
  catch (error) {
    console.error("Error establishing SMTP connection:", error);
  }

  console.log(`Email sent to ${partnerData.partnerName} - ${month} ${year}`);
  return true;
}
