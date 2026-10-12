import { getAuditLogs } from "@/lib/actions/audit-actions";
import { requireAdmin } from "@/lib/auth/guards";
import { AuditClient } from "./audit-client";

// Admin-only screen (lib/nav.ts roles: ADMIN_ROLES) - refused here too, server-side,
// like /price-light: an editor typing /audit-log directly never gets the screen.
//
// `?entity=offline_flight&id=57` opens the screen on ONE entity's history - what
// the "History" button on a flight, hotel or event page links to
// (auditHistoryHref). The rows then come filtered from the server, newest 500.
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const entityType = one(sp.entity);
  const entityId = one(sp.id);
  const fromUrl = entityType || entityId;
  const rows = await getAuditLogs({
    entityType,
    entityId,
    limit: entityId ? 500 : undefined,
  });
  return (
    <AuditClient
      initialRows={rows}
      initialFilters={fromUrl ? { entityType: entityType ?? "all", entityId: entityId ?? "" } : null}
    />
  );
}
