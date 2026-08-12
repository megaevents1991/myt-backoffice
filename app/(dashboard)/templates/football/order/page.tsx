import Link from "next/link";
import { PeopleOrderList } from "@/components/templates/PeopleOrderList";
import { RevalidateButton } from "@/components/templates/RevalidateButton";

export default function FootballOrderPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Link href="/templates/football" className="text-sm text-muted-foreground hover:underline">← Football Teams</Link>
          <h1 className="text-3xl font-bold">Homepage Order - כדורגל</h1>
        </div>
        <RevalidateButton />
      </div>
      <PeopleOrderList kind="football_teams" />
    </div>
  );
}
