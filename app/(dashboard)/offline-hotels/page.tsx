import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OfflineHotelsTable } from "./offline-hotels-table";

export default async function OfflineHotelsPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Offline Hotels Management</h1>
        <Button asChild>
          <Link href="/offline-hotels/new">Add New Hotel</Link>
        </Button>
      </div>
      <OfflineHotelsTable />
    </div>
  );
}
