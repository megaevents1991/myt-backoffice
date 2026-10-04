import Link from "next/link";
import { Layers, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineFlightsTable } from "./offline-flights-table"; // Ensure this path is correct
import { FlightsSheet } from "@/components/tours/flights/flights-sheet";
import { getActiveCompany } from "@/lib/company";
import { sellsTours } from "@/lib/flights-scope";

export default async function OfflineFlightsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // The list shows the flights of the ACTIVE company only (the actions scope
  // them on the server).
  //
  // A tours company gets the flights sheet (Alon, 04.10.2026): a spreadsheet with
  // a Details / Operations switch and the tour code of every flight. The table
  // Mega Events uses stays one click away for it (`?view=table`: the column
  // picker, delete / restore, the inventory export). Mega Events sees only the
  // table, as before.
  const company = await getActiveCompany();
  const tours = sellsTours(company);
  const { view } = await searchParams;
  const sheet = tours && view !== "table";
  return (
    <div className="container mx-auto py-10">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h1 className="text-3xl font-bold">Offline Flights Management</h1>
        <div className="flex flex-wrap items-center gap-2">
          {tours && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={sheet ? "/offline-flights?view=table" : "/offline-flights"}>
                <Table2 className="mr-2 h-4 w-4" />
                {sheet ? "Classic table" : "Back to the sheet"}
              </Link>
            </Button>
          )}
          {sheet && (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/offline-flights/series/new">
                <Layers className="mr-2 h-4 w-4" />
                New series
              </Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/offline-flights/new">Add New Flight</Link>
          </Button>
        </div>
      </div>
      {sheet ? <FlightsSheet /> : <OfflineFlightsTable tours={tours} />}
    </div>
  );
}
