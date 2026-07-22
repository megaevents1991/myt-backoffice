import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { guardCronRoute } from "@/lib/auth/guards";

/**
 * Weekly health check for the Meta product-catalog feed the MAIN app serves.
 * Meta fetches that URL hourly — a broken/empty feed silently kills the whole
 * catalog, so this cron fetches it like Meta would (following the 307 to the
 * storage snapshot) and emails an alert ONLY when something is wrong:
 * non-200, zero items, no XML declaration, or a stale `<!-- generated -->`
 * stamp (publishMetaFeed runs every 30 min — anything hours old means the
 * publish pipeline is broken, like the 2026-07-20→22 freeze where the cron
 * silently republished its own snapshot). No content-type check: the
 * snapshot is deliberately served as application/octet-stream so Cloudflare
 * won't Brotli-compress it. Schedule lives in vercel.json (Mondays 06:00 UTC).
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
      const body = await res.text();
      itemCount = (body.match(/<item>/g) ?? []).length;
      if (itemCount === 0) problems.push("Feed contains 0 items");
      if (!body.startsWith("<?xml")) problems.push("Body does not start with an XML declaration");

      const STALE_AFTER_MS = 3 * 60 * 60 * 1000; // publish cron runs every 30 min
      const stamp = body.match(/<!-- generated (\S+) -->/)?.[1];
      const stampMs = stamp ? Date.parse(stamp) : NaN;
      if (isNaN(stampMs)) {
        problems.push("No parseable <!-- generated --> stamp — snapshot predates the freshness stamp or publish pipeline is broken");
      } else if (Date.now() - stampMs > STALE_AFTER_MS) {
        problems.push(`Feed is STALE — generated ${stamp}, publish cron should refresh it every 30 min`);
      }
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
