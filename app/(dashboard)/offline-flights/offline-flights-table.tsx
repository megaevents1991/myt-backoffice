"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "react-hot-toast";
import { Layers } from "lucide-react";
import { OfflineFlight } from "@/types/offline-flight.types";
import { getCompanyFlights } from "@/lib/actions/offline-flight-actions";
import { FlightsEditableTable } from "@/components/flights-editable-table";
import { DataTableSkeleton } from "@/components/data-table";

/**
 * `tours` comes from the server (the active company, see page.tsx). The rows
 * themselves are scoped on the server by getCompanyFlights - this flag only
 * decides which columns and statuses the table offers.
 */
export function OfflineFlightsTable({ tours = false }: { tours?: boolean }) {
  const [flights, setFlights] = useState<OfflineFlight[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFlights = useCallback(async () => {
    try {
      // The ACTIVE company's flights (getOfflineFlights is the Mega Events
      // list the event page links from).
      const data = await getCompanyFlights();
      setFlights(data);
    } catch (error) {
      console.error("Failed to fetch flights:", error);
      toast.error("Could not load flights.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlights();
  }, [fetchFlights]);

  if (isLoading) {
    return <DataTableSkeleton label="Loading flights" />;
  }

  return (
    <FlightsEditableTable
      flights={flights}
      onChanged={fetchFlights}
      tours={tours}
      toolbarExtra={
        <Button variant="secondary" size="sm" asChild>
          <Link href="/offline-flights/series/new">
            <Layers className="mr-2 h-4 w-4" />
            New series
          </Link>
        </Button>
      }
    />
  );
}
