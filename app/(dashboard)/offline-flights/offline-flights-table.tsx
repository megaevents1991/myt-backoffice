"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "react-hot-toast";
import { Layers } from "lucide-react";
import { OfflineFlight } from "@/types/offline-flight.types";
import { getOfflineFlights } from "@/lib/actions/offline-flight-actions";
import { FlightsEditableTable } from "@/components/flights-editable-table";

export function OfflineFlightsTable() {
  const [flights, setFlights] = useState<OfflineFlight[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFlights = useCallback(async () => {
    try {
      const data = await getOfflineFlights();
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
    return <div>Loading flights...</div>;
  }

  return (
    <FlightsEditableTable
      flights={flights}
      onChanged={fetchFlights}
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
