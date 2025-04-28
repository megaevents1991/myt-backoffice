export const runtime = 'nodejs';

import { supabase } from "@/lib/supabase-server";
import nodemailer from "nodemailer";

interface Reservation {
  main_contact_first_name: string
  event_order_info: {
    name : string,
    location_name :string,
    number_of_ticket: number
  }
  created_at: string
  accounting_number: number
}

interface PartnerData {
  partnerName: string
  commission: number
  email: string
  reservations: Reservation[]
  supplier_number?: number | null,
}

interface PartnerReportProps {
  partnerName: string
  month: string
  year: string
  totalReservations: number
  totalTickets: number
  reservations: Reservation[]
  commission: number
  supplier_number?: number | null
}

export async function GET(req: Request) {
  
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== `monthlyAlonSecret` || !process.env.NEXT_SECRET_EMAIL_SERVER_USER || !process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }
  console.log('Cron job started!');

  try {
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
      console.log(`Generating report for tracking code: ${trackingCode}`);

      const { data: partnerData, error: partnerError } = await supabase
        .from('partners')
        .select('*')
        .eq('partner_tracking_code', trackingCode)
        .single();
      if (partnerError) {
        console.error(`Error fetching partner data for tracking code ${trackingCode}:`, partnerError);
        continue;
      }

      await sendMonthlyReportEmail({
        partnerName: partnerData?.nameHebrew,
        commission: partnerData?.commission,
        email: partnerData.email,
        reservations: reservations as Reservation[],
        supplier_number: partnerData?.supplier_number
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
  commission,
  reservations,
  supplier_number = null
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
                .map(
                  (reservation) => {
                    const date = new Date(reservation.created_at);
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
                    
                    return `
                <tr>
                  <td>${reservation.main_contact_first_name}</td>
                  <td>${reservation.event_order_info.name}</td>
                  <td>${reservation.event_order_info.location_name}</td>
                  <td>${reservation.event_order_info.number_of_ticket}</td>
                  <td>${formattedDate}</td>
                  <td>${reservation.event_order_info.number_of_ticket * commission}</td>
                  <td>${reservation.accounting_number}</td>
                </tr>
              `}
                )
                .join("")}
            </tbody>
          </table>
                    
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
                .map(
                  (reservation) => {
                    const date = new Date(reservation.created_at);
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
                    
                    return `
                <tr>
                  <td>${reservation.main_contact_first_name}</td>
                  <td>${reservation.event_order_info.name}</td>
                  <td>${reservation.event_order_info.location_name}</td>
                  <td>${reservation.event_order_info.number_of_ticket}</td>
                  <td>${formattedDate}</td>
                  <td>${reservation.event_order_info.number_of_ticket * commission}</td>
                  <td>${reservation.accounting_number || "TBD"}</td>
                </tr>
              `}
                )
                .join("")}
            </tbody>
          </table>
          
          <p dir="rtl" class="rtl-text">אנחנו מעריכים מאוד את השותפות עימך, ורואים בך חלק בלתי נפרד מההצלחה שלנו.
אנו מצפים להמשך שיתוף פעולה פורה ולעוד הישגים משותפים גם בחודש הקרוב.<br>
אם יש לך שאלות או הבהרות בנוגע אנו זמינים לכל שאלה.</p>
  
            
            <p dir="rtl" class="rtl-text">על מנת שנוכל לשלם לך בהקדם, נבקשך להעביר לנו חשבונית / דרישת תשלום עם הפירוט מעלה.</p>
                      
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
}

async function sendMonthlyReportEmail(partnerData: PartnerData) {
  const now = new Date()
  const month = now.toLocaleString("default", { month: "long" })
  const year = now.getFullYear().toString()

  const totalReservations = partnerData.reservations.length
  const totalTickets = partnerData.reservations.reduce((sum, reservation) => sum + reservation.event_order_info.number_of_ticket, 0)

  const emailHtmlForPartner = generateEmailHtml({
    partnerName: partnerData.partnerName,
    month,
    year,
    totalReservations,
    totalTickets,
    commission: partnerData.commission,
    reservations: partnerData.reservations,
  })

  const emailHtmlToOrly = generateEmailHtml({
    partnerName: partnerData.partnerName,
    month,
    year,
    totalReservations,
    totalTickets,
    reservations: partnerData.reservations,
    commission: partnerData.commission,
    supplier_number: partnerData.supplier_number,
  })

  const transporter = await nodemailer.createTransport({
    service: "Zoho",
    auth: {
      user: process.env.NEXT_SECRET_EMAIL_SERVER_USER,
      pass: process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD,
    },
  });

  try {
    await transporter.verify();
    await transporter.sendMail({
      from: "gilad@mega-events.co.il",
      to: partnerData.email,
      subject: `Monthly Partner Activity Report - ${month} ${year}`,
      html: emailHtmlForPartner,
    });
    await transporter.sendMail({
      from: "gilad@mega-events.co.il",
      to: "alon@megatr.co.il",
      cc: "alon@mega-events.co.il",
      subject: `Monthly Partner Report - ${month} ${year} - Supplier Number ${partnerData.supplier_number}`,
      html: emailHtmlToOrly,
    })
  }
  catch (error) {
    console.error("Error: ", error);
  }
  console.log(`Email sent to ${partnerData.partnerName} - ${month} ${year}`);
  return true;
}
