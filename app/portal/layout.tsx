import { getSession } from "@/lib/auth/guards";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { PortalNav } from "./portal-nav";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  const profile = isPartner ? await getPortalProfile() : null;

  return (
    <div dir="rtl" className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {profile?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : null}
            <div>
              <div className="font-bold">
                {profile?.name_hebrew || profile?.display_name || "פורטל שותפים"}
              </div>
              <div className="text-xs text-muted-foreground">MYT — פורטל שותפים</div>
            </div>
          </div>
          <PortalNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {!isPartner ? (
          <div className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            תצוגת צוות — נתוני שותף לא נטענים עבור משתמשי צוות.
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
