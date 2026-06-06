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
  Search,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COMMON_TAGS = ["Sold", "Hot", "Selling Fast", "Limited Availability", "New"];
const COMPETITOR_TOAST_DURATION = 2_147_483_647;
const COMPETITOR_PROVIDER_LABELS = {
  liveevents: "LiveEvents",
  issta: "ISSTA",
} as const;

type CompetitorProvider = keyof typeof COMPETITOR_PROVIDER_LABELS;

type CompetitorPricingResponse = {
  provider: CompetitorProvider;
  upstreamStatus?: number;
  data?: unknown;
  error?: string;
};

type PricingAmount = {
  amount?: number | null;
  currency?: string | null;
  rawText?: string | null;
};

type PricingStatusPayload = {
  status?: string;
  reason?: string;
};

type LiveEventsPricingPayload = PricingStatusPayload & {
  requestedCity?: string;
  price?: PricingAmount;
  dates?: {
    start?: string;
    end?: string;
  };
  hotel?: {
    name?: string;
    stars?: number | null;
  };
  flight?: {
    isDirect?: boolean;
    raw?: string;
  };
  ticket?: {
    raw?: string;
    rawText?: string;
    options?: { name?: string; price?: string }[];
  };
  popupText?: string;
  requestedDateOption?: LiveEventsAvailabilityOption;
  nearestAvailable?: LiveEventsAvailabilityOption;
  availableOptions?: LiveEventsAvailabilityOption[];
};

type LiveEventsAvailabilityOption = {
  city?: string;
  date?: string;
  price?: PricingAmount;
  availability?: string;
  ctaText?: string;
  matchedDate?: string;
};

type IsstaPricingPayload = PricingStatusPayload & {
  basePrice?: PricingAmount;
  finalPricePerPerson?: PricingAmount;
  finalPriceTotal?: PricingAmount;
  match?: {
    foundDateRange?: string;
    requestedDate?: string;
  };
  hotel?: {
    name?: string;
    stars?: number | null;
  };
  ticket?: {
    requested?: string;
    requestedCategory?: number;
  };
  flightDetails?: {
    isDirect?: boolean;
    rawText?: string;
  };
};

type EventTypeBadgeVariant = "default" | "secondary" | "outline" | "destructive";

function normalizeDateInput(value: string | undefined) {
  return value?.split("T")[0] || "";
}

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

function getCompetitorEventName(event: Event) {
  return event.name?.trim() || event.name_english?.trim() || `Event ${event.id}`;
}

function getCompetitorEventLocation(event: Event) {
  return event.location?.name?.trim() ?? "";
}

function getCompetitorTravelDates(event: Event) {
  const defaults = calculateSmartDates(event.date);

  return {
    startDate: normalizeDateInput(event.def_date_depart) || defaults.startDate,
    endDate: normalizeDateInput(event.def_date_return) || defaults.endDate,
  };
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

function formatPriceLabel(value: { amount?: number | null; currency?: string | null } | null | undefined) {
  if (typeof value?.amount !== "number") return "-";
  return value.currency
    ? `${value.amount.toLocaleString()} ${value.currency}`
    : value.amount.toLocaleString();
}

function renderSummaryCard(label: string, value: string) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium leading-snug">{value}</div>
    </div>
  );
}

function renderRawBlock(label: string, value: string | null | undefined) {
  if (!value) return null;

  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function renderAvailabilityOption(
  label: string,
  option: LiveEventsAvailabilityOption | null | undefined,
) {
  if (!option) return null;

  const meta = [
    option.city,
    option.date ? formatDateLabel(option.date) : undefined,
    option.availability,
  ].filter(Boolean);

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">
        {formatPriceLabel(option.price)}
      </div>
      {meta.length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">{meta.join(" · ")}</div>
      )}
      {option.ctaText && (
        <div className="mt-1 text-xs text-muted-foreground">CTA: {option.ctaText}</div>
      )}
      {option.matchedDate && (
        <div className="mt-1 text-xs text-muted-foreground">
          Matched date: {formatDateLabel(option.matchedDate)}
        </div>
      )}
    </div>
  );
}

