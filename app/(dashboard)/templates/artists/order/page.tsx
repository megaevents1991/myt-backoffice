import Link from "next/link";
import { PeopleOrderList } from "@/components/templates/PeopleOrderList";
import { RevalidateButton } from "@/components/templates/RevalidateButton";

export default function ArtistsOrderPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates/artists" className="text-sm text-muted-foreground hover:underline">← Artists</Link>
          <h1 className="text-3xl font-bold">Homepage Order - אמנים מובילים</h1>
        </div>
        <RevalidateButton />
      </div>
      <PeopleOrderList kind="artists" />
    </div>
  );
}
