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
import { DataTableSkeleton } from "@/components/data-table";
import { toast } from "react-hot-toast";
import { useConfirm } from "@/components/confirm-provider";
import { Edit, Trash2, Eye, RotateCcw } from "lucide-react";
import type { OfflineHotel } from "@/types/offline-hotel.types";
import {
  getOfflineHotels,
  restoreOfflineHotel,
  softDeleteOfflineHotel,
} from "@/lib/actions/offline-hotel-actions";

export function OfflineHotelsTable() {
  const [allHotels, setHotels] = useState<OfflineHotel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();
  // Deleted hotels are hidden unless asked for - same as the flights list.
  const hotels = showDeleted ? allHotels : allHotels.filter((h) => !h.is_deleted);

  useEffect(() => {
    setIsLoading(true);
    getOfflineHotels()
      .then(setHotels)
      .catch(() => toast.error("Could not load hotels."))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSelectRow = (id: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedRows(checked ? new Set(hotels.map((h) => h.id)) : new Set());
  };

  const handleDelete = async (id: number) => {
    if (
      !(await confirm({
        title: "Delete hotel?",
        description: "This soft deletes the hotel. You can restore it later.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      try {
        await softDeleteOfflineHotel(id);
        setHotels((prev) =>
          prev.map((h) => (h.id === id ? { ...h, is_deleted: true } : h))
        );
        toast.success("Hotel soft deleted successfully.");
        setSelectedRows((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (error) {
        console.error("Failed to delete hotel:", error);
        toast.error("Failed to delete hotel.");
      }
    });
  };

  const handleRestore = async (id: number) => {
    if (
      !(await confirm({
        title: "Restore hotel?",
        description: "The hotel returns to active status.",
        confirmLabel: "Restore",
      }))
    )
      return;
    startTransition(async () => {
      try {
        await restoreOfflineHotel(id);
        setHotels((prev) =>
          prev.map((h) => (h.id === id ? { ...h, is_deleted: false } : h))
        );
        toast.success("Hotel restored successfully.");
      } catch (error) {
        console.error("Failed to restore hotel:", error);
        toast.error("Failed to restore hotel.");
      }
    });
  };

  if (isLoading) return <DataTableSkeleton label="Loading hotels" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={showDeleted}
            onCheckedChange={(checked) => {
              setShowDeleted(Boolean(checked));
              setSelectedRows(new Set());
            }}
          />
          Show deleted
        </label>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  checked={hotels.length > 0 && selectedRows.size === hotels.length}
                  onCheckedChange={(checked) => handleSelectAll(Boolean(checked))}
                  aria-label="Select all rows"
                />
              </TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Hotel Name</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead>Room Type</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Rooms</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hotels.length > 0 ? (
              hotels.map((hotel) => (
                <TableRow
                  key={hotel.id}
                  data-state={selectedRows.has(hotel.id) && "selected"}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedRows.has(hotel.id)}
                      onCheckedChange={() => handleSelectRow(hotel.id)}
                      aria-label={`Select row ${hotel.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/offline-hotels/${hotel.id}`}
                      className="hover:underline"
                    >
                      {hotel.id}
                    </Link>
                  </TableCell>
                  <TableCell>{hotel.hotel_name}</TableCell>
                  <TableCell>{hotel.city}</TableCell>
                  <TableCell>{hotel.check_in}</TableCell>
                  <TableCell>{hotel.check_out}</TableCell>
                  <TableCell>{hotel.room_type}</TableCell>
                  <TableCell>${Number(hotel.price).toFixed(2)}</TableCell>
                  <TableCell>
                    {(() => {
                      const avail = hotel.num_rooms - hotel.consumed_rooms;
                      return (
                        <span className={avail > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                          {avail}/{hotel.num_rooms}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={hotel.is_deleted ? "destructive" : "outline"}>
                      {hotel.is_deleted ? "Deleted" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/offline-hotels/${hotel.id}`} title="View Hotel">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">View Hotel</span>
                        </Button>
                      </Link>
                      <Link href={`/offline-hotels/${hotel.id}/edit`} title="Edit Hotel">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit className="h-4 w-4" />
                          <span className="sr-only">Edit Hotel</span>
                        </Button>
                      </Link>
                      {hotel.is_deleted ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Restore Hotel"
                          onClick={() => handleRestore(hotel.id)}
                          disabled={isPending}
                          className="h-8 w-8 text-green-600 hover:text-green-700"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span className="sr-only">Restore Hotel</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete Hotel"
                          onClick={() => handleDelete(hotel.id)}
                          disabled={isPending}
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete Hotel</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center">
                  No hotels found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