function renderAvailabilityOptions(
  label: string,
  options: LiveEventsAvailabilityOption[] | null | undefined,
) {
  if (!options?.length) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="grid gap-2">
        {options.map((option, index) => (
          <div key={`${option.city || "city"}-${option.date || "date"}-${index}`}>
            {renderAvailabilityOption(`Option ${index + 1}`, option)}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderLiveEventsDescription(data: LiveEventsPricingPayload) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {renderSummaryCard("Package price", formatPriceLabel(data.price))}
        {renderSummaryCard("Requested city", data.requestedCity || "-")}
        {renderSummaryCard(
          "Dates",
          data.dates?.start && data.dates?.end
            ? `${formatDateLabel(data.dates.start)} → ${formatDateLabel(data.dates.end)}`
            : "-"
        )}
        {renderSummaryCard(
          "Hotel",
          data.hotel?.name
            ? `${data.hotel.name}${data.hotel?.stars ? ` · ${data.hotel.stars}★` : ""}`
            : "-"
        )}
        {renderSummaryCard(
          "Flight",
          typeof data.flight?.isDirect === "boolean"
            ? data.flight.isDirect
              ? "Direct"
              : "Not direct"
            : "-"
        )}
      </div>
      {renderAvailabilityOption("Requested date option", data.requestedDateOption)}
      {renderAvailabilityOption("Nearest available", data.nearestAvailable)}
      {renderAvailabilityOptions("Available options", data.availableOptions)}
      {renderRawBlock("Popup", data.popupText)}
      {data.ticket?.options?.length ? (
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ticket</div>
          <div className="mt-2 space-y-1">
            {data.ticket.options.map((opt, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground">{opt.name || "—"}</span>
                <span className="shrink-0 text-muted-foreground">{opt.price || "—"}</span>
              </div>
            ))}
          </div>
          {(data.ticket.rawText || data.ticket.raw) && (
            <div className="mt-2 max-h-16 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground border-t pt-1">
              {data.ticket.rawText ?? data.ticket.raw}
            </div>
          )}
        </div>
      ) : (
        renderRawBlock("Ticket", data.ticket?.rawText ?? data.ticket?.raw)
      )}
      {renderRawBlock("Flight", data.flight?.raw)}
    </div>
  );
}

function renderIsstaDescription(data: IsstaPricingPayload) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {renderSummaryCard(
          "Per person",
          formatPriceLabel(data.finalPricePerPerson || data.basePrice)
        )}
        {renderSummaryCard("Total", formatPriceLabel(data.finalPriceTotal))}
        {renderSummaryCard(
          "Match window",
          data.match?.foundDateRange || formatDateLabel(data.match?.requestedDate)
        )}
        {renderSummaryCard(
          "Hotel",
          data.hotel?.name
            ? `${data.hotel.name}${data.hotel?.stars ? ` · ${data.hotel.stars}★` : ""}`
            : "-"
        )}
        {renderSummaryCard(
          "Ticket",
          data.ticket?.requested || (typeof data.ticket?.requestedCategory === "number"
            ? `Category ${data.ticket.requestedCategory}`
            : "-")
        )}
        {renderSummaryCard(
          "Flight",
          typeof data.flightDetails?.isDirect === "boolean"
            ? data.flightDetails.isDirect
              ? "Direct"
              : "Not direct"
            : "-"
        )}
      </div>
      {renderRawBlock("Flight details", data.flightDetails?.rawText)}
    </div>
  );
}

