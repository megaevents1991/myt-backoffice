import { Metadata } from "next";
import { LocationForm } from "@/components/location-form";

export const metadata: Metadata = {
  title: "Create Location | Backoffice",
  description: "Create a new location",
};

export default function NewLocationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Location</h1>
        <p className="text-muted-foreground">
          Add a new location to the system
        </p>
      </div>

      <LocationForm />
    </div>
  );
}
