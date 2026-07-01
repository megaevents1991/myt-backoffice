import { PersonForm } from "@/components/templates/PersonForm";

export default function NewArtistPage() {
  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Add New Artist</h1>
      <PersonForm kind="artists" />
    </div>
  );
}