function renderCompetitorPricingDescription(response: CompetitorPricingResponse) {
  const data =
    response.data && typeof response.data === "object"
      ? (response.data as PricingStatusPayload)
      : null;
  const status = typeof data?.status === "string" ? data.status : response.error ? "ERROR" : "UNKNOWN";

  if (!data) {
    return (
      <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        {response.error || "No response payload returned."}
      </div>
    );
  }

  return (
    <div className="mt-3 max-h-[60vh] overflow-y-auto space-y-3 text-xs pr-1">
      <div className="flex flex-wrap gap-2">
        <Badge variant={status === "OK" ? "default" : "secondary"}>{status}</Badge>
        {typeof response.upstreamStatus === "number" && (
          <Badge variant="outline">HTTP {response.upstreamStatus}</Badge>
        )}
      </div>
      {data.reason && (
        <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {String(data.reason)}
        </div>
      )}
      {response.provider === "liveevents"
        ? renderLiveEventsDescription(data as LiveEventsPricingPayload)
        : renderIsstaDescription(data as IsstaPricingPayload)}
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
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [pricingEvent, setPricingEvent] = useState<Event | null>(null);
  const [pricingLoadingProvider, setPricingLoadingProvider] =
    useState<CompetitorProvider | null>(null);
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

  const openCompetitorPricingDialog = (event: Event) => {
    setPricingEvent(event);
    setPricingDialogOpen(true);
  };

  const handleCompetitorPricingCheck = async (provider: CompetitorProvider) => {
    if (!pricingEvent) return;

    const currentEvent = pricingEvent;
    const providerLabel = COMPETITOR_PROVIDER_LABELS[provider];
    const eventName = getCompetitorEventName(currentEvent);
    const eventLocation = getCompetitorEventLocation(currentEvent);
    const travelDates = getCompetitorTravelDates(currentEvent);

    setPricingLoadingProvider(provider);

    const toastHandle = toast({
      title: `Checking ${providerLabel} pricing`,
      description: (
        <div className="mt-1 flex items-start gap-3 text-sm">
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
          <div className="space-y-1">
            <div className="font-medium leading-snug">{eventName}</div>
            {eventLocation && (
              <div className="text-muted-foreground">{String(eventLocation)}</div>
            )}
            <div className="text-muted-foreground">
              This request usually takes 30 to 40 seconds. You can keep working while it runs.
            </div>
          </div>
        </div>
      ),
      duration: COMPETITOR_TOAST_DURATION,
      className: "sm:max-w-[560px]",
    });

    setPricingDialogOpen(false);

    try {
      const response = await fetch("/api/competitor-pricing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          eventName,
          eventLocation,
          eventDate: normalizeDateInput(currentEvent.date),
          ...(provider === "liveevents" ? { travelDates } : {}),
        }),
      });

      const result = (await response.json()) as CompetitorPricingResponse;

      if (!response.ok) {
        throw new Error(result.error || `Request failed with status ${response.status}.`);
      }

      // HTTP 200 is never an error regardless of business status (DATE_QUOTE_ONLY, etc.)
      toastHandle.update({
        title: `${providerLabel} pricing result`,
        description: renderCompetitorPricingDescription(result),
        variant: "default",
        duration: COMPETITOR_TOAST_DURATION,
        className: "sm:max-w-[560px]",
      });
    } catch (error) {
      toastHandle.update({
        title: `${providerLabel} pricing failed`,
        description: (
          <div className="mt-2 space-y-2 text-sm">
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
              {error instanceof Error ? error.message : "Unknown error while checking competitor pricing."}
            </div>
            <div className="text-muted-foreground">
              The proxy expects the scraper service to be reachable from the Next.js server at localhost:8080 unless overridden with NEXT_SECRET_COMPETITOR_PRICING_URL.
            </div>
          </div>
        ),
        variant: "destructive",
        duration: COMPETITOR_TOAST_DURATION,
        className: "sm:max-w-[560px]",
      });
    } finally {
      setPricingLoadingProvider(null);
      setPricingEvent(null);
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
      cell: ({ row }) => {
        const [calculating, setCalculating] = useState(false);
        const event = row.original;
        const price = Number.parseFloat(row.getValue("usual_price"));

        const autoCalculatePrice = async () => {
          const { def_date_depart, def_date_return, date, location, tickets_and_rates, skip_flight } = event;

          const smartDates = calculateSmartDates(date);
          const checkin = def_date_depart?.split("T")[0] || smartDates.startDate;
          const checkout = def_date_return?.split("T")[0] || smartDates.endDate;

          const cityIata = location?.city_iata;
          const lat = location?.latitude;
          const lon = location?.longitude;

          const ticketPrices = (tickets_and_rates ?? []).filter(t => t.available !== false).map(t => t.price).filter(p => p > 0);
          const minTicket = ticketPrices.length ? Math.min(...ticketPrices) : 0;

          setCalculating(true);
          try {
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
              e.id === event.id ? { ...e, usual_price: newUsualPrice, base_flight_price: newFlightPrice, base_hotel_price: newHotelPrice } : e
            ));
            await updateEvent(event.id, { usual_price: newUsualPrice, base_flight_price: newFlightPrice, base_hotel_price: newHotelPrice });

            const parts = skip_flight
              ? `hotel $${newHotelPrice} + ticket $${minTicket} + $175 margin`
              : `flight $${newFlightPrice} + hotel $${newHotelPrice} + ticket $${minTicket} + $175 margin`;
            toast({ title: `Usual price set to $${newUsualPrice}`, description: parts });
          } catch {
            toast({ variant: "destructive", title: "Error", description: "Failed to calculate price." });
          } finally {
            setCalculating(false);
          }
        };

        return (
          <div className="flex items-center gap-1">
            <span>${isNaN(price) ? "0.00" : price.toFixed(2)}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              title="Auto-calculate: flight + hotel + cheapest ticket + $175"
              disabled={calculating}
              onClick={autoCalculatePrice}
            >
              {calculating
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        );
      },
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
                <DropdownMenuItem
                  onSelect={() => openCompetitorPricingDialog(event)}
                  className="flex items-center"
                >
                  <Search className="h-4 w-4 mr-2" />
                  <span>Check competitor pricing</span>
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
      <Dialog
        open={pricingDialogOpen}
        onOpenChange={(open) => {
          setPricingDialogOpen(open);
          if (!open && !pricingLoadingProvider) {
            setPricingEvent(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Check competitor pricing</DialogTitle>
            <DialogDescription>
              {pricingEvent
                ? `Choose which competitor to query for ${getCompetitorEventName(pricingEvent)}.`
                : "Choose which competitor to query."}
            </DialogDescription>
          </DialogHeader>
          {pricingEvent && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{getCompetitorEventName(pricingEvent)}</div>
              {pricingEvent && getCompetitorEventLocation(pricingEvent) && (
                <div className="mt-1 text-muted-foreground">
                  {getCompetitorEventLocation(pricingEvent)}
                </div>
              )}
              <div className="mt-1 text-muted-foreground">Event date {formatDateLabel(pricingEvent.date)}</div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-start sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCompetitorPricingCheck("liveevents")}
              disabled={Boolean(pricingLoadingProvider)}
              className="sm:flex-1"
            >
              {pricingLoadingProvider === "liveevents" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              LiveEvents
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCompetitorPricingCheck("issta")}
              disabled={Boolean(pricingLoadingProvider)}
              className="sm:flex-1"
            >
              {pricingLoadingProvider === "issta" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              ISSTA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
