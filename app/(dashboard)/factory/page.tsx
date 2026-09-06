import { PageHeader } from "@/components/page-header";
import { FactoryClient } from "./factory-client";

// The events factory (spec docs/superpowers/specs/2026-09-02, section 8):
// provider tables send selections here as drafts, the build loop fills them
// through the shared blocks, and the grid is where a human approves in bulk.
export default function FactoryPage() {
  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title="מפעל האירועים"
        description="טיוטות נבנות אוטומטית — כרטיסים מזיכרון האצטדיון, מחירים חיים, iata — ואתה מאשר בבת אחת. שולחים לכאן מכל טבלת ספק (Send to factory)."
      />
      <FactoryClient />
    </div>
  );
}
