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
  Loader2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { searchFlightPrices } from "@/lib/actions/flight-actions";
import { searchHotelPrices } from "@/lib/actions/hotel-actions";
import type { Event } from "@/types/app.types";
import {
  getEvents,
  softDeleteEvent,
  duplicateEvent,
  updateEvent,
  bulkUpdateEvents,
  bulkSoftDeleteEvents,
} from "@/lib/actions/event-actions";
import {
  listCategories,
  listTags,
  bulkAssignTags,
  getTaxonomyLinkMaps,
} from "@/lib/actions/event-taxonomy-actions";
import { buildTree, descendantIds, flattenWithPath } from "@/lib/taxonomy-tree";
import { isTicketOnlyEvent } from "@/lib/package-mode";
import type { EventCategory } from "@/types/taxonomy.types";
import {
  EventTaxonomySelect,
  type TaxonomyOption,
} from "@/components/taxonomy/event-taxonomy-select";
import type { AssignMode } from "@/types/taxonomy.types";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { PriceLightCell, LIGHT_SORT_ORDER, isLight } from "./price-light-cell";

// Storefront tag vocabulary. MUST stay in sync with myt-main
// `lib/eventTags.ts` - a tag the site doesn't recognize renders NO badge at
// all (that's how "Hot" / "Selling Fast" / "Limited Availability" were
// invisible on the site). Same list as the event detail page's Tags select.
const COMMON_TAGS = [
  "Sold",
  "LastTickets",
  "Limited Availability",
  "Selling Fast",
  "Hot",
  "Popular",
  "Restock",
  "New",
  "VIPevent",
  "VIPavailable",
];
type EventTypeBadgeVariant = "default" | "secondary" | "outline" | "destructive";

function calculateSmartDates(eventDate: string) {
  const event = new Date(eventDate);

  const departure = new Date(event);
  departure.setDate(event.getDate() - 2);

  if (departure.getDay() === 5) {
    departure.setDate(departure.getDate() - 1);
  } else if (departure.getDay() === 6) {
    departure.setDate(departure.getDate() - 2);
  }

  const returnDate = new Date(event);
  returnDate.setDate(event.getDate() + 1);

  if (returnDate.getDay() === 6) {
    returnDate.setDate(returnDate.getDate() + 1);
  }

  return {
    startDate: departure.toISOString().split("T")[0],
    endDate: returnDate.toISOString().split("T")[0],
  };
}

function getCompetitorEventLocation(event: Event) {
  return event.location?.name?.trim() ?? "";
}

// Extracted from the usual_price column cell — hooks aren't allowed inside a
// TanStack cell render function.
// Quick edit of the per-event "Additional Event Markup" (USD). Commits on
// blur / Enter, Escape restores. Empty = null (cleared), mirroring the editor.
function AdditionalMarkupCell({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    onCommit(Math.round(n));
  };
  return (
    <Input
      type="number"
      step={1}
      inputMode="numeric"
      placeholder="-"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value == null ? "" : String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className={`h-8 w-[88px] tabular ${value ? "font-semibold text-teal-700 dark:text-teal-400" : ""}`}
    />
  );
}

