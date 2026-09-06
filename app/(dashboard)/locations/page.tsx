import { Suspense } from "react";
import { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import LocationsContent from "./locations-content";

export const metadata: Metadata = {
  title: "Locations | Backoffice",
  description: "Manage locations",
};

export default function LocationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description="The cities and countries events happen in. Events, packages and content are tagged against these, and the customer site filters by them - so renaming one changes what customers see."
      />

      <Suspense fallback={<div>Loading locations...</div>}>
        <LocationsContent />
      </Suspense>
    </div>
  );
}
