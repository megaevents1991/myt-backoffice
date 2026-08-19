import { Assistant, Rubik } from "next/font/google";
import { getSession } from "@/lib/auth/guards";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import { resolvePortalScope } from "@/lib/portal-attribution";
import { PARTNER_ROLES } from "@/types/auth.types";
import { PortalNav } from "./portal-nav";

// Main-app brand fonts (Assistant body / Rubik display), loaded only for the
// portal subtree - the admin dashboard keeps its own look.
const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-portal-sans",
});

const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["600", "700", "800"],
  variable: "--font-portal-display",
});

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  const profile = isPartner ? await getPortalProfile() : null;
  const scope =
    isPartner && session?.partner_code
      ? await resolvePortalScope({
          sub: session.sub,
          role: session.role,
          partner_code: session.partner_code,
        })
      : null;
  const showCredit =
    !!session &&
    (session.role === "office_manager" ||
      session.role === "affiliate" ||
      (session.role === "agent" && (scope?.soloOffice ?? false)));
  const roleLabel =
    session?.role === "office_manager"
      ? "מנהל משרד"
      : session?.role === "agent"
        ? "סוכן"
        : "משפיען";

  return (
    <div
      dir="rtl"
      className={`portal-theme min-h-screen ${assistant.variable} ${rubik.variable}`}
    >
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
                {(profile?.name_hebrew || profile?.display_name || "M").slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-lg font-bold">
                  {profile?.name_hebrew || profile?.display_name || "פורטל שותפים"}
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
