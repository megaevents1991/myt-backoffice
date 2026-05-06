"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDown,
  Edit,
  Trash2,
  Copy,
  Eye,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import type { Event } from "@/types/app.types";
import {
  getEvents,
  softDeleteEvent,
  duplicateEvent,
  updateEvent,
  bulkUpdateEvents,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COMMON_TAGS = ["Sold", "Hot", "Selling Fast", "Limited Availability", "New"];

export function EventsTable() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [hideSold, setHideSold] = useState(false);
  const [hidePast, setHidePast] = useState(false);
  const [showTicketOnly, setShowTicketOnly] = useState(false);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
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

  const handleDelete = async (id: number) => {
    try {
      await softDeleteEvent(id);

      // Update the local state
      setEvents(
        events.map((event) => {
          if (event.id === id) {
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
        title: "Event deleted",
        description: "Event has been marked as deleted.",
      });
    } catch (error) {
      console.error("Error deleting event:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete event. Please try again.",
      });
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      const duplicatedEvent = await duplicateEvent(id);

      // Update the local state
      setEvents([duplicatedEvent, ...events]);

      toast({
        title: "Event duplicated",
        description: "Event has been duplicated.",
      });
    } catch (error) {
      console.error("Error duplicating event:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to duplicate event. Please try again.",
      });
    }
  };

  const handleUpdatePrioritized = async (id: number, isPrioritized: boolean) => {
    try {
      // Optimistic update
      setEvents(
        events.map((event) =>
          event.id === id ? { ...event, is_prioritized: isPrioritized } : event
        )
      );

      await updateEvent(id, { is_prioritized: isPrioritized });

      toast({
        title: "Event updated",
        description: `Event priority has been ${isPrioritized ? "enabled" : "disabled"}.`,
      });
    } catch (error) {
      console.error("Error updating event priority:", error);
      // Revert optimistic update
      const originalEvent = events.find((e) => e.id === id);
      if (originalEvent) {
        setEvents(
          events.map((event) =>
            event.id === id ? { ...event, is_prioritized: !isPrioritized } : event
          )
        );
      }
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update event priority.",
      });
    }
  };

  const handleUpdateTags = async (id: number, newTags: string) => {
    try {
      // Optimistic update
      setEvents(
        events.map((event) =>
          event.id === id ? { ...event, tags: newTags } : event
        )
      );

      await updateEvent(id, { tags: newTags });

      toast({
        title: "Event updated",
        description: "Event tags have been updated.",
      });
    } catch (error) {
      console.error("Error updating event tags:", error);
      // Revert optimistic update (requires fetching or storing previous state, skipping for simplicity or could fetch single event)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update event tags.",
      });
    }
  };

  const filteredEvents = events.filter((event) => {
    if (!showDeleted && event.is_deleted) return false;
    if (hideSold && event.tags?.includes("Sold")) return false;
    if (hidePast) {
      const eventDate = new Date(event.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (eventDate < today) return false;
    }
    if (showTicketOnly && !event.skip_flight) return false;
    return true;
  });

  const selectedIds = Object.entries(rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => Number(id))
    .filter(Boolean) as number[];

  const handleBulkUpdate = async (update: Partial<Event>) => {
    if (selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      await bulkUpdateEvents(selectedIds, update);
      setEvents((prev) =>
        prev.map((e) => (selectedIds.includes(e.id) ? { ...e, ...update } : e))
      );
      setRowSelection({});
      toast({ title: "Updated", description: `${selectedIds.length} event(s) updated.` });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Bulk update failed." });
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkTagToggle = async (tag: string) => {
    if (selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      // Determine if ALL selected events have this tag → remove it; otherwise add it
      const allHaveTag = selectedIds.every((id) => {
        const event = events.find((e) => e.id === id);
        return event?.tags?.split(",").map((t) => t.trim()).includes(tag);
      });
      await Promise.all(
        selectedIds.map((id) => {
          const event = events.find((e) => e.id === id)!;
          const current = (event.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
          const newTags = allHaveTag
            ? current.filter((t) => t !== tag)
            : current.includes(tag) ? current : [...current, tag];
          return updateEvent(id, { tags: newTags.join(", ") });
        })
      );
      setEvents((prev) =>
        prev.map((e) => {
          if (!selectedIds.includes(e.id)) return e;
          const current = (e.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
          const newTags = allHaveTag
            ? current.filter((t) => t !== tag)
            : current.includes(tag) ? current : [...current, tag];
          return { ...e, tags: newTags.join(", ") };
        })
      );
      setRowSelection({});
      toast({ title: "Tags updated", description: `${selectedIds.length} event(s) updated.` });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Bulk tag update failed." });
    } finally {
      setBulkLoading(false);
    }
  };

  const columns: ColumnDef<Event>[] = [
    {
      accessorKey: "id",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            ID
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
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
      accessorKey: "type",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Type
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const type = row.getValue("type") as string;
        const getTypeLabel = (type: string) => {
          switch (type) {
            case "music_event":
              return "Music Event Offline";
            case "sports_event":
              return "Sports Event Offline";
            case "sports_event_dynamic":
              return "Sports Event (XS2 Dynamic)";
            case "sports_live_event_dynamic":
              return "Sports Event (Live Dynamic)";
            case "music_live_event_dynamic":
              return "Music Event (Live Dynamic)";
            case "tx_event":
              return "TixStock Event";
            default:
              return type;
          }
        };
        const getTypeVariant = (type: string) => {
          switch (type) {
            case "music_event":
              return "default";
            case "sports_event":
              return "secondary";
            case "sports_event_dynamic":
              return "outline";
            case "sports_live_event_dynamic":
              return "destructive";
            case "music_live_event_dynamic":
              return "destructive";
            case "tx_event":
              return "secondary";
            default:
              return "default";
          }
        };
        return (
          <Badge variant={getTypeVariant(type) as any}>
            {getTypeLabel(type)}
          </Badge>
        );
      },
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
            Usual Price
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
      accessorKey: "tags",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Tags
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const tagsString = (row.getValue("tags") as string) || "";
        const currentTags = tagsString.split(",").map(t => t.trim()).filter(Boolean);

        const toggleTag = (tag: string) => {
          let newTags: string[];
          if (currentTags.includes(tag)) {
            newTags = currentTags.filter((t) => t !== tag);
          } else {
            newTags = [...currentTags, tag];
          }
          handleUpdateTags(row.original.id, newTags.join(", "));
        };

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-full justify-start px-2 text-left font-normal">
                {tagsString || <span className="text-muted-foreground italic">No tags</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[200px]">
              <DropdownMenuLabel>Manage Tags</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COMMON_TAGS.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  checked={currentTags.includes(tag)}
                  onCheckedChange={() => toggleTag(tag)}
                >
                  {tag}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      accessorKey: "skip_flight",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Skip Flight
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const skipFlight = row.original.skip_flight;
        return (
          <Select
            value={skipFlight ? "yes" : "no"}
            onValueChange={(value) => {
              const skipFlight = value === "yes";
              setEvents((prev) =>
                prev.map((e) => e.id === row.original.id ? { ...e, skip_flight: skipFlight } : e)
              );
              updateEvent(row.original.id, { skip_flight: skipFlight }).catch(() => {
                setEvents((prev) =>
                  prev.map((e) => e.id === row.original.id ? { ...e, skip_flight: !skipFlight } : e)
                );
                toast({ variant: "destructive", title: "Error", description: "Failed to update skip flight." });
              });
            }}
          >
            <SelectTrigger className={`h-8 w-[80px] ${skipFlight ? "text-teal-700 font-semibold" : ""}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "is_prioritized",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Prioritized
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const isPrioritized = row.getValue("is_prioritized") as boolean;
        return (
          <Select
            value={isPrioritized ? "yes" : "no"}
            onValueChange={(value) =>
              handleUpdatePrioritized(row.original.id, value === "yes")
            }
          >
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        );
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
        const isDeleted = Boolean(event.is_deleted);

        return (
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link
                    href={`/events/${event.id}/view`}
                    className="flex items-center"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    <span>View</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    href={`/events/${event.id}`}
                    className="flex items-center"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    <span>Edit</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDuplicate(event.id)}
                  className="flex items-center"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  <span>Duplicate</span>
                </DropdownMenuItem>
                {!isDeleted && (
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem className="text-destructive flex items-center focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will mark this event as deleted. It will no longer appear
                  in the main list.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleDelete(event.id)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      },
    },
  ];

  if (loading) {
    return <div>Loading events...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6">
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
        
        <div className="flex items-center space-x-2">
          <Checkbox
            id="hide-sold"
            checked={hideSold}
            onCheckedChange={(checked) => setHideSold(checked as boolean)}
          />
          <label
            htmlFor="hide-sold"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Hide sold events
          </label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="hide-past"
            checked={hidePast}
            onCheckedChange={(checked) => setHidePast(checked as boolean)}
          />
          <label
            htmlFor="hide-past"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Hide past events
          </label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="show-ticket-only"
            checked={showTicketOnly}
            onCheckedChange={(checked) => setShowTicketOnly(checked as boolean)}
          />
          <label
            htmlFor="show-ticket-only"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Show ticket only events
          </label>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredEvents}
        searchColumn="name"
        searchPlaceholder="Search events..."
        enableRowSelection={true}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={(row) => String(row.id)}
        bulkActions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-medium">
              {selectedIds.length} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  Set Tags
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[200px]">
                <DropdownMenuLabel>Toggle tag on selected</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COMMON_TAGS.map((tag) => (
                  <DropdownMenuItem key={tag} onClick={() => handleBulkTagToggle(tag)}>
                    {tag}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  Prioritized
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Set prioritized</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBulkUpdate({ is_prioritized: true })}>
                  Yes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkUpdate({ is_prioritized: false })}>
                  No
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  Skip Flight
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Set skip flight</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBulkUpdate({ skip_flight: true })}>
                  Yes (ticket only)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkUpdate({ skip_flight: false })}>
                  No (full package)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
        getRowClassName={(row, index, sorting) => {
          const isSortedByPrioritized = sorting.some(
            (s) => s.id === "is_prioritized" && s.desc
          );
          if (isSortedByPrioritized && index === 7) {
            return "border-b-4 border-primary";
          }
          return undefined;
        }}
      />
    </div>
  );
}
