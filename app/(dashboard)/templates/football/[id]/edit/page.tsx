import { PersonForm } from "@/components/templates/PersonForm";
import { getFootballTeam } from "@/lib/actions/football-actions";
import { notFound } from "next/navigation";

export default async function EditFootballPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initial;
  try {
    initial = await getFootballTeam(Number(id));
  } catch {
    notFound();
  }
  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Edit Team</h1>
      <PersonForm kind="football_teams" initial={initial} />
    </div>
  );
}
