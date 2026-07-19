import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PeopleTable } from "@/components/templates/PeopleTable";
import { RevalidateButton } from "@/components/templates/RevalidateButton";

export default function ArtistsPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates" className="text-sm text-muted-foreground hover:underline">← Templates</Link>
          <h1 className="text-3xl font-bold">Artists</h1>
        </div>
        <div className="flex items-center gap-2">
          <RevalidateButton />
          <Button variant="outline" asChild><Link href="/templates/artists/order">Homepage Order</Link></Button>
          <Button asChild><Link href="/templates/artists/new">Add New Artist</Link></Button>
        </div>
      </div>
      <PeopleTable kind="artists" />
    </div>
  );
}
