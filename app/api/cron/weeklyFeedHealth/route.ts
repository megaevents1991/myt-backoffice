import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { guardCronRoute } from "@/lib/auth/guards";

/**
 * Weekly health check for the Meta product-catalog feed the MAIN app serves.
 * Meta fetches that URL hourly — a broken/empty feed silently kills the whole
 * catalog, so this cron fetches it like Meta would and emails an alert ONLY
 * when something is wrong (non-200, wrong content type, or zero items).
 * Schedule lives in vercel.json (Mondays 06:00 UTC).
 */
export const maxDuration = 60;

const FEED_URL = "https://www.mega-events.co.il/feeds/meta-catalog.xml";
const ALERT_TO = "alon@megatr.co.il, office@megatr.co.il";

const transporter = nodemailer.createTransport({
  host: "smtp.zeptomail.com",
  port: 587,
  auth: {
    user: process.env.NEXT_SECRET_EMAIL_SERVER_USER,
    pass: process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD,
  },
});

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;

  const problems: string[] = [];
  let itemCount = 0;
  let status = 0;

  try {
    const res = await fetch(FEED_URL, { cache: "no-store" });
    status = res.status;
    if (!res.ok) {
      problems.push(`HTTP ${res.status} from feed URL`);
    } else {
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("xml")) {
        problems.push(`Unexpected Content-Type: "${contentType}" (expected application/xml)`);
      }
      const body = await res.text();
      itemCount = (body.match(/<item>/g) ?? []).length;
      if (itemCount === 0) problems.push("Feed contains 0 items");
      if (!body.startsWith("<?xml")) problems.push("Body does not start with an XML declaration");
    }
  } catch (e) {
    problems.push(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (problems.length > 0) {
    try {
      await transporter.sendMail({
        from: "alon@mega-events.co.il",
        to: ALERT_TO,
        subject: `⚠ Meta product feed UNHEALTHY (${problems.length} problem${problems.length > 1 ? "s" : ""})`,
        html: `
          <h2>Meta product feed health check failed</h2>
          <p>URL: <a href="${FEED_URL}">${FEED_URL}</a></p>
          <ul>${problems.map((p) => `<li>${p}</li>`).join("")}</ul>
          <p>Items found: ${itemCount} · HTTP status: ${status || "n/a"}</p>
          <p>Meta refetches hourly — until this is fixed the ad catalog may drop products.</p>
        `,
      });
    } catch (mailErr) {
      console.error("[feed-health] alert email failed:", mailErr);
    }
    console.error("[feed-health] UNHEALTHY:", JSON.stringify(problems));
    return NextResponse.json(
      { healthy: false, problems, itemCount, status },
      { status: 500 }
    );
  }

  console.log(`[feed-health] OK — ${itemCount} items`);
  return NextResponse.json({ healthy: true, itemCount, status });
}
