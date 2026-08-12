import { listUsers } from "@/lib/actions/user-actions";
import { getPartners } from "@/lib/actions/partner-actions";
import { isCustomerRefundPartner } from "@/types/partner.types";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const [users, partners] = await Promise.all([listUsers(), getPartners()]);
  // Only real marketing partners can back a portal login - the auto-created
  // customer-refund rows run to thousands and would swamp the picker.
  const realPartners = (partners ?? []).filter((p) => !isCustomerRefundPartner(p));
  return <UsersClient users={users} partners={realPartners} />;
}
