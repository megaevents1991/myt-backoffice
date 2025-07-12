import { notFound } from "next/navigation";
import { Metadata } from "next";
import { LocationForm } from "@/components/location-form";
import { getLocationById } from "@/lib/actions/location-actions";

interface EditLocationPageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: EditLocationPageProps): Promise<Metadata> {
  const location = await getLocationById(parseInt(params.id));

  return {
    title: location
      ? `Edit ${location.name} | Backoffice`
      : "Location Not Found | Backoffice",
    description: location
      ? `Edit location: ${location.name}`
      : "Location not found",
  };
}

export default async function EditLocationPage({
  params,
}: EditLocationPageProps) {
  const locationId = parseInt(params.id);

  if (isNaN(locationId)) {
    notFound();
  }

  const location = await getLocationById(locationId);

  if (!location) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit Location</h1>
        <p className="text-muted-foreground">
          Update location: {location.name}
        </p>
      </div>

      <LocationForm location={location} />
    </div>
  );
}
