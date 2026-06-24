import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PeopleTable } from "@/components/templates/PeopleTable";

export default function ArtistsPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates" className="text-sm text-muted-foreground hover:underline">← Templates</Link>
          <h1 className="text-3xl font-bold">Artists</h1>
        </div>
        <Button asChild><Link href="/templates/artists/new">Add New Artist</Link></Button>
      </div>
      <PeopleTable kind="artists" />
    </div>
  );
}
