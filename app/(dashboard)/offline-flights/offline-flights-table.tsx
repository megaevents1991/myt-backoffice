"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "react-hot-toast";
import { OfflineFlight } from "@/types/offline-flight.types";
import {
  getOfflineFlights,
  softDeleteOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import { Edit, Trash2, Eye } from "lucide-react";

export function OfflineFlightsTable() {
  const [flights, setFlights] = useState<OfflineFlight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set()); // Changed to Set<number>
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function fetchFlights() {
      try {
        setIsLoading(true);
        const data = await getOfflineFlights();
        setFlights(data);
      } catch (error) {
        console.error("Failed to fetch flights:", error);
        toast.error("Could not load flights.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchFlights();
  }, []);

  const handleSelectRow = (id: number) => {
    setSelectedRows((prev) => {
      const newSelectedRows = new Set(prev);
      if (newSelectedRows.has(id)) {
        newSelectedRows.delete(id);
      } else {
        newSelectedRows.add(id);
      }
      return newSelectedRows;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(flights.map((flight) => flight.id))); // flight.id is now number
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to soft delete this flight?")) return;
    startTransition(async () => {
      try {
        await softDeleteOfflineFlight(id);
        setFlights((prevFlights) =>
          prevFlights.map((f) => (f.id === id ? { ...f, is_deleted: true } : f))
        );
        toast.success("Flight soft deleted successfully.");
        setSelectedRows((prev) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      } catch (error) {
        console.error("Failed to delete flight:", error);
        toast.error("Failed to delete flight.");
      }
    });
  };

  if (isLoading) {
    return <div>Loading flights...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  checked={
                    flights.length > 0 && selectedRows.size === flights.length
                  }
                  onCheckedChange={(checked) =>
                    handleSelectAll(Boolean(checked))
                  }
                  aria-label="Select all rows"
                />
              </TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Airline</TableHead>
              <TableHead>Flight No.</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Departure</TableHead>
              <TableHead>Arrival</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flights.length > 0 ? (
              flights.map((flight) => (
                <TableRow
                  key={flight.id} // flight.id is now number
                  data-state={selectedRows.has(flight.id) && "selected"}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedRows.has(flight.id)}
                      onCheckedChange={() => handleSelectRow(flight.id)}
                      aria-label={`Select row ${flight.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/offline-flights/${flight.id}`} // flight.id is number, interpolates fine
                      className="hover:underline"
                      title="View Flight Details"
                    >
                      {flight.id} {/* Display number directly */}
                    </Link>
                  </TableCell>
                  <TableCell>{flight.airline_code}</TableCell>
                  <TableCell>{flight.outbound_flight_number}</TableCell>
                  <TableCell>{flight.outbound_departure_airport}</TableCell>
                  <TableCell>{flight.outbound_arrival_airport}</TableCell>
                  <TableCell>
                    {new Date(flight.outbound_departure_time).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {new Date(flight.outbound_arrival_time).toLocaleString()}
                  </TableCell>
                  <TableCell>${flight.price.toFixed(2)}</TableCell>
                  <TableCell>{flight.initial_quantity}</TableCell>
                  <TableCell>
                    <Badge
                      variant={flight.is_deleted ? "destructive" : "outline"}
                    >
                      {flight.is_deleted ? "Deleted" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/offline-flights/${flight.id}`}
                        title="View Flight"
                      >
                        <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">View Flight</span>
                        </Button>
                      </Link>
                      <Link
                        href={`/offline-flights/${flight.id}/edit`}
                        title="Edit Flight"
                      >
                        <Button variant="ghost" size="icon">
                          <Edit className="h-4 w-4" />
                          <span className="sr-only">Edit Flight</span>
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete Flight"
                        onClick={() => handleDelete(flight.id)}
                        disabled={isPending || Boolean(flight.is_deleted)}
                        className={
                          flight.is_deleted
                            ? "text-muted-foreground cursor-not-allowed"
                            : "text-red-600 hover:text-red-700"
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete Flight</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={12} className="h-24 text-center">
                  No flights found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
