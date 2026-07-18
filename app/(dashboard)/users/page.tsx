import { listUsers } from "@/lib/actions/user-actions";
import { getPartners } from "@/lib/actions/partner-actions";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const [users, partners] = await Promise.all([listUsers(), getPartners()]);
  // Filter out per-customer refund placeholder partners from the link dropdown —
  // same substring condition as getCouponPartnerOptions (coupon-actions.ts:87-96):
  // keep partners with no Hebrew name, drop any whose name contains "ניתן להתעלם".
  const realPartners = (partners ?? []).filter(
    (p: { name_hebrew?: string | null }) =>
      !p.name_hebrew || !p.name_hebrew.includes("ניתן להתעלם")
  );
  return <UsersClient users={users} partners={realPartners} />;
}
