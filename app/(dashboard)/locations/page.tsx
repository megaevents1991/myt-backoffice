import { Suspense } from "react";
import { Metadata } from "next";
import LocationsContent from "./locations-content";

export const metadata: Metadata = {
  title: "Locations | Backoffice",
  description: "Manage locations",
};

export default function LocationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Locations</h1>
        <p className="text-muted-foreground">
          Manage location data for events and venues
        </p>
      </div>

      <Suspense fallback={<div>Loading locations...</div>}>
        <LocationsContent />
      </Suspense>
    </div>
  );
}
