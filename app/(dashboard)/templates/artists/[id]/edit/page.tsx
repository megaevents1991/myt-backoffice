import { PersonForm } from "@/components/templates/PersonForm";
import { getArtist } from "@/lib/actions/artist-actions";
import { notFound } from "next/navigation";

export default async function EditArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initial;
  try {
    initial = await getArtist(Number(id));
  } catch {
    notFound();
  }
  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Edit Artist</h1>
      <PersonForm kind="artists" initial={initial} />
    </div>
  );
}
