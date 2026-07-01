import { PersonForm } from "@/components/templates/PersonForm";

export default function NewFootballPage() {
  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Add New Team</h1>
      <PersonForm kind="football_teams" />
    </div>
  );
}
