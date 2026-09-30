import { getAuditLogs } from "@/lib/actions/audit-actions";
import { requireAdmin } from "@/lib/auth/guards";
import { AuditClient } from "./audit-client";

// Admin-only screen (lib/nav.ts roles: ADMIN_ROLES) - refused here too, server-side,
// like /price-light: an editor typing /audit-log directly never gets the screen.
export default async function AuditLogPage() {
  await requireAdmin();
  const rows = await getAuditLogs({});
  return <AuditClient initialRows={rows} />;
}
