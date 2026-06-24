import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PeopleTable } from "@/components/templates/PeopleTable";

export default function FootballPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates" className="text-sm text-muted-foreground hover:underline">← Templates</Link>
          <h1 className="text-3xl font-bold">Football Teams</h1>
        </div>
        <Button asChild><Link href="/templates/football/new">Add New Team</Link></Button>
      </div>
      <PeopleTable kind="football_teams" />
    </div>
  );
}
