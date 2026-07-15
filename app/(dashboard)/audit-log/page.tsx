import { getAuditLogs } from "@/lib/actions/audit-actions";
import { AuditClient } from "./audit-client";

export default async function AuditLogPage() {
  const rows = await getAuditLogs({});
  return <AuditClient initialRows={rows} />;
}
