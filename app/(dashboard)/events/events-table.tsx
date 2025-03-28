"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Edit, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import type { Event } from "@/types/app.types";
import {
  getEvents,
  bulkSoftDeleteEvents,
  bulkDuplicateEvents,
} from "@/lib/actions/event-actions";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

export function EventsTable() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function fetchEvents() {
      try {
        const data = await getEvents();
        setEvents(data);
      } catch (error) {
        console.error("Error fetching events:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load events. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, [toast]);

  useEffect(() => {
    // Extract the IDs from the selected rows
    const ids = Object.entries(selectedRows)
      .filter(([_, isSelected]) => isSelected)
      .map(([id]) => Number.parseInt(id, 10));

    setSelectedIds(ids);
  }, [selectedRows]);

  const handleBulkSoftDelete = async () => {
    if (selectedIds.length === 0) return;

    setIsDeleting(true);
    try {
      await bulkSoftDeleteEvents(selectedIds);

      // Update the local state
      setEvents(
        events.map((event) => {
          if (selectedIds.includes(event.id)) {
            const today = new Date();
            const formattedDate = `${(today.getMonth() + 1)
              .toString()
              .padStart(2, "0")}-${today
              .getDate()
              .toString()
              .padStart(2, "0")}-${today.getFullYear()}`;
            return { ...event, is_deleted: formattedDate };
          }
          return event;
        })
      );

      toast({
        title: "Events deleted",
        description: `${selectedIds.length} events have been marked as deleted.`,
      });

      // Clear selection
      setSelectedRows({});
    } catch (error) {
      console.error("Error deleting events:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete events. Please try again.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDuplicate = async () => {
    if (selectedIds.length === 0) return;

    setIsDuplicating(true);
    try {
      const duplicatedEvents = await bulkDuplicateEvents(selectedIds);

      // Update the local state
      setEvents([...duplicatedEvents, ...events]);

      toast({
        title: "Events duplicated",
        description: `${selectedIds.length} events have been duplicated.`,
      });

      // Clear selection
      setSelectedRows({});
    } catch (error) {
      console.error("Error duplicating events:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to duplicate events. Please try again.",
      });
    } finally {
      setIsDuplicating(false);
    }
  };

  const filteredEvents = showDeleted
    ? events
    : events.filter((event) => !event.is_deleted);

  const columns: ColumnDef<Event>[] = [
    {
      accessorKey: "id",
      header: "ID",
    },
    {
      accessorKey: "name",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Name
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const isDeleted = row.original.is_deleted;
        return (
          <div className="flex items-center gap-2">
            {isDeleted && (
              <Badge
                variant="outline"
                className="text-destructive border-destructive"
              >
                Deleted
              </Badge>
            )}
            <span>{row.getValue("name")}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "name_english",
      header: "English Name",
    },
    {
      accessorKey: "date",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue("date"));
        return <div>{date.toLocaleDateString()}</div>;
      },
    },
    {
      accessorKey: "location.name",
      header: "Location",
      cell: ({ row }) => {
        const location = row.original.location;
        return <div>{location.name}</div>;
      },
    },
    {
      accessorKey: "usual_price",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Price
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const price = Number.parseFloat(row.getValue("usual_price"));
        return <div>${price.toFixed(2)}</div>;
      },
    },
    {
      accessorKey: "is_prioritized",
      header: "Prioritized",
      cell: ({ row }) => {
        return <div>{row.getValue("is_prioritized") ? "Yes" : "No"}</div>;
      },
    },
    {
      accessorKey: "is_deleted",
      header: "Deleted Date",
      cell: ({ row }) => {
        const deletedDate = row.getValue("is_deleted") as
          | string
          | null
          | undefined;
        return deletedDate ? <div>{String(deletedDate)}</div> : <div>-</div>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const event = row.original;

        return (
          <div className="flex items-center gap-2">
            <Link href={`/events/${event.id}`}>
              <Button variant="ghost" size="icon">
                <Edit className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        );
      },
    },
  ];

  const BulkActions = () => (
    <div className="flex gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="sm"
            disabled={isDeleting || selectedIds.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Selected
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark {selectedIds.length} event(s) as deleted. They will
              no longer appear in the main list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkSoftDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Button
        variant="outline"
        size="sm"
        onClick={handleBulkDuplicate}
        disabled={isDuplicating || selectedIds.length === 0}
      >
        <Copy className="h-4 w-4 mr-2" />
        Duplicate Selected
      </Button>
    </div>
  );

  if (loading) {
    return <div>Loading events...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Checkbox
          id="show-deleted"
          checked={showDeleted}
          onCheckedChange={(checked) => setShowDeleted(checked as boolean)}
        />
        <label
          htmlFor="show-deleted"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Show deleted events
        </label>
      </div>

      <DataTable
        columns={columns}
        data={filteredEvents}
        searchColumn="name"
        searchPlaceholder="Search events..."
        enableRowSelection={true}
        onRowSelectionChange={setSelectedRows}
        bulkActions={<BulkActions />}
      />
    </div>
  );
}
