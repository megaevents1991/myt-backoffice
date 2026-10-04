import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { appOrigin, sendMail } from "@/lib/email";
import { revalidateMain } from "@/lib/revalidate-main";
import { runReadyPackageRefresh } from "@/lib/services/ready-package";

/**
 * Nightly (vercel.json, 03:10 UTC - after base-price-sync and price-light-ours have finished
 * their own flight and hotel searches): re-prices every ready package an event opens on
 * (`events.ready_package_mode` preview or live) - each party size is looked up again through
 * main's own search APIs - and rewrites the per-person price the site card shows. Least
 * recently refreshed first, inside one time budget; what it did not reach is first tomorrow.
 * A LIVE package whose default size can no longer be served is mailed to the admin address.
 *
 * `?dry_run=1` searches (that is what is being tested) but writes nothing and mails nothing.
 */
export const maxDuration = 300;

const BUDGET_MS = 250_000;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const pass = await runReadyPackageRefresh({ dryRun, budgetMs: BUDGET_MS });
    if (!dryRun && pass.refreshed.length > 0) await revalidateMain();

    const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
    if (!dryRun && to && pass.brokenLive.length > 0) {
      try {
        const rows = pass.brokenLive
          .map(
            (b) =>
              `<li><a href="${appOrigin()}/events/${b.eventId}#section-ready-package">${b.name}</a>` +
              `${b.note ? ` - ${b.note}` : ""}</li>`,
          )
          .join("");
        await sendMail({
          to,
          subject: `Ready package: ${pass.brokenLive.length} live package(s) cannot open`,
          html:
            `<p>These events are set to open on a ready package, and it can no longer be served. ` +
            `Until it is fixed their customers land on the regular flow.</p><ul>${rows}</ul>`,
        });
      } catch (mailError) {
        console.error("[ready-package-refresh] mail failed", mailError);
      }
    }

    console.log(
      `[ready-package-refresh] candidates=${pass.candidates} refreshed=${pass.refreshed.length} ` +
        `brokenLive=${pass.brokenLive.length} remaining=${pass.remaining}${dryRun ? " (dry-run)" : ""}`,
    );
    return NextResponse.json({
      dryRun,
      candidates: pass.candidates,
      remaining: pass.remaining,
      brokenLive: pass.brokenLive,
      refreshed: pass.refreshed.map((r) => ({
        packageId: r.packageId,
        eventId: r.eventId,
        status: r.status,
        sizes: r.sizes,
        pricePerPerson: r.pricePerPerson,
        note: r.note,
        cut: r.cut,
      })),
    });
  } catch (error) {
    console.error("[ready-package-refresh] fatal", error);
    return NextResponse.json({ error: "ready-package refresh failed" }, { status: 500 });
  }
}
