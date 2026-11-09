import { requireAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { ClubClient } from "./club-client";

// Admin-only (lib/nav.ts roles: ADMIN_ROLES) - refused here too, server-side.
export default async function ClubPage() {
  await requireAdmin();
  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title="Members Club"
        description="MEGA CLUB on the site's order summary: who joined, what they ordered, what the member price cost, and the club's switch and amount."
      />
      <ClubClient />
    </div>
  );
}
