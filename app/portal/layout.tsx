import { getSession } from "@/lib/auth/guards";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { PortalNav } from "./portal-nav";
import { SessionWatch } from "./session-watch";

// Assistant + Rubik now load once in the ROOT layout for the whole app; the
// .portal-theme block in globals.css aliases --font-portal-* onto them, so the
// portal renders in the exact same faces without loading them a second time.

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  const profile = isPartner ? await getPortalProfile() : null;
  // Credit is per-agent now (QA wave 2, 20.08) - every partner role may reach
  // it, gated only by whether the OFFICE has a credit agreement at all ("0 =
  // no agreement", now enforced in the nav too, not just the page). Coupons
  // stay open to every partner role regardless (affiliates lean on them for
  // their audience discount) - see PortalNav, which no longer gates them on
  // showCredit.
  const showCredit = isPartner && (profile?.credit_per_ticket ?? 0) > 0;
  const roleLabel =
    session?.role === "office_manager"
      ? "מנהל משרד"
      : session?.role === "agent"
        ? "סוכן"
        : "משפיען";

  return (
    <div
      dir="rtl"
      className="portal-theme min-h-screen"
    >
      {/* Idle-tab kick (QA item 10 upgrade, 20.08) - partner sessions only.
          Staff debugging the portal have no partner_code, so their own
          requirePartner check would read alive: false and kick them out of
          their own dashboard context. */}
      {isPartner && <SessionWatch />}
      {/* Forest brand band - same near-black green the main site headers use */}
      <header className="portal-hero text-primary-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {profile?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt=""
                className="h-11 w-11 rounded-full border-2 border-brand-mint/40 bg-white object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-mint font-display text-lg font-bold text-brand-forest">
                {(profile?.display_name || profile?.name_hebrew || "M").slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-lg font-bold">
                  {profile?.display_name || profile?.name_hebrew || "פורטל שותפים"}
                </span>
                {isPartner && (
                  <span className="rounded-full bg-brand-mint px-2 py-0.5 text-xs font-semibold text-brand-forest">
                    {roleLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-primary-foreground/60">
                <span>MYT - פורטל שותפים</span>
                {session?.partner_code && (
                  <span className="font-mono" dir="ltr">
                    {session.partner_code}
                  </span>
                )}
              </div>
            </div>
          </div>
          <PortalNav role={session?.role ?? null} showCredit={showCredit} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!isPartner ? (
          <div className="mb-4 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
            תצוגת צוות - נתוני שותף לא נטענים עבור משתמשי צוות.
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
