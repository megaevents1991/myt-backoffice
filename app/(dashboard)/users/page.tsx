import { getUsersScope, listUsers } from "@/lib/actions/user-actions";
import { getPartners } from "@/lib/actions/partner-actions";
import { isCustomerRefundPartner } from "@/types/partner.types";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  // Any company but Mega Events: the same screen over that company's people
  // (lib/actions/user-actions.ts) - no partners, and nothing here may go
  // through requireAdmin / requireStaff, which refuse a company-only admin.
  const scope = await getUsersScope();
  if (scope.scope === "company") {
    const users = await listUsers();
    return (
      <UsersClient
        users={users}
        partners={[]}
        scope="company"
        companyName={scope.companyName}
      />
    );
  }
  const [users, partners] = await Promise.all([listUsers(), getPartners()]);
  // Only real marketing partners can back a portal login - the auto-created
  // customer-refund rows run to thousands and would swamp the picker.
  const realPartners = (partners ?? []).filter((p) => !isCustomerRefundPartner(p));
  return <UsersClient users={users} partners={realPartners} />;
}