function UsualPriceCell({
  price,
  onCalculate,
}: {
  price: number;
  onCalculate: () => Promise<void>;
}) {
  const [calculating, setCalculating] = useState(false);
  const { toast } = useToast();

  const handleClick = async () => {
    setCalculating(true);
    try {
      await onCalculate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to calculate price." });
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <span>
        ${isNaN(price) ? "0.00" : price.toFixed(2)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title="Auto-calculate: flight + hotel + cheapest ticket + $175"
        disabled={calculating}
        onClick={handleClick}
      >
        {calculating
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <RefreshCw className="h-3 w-3" />}
      </Button>
    </div>
  );
}

export function EventsTable() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [hideSold, setHideSold] = useState(false);
  const [hidePast, setHidePast] = useState(false);
  const [showTicketOnly, setShowTicketOnly] = useState(false);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkMarkupOpen, setBulkMarkupOpen] = useState(false);
  const [bulkMarkupInput, setBulkMarkupInput] = useState("");
  const { toast } = useToast();
  const confirm = useConfirm();

  // Bulk TAG assignment over the selected rows. Categories are never assigned
  // by hand any more - a category is composed of tags (Templates → Categories),
  // so tagging an event is what puts it in one.
  const [catOptions, setCatOptions] = useState<TaxonomyOption[]>([]);
  const [tagOptions, setTagOptions] = useState<TaxonomyOption[]>([]);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagIds, setBulkTagIds] = useState<number[]>([]);
  const [bulkTagMode, setBulkTagMode] = useState<AssignMode>("add");
  // Raw categories (for descendant-aware filtering) + per-event link maps
  // (taxonomy column + filters; categories are derived). "" = no filter.
  const [rawCats, setRawCats] = useState<EventCategory[]>([]);
  const [catsByEvent, setCatsByEvent] = useState<Record<number, number[]>>({});
  const [tagsByEvent, setTagsByEvent] = useState<Record<number, number[]>>({});
  const [filterCatId, setFilterCatId] = useState("");
  const [filterTagId, setFilterTagId] = useState("");

  const refreshTaxonomyLinks = async () => {
    try {
      const maps = await getTaxonomyLinkMaps();
      setCatsByEvent(maps.cats);
      setTagsByEvent(maps.tags);
    } catch (e) {
      console.error("Failed to load taxonomy link maps:", e);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [cats, tags] = await Promise.all([listCategories(), listTags()]);
        setRawCats(cats);
        setCatOptions(flattenWithPath(cats).map((c) => ({ id: c.id, label: c.path })));
        setTagOptions(tags.map((t) => ({ id: t.id, label: t.name })));
      } catch (e) {
        console.error("Failed to load taxonomy pools:", e);
      }
      await refreshTaxonomyLinks();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Category filter matches the node AND its whole subtree (Shopify-style).
  const filterCatIdSet = (() => {
    if (!filterCatId) return null;
    const id = Number(filterCatId);
    return new Set([id, ...descendantIds(buildTree(rawCats), id)]);
  })();

  const handleBulkAssignTags = async () => {
    if (selectedIds.length === 0 || bulkTagIds.length === 0) return;
    setBulkLoading(true);
    try {
      await bulkAssignTags(selectedIds, bulkTagIds, bulkTagMode);
      toast({
        title: bulkTagMode === "remove" ? "Tags removed" : "Tags assigned",
        description: `${selectedIds.length} event(s) (${bulkTagMode}).`,
      });
      setBulkTagOpen(false);
      setBulkTagIds([]);
      await refreshTaxonomyLinks();
    } catch (e) {
      console.error("Bulk assign tags failed:", e);
      toast({ variant: "destructive", title: "Error", description: "Bulk assign failed." });
    } finally {
      setBulkLoading(false);
    }
  };

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

  // Inline edit of event_additional_markup from the table (same field as the
  // editor's "Additional Event Markup"). null = cleared.
  const handleUpdateAdditionalMarkup = async (id: number, value: number | null) => {
    const original = events.find((e) => e.id === id);
    const previous = original?.event_additional_markup ?? null;
    if (previous === value) return;
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, event_additional_markup: value } : e))
    );
    try {
      await updateEvent(id, { event_additional_markup: value });
      toast({
        title: "Event updated",
        description:
          value == null ? "Additional markup cleared." : `Additional markup set to $${value}.`,
      });
    } catch (error) {
      console.error("Error updating additional markup:", error);
      setEvents((prev) =>
        prev.map((e) => (e.id === id ? { ...e, event_additional_markup: previous } : e))
      );
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update additional markup.",
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

  const handleAutoCalculatePrice = async (eventId: number) => {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;

    const { def_date_depart, def_date_return, date, location, tickets_and_rates, skip_flight } = event;
    const smartDates = calculateSmartDates(date);
    const checkin = def_date_depart?.split("T")[0] || smartDates.startDate;
    const checkout = def_date_return?.split("T")[0] || smartDates.endDate;
    const cityIata = location?.city_iata;
    const lat = location?.latitude;
    const lon = location?.longitude;
    const ticketPrices = (tickets_and_rates ?? []).filter(t => t.available !== false).map(t => t.price).filter(p => p > 0);
    const minTicket = ticketPrices.length ? Math.min(...ticketPrices) : 0;

    const [flightResult, hotelResult] = await Promise.all([
      skip_flight || !cityIata
        ? Promise.resolve(null)
        : searchFlightPrices({ originLocationCode: "TLV", destinationLocationCode: cityIata, departureDate: checkin, returnDate: checkout, adults: 1, currencyCode: "USD" }),
      lat && lon
        ? searchHotelPrices({ lat, lon, checkin, checkout })
        : Promise.resolve(null),
    ]);

    const newFlightPrice = skip_flight
      ? event.base_flight_price
      : (flightResult?.cheapestPrice ? Math.round(flightResult.cheapestPrice) : event.base_flight_price);
    const newHotelPrice = hotelResult?.cheapestPrice ? Math.round(hotelResult.cheapestPrice) : event.base_hotel_price;
    const newUsualPrice = newFlightPrice + newHotelPrice + minTicket + 175;

    setEvents(prev => prev.map(e =>
      e.id === eventId ? { ...e, usual_price: newUsualPrice, base_flight_price: newFlightPrice, base_hotel_price: newHotelPrice } : e
    ));
    await updateEvent(eventId, { usual_price: newUsualPrice, base_flight_price: newFlightPrice, base_hotel_price: newHotelPrice });

    const parts = skip_flight
      ? `hotel $${newHotelPrice} + ticket $${minTicket} + $175 margin`
      : `flight $${newFlightPrice} + hotel $${newHotelPrice} + ticket $${minTicket} + $175 margin`;
    toast({ title: `Usual price set to $${newUsualPrice}`, description: parts });

    return newUsualPrice;
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
    if (showTicketOnly && !isTicketOnlyEvent(event)) return false;
    if (filterCatIdSet) {
      const ids = catsByEvent[event.id] ?? [];
      if (!ids.some((id) => filterCatIdSet.has(id))) return false;
    }
    if (filterTagId) {
      const ids = tagsByEvent[event.id] ?? [];
      if (filterTagId === "__none__") {
        if (ids.length > 0) return false;
      } else if (!ids.includes(Number(filterTagId))) {
        return false;
      }
    }
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

  const handleBulkTicketMarkup = async () => {
    const value = Number(bulkMarkupInput);
    if (bulkMarkupInput.trim() === "" || !Number.isFinite(value) || value < 0) {
      toast({
        variant: "destructive",
        title: "Invalid value",
        description: "Enter a non-negative number (USD per ticket).",
      });
      return;
    }
    setBulkMarkupOpen(false);
    await handleBulkUpdate({ ticket_only_markup: value });
    setBulkMarkupInput("");
  };

  const handleBulkTicketMarkupClear = async () => {
    setBulkMarkupOpen(false);
    setBulkMarkupInput("");
    await handleBulkUpdate({ ticket_only_markup: null });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (
      !(await confirm({
        title: `Delete ${selectedIds.length} event(s)?`,
        description:
          "They are soft-deleted (marked as deleted) and stay recoverable.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setBulkLoading(true);
    try {
      await bulkSoftDeleteEvents(selectedIds);
      const today = new Date();
      const formattedDate = `${(today.getMonth() + 1)
        .toString()
        .padStart(2, "0")}-${today
        .getDate()
        .toString()
        .padStart(2, "0")}-${today.getFullYear()}`;
      setEvents((prev) =>
        prev.map((e) =>
          selectedIds.includes(e.id) ? { ...e, is_deleted: formattedDate } : e
        )
      );
      setRowSelection({});
      toast({ title: "Deleted", description: `${selectedIds.length} event(s) marked as deleted.` });
    } catch (error) {
      console.error("Bulk delete failed:", error);
      toast({ variant: "destructive", title: "Error", description: "Bulk delete failed." });
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
            size="sm"
            className="px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            ID
            <ArrowUpDown className="ml-1 h-3 w-3" />
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
        // Tickets attached although the supplier does not confirm them instantly
        // (Alon 23.09) - internal warning, the customer never sees it.
        const nonInstant = (row.original.tickets_and_rates ?? []).some(
          (t) => t.nonInstant && t.available !== false,
        );
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
            {isTicketOnlyEvent(row.original) && (
              <Badge
                variant="outline"
                className="border-amber-400 text-amber-800"
                title="Sold as a ticket alone - no flight/hotel steps on the site"
              >
                ticket only{row.original.ticket_only_markup == null ? " · no markup!" : ""}
              </Badge>
            )}
            {nonInstant && (
              <Badge
                variant="outline"
                className="border-amber-400 text-amber-800"
                title="Some tickets are not instant-confirm - confirm every order with the supplier by hand"
              >
                Not instant
              </Badge>
            )}
            <span>{row.getValue("name")}</span>
          </div>
        );
      },
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
        const getTypeVariant = (type: string): EventTypeBadgeVariant => {
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
        return <Badge variant={getTypeVariant(type)}>{getTypeLabel(type)}</Badge>;
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
        return <div>{getCompetitorEventLocation(row.original)}</div>;
      },
    },
    {
      accessorKey: "usual_price",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Usual Price
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <UsualPriceCell
          price={Number.parseFloat(row.getValue("usual_price"))}
          onCalculate={async () => {
            await handleAutoCalculatePrice(row.original.id);
          }}
        />
      ),
    },
    {
      id: "price_light",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            רמזור
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        );
      },
      // Sort by the WORSE of the two pills, not by the package one alone. The cell shows both,
      // and today the ticket light carries most of the signal (the package light is still
      // "unchecked" for every event no package competitor sells), so sorting on package alone
      // buried rows with a red ticket under rows that had nothing to say.
      accessorFn: (row) =>
        Math.min(
          LIGHT_SORT_ORDER[isLight(row.light_package) ? row.light_package : "unchecked"],
          LIGHT_SORT_ORDER[isLight(row.light_ticket) ? row.light_ticket : "unchecked"],
        ),
      cell: ({ row }) => (
        <PriceLightCell
          event={row.original}
          onUpdated={(patch) =>
            setEvents((prev) => prev.map((e) => (e.id === row.original.id ? { ...e, ...patch } : e)))
          }
        />
      ),
    },
    {
      accessorKey: "tags",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Tags
            <ArrowUpDown className="ml-1 h-3 w-3" />
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
      id: "taxonomy",
      header: "Categories / Feed tags",
      cell: ({ row }) => {
        const catIds = catsByEvent[row.original.id] ?? [];
        const tagIds = tagsByEvent[row.original.id] ?? [];
        // Leaf label only ("כדורגל › ליגה אנגלית" → "ליגה אנגלית") - keep the cell narrow.
        const catLabels = catIds
          .map((id) => catOptions.find((o) => o.id === id)?.label.split(" › ").pop())
          .filter(Boolean) as string[];
        const tagLabels = tagIds
          .map((id) => tagOptions.find((o) => o.id === id)?.label)
          .filter(Boolean) as string[];
        if (!catLabels.length && !tagLabels.length) {
          return <span className="text-xs italic text-muted-foreground">-</span>;
        }
        const shown = [
          ...catLabels.slice(0, 2).map((l) => ({ l, kind: "cat" as const })),
          ...tagLabels.slice(0, 2).map((l) => ({ l, kind: "tag" as const })),
        ];
        const extra = catLabels.length + tagLabels.length - shown.length;
        return (
          <div
            className="flex max-w-[180px] flex-wrap gap-1"
            title={[...catLabels, ...tagLabels].join(", ")}
          >
            {shown.map(({ l, kind }, i) => (
              <Badge
                key={`${kind}-${i}`}
                variant={kind === "cat" ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {l}
              </Badge>
            ))}
            {extra > 0 && (
              <span className="text-[10px] text-muted-foreground">+{extra}</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "skip_flight",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="px-0"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Skip Flight
          <ArrowUpDown className="ml-1 h-3 w-3" />
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
      accessorKey: "event_additional_markup",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="px-0"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Add. Markup
          <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <AdditionalMarkupCell
          key={`${row.original.id}-${row.original.event_additional_markup ?? ""}`}
          value={row.original.event_additional_markup ?? null}
          onCommit={(next) => handleUpdateAdditionalMarkup(row.original.id, next)}
        />
      ),
    },
    {
      accessorKey: "is_prioritized",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Prioritized
            <ArrowUpDown className="ml-1 h-3 w-3" />
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            Ticket-only events only
          </label>
        </div>

        {/* Taxonomy filters - category matches its whole subtree */}
        <select
          className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={filterCatId}
          onChange={(e) => setFilterCatId(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {catOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm"
          value={filterTagId}
          onChange={(e) => setFilterTagId(e.target.value)}
          aria-label="Filter by feed tag"
        >
          <option value="">All feed tags</option>
          <option value="__none__">ללא תגיות (untagged)</option>
          {tagOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        data={filteredEvents}
        searchColumn="name"
        searchPlaceholder="Search events..."
        defaultSorting={[{ id: "id", desc: true }]}
        enableRowSelection={true}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={(row) => String(row.id)}
        bulkActions={
          <div className="flex flex-wrap items-center gap-2">
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
                <DropdownMenuItem
                  onClick={() =>
                    handleBulkUpdate({ package_mode: "ticket_only", base_flight_price: 0, base_hotel_price: 0 })
                  }
                >
                  Ticket only: ON (bases → 0; set each markup after)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkUpdate({ package_mode: "package" })}>
                  Ticket only: OFF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkUpdate({ skip_flight: true })}>
                  Skip flight: Yes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkUpdate({ skip_flight: false })}>
                  No (full package)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover open={bulkMarkupOpen} onOpenChange={setBulkMarkupOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  Ticket Markup
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Ticket-Only Markup (USD per ticket)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Applied to all {selectedIds.length} selected event(s). When
                    the customer skips both flight and hotel, they pay ticket
                    cost + this value. Clear = normal flow.
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="e.g. 25"
                  value={bulkMarkupInput}
                  onChange={(e) => setBulkMarkupInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleBulkTicketMarkup();
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleBulkTicketMarkup}
                    disabled={bulkLoading}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkTicketMarkupClear}
                    disabled={bulkLoading}
                  >
                    Clear markup
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Popover
              open={bulkTagOpen}
              onOpenChange={(o) => {
                setBulkTagOpen(o);
                if (o) {
                  setBulkTagIds([]);
                  setBulkTagMode("add");
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  Tags (feed)
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3">
                <p className="text-sm font-medium">
                  {bulkTagMode === "remove" ? "Remove tags from" : "Assign tags to"}{" "}
                  {selectedIds.length} event(s)
                </p>
                <EventTaxonomySelect
                  options={tagOptions}
                  value={bulkTagIds}
                  onChange={setBulkTagIds}
                  onOptionCreated={(o) => setTagOptions((p) => [...p, o])}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={bulkTagMode === "add" ? "default" : "outline"}
                    onClick={() => setBulkTagMode("add")}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant={bulkTagMode === "replace" ? "default" : "outline"}
                    onClick={() => setBulkTagMode("replace")}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant={bulkTagMode === "remove" ? "destructive" : "outline"}
                    onClick={() => setBulkTagMode("remove")}
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    className="ml-auto"
                    variant={bulkTagMode === "remove" ? "destructive" : "default"}
                    onClick={handleBulkAssignTags}
                    disabled={bulkLoading || bulkTagIds.length === 0}
                  >
                    Apply
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkLoading}
              onClick={handleBulkDelete}
            >
              {bulkLoading ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3 w-3" />
              )}
              Delete
            </Button>
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
