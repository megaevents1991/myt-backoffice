import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { DataTableSkeleton } from "@/components/data-table";
import { requireCompany } from "@/lib/company";
import { ADMIN_ROLES, type Role } from "@/types/auth.types";
import { WhatsappScreen } from "./whatsapp-screen";

export const dynamic = "force-dynamic";

/** Mega Events' WhatsApp (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, section 8). */
export default async function WhatsappPage() {
  const { session } = await requireCompany("events");
  const isAdmin = ADMIN_ROLES.includes(session.role as Role);
  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Every conversation of the company's number 054-200-2722, with the orders of the same phone. Answer here inside 24 hours of the customer's last message, or from the WhatsApp app at any time."
      />
      {/* The screen reads ?tab= / ?f= / ?chat= (useUrlState -> useSearchParams). */}
      <Suspense fallback={<DataTableSkeleton rows={10} label="Loading conversations" />}>
        <WhatsappScreen isAdmin={isAdmin} />
      </Suspense>
    </div>
  );
}
