"use client";

import { useState, useEffect, useRef } from "react";
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
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";
import type { Event } from "@/types/app.types";
import {
  getEvents,
  softDeleteEvent,
  duplicateEvent,
  updateEvent,
  bulkUpdateEvents,
  bulkSoftDeleteEvents,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

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
                <span className="text-foreground">{opt.name || "-"}</span>
                <span className="shrink-0 text-muted-foreground">{opt.price || "-"}</span>
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
  const [bulkMarkupOpen, setBulkMarkupOpen] = useState(false);
  const [bulkMarkupInput, setBulkMarkupInput] = useState("");
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [pricingEvent, setPricingEvent] = useState<Event | null>(null);
  const [pricingLoadingProvider, setPricingLoadingProvider] =
    useState<CompetitorProvider | null>(null);
  const [dateMismatchDialog, setDateMismatchDialog] = useState<{
    provider: CompetitorProvider;
    eventId: number;
    priceUSD: number;
    rawPrice: number;
    isoCurrency: "USD" | "EUR" | "GBP" | "ILS";
    eventDate: string;
    foundDate: string;
    result?: CompetitorPricingResponse;
  } | null>(null);
  const [mismatchQueue, setMismatchQueue] = useState<NonNullable<typeof dateMismatchDialog>[]>([]);
  const [bulkCompPricingLoading, setBulkCompPricingLoading] = useState(false);
  const { toast } = useToast();
  const bulkDetailToastRef = useRef<ReturnType<typeof toast> | null>(null);

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
      !window.confirm(
        `Delete ${selectedIds.length} event(s)? They will be soft-deleted (marked as deleted, recoverable).`
      )
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

  const openCompetitorPricingDialog = (event: Event) => {
    setPricingEvent(event);
    setPricingDialogOpen(true);
  };

  // Shared comp pricing helpers - used by both single and bulk flows
  const normalizeCurrency = (raw: string | null | undefined): "USD" | "EUR" | "GBP" | "ILS" => {
    switch (raw) {
      case "€": return "EUR";
      case "£": return "GBP";
      case "₪": return "ILS";
      default:  return "USD";
    }
  };

  const toUSD = async (amount: number, iso: "USD" | "EUR" | "GBP" | "ILS"): Promise<number> => {
    if (iso === "USD") return amount;
    try {
      await exchangeRateClientService.updateAllExchangeRates();
      return await exchangeRateClientService.convertToUSD(amount, iso);
    } catch {
      return amount;
    }
  };

  const persistComp = async (
    currentEvent: Event,
    compPricing: NonNullable<Event["comp_pricing"]>
  ) => {
    const ticketPrices = (currentEvent.tickets_and_rates ?? [])
      .filter(t => t.available !== false)
      .map(t => t.price)
      .filter(p => p > 0);
    const minTicket = ticketPrices.length ? Math.min(...ticketPrices) : 0;
    const additionalMarkup = currentEvent.event_additional_markup ?? 0;
    const newUsualPrice =
      currentEvent.base_flight_price +
      currentEvent.base_hotel_price +
      minTicket + 175 + additionalMarkup;
    setEvents(prev => prev.map(e => e.id === currentEvent.id
      ? { ...e, comp_pricing: compPricing, usual_price: newUsualPrice }
      : e
    ));
    await updateEvent(currentEvent.id, { comp_pricing: compPricing, usual_price: newUsualPrice });
    return newUsualPrice;
  };

  // Pop next mismatch from queue (used by dialog close + color button handlers)
  const popMismatchQueue = () => {
    setMismatchQueue(prev => {
      if (prev.length === 0) {
        // No more mismatches — dismiss the persistent detail toast
        setTimeout(() => {
          bulkDetailToastRef.current?.dismiss();
          bulkDetailToastRef.current = null;
        }, 150);
        return prev;
      }
      const [next, ...remaining] = prev;
      setTimeout(() => {
        setDateMismatchDialog(next);
        if (next.result) {
          const nextEv = events.find(e => e.id === next.eventId);
          const eventName = `${COMPETITOR_PROVIDER_LABELS[next.result.provider]} · ${nextEv ? getCompetitorEventName(nextEv) : `Event ${next.eventId}`}`;
          const content = {
            title: eventName,
            description: renderCompetitorPricingDescription(next.result),
            duration: COMPETITOR_TOAST_DURATION,
            className: "sm:max-w-[560px]",
          };
          if (bulkDetailToastRef.current) {
            bulkDetailToastRef.current.update(content);
          }
        }
      }, 150);
      return remaining;
    });
  };

  const handleBulkCompetitorPricing = async (provider: CompetitorProvider) => {
    if (selectedIds.length === 0) return;
    const providerLabel = COMPETITOR_PROVIDER_LABELS[provider];
    const eventsToProcess = events.filter(e => selectedIds.includes(e.id));
    const total = eventsToProcess.length;

    setBulkCompPricingLoading(true);
    const progressToast = toast({
      title: `${providerLabel}: checking ${total} event${total > 1 ? "s" : ""}`,
      description: "Starting - processing in groups of 3...",
      duration: COMPETITOR_TOAST_DURATION,
    });

    const pendingMismatches: NonNullable<typeof dateMismatchDialog>[] = [];
    let completed = 0;
    let autoSaved = 0;
    let noResult = 0;
    let failed = 0;

    // Split into chunks of 3
    const chunks: Event[][] = [];
    for (let i = 0; i < eventsToProcess.length; i += 3) {
      chunks.push(eventsToProcess.slice(i, i + 3));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (currentEvent) => {
        try {
          const travelDates = getCompetitorTravelDates(currentEvent);
          const response = await fetch("/api/competitor-pricing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider,
              eventName: getCompetitorEventName(currentEvent),
              eventLocation: getCompetitorEventLocation(currentEvent),
              eventDate: normalizeDateInput(currentEvent.date),
              ...(provider === "liveevents" ? { travelDates } : {}),
            }),
          });

          if (!response.ok) { failed++; return; }

          const result = await response.json() as CompetitorPricingResponse;
          const resultData = result.data && typeof result.data === "object"
            ? result.data as Record<string, unknown> : null;
          const resultStatus = typeof resultData?.status === "string" ? resultData.status : null;

          if (!resultData) { failed++; return; }

          if (resultStatus === "OK") {
            const isstaMatch = resultData.match as { distanceDays?: number; foundDateRange?: string } | undefined;
            const isIsstaMismatch = provider === "issta" && typeof isstaMatch?.distanceDays === "number" && isstaMatch.distanceDays > 0;

            if (isIsstaMismatch) {
              const perPerson = resultData.finalPricePerPerson as { amount?: number | null; currency?: string | null } | undefined;
              const base = resultData.basePrice as { amount?: number | null; currency?: string | null } | undefined;
              const priceObj = perPerson ?? base;
              const rawPrice = typeof priceObj?.amount === "number" ? priceObj.amount : null;
              const iso = normalizeCurrency(priceObj?.currency);
              if (rawPrice !== null) {
                const priceUSD = Math.round(await toUSD(rawPrice, iso));
                pendingMismatches.push({ provider, eventId: currentEvent.id, priceUSD, rawPrice, isoCurrency: iso, eventDate: normalizeDateInput(currentEvent.date), foundDate: isstaMatch?.foundDateRange ?? "", result });
              } else { failed++; }
            } else {
              let rawPrice: number | null = null;
              let iso: "USD" | "EUR" | "GBP" | "ILS" = "USD";
              let returnedStart: string | null = null;
              let returnedEnd: string | null = null;

              if (provider === "liveevents") {
                const p = resultData.price as { amount?: number | null; currency?: string | null } | undefined;
                rawPrice = typeof p?.amount === "number" ? p.amount : null;
                iso = normalizeCurrency(p?.currency);
                const retDates = resultData.dates as { start?: string | null; end?: string | null } | undefined;
                returnedStart = retDates?.start ?? null;
                returnedEnd = retDates?.end ?? null;
              } else {
                const perPerson = resultData.finalPricePerPerson as { amount?: number | null; currency?: string | null } | undefined;
                const base = resultData.basePrice as { amount?: number | null; currency?: string | null } | undefined;
                const priceObj = perPerson ?? base;
                rawPrice = typeof priceObj?.amount === "number" ? priceObj.amount : null;
                iso = normalizeCurrency(priceObj?.currency);
              }

              if (rawPrice !== null) {
                const isLiveDateMismatch = provider === "liveevents" && (
                  (returnedStart && returnedStart !== travelDates.startDate) ||
                  (returnedEnd && returnedEnd !== travelDates.endDate)
                );
                if (isLiveDateMismatch) {
                  const priceUSD = Math.round(await toUSD(rawPrice, iso));
                  pendingMismatches.push({ provider, eventId: currentEvent.id, priceUSD, rawPrice, isoCurrency: iso, eventDate: `${travelDates.startDate} → ${travelDates.endDate}`, foundDate: [returnedStart, returnedEnd].filter(Boolean).join(" → "), result });
                } else {
                  const priceUSD = Math.round(await toUSD(rawPrice, iso));
                  await persistComp(currentEvent, { price: priceUSD, name: providerLabel, date: normalizeDateInput(currentEvent.date), status: "ok" });
                  autoSaved++;
                }
              } else { failed++; }
            }
          } else if (resultStatus === "DATE_NOT_PRESENT" || resultStatus === "DATE_QUOTE_ONLY") {
            const nearest = resultData.nearestAvailable as { price?: { amount?: number | null; currency?: string | null }; matchedDate?: string; date?: string } | undefined;
            const rawPrice = typeof nearest?.price?.amount === "number" ? nearest.price.amount : null;
            const iso = normalizeCurrency(nearest?.price?.currency);
            if (rawPrice !== null) {
              const priceUSD = Math.round(await toUSD(rawPrice, iso));
              pendingMismatches.push({ provider, eventId: currentEvent.id, priceUSD, rawPrice, isoCurrency: iso, eventDate: normalizeDateInput(currentEvent.date), foundDate: nearest?.matchedDate ?? nearest?.date ?? "", result });
            } else {
              // No usable price — treat as no result (blue)
              const noResultComp = { price: 0, name: providerLabel, date: normalizeDateInput(currentEvent.date), status: "no_result" as const };
              await updateEvent(currentEvent.id, { comp_pricing: noResultComp });
              setEvents(prev => prev.map(e => e.id === currentEvent.id ? { ...e, comp_pricing: noResultComp } : e));
              noResult++;
            }
          } else if (resultStatus && resultStatus !== "ERROR") {
            await updateEvent(currentEvent.id, { comp_pricing: { price: 0, name: providerLabel, date: normalizeDateInput(currentEvent.date), status: "no_result" } });
            setEvents(prev => prev.map(e => e.id === currentEvent.id ? { ...e, comp_pricing: { price: 0, name: providerLabel, date: normalizeDateInput(currentEvent.date), status: "no_result" } } : e));
            noResult++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        } finally {
          completed++;
          progressToast.update({
            title: `${providerLabel}: ${completed}/${total} checked`,
            description: `✓ ${autoSaved} saved · ⚠ ${pendingMismatches.length} need review · ✗ ${failed} failed`,
          });
        }
      }));
    }

    setBulkCompPricingLoading(false);
    setRowSelection({});

    progressToast.update({
      title: `${providerLabel} bulk check complete`,
      description: `${autoSaved} auto-saved · ${noResult} no result · ${pendingMismatches.length} need review · ${failed} failed`,
      duration: 8000,
    });

    if (pendingMismatches.length > 0) {
      const [first, ...rest] = pendingMismatches;
      setMismatchQueue(rest);
      setTimeout(() => {
        setDateMismatchDialog(first);
        if (first.result) {
          const ev = events.find(e => e.id === first.eventId);
          const eventName = `${COMPETITOR_PROVIDER_LABELS[first.result.provider]} · ${ev ? getCompetitorEventName(ev) : `Event ${first.eventId}`}`;
          bulkDetailToastRef.current = toast({
            title: eventName,
            description: renderCompetitorPricingDescription(first.result),
            duration: COMPETITOR_TOAST_DURATION,
            className: "sm:max-w-[560px]",
          });
        }
      }, 300);
    }
  };

  const handleCompetitorPricingCheck = async (provider: CompetitorProvider) => {
    if (!pricingEvent) return;

    const currentEvent = pricingEvent;
    const providerLabel = COMPETITOR_PROVIDER_LABELS[provider];
    const eventName = getCompetitorEventName(currentEvent);
    const eventLocation = getCompetitorEventLocation(currentEvent);
    const travelDates = getCompetitorTravelDates(currentEvent);

    // Closure-local persistComp wrapper for single-event flow
    const persistCompSingle = (compPricing: NonNullable<Event["comp_pricing"]>) =>
      persistComp(currentEvent, compPricing);

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

      // Persist comp_pricing based on the result status
      const resultData = result.data && typeof result.data === "object"
        ? result.data as Record<string, unknown>
        : null;
      const resultStatus = typeof resultData?.status === "string" ? resultData.status : null;

      // Shared helper: convert symbol currency to ISO
      const normalizeCurrencyLocal = normalizeCurrency;

      // Shared helper: convert price to USD
      const toUSDLocal = toUSD;

      // Shared helper: save comp + recalc usual price
      const persistCompLocal = async (
        compPricing: NonNullable<Event["comp_pricing"]>
      ) => persistCompSingle(compPricing);

      if (!resultData) {
        // Nothing actionable
      } else if (resultStatus === "OK") {
        // --- CONFIRMED MATCH ---
        // Check ISSTA date mismatch: status is OK but distanceDays > 0
        const isstaMatch = resultData.match as { distanceDays?: number; foundDateRange?: string } | undefined;
        const isIsstaMismatch = provider === "issta" && typeof isstaMatch?.distanceDays === "number" && isstaMatch.distanceDays > 0;

        if (isIsstaMismatch) {
          // Extract price for the dialog
          const perPerson = resultData.finalPricePerPerson as { amount?: number | null; currency?: string | null } | undefined;
          const base = resultData.basePrice as { amount?: number | null; currency?: string | null } | undefined;
          const priceObj = perPerson ?? base;
          const rawPrice = typeof priceObj?.amount === "number" ? priceObj.amount : null;
          const iso = normalizeCurrencyLocal(priceObj?.currency);
          if (rawPrice !== null) {
            const priceUSD = Math.round(await toUSDLocal(rawPrice, iso));
            setDateMismatchDialog({
              provider,
              eventId: currentEvent.id,
              priceUSD,
              rawPrice,
              isoCurrency: iso,
              eventDate: normalizeDateInput(currentEvent.date),
              foundDate: isstaMatch?.foundDateRange ?? "",
            });
          }
        } else {
          // Clean OK match - but first verify dates for LiveEvents
          try {
            let rawPrice: number | null = null;
            let iso: "USD" | "EUR" | "GBP" | "ILS" = "USD";
            let returnedStart: string | null = null;
            let returnedEnd: string | null = null;

            if (provider === "liveevents") {
              const p = resultData.price as { amount?: number | null; currency?: string | null } | undefined;
              rawPrice = typeof p?.amount === "number" ? p.amount : null;
              iso = normalizeCurrencyLocal(p?.currency);
              const retDates = resultData.dates as { start?: string | null; end?: string | null } | undefined;
              returnedStart = retDates?.start ?? null;
              returnedEnd = retDates?.end ?? null;
            } else {
              const perPerson = resultData.finalPricePerPerson as { amount?: number | null; currency?: string | null } | undefined;
              const base = resultData.basePrice as { amount?: number | null; currency?: string | null } | undefined;
              const priceObj = perPerson ?? base;
              rawPrice = typeof priceObj?.amount === "number" ? priceObj.amount : null;
              iso = normalizeCurrencyLocal(priceObj?.currency);
            }

            if (rawPrice !== null) {
              // For LiveEvents: verify returned dates match what we sent
              const isLiveDateMismatch = provider === "liveevents" && (
                (returnedStart && returnedStart !== travelDates.startDate) ||
                (returnedEnd && returnedEnd !== travelDates.endDate)
              );

              if (isLiveDateMismatch) {
                const priceUSD = Math.round(await toUSDLocal(rawPrice, iso));
                const foundDate = [returnedStart, returnedEnd].filter(Boolean).join(" → ");
                setDateMismatchDialog({
                  provider,
                  eventId: currentEvent.id,
                  priceUSD,
                  rawPrice,
                  isoCurrency: iso,
                  eventDate: `${travelDates.startDate} → ${travelDates.endDate}`,
                  foundDate,
                });
              } else {
                const priceUSD = Math.round(await toUSDLocal(rawPrice, iso));
                const compPricing: NonNullable<Event["comp_pricing"]> = {
                  price: priceUSD,
                  name: COMPETITOR_PROVIDER_LABELS[provider],
                  date: normalizeDateInput(currentEvent.date),
                  status: "ok",
                };
                const newUsualPrice = await persistCompLocal(compPricing);
                const ticketPricesForToast = (currentEvent.tickets_and_rates ?? []).filter(t => t.available !== false).map(t => t.price).filter(p => p > 0);
                const minTicketForToast = ticketPricesForToast.length ? Math.min(...ticketPricesForToast) : 0;
                const priceParts = [
                  `flight $${currentEvent.base_flight_price}`,
                  `hotel $${currentEvent.base_hotel_price}`,
                  `ticket $${minTicketForToast}`,
                  `$175 margin`,
                  ...(currentEvent.event_additional_markup ? [`+$${currentEvent.event_additional_markup} markup`] : []),
                ].join(" + ");
                toast({
                  title: "Competitor price saved",
                  description: `${COMPETITOR_PROVIDER_LABELS[provider]}: ${rawPrice}${iso !== "USD" ? ` ${iso} → ` : " "}$${priceUSD} · Our price $${newUsualPrice} (${priceParts})`,
                });
              }
            }
          } catch (err) {
            toast({ variant: "destructive", title: "Failed to save competitor price", description: err instanceof Error ? err.message : "Unknown error." });
          }
        }

      } else if (resultStatus === "DATE_NOT_PRESENT" || resultStatus === "DATE_QUOTE_ONLY") {
        // --- LIVEEVENTS DATE MISMATCH ---
        const nearest = resultData.nearestAvailable as { price?: { amount?: number | null; currency?: string | null }; matchedDate?: string; date?: string } | undefined;
        const rawPrice = typeof nearest?.price?.amount === "number" ? nearest.price.amount : null;
        const iso = normalizeCurrencyLocal(nearest?.price?.currency);
        if (rawPrice !== null) {
          const priceUSD = Math.round(await toUSDLocal(rawPrice, iso));
          setDateMismatchDialog({
            provider,
            eventId: currentEvent.id,
            priceUSD,
            rawPrice,
            isoCurrency: iso,
            eventDate: normalizeDateInput(currentEvent.date),
            foundDate: nearest?.matchedDate ?? nearest?.date ?? "",
          });
        } else {
          // No usable price from nearestAvailable — treat as no result (blue)
          try {
            const compPricing: NonNullable<Event["comp_pricing"]> = {
              price: 0,
              name: COMPETITOR_PROVIDER_LABELS[provider],
              date: normalizeDateInput(currentEvent.date),
              status: "no_result",
            };
            setEvents(prev => prev.map(e => e.id === currentEvent.id ? { ...e, comp_pricing: compPricing } : e));
            await updateEvent(currentEvent.id, { comp_pricing: compPricing });
            toast({ title: "Competitor: no result", description: `${COMPETITOR_PROVIDER_LABELS[provider]} has no package for this event (${resultStatus}).` });
          } catch {
            // silent
          }
        }

      } else if (resultStatus && !["ERROR"].includes(resultStatus)) {
        // --- NO RESULT (CITY_NOT_FOUND, NO_MATCH, NO_PACKAGE, NO_CTA, etc.) ---
        try {
          const compPricing: NonNullable<Event["comp_pricing"]> = {
            price: 0,
            name: COMPETITOR_PROVIDER_LABELS[provider],
            date: normalizeDateInput(currentEvent.date),
            status: "no_result",
          };
          setEvents(prev => prev.map(e => e.id === currentEvent.id ? { ...e, comp_pricing: compPricing } : e));
          await updateEvent(currentEvent.id, { comp_pricing: compPricing });
          toast({ title: "Competitor: no result", description: `${COMPETITOR_PROVIDER_LABELS[provider]} has no package for this event (${resultStatus}).` });
        } catch {
          // silent
        }
      }
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
        const comp = event.comp_pricing ?? null;
        const compPrice = comp?.price ?? null;

        let priceColor = "";
        if (comp) {
          if (comp.status === "no_result") {
            priceColor = "text-blue-400";
          } else if (comp.status === "date_mismatch" && comp.colorOverride) {
            priceColor = comp.colorOverride === "green" ? "text-green-500"
              : comp.colorOverride === "yellow" ? "text-yellow-500"
              : comp.colorOverride === "blue" ? "text-blue-400"
              : "text-red-500";
          } else if (compPrice !== null && !isNaN(price)) {
            priceColor = price < compPrice ? "text-green-500"
              : price - compPrice <= 100 ? "text-yellow-500"
              : "text-red-500";
          }
        }

        const tooltipLines: string[] = [];
        if (comp) {
          if (comp.status === "no_result") {
            tooltipLines.push(`${comp.name} has no package for this event`);
          } else if (comp.status === "date_mismatch") {
            tooltipLines.push(`${comp.name}: $${comp.price} (date mismatch)`);
            if (comp.foundDate) tooltipLines.push(`Found: ${comp.foundDate} · Queried: ${comp.date}`);
          } else {
            tooltipLines.push(`${comp.name}: $${comp.price}`);
          }
          tooltipLines.push(`Checked: ${comp.date}`);
        }
        const tooltipText = tooltipLines.join("\n") || undefined;

        const handleClick = async () => {
          setCalculating(true);
          try {
            await handleAutoCalculatePrice(event.id);
          } catch {
            toast({ variant: "destructive", title: "Error", description: "Failed to calculate price." });
          } finally {
            setCalculating(false);
          }
        };

        return (
          <div className="flex items-center gap-1">
            <span
              className={priceColor}
              title={tooltipText}
            >
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

      {/* Date mismatch dialog */}
      <Dialog open={!!dateMismatchDialog} onOpenChange={(open) => {
        if (!open) {
          setDateMismatchDialog(null);
          popMismatchQueue();
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Date mismatch - choose a label
              {mismatchQueue.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({mismatchQueue.length} more after this)
                </span>
              )}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                {dateMismatchDialog && (
                  <>
                    <p>
                      We queried <strong>{dateMismatchDialog.eventDate}</strong> but{" "}
                      {COMPETITOR_PROVIDER_LABELS[dateMismatchDialog.provider]} returned a result for{" "}
                      <strong>{dateMismatchDialog.foundDate || "a different date"}</strong>.
                    </p>
                    <p>
                      Competitor price:{" "}
                      <strong>
                        {dateMismatchDialog.rawPrice}
                        {dateMismatchDialog.isoCurrency !== "USD"
                          ? ` ${dateMismatchDialog.isoCurrency} → $${dateMismatchDialog.priceUSD}`
                          : ` ($${dateMismatchDialog.priceUSD})`}
                      </strong>
                    </p>
                    {(() => {
                      const ev = events.find(e => e.id === dateMismatchDialog.eventId);
                      if (!ev) return null;
                      const ticketPrices = (ev.tickets_and_rates ?? [])
                        .filter(t => t.available !== false).map(t => t.price).filter(p => p > 0);
                      const minTicket = ticketPrices.length ? Math.min(...ticketPrices) : 0;
                      const additionalMarkup = ev.event_additional_markup ?? 0;
                      const ourPrice = ev.base_flight_price + ev.base_hotel_price + minTicket + 175 + additionalMarkup;
                      return (
                        <p>
                          Our price:{" "}
                          <strong>${ourPrice}</strong>
                          <span className="ml-1 text-muted-foreground">
                            (flight ${ev.base_flight_price} + hotel ${ev.base_hotel_price} + ticket ${minTicket} + $175
                            {additionalMarkup ? ` + $${additionalMarkup} markup` : ""})
                          </span>
                        </p>
                      );
                    })()}
                    <p className="font-medium text-destructive">
                      Dates do not match - the competitor result may be for a different event or package.
                    </p>
                    <p>How do you want to flag this event?</p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 pt-2">
            {(["green", "yellow", "red", "blue"] as const).map((color) => (
              <Button
                key={color}
                type="button"
                variant="outline"
                className={
                  color === "green" ? "border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950" :
                  color === "yellow" ? "border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950" :
                  color === "blue" ? "border-blue-400 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950" :
                  "border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                }
                onClick={async () => {
                  if (!dateMismatchDialog) return;
                  const d = dateMismatchDialog;
                  setDateMismatchDialog(null);
                  popMismatchQueue();
                  try {
                    const compPricing: NonNullable<Event["comp_pricing"]> = {
                      price: d.priceUSD,
                      name: COMPETITOR_PROVIDER_LABELS[d.provider],
                      date: d.eventDate,
                      foundDate: d.foundDate,
                      status: "date_mismatch",
                      colorOverride: color,
                    };
                    const ev = events.find(e => e.id === d.eventId)!;
                    const ticketPrices = (ev?.tickets_and_rates ?? [])
                      .filter(t => t.available !== false).map(t => t.price).filter(p => p > 0);
                    const minTicket = ticketPrices.length ? Math.min(...ticketPrices) : 0;
                    const additionalMarkup = ev.event_additional_markup ?? 0;
                    const newUsualPrice = ev.base_flight_price + ev.base_hotel_price + minTicket + 175 + additionalMarkup;
                    setEvents(prev => prev.map(e => e.id === d.eventId ? { ...e, comp_pricing: compPricing, usual_price: newUsualPrice } : e));
                    await updateEvent(d.eventId, { comp_pricing: compPricing, usual_price: newUsualPrice });
                    toast({ title: "Competitor price saved (date mismatch)", description: `Marked ${color} · comp $${d.priceUSD} (found: ${d.foundDate || "unknown date"}) · our price $${newUsualPrice}` });
                  } catch (err) {
                    toast({ variant: "destructive", title: "Failed to save", description: err instanceof Error ? err.message : "Unknown error." });
                  }
                }}
              >
                {color === "green" ? "🟢 Cheaper"
                  : color === "yellow" ? "🟡 Approximate"
                  : color === "blue" ? "🔵 No exact match"
                  : "🔴 More expensive"}
              </Button>
            ))}
          </div>
          <div className="pt-1">
            <Button type="button" variant="ghost" className="w-full" onClick={() => {
              setDateMismatchDialog(null);
              popMismatchQueue();
            }}>
              Discard - don't save
              {mismatchQueue.length > 0 && ` (${mismatchQueue.length} more remaining)`}
            </Button>
          </div>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading || bulkCompPricingLoading}>
                  {bulkCompPricingLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Search className="mr-1 h-3 w-3" />}
                  Check Pricing
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Check competitor pricing</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBulkCompetitorPricing("liveevents")} disabled={bulkCompPricingLoading}>
                  LiveEvents
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkCompetitorPricing("issta")} disabled={bulkCompPricingLoading}>
                  ISSTA
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
