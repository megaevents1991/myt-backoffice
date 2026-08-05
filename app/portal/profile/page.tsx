import { getSession } from "@/lib/auth/guards";
import { getMyProfileDetails } from "@/lib/actions/portal-profile-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { ProfileClient } from "./profile-client";

export default async function PortalProfilePage() {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  // Staff visiting /portal see the layout's notice only.
  if (!isPartner) return null;

  const details = await getMyProfileDetails();
  if (!details) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        לא הצלחנו לטעון את הפרופיל. נסו לרענן.
      </div>
    );
  }

  return <ProfileClient details={details} />;
}
