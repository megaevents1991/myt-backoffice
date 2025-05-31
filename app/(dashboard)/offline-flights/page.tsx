import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OfflineFlightsTable } from "./offline-flights-table"; // Ensure this path is correct

export default async function OfflineFlightsPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Offline Flights Management</h1>
        <Button asChild>
          <Link href="/offline-flights/new">Add New Flight</Link>
        </Button>
      </div>
      <OfflineFlightsTable />
    </div>
  );
}
