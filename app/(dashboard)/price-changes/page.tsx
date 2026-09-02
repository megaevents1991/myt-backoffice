import { PageHeader } from "@/components/page-header";
import { PriceChangesClient } from "./price-changes-client";

// What the nightly base-price sync did, and the ">$400" changes it froze
// for a human decision. Spec docs/superpowers/specs/2026-09-02, section 3.
export default function PriceChangesPage() {
  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader
        title="שינויי מחיר"
        description="מה הסנכרון הלילי עדכן, ומה נעצר לבדיקה ידנית (שינוי מעל $400)."
      />
      <PriceChangesClient />
    </div>
  );
}
