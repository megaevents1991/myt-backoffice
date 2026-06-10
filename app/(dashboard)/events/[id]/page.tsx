"use client";

import type React from "react";
import { useState, useEffect, use, useLayoutEffect, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2, AlertTriangle, Loader2, Crown, Plane, ExternalLink, BedDouble } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { Event, EventTicket, EventType } from "@/types/app.types";
import {
  getEvent,
  updateEvent,
  createEvent,
} from "@/lib/actions/event-actions";
import { airportsMatch } from "@/lib/airport-cities";
import { ColorPicker } from "@/components/color-picker";
import { ImageFilePicker } from "@/components/image-file-picker";
import { ArtBlobPicker } from "@/components/art-blob-picker";
import { v4 as uuidv4 } from "uuid";
import { 
  searchFlightPrices, 
  isValidIATACode 
} from "@/lib/actions/flight-actions";
import { getLocations } from "@/lib/actions/location-actions";
import type { Location } from "@/types/location.types";
import { searchHotelPrices } from "@/lib/actions/hotel-actions";
import { getTixStockTickets } from "@/lib/actions/tixstock-actions";
import type { TixStockListing } from "@/types/tixstock.types";
import { exchangeRateClientService, type SupportedCurrency } from "@/lib/services/exchange-rate-client";
import {
  getFlightsByEventId,
  getOfflineFlights,
  addEventToFlight,
  removeEventFromFlight,
  createOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import type { OfflineFlight } from "@/types/offline-flight.types";
import { InlineFlightForm, type StagedFlightData } from "@/components/inline-flight-form";
import {
  getHotelsByEventId,
  getOfflineHotels,
  addEventToHotel,
  removeEventFromHotel,
  createOfflineHotel,
} from "@/lib/actions/offline-hotel-actions";
import type { OfflineHotel } from "@/types/offline-hotel.types";
import { InlineHotelForm, type StagedHotelData } from "@/components/inline-hotel-form";
import { getOfflineRoomCapacity } from "@/lib/offlineRoomCapacity";

const TX_TICKET_COLOR = "rgb(5, 32, 60)";

export default function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const unwrappedParams = use(params);
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchingFlights, setSearchingFlights] = useState(false);
  const [searchingHotels, setSearchingHotels] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");

  const [linkedFlights, setLinkedFlights] = useState<OfflineFlight[]>([]);
  const [isLoadingLinkedFlights, setIsLoadingLinkedFlights] = useState(false);
  const [flightPanel, setFlightPanel] = useState<"add" | "link" | null>(null);
  const [stagedFlights, setStagedFlights] = useState<StagedFlightData[]>([]);
  const [allFlights, setAllFlights] = useState<OfflineFlight[]>([]);
  const [isLoadingAllFlights, setIsLoadingAllFlights] = useState(false);

  const [linkedHotels, setLinkedHotels] = useState<OfflineHotel[]>([]);
  const [isLoadingLinkedHotels, setIsLoadingLinkedHotels] = useState(false);
  const [hotelPanel, setHotelPanel] = useState<"add" | "link" | null>(null);
  const [stagedHotels, setStagedHotels] = useState<StagedHotelData[]>([]);
  const [allHotels, setAllHotels] = useState<OfflineHotel[]>([]);
  const [isLoadingAllHotels, setIsLoadingAllHotels] = useState(false);

  // TixStock preview state (map + source tickets)
  const [tixStockTickets, setTixStockTickets] = useState<TixStockListing[]>([]);
  const [isLoadingTixStockTickets, setIsLoadingTixStockTickets] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [mapCategoryIds, setMapCategoryIds] = useState<string[] | null>(null);
  const [hoveredTixTicket, setHoveredTixTicket] = useState<TixStockListing | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [excludeSectionsMode, setExcludeSectionsMode] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const isNewEvent = unwrappedParams.id === "new";

  useEffect(() => {
    async function fetchEvent() {
      if (isNewEvent) {
        // Check if there's pre-populated data from sports events
        const dataParam = searchParams.get("data");

        if (dataParam) {
          try {
            const prePopulatedData = JSON.parse(
              decodeURIComponent(dataParam)
            ) as Omit<Event, "id">;

            // Apply smart date calculation if we have an event date
            const finalData = { ...prePopulatedData };
            finalData.event_additional_markup ??= null;
            if (prePopulatedData.date) {
              const smartDates = calculateSmartDates(prePopulatedData.date);
              finalData.def_date_depart = smartDates.departure;
              finalData.def_date_return = smartDates.return;
            }

            // For TixStock-created events, start with empty editable tickets.
            // User will add reviewed tickets manually from the Source Tickets list.
            if (finalData.type === "tx_event") {
              finalData.tickets_and_rates = [];
            }

            setEvent({
              id: 0,
              ...finalData,
            });
          } catch (error) {
            console.error("Failed to parse pre-populated data:", error);
            toast({
              variant: "destructive",
              title: "Error",
              description:
                "Failed to load pre-populated data. Using default values.",
            });
            // Fall back to default empty event
            setEvent({
              id: 0,
              name: "",
              name_english: "",
              type: "music_event", // Default type for manually created events
              date: new Date().toISOString().split("T")[0],
              location: {
                latitude: 0,
                longitude: 0,
                name: "",
                city_iata: "",
              },
              map_image_url: "",
              description: "",
              card_image_url: "",
              tickets_and_rates: [],
              def_date_depart: "",
              def_date_return: "",
              usual_price: 0,
              base_flight_price: 0,
              base_hotel_price: 0,
              is_prioritized: false,
              skip_flight: false,
              skip_flight_markup: null,
              event_additional_markup: null,
              is_deleted: "",
              tags: "",
            });
          }
        } else {
          // Default empty event
          setEvent({
            id: 0,
            name: "",
            name_english: "",
            type: "music_event", // Default type for manually created events
            date: new Date().toISOString().split("T")[0],
            location: {
              latitude: 0,
              longitude: 0,
              name: "",
              city_iata: "",
              country_code: "",
            },
            map_image_url: "",
            description: "",
            card_image_url: "",
            tickets_and_rates: [],
            def_date_depart: "",
            def_date_return: "",
            usual_price: 0,
            base_flight_price: 0,
            base_hotel_price: 0,
            is_prioritized: false,
            skip_flight: false,
            skip_flight_markup: null,
            event_additional_markup: null,
            is_deleted: "",
            tags: "",
          });
        }
        setLoading(false);
        return;
      }

      try {
        const data = await getEvent(Number.parseInt(unwrappedParams.id));
        setEvent(data);
      } catch (error) {
        console.error("Error fetching event:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load event details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchEvent();
  }, [unwrappedParams.id, toast, isNewEvent, searchParams]);

  // Load saved locations for dropdown (always load so edit can also reuse)
  useEffect(() => {
    async function loadLocations() {
      try {
        setLocationsLoading(true);
        const data = await getLocations();
        setLocations(data);
      } catch (error) {
        console.error("Failed to load locations list:", error);
        toast({
          variant: "destructive",
          title: "Error",
            description: "Failed to load saved locations",
        });
      } finally {
        setLocationsLoading(false);
      }
    }
    loadLocations();
  }, [toast]);

  const txEventIdFromQuery = searchParams.get("txEventId");

  const tixStockEventId =
    event?.type === "tx_event"
      ? txEventIdFromQuery ?? event.tickets_and_rates.find((t) => !!t.eid)?.eid ?? null
      : null;

  const mapSourceUrl =
    event?.type === "tx_event" && event.map_image_url
      ? `/api/proxy-image?url=${encodeURIComponent(event.map_image_url)}`
      : "";

  useEffect(() => {
    if (!tixStockEventId) {
      setTixStockTickets([]);
      return;
    }

    const eventId = tixStockEventId;

    async function loadTixStockTickets() {
      try {
        setIsLoadingTixStockTickets(true);
        const data = await getTixStockTickets(eventId);
        setTixStockTickets(data);
      } catch (error) {
        console.error("Failed to load TixStock source tickets:", error);
      } finally {
        setIsLoadingTixStockTickets(false);
      }
    }
    

    loadTixStockTickets();
  }, [tixStockEventId]);

  useEffect(() => {
    setSelectedSection(null);
    setSelectedCategory(null);
    setMapCategoryIds(null);
  }, [mapSourceUrl]);

  useEffect(() => {
    async function fetchSvg() {
      if (!mapSourceUrl) {
        setSvgContent(null);
        return;
      }

      setIsLoadingMap(true);
      try {
        const response = await fetch(mapSourceUrl);
        const text = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "image/svg+xml");
        const sections = Array.from(doc.querySelectorAll("[data-section]"));
        const geometryMap = new Map<string, Element>();

        sections.forEach((section) => {
          const block = section.querySelector(".block");
          if (!block) return;

          let signature = "";
          if (block.tagName === "path") {
            signature = `path:${block.getAttribute("d")}`;
          } else if (block.tagName === "rect") {
            signature = `rect:${block.getAttribute("x")},${block.getAttribute("y")},${block.getAttribute("width")},${block.getAttribute("height")}`;
          } else if (block.tagName === "polygon") {
            signature = `poly:${block.getAttribute("points")}`;
          }

          if (signature) {
            if (geometryMap.has(signature)) {
              section.remove();
            } else {
              geometryMap.set(signature, section);
            }
          }
        });

        const tierLabels = Array.from(doc.querySelectorAll(".tier-label"));
        tierLabels.forEach((el) => el.remove());

        const categoryIds = Array.from(doc.querySelectorAll("[data-category]"))
          .map((el) => el.getAttribute("data-category")!.toLowerCase())
          .filter((v, i, a) => a.indexOf(v) === i);
        setMapCategoryIds(categoryIds);

        setSvgContent(doc.documentElement.outerHTML);
      } catch (error) {
        console.error("Failed to load SVG:", error);
        setSvgContent(null);
        setMapCategoryIds(null);
      } finally {
        setIsLoadingMap(false);
      }
    }

    fetchSvg();
  }, [mapSourceUrl]);

  const slugify = (name: string) =>
    name.replace(/block|section/gi, "").trim().toLowerCase().replace(/\s+/g, "-");

  const isCategoryOnlyTicket = (ticket: TixStockListing) =>
    !!(
      ticket.seat_details.category &&
      ticket.seat_details.section &&
      ticket.seat_details.category.trim().toLowerCase() ===
        ticket.seat_details.section.trim().toLowerCase()
    );

  const isTicketMatchingSection = (ticket: TixStockListing, mapSectionId: string) => {
    if (!ticket.seat_details.section) return false;
    const norm = ticket.seat_details.section
      .replace(/block|section/gi, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    const mapId = mapSectionId.toLowerCase();
    if (mapId === norm || mapId.endsWith(`_${norm}`) || mapId.endsWith(`-${norm}`)) return true;

    // Handle SVGs where the category word is embedded in the section slug.
    // e.g. mapId "pit_vip-pit-and-garden" should match norm "vip-and-garden".
    const underscoreIdx = mapId.indexOf("_");
    if (underscoreIdx !== -1) {
      const categoryTokens = new Set(mapId.substring(0, underscoreIdx).split("-"));
      const sectionPart = mapId.substring(underscoreIdx + 1);
      const cleaned = sectionPart
        .split("-")
        .filter((token) => !categoryTokens.has(token))
        .join("-");
      if (cleaned === norm || cleaned.endsWith(`-${norm}`) || cleaned.endsWith(`_${norm}`)) return true;
    }

    return false;
  };

  const isTicketMatchingCategory = (ticket: TixStockListing, mapCategoryId: string) => {
    if (!isCategoryOnlyTicket(ticket)) return false;
    return slugify(ticket.seat_details.category) === mapCategoryId.toLowerCase();
  };

  const isTicketMatchingSectionOrCategory = (ticket: TixStockListing, sectionEl: Element) => {
    const sectionId = sectionEl.getAttribute("data-section");
    if (!sectionId) return false;

    if (!isCategoryOnlyTicket(ticket)) {
      return isTicketMatchingSection(ticket, sectionId);
    }

    const categoryEl = sectionEl.closest("[data-category]");
    const categoryId = categoryEl?.getAttribute("data-category");
    return categoryId ? isTicketMatchingCategory(ticket, categoryId) : false;
  };

  useLayoutEffect(() => {
    if (!svgContent || !mapContainerRef.current) return;

    const applyHighlights = () => {
      const allSections = mapContainerRef.current?.querySelectorAll("[data-section]");
      if (!allSections) return;

      const excludedSections = event?.tx_excluded_sections ?? [];

      allSections.forEach((el) => {
        const sectionId = el.getAttribute("data-section");
        const parentCategory = el.closest("[data-category]")?.getAttribute("data-category");
        let shouldHighlight = false;

        if (selectedSection && sectionId === selectedSection) {
          shouldHighlight = true;
        }

        if (!shouldHighlight && selectedCategory && parentCategory === selectedCategory) {
          shouldHighlight = true;
        }

        if (!shouldHighlight && hoveredTixTicket && hoveredTixTicket.seat_details.section) {
          shouldHighlight = isTicketMatchingSectionOrCategory(hoveredTixTicket, el);
        }

        if (shouldHighlight) {
          el.classList.add("svg-highlighted");
        } else {
          el.classList.remove("svg-highlighted");
        }

        // Apply excluded styling
        if (sectionId && excludedSections.includes(sectionId)) {
          el.classList.add("svg-excluded");
        } else {
          el.classList.remove("svg-excluded");
        }
      });
    };

    applyHighlights();
    const observer = new MutationObserver(applyHighlights);
    observer.observe(mapContainerRef.current, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    return () => observer.disconnect();
  }, [svgContent, hoveredTixTicket, selectedSection, selectedCategory, event?.tx_excluded_sections]);

  // Function to search for flight prices
  const searchFlightPricesForEvent = async (
    cityIata: string,
    departureDate: string,
    returnDate: string
  ) => {
    if (!cityIata || !departureDate || !returnDate) {
      return;
    }

    // Validate IATA code
    if (!isValidIATACode(cityIata)) {
      return;
    }

    setSearchingFlights(true);
    try {
      const originCode = "TLV";
      const result = await searchFlightPrices({
        originLocationCode: originCode,
        destinationLocationCode: cityIata,
        departureDate,
        returnDate,
        adults: 1,
        currencyCode: "USD",
      });

      if (result.success && result.cheapestPrice) {
        // Update the base flight price with the cheapest found price
        setEvent((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            base_flight_price: Math.round(result.cheapestPrice!),
          };
        });

        toast({
          title: "Flight Prices Updated",
          description: `Found flights from ${originCode} to ${cityIata} starting at $${Math.round(result.cheapestPrice)} (${result.totalOffers} offers found)`,
        });
      } else if (!result.success) {
        toast({
          variant: "destructive",
          title: "Flight Search Error",
          description: result.message || "Could not fetch flight prices",
        });
      } else {
        toast({
          title: "No Flights Found",
          description: `No flights found for ${originCode} to ${cityIata} on the selected dates`,
        });
      }
    } catch (error) {
      console.error("Flight search error:", error);
      toast({
        variant: "destructive",
        title: "Flight Search Error",
        description: "Failed to search for flight prices",
      });
    } finally {
      setSearchingFlights(false);
    }
  };

  // Function to search for hotel prices
  const searchHotelPricesForEvent = async (
    lat: number,
    lon: number,
    checkin: string,
    checkout: string
  ) => {
    if (!lat || !lon || !checkin || !checkout) {
      return;
    }

    setSearchingHotels(true);
    try {
      const result = await searchHotelPrices({
        lat,
        lon,
        checkin,
        checkout,
      });

      if (result.success && result.cheapestPrice) {
        // Update the base hotel price with the cheapest found price
        setEvent((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            base_hotel_price: Math.round(result.cheapestPrice!),
          };
        });

        // Show success toast with hotel details
        const hotelInfo = result.hotelDetails;
        const description = hotelInfo 
          ? `Found "${hotelInfo.name}" - ${hotelInfo.room_name} (${hotelInfo.meal}) starting at $${Math.round(result.cheapestPrice)} (${result.totalOffers} hotels found)`
          : `Found hotels starting at $${Math.round(result.cheapestPrice)} (${result.totalOffers} hotels found)`;

        toast({
          title: "Hotel Prices Updated",
          description,
        });
      } else if (!result.success) {
        toast({
          variant: "destructive",
          title: "Hotel Search Error",
          description: result.message || "Could not fetch hotel prices",
        });
      } else {
        toast({
          title: "No Hotels Found",
          description: `No hotels found for the specified location and dates`,
        });
      }
    } catch (error) {
      console.error("Hotel search error:", error);
      toast({
        variant: "destructive",
        title: "Hotel Search Error",
        description: "Failed to search for hotel prices",
      });
    } finally {
      setSearchingHotels(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    if (name.includes(".")) {
      const [parent, child] = name.split(".");
      setEvent((prev) => {
        if (!prev) return prev;

        const parentValue = prev[parent as keyof Event];
        // Ensure we're only spreading object types
        if (parentValue && typeof parentValue === "object") {
          // Convert city_iata to uppercase
          const finalValue =
            child === "city_iata" ? value.toUpperCase() : value;
          
          const updatedEvent = {
            ...prev,
            [parent]: {
              ...parentValue,
              [child]: finalValue,
            },
          };

          // If city_iata is being changed and we have departure/return dates, trigger flight search
          // Note: Automatic search disabled - users can manually trigger with the "Search Flights" button
          // if (child === "city_iata" && finalValue && isNewEvent && prev.def_date_depart && prev.def_date_return) {
          //   setTimeout(() => {
          //     searchFlightPricesForEvent(
          //       finalValue,
          //       prev.def_date_depart,
          //       prev.def_date_return
          //     );
          //   }, 100);
          // }

          return updatedEvent;
        }
        return prev;
      });
    } else {
      setEvent((prev) => {
        if (!prev) return prev;

        const updatedEvent = {
          ...prev,
          [name]: value,
        };

        // If the date field is being changed, automatically calculate smart departure and return dates
        if (name === "date" && value) {
          const smartDates = calculateSmartDates(value);
          updatedEvent.def_date_depart = smartDates.departure;
          updatedEvent.def_date_return = smartDates.return;
        }
        return updatedEvent;
      });
    }
  };

  const handleSwitchChange = (checked: boolean) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        is_prioritized: checked,
      };
    });
  };

  const handleSkipFlightChange = (checked: boolean) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        skip_flight: checked,
      };
    });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [name]: Number.parseFloat(value),
      };
    });
  };

  const handleLocationNumberChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = e.target;
    const field = name.split(".")[1];

    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        location: {
          ...prev.location,
          [field]: Number.parseFloat(value),
        },
      };
    });
  };

  useEffect(() => {
    if (!event || event.type !== "tx_event") return;

    const hasWrongColor = event.tickets_and_rates.some(
      (ticket) => ticket.colorOnTheMap !== TX_TICKET_COLOR
    );
    if (!hasWrongColor) return;

    setEvent((prev) => {
      if (!prev || prev.type !== "tx_event") return prev;
      return {
        ...prev,
        tickets_and_rates: prev.tickets_and_rates.map((ticket) => ({
          ...ticket,
          colorOnTheMap: TX_TICKET_COLOR,
        })),
      };
    });
  }, [event]);

  useEffect(() => {
    if (isNewEvent || !event?.id) return;
    const id = event.id;
    setIsLoadingLinkedFlights(true);
    setIsLoadingLinkedHotels(true);
    Promise.all([getFlightsByEventId(id), getHotelsByEventId(id)])
      .then(([flights, hotels]) => {
        setLinkedFlights(flights);
        setLinkedHotels(hotels);
      })
      .catch(console.error)
      .finally(() => {
        setIsLoadingLinkedFlights(false);
        setIsLoadingLinkedHotels(false);
      });
  }, [event?.id, isNewEvent]);

  const getTicketAmount = (ticket: TixStockListing) => {
    const proceed = Number.parseFloat(ticket.proceed_price?.amount || "0");
    if (Number.isFinite(proceed) && proceed > 0) return proceed;
    const face = Number.parseFloat(ticket.face_value?.amount || "0");
    return Number.isFinite(face) ? face : 0;
  };

  const hasLimitedViewRestriction = (ticket: TixStockListing): boolean => {
    const options = ticket.restrictions_benefits?.options;
    if (!Array.isArray(options) || options.length === 0) return false;
    return options.some((opt) => {
      const lower = String(opt).toLowerCase();
      return lower.includes("limited") && lower.includes("view");
    });
  };

  const sourceTicketsForDisplay = useMemo(() => {
    const filtered = tixStockTickets.filter((ticket) => {
      // Exclude tickets with "Limited * view" restriction
      if (hasLimitedViewRestriction(ticket)) return false;

      if (selectedSection) {
        return isTicketMatchingSection(ticket, selectedSection);
      }
      if (selectedCategory) {
        return isTicketMatchingCategory(ticket, selectedCategory);
      }
      return true;
    });

    // Group by category only — one row per category, cheapest price (qty>=2), count sections & qty
    const categoryMap = new Map<string, { ticket: TixStockListing; sectionCount: number; totalQty: number }>();
    for (const ticket of filtered) {
      const key = (ticket.seat_details?.category || "").toLowerCase().trim();
      const qty = ticket.number_of_tickets_for_sale?.quantity_available || 0;
      const existing = categoryMap.get(key);
      if (!existing) {
        // Use this ticket as placeholder even if qty<2, so the category always shows
        categoryMap.set(key, { ticket, sectionCount: 1, totalQty: qty });
      } else {
        // Only replace as cheapest representative if this ticket has qty>=2
        const thisPrice = getTicketAmount(ticket);
        const existingPrice = getTicketAmount(existing.ticket);
        const existingQty = existing.ticket.number_of_tickets_for_sale?.quantity_available || 0;
        const existingIsEligible = existingQty >= 2;
        const thisIsEligible = qty >= 2;
        let cheapest = existing.ticket;
        if (thisIsEligible && (!existingIsEligible || thisPrice < existingPrice)) {
          cheapest = ticket;
        }
        categoryMap.set(key, { ticket: cheapest, sectionCount: existing.sectionCount + 1, totalQty: existing.totalQty + qty });
      }
    }

    const allEntries = Array.from(categoryMap.values());

    // If a map is loaded, only show categories that have a corresponding section on the map
    if (mapCategoryIds !== null) {
      return allEntries.filter(({ ticket }) => {
        const categorySlug = slugify(ticket.seat_details?.category || "");
        return mapCategoryIds.includes(categorySlug);
      });
    }

    return allEntries;
  }, [tixStockTickets, selectedSection, selectedCategory, mapCategoryIds]);

  const isSourceTicketAdded = (category: string) =>
    !!event?.tickets_and_rates.some((t) => t.category.toLowerCase() === category.toLowerCase());

  const handleAddSourceTicket = async (sourceTicket: TixStockListing) => {
    if (!event || !tixStockEventId) return;

    const category = sourceTicket.seat_details?.category || "Unknown";

    if (isSourceTicketAdded(category)) {
      toast({
        title: "Already added",
        description: "This category is already in Tickets and Rates.",
      });
      return;
    }

    // Find cheapest ticket in this category with qty>=2
    const eligibleTickets = tixStockTickets.filter((t) => {
      const tCategory = (t.seat_details?.category || "").toLowerCase().trim();
      const qty = t.number_of_tickets_for_sale?.quantity_available || 0;
      return tCategory === category.toLowerCase().trim() && qty >= 2;
    });

    const cheapestEligible = eligibleTickets.length > 0
      ? eligibleTickets.reduce((min, t) => getTicketAmount(t) < getTicketAmount(min) ? t : min)
      : sourceTicket;

    const rawPrice = getTicketAmount(cheapestEligible);
    const currency = (
      cheapestEligible.proceed_price?.currency ||
      cheapestEligible.face_value?.currency ||
      "GBP"
    ).toUpperCase();

    // Convert to USD with the same markup used elsewhere in the app
    let priceInUSD: number;
    try {
      await exchangeRateClientService.updateAllExchangeRates();
      if (currency === "GBP") {
        priceInUSD = await exchangeRateClientService.convertToUSD(rawPrice + 35, "GBP");
      } else if (currency === "EUR") {
        priceInUSD = await exchangeRateClientService.convertToUSD(rawPrice + 40, "EUR");
      } else if (currency === "ILS") {
        priceInUSD = await exchangeRateClientService.convertToUSD(rawPrice + 150, "ILS");
      } else {
        // Already USD or unknown — apply flat markup
        priceInUSD = rawPrice + 40;
      }
    } catch (err) {
      console.error("Exchange rate conversion failed, using raw price:", err);
      priceInUSD = rawPrice;
    }

    const mappedTicket: EventTicket = {
      id: uuidv4(),
      category,
      price: Math.round(priceInUSD),
      description: "",
      colorOnTheMap: TX_TICKET_COLOR,
      vendor: "TixStock",
      available: true,
      eid: tixStockEventId,
    };

    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tickets_and_rates: [...prev.tickets_and_rates, mappedTicket],
      };
    });

    toast({
      title: "Ticket added",
      description: "Source ticket added to Tickets and Rates.",
    });
  };

  const handleAddTicket = () => {
    if (!event) return;

    const newTicket: EventTicket = {
      id: uuidv4(),
      category: "",
      price: 0,
      description: "",
      colorOnTheMap: event.type === "tx_event" ? TX_TICKET_COLOR : "#000000",
      vendor: event.type === "tx_event" ? "TixStock" : "",
      ...(event.type === "tx_event" && tixStockEventId ? { eid: tixStockEventId } : {}),
    };

    setEvent({
      ...event,
      tickets_and_rates: [...event.tickets_and_rates, newTicket],
    });
  };

  const handleRemoveTicket = (ticketId: string) => {
    if (!event) return;

    setEvent({
      ...event,
      tickets_and_rates: event.tickets_and_rates.filter(
        (ticket) => ticket.id !== ticketId
      ),
    });
  };

  const handleTicketChange = (
    ticketId: string,
    field: keyof EventTicket,
    value: string | number
  ) => {
    if (!event) return;

    setEvent({
      ...event,
      tickets_and_rates: event.tickets_and_rates.map((ticket) =>
        ticket.id === ticketId ? { ...ticket, [field]: value } : ticket
      ),
    });
  };

  const handleTicketVipChange = (
    ticketId: string,
    enabled: boolean,
    details?: string
  ) => {
    if (!event) return;

    setEvent({
      ...event,
      tickets_and_rates: event.tickets_and_rates.map((ticket) => {
        if (ticket.id === ticketId) {
          if (!enabled) {
            // Remove vip field entirely when disabled
            const { vip, ...ticketWithoutVip } = ticket;
            return ticketWithoutVip;
          }
          // Update or create vip config
          return {
            ...ticket,
            vip: {
              enabled,
              details: details ?? ticket.vip?.details ?? '',
            },
          };
        }
        return ticket;
      }),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    // Validate required fields for new events
    if (isNewEvent) {
      const requiredFields = [
        { field: "name", label: "Name" },
        { field: "name_english", label: "English Name" },
        { field: "date", label: "Date" },
        { field: "location.name", label: "Location Name" },
      ];

      for (const { field, label } of requiredFields) {
        const value = field.includes(".")
          ? event.location.name // For nested fields
          : event[field as keyof Event];

        if (!value || value === "") {
          toast({
            variant: "destructive",
            title: "Validation Error",
            description: `${label} is required.`,
          });
          return;
        }
      }
    }

    // Show confirmation dialog with appropriate message
    const confirmed = window.confirm(
      isNewEvent
        ? "Are you sure you want to create this event?"
        : "Are you sure you want to save changes to this event?"
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      if (isNewEvent) {
        // For new events, remove the id and ensure proper field values
        const { id, ...eventWithoutId } = event;
        const createdEvent = await createEvent({ ...eventWithoutId });

        await Promise.all([
          ...stagedFlights.map((flight) =>
            createOfflineFlight({ ...flight, event_ids: [createdEvent.id] })
          ),
          ...stagedHotels.map((hotel) =>
            createOfflineHotel({ ...hotel, event_ids: [createdEvent.id] })
          ),
        ]);

        const extras = [];
        if (stagedFlights.length > 0) extras.push(`${stagedFlights.length} flight(s)`);
        if (stagedHotels.length > 0) extras.push(`${stagedHotels.length} hotel(s)`);

        toast({
          title: "Success",
          description: extras.length > 0
            ? `Event created with ${extras.join(" and ")}.`
            : "Event has been created successfully.",
        });
      } else {
        // For existing events, use updateEvent
        await updateEvent(event.id, event);
        toast({
          title: "Success",
          description: "Event has been saved successfully.",
        });
      }
      router.push("/events");
    } catch (error) {
      console.error(
        `Error ${isNewEvent ? "creating" : "saving"} event:`,
        error
      );
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to ${
          isNewEvent ? "create" : "save"
        } event. Please try again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Helper function to calculate smart departure and return dates
  const calculateSmartDates = (eventDate: string) => {
    const event = new Date(eventDate);

    // Calculate departure date (2 days before, but avoid Friday/Saturday)
    const departure = new Date(event);
    departure.setDate(event.getDate() - 2);

    // If departure falls on Friday (5) or Saturday (6), move to Thursday
    const departureDay = departure.getDay();
    if (departureDay === 5) {
      // Friday
      departure.setDate(departure.getDate() - 1); // Move to Thursday
    } else if (departureDay === 6) {
      // Saturday
      departure.setDate(departure.getDate() - 2); // Move to Thursday
    }

    // Calculate return date (1 day after, but if Saturday move to Sunday)
    const returnDate = new Date(event);
    returnDate.setDate(event.getDate() + 1);

    // If return falls on Saturday (6), move to Sunday
    if (returnDate.getDay() === 6) {
      returnDate.setDate(returnDate.getDate() + 1); // Move to Sunday
    }

    return {
      departure: departure.toISOString().split("T")[0],
      return: returnDate.toISOString().split("T")[0],
    };
  };

  if (loading) {
    return <div>Loading event details...</div>;
  }

  if (!event) {
    return <div>Event not found</div>;
  }

  const availableFlights = allFlights.filter(
    (f) =>
      !f.is_deleted &&
      f.initial_quantity > 0 &&
      !linkedFlights.some((l) => l.id === f.id) &&
      airportsMatch(f.outbound_arrival_airport, event?.location?.city_iata) &&
      // event must fall strictly between outbound departure and return-leg takeoff
      (!event?.date || (
        f.outbound_departure_time.slice(0, 10) < event.date &&
        f.inbound_departure_time.slice(0, 10) > event.date
      ))
  );

  const linkedFlightDateRanges = linkedFlights.map((f) => ({
    checkIn: f.outbound_departure_time.slice(0, 10),
    checkOut: f.inbound_arrival_time.slice(0, 10),
  }));
  // All non-deleted, non-linked hotels — date-matching ones sorted first
  const availableHotels = allHotels
    .filter((h) =>
      !h.is_deleted &&
      !linkedHotels.some((l) => l.id === h.id) &&
      // event date must fall strictly between check_in/check_out (exclusive)
      (!event?.date || (h.check_in < event.date && h.check_out > event.date))
    )
    .sort((a, b) => {
      const aMatch = linkedFlightDateRanges.some(
        (r) => a.check_in === r.checkIn && a.check_out === r.checkOut
      );
      const bMatch = linkedFlightDateRanges.some(
        (r) => b.check_in === r.checkIn && b.check_out === r.checkOut
      );
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="ml-4">
          <h1 className="text-3xl font-bold tracking-tight">
            {isNewEvent
              ? searchParams.get("data")
                ? "Create Event from Sports Event"
                : "Create Event"
              : `Edit Event: ${event.name}`}
          </h1>
          {isNewEvent && searchParams.get("data") && (
            <p className="text-sm text-muted-foreground mt-1">
              Pre-populated with data from XS2Event. Review and adjust as
              needed.
            </p>
          )}
        </div>
      </div>

      {event.is_deleted && (
        <Card className="bg-destructive/10 border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="font-medium text-destructive">
                This event is marked as deleted on {event.is_deleted}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Enter the basic details for this event.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={event.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name_english">English Name</Label>
                <Input
                  id="name_english"
                  name="name_english"
                  value={event.name_english}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Event Type</Label>
              <select
                id="type"
                name="type"
                value={event.type}
                onChange={(e) => {
                  setEvent((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      type: e.target.value as EventType,
                    };
                  });
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="music_event">Music Event (Offline)</option>
                <option value="sports_event">Sports Event (Offline)</option>
                <option value="sports_event_dynamic">
                  Sports Event (Dynamic)
                </option>
                <option value="sports_live_event_dynamic">
                  Sports Event (Live)
                </option>
                <option value="music_live_event_dynamic">
                  Music Event (Live)
                </option>
                <option value="tx_event">TixStock Event</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                value={event.date.split("T")[0]}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={event.description}
                onChange={handleChange}
                rows={4}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="usual_price">Usual Price</Label>
                <Input
                  id="usual_price"
                  name="usual_price"
                  type="number"
                  value={event.usual_price}
                  onChange={handleNumberChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_flight_price">
                  Base Flight Price
                  {searchingFlights && (
                    <span className="ml-2 text-sm text-blue-600 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Searching flights...
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="base_flight_price"
                    name="base_flight_price"
                    type="number"
                    value={event.base_flight_price}
                    onChange={handleNumberChange}
                    disabled={searchingFlights}
                    required
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (event.location.city_iata && event.def_date_depart && event.def_date_return) {
                        searchFlightPricesForEvent(
                          event.location.city_iata,
                          event.def_date_depart,
                          event.def_date_return
                        );
                      } else {
                        toast({
                          variant: "destructive",
                          title: "Missing Information",
                          description: "Please set the destination city (IATA code) and departure/return dates first.",
                        });
                      }
                    }}
                    disabled={searchingFlights || !event.location.city_iata || !event.def_date_depart || !event.def_date_return}
                    className="whitespace-nowrap"
                  >
                    {searchingFlights ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      "Search Flights"
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click "Search Flights" to get current prices from TLV to your destination
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_hotel_price">
                  Base Hotel Price
                  {searchingHotels && (
                    <span className="ml-2 text-sm text-blue-600 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Searching hotels...
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="base_hotel_price"
                    name="base_hotel_price"
                    type="number"
                    value={event.base_hotel_price}
                    onChange={handleNumberChange}
                    disabled={searchingHotels}
                    required
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (event.location.latitude && event.location.longitude && event.def_date_depart && event.def_date_return) {
                        searchHotelPricesForEvent(
                          event.location.latitude,
                          event.location.longitude,
                          event.def_date_depart,
                          event.def_date_return
                        );
                      } else {
                        toast({
                          variant: "destructive",
                          title: "Missing Information",
                          description: "Please set the location coordinates (latitude/longitude) and departure/return dates first.",
                        });
                      }
                    }}
                    disabled={searchingHotels || !event.location.latitude || !event.location.longitude || !event.def_date_depart || !event.def_date_return}
                    className="whitespace-nowrap"
                  >
                    {searchingHotels ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      "Search Hotels"
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click "Search Hotels" to get current prices near your event location
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="def_date_depart">Default Departure Date</Label>
                <Input
                  id="def_date_depart"
                  name="def_date_depart"
                  type="date"
                  value={
                    event.def_date_depart
                      ? event.def_date_depart.split("T")[0]
                      : ""
                  }
                  onChange={handleChange}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-calculated: 2 days before event (avoids Fri/Sat, uses Thu
                  instead)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="def_date_return">Default Return Date</Label>
                <Input
                  id="def_date_return"
                  name="def_date_return"
                  type="date"
                  value={
                    event.def_date_return
                      ? event.def_date_return.split("T")[0]
                      : ""
                  }
                  onChange={handleChange}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-calculated: 1 day after event (if Sat, moves to Sun)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="is_prioritized">Prioritized</Label>
              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="is_prioritized"
                  checked={event.is_prioritized}
                  onCheckedChange={handleSwitchChange}
                />
                <Label htmlFor="is_prioritized">
                  {event.is_prioritized ? "Yes" : "No"}
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="skip_flight">Allow Skip Flight</Label>
              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="skip_flight"
                  checked={event.skip_flight ?? false}
                  onCheckedChange={handleSkipFlightChange}
                />
                <Label htmlFor="skip_flight">
                  {event.skip_flight ? "Yes (clients can skip flight)" : "No"}
                </Label>
              </div>
            </div>

            {event.skip_flight && (
              <div className="space-y-2">
                <Label htmlFor="skip_flight_markup">
                  Skip-Flight Markup (USD per ticket)
                </Label>
                <Input
                  id="skip_flight_markup"
                  name="skip_flight_markup"
                  type="number"
                  min={0}
                  step={1}
                  value={event.skip_flight_markup ?? ""}
                  placeholder="e.g., 100"
                  onChange={(e) => {
                    const v = e.target.value;
                    setEvent((prev) =>
                      prev
                        ? {
                            ...prev,
                            skip_flight_markup: v === "" ? null : Number(v),
                          }
                        : prev
                    );
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Added per ticket when customer chooses to skip the flight.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="event_additional_markup">
                Additional Event Markup (USD)
              </Label>
              <Input
                id="event_additional_markup"
                name="event_additional_markup"
                type="number"
                min={-32768}
                max={32767}
                step={1}
                value={event.event_additional_markup ?? ""}
                placeholder="Leave empty for none"
                onChange={(e) => {
                  const value = e.target.value;
                  setEvent((prev) =>
                    prev
                      ? {
                          ...prev,
                          event_additional_markup:
                            value === "" ? null : Number(value),
                        }
                      : prev
                  );
                }}
              />
              <p className="text-xs text-muted-foreground">
                Optional per-event markup. Leave empty to store null.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tag</Label>
              <select
                id="tags"
                name="tags"
                value={event.tags || "null"}
                onChange={(e) => {
                  const value = e.target.value === "null" ? "" : e.target.value;
                  setEvent((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      tags: value,
                    };
                  });
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="null">None</option>
                <option value="Sold">Sold</option>
                <option value="LastTickets">LastTickets</option>
                <option value="Popular">Popular</option>
                <option value="Restock">Restock</option>
                <option value="VIPevent">VIP Event</option>
                <option value="VIPavailable">VIP Available</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
            <CardDescription>
              Enter the location details for this event.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="saved-location">Select Existing Location</Label>
              <div className="flex gap-2">
                <select
                  id="saved-location"
                  value={selectedLocationId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedLocationId(val);
                    if (!val || val === "custom") return; // user reset to custom
                    const loc = locations.find(l => l.id === Number(val));
                    if (loc) {
                      setEvent(prev => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          location: {
                            name: loc.name,
                            latitude: loc.latitude,
                            longitude: loc.longitude,
                            city_iata: loc.city_iata || "",
                            country_code: loc.country_code || "",
                          }
                        };
                      });
                      toast({
                        title: "Location applied",
                        description: `Filled with saved location \"${loc.name}\"`,
                      });
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  disabled={locationsLoading}
                >
                  <option value="">{locationsLoading ? "Loading locations..." : "-- Choose a saved location --"}</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} {loc.city_iata ? `(${loc.city_iata})` : ''}
                    </option>
                  ))}
                  {selectedLocationId && (
                    <option value="custom">Custom / Clear selection</option>
                  )}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Selecting a saved location will overwrite the fields below. You can still edit them manually afterwards.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location.name">Location Name</Label>
              <Input
                id="location.name"
                name="location.name"
                value={event.location.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location.city_iata">City IATA Code</Label>
                <Input
                  id="location.city_iata"
                  name="location.city_iata"
                  value={event.location.city_iata}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location.latitude">Latitude</Label>
                <Input
                  id="location.latitude"
                  name="location.latitude"
                  type="number"
                  step="0.000001"
                  value={event.location.latitude}
                  onChange={handleLocationNumberChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location.longitude">Longitude</Label>
                <Input
                  id="location.longitude"
                  name="location.longitude"
                  type="number"
                  step="0.000001"
                  value={event.location.longitude}
                  onChange={handleLocationNumberChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Images</CardTitle>
            <CardDescription>
              Select image files from storage or enter URLs manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ImageFilePicker
              label="Card Image"
              value={event.card_image_url}
              onChange={(url) =>
                setEvent((prev) =>
                  prev ? { ...prev, card_image_url: url } : prev
                )
              }
              bucketName={
                process.env.NODE_ENV === "development"
                  ? "card_images"
                  : "card_images"
              }
              folder=""
            />

            <ImageFilePicker
              label="Map Image"
              value={event.map_image_url}
              onChange={(url) =>
                setEvent((prev) =>
                  prev ? { ...prev, map_image_url: url } : prev
                )
              }
              bucketName={
                process.env.NODE_ENV === "development"
                  ? "map_images"
                  : "map_images"
              }
              folder="maps"
            />

            <ArtBlobPicker
              imageUrl={event.art_image_url}
              colorIndex={event.art_color_index}
              shapeIndex={event.art_shape_index}
              onImage={(url) =>
                setEvent((prev) => (prev ? { ...prev, art_image_url: url } : prev))
              }
              onColor={(i) =>
                setEvent((prev) =>
                  prev ? { ...prev, art_color_index: i } : prev
                )
              }
              onShape={(i) =>
                setEvent((prev) =>
                  prev ? { ...prev, art_shape_index: i } : prev
                )
              }
            />
          </CardContent>
        </Card>

        {event.type === "tx_event" && (
          <Card>
            <CardHeader>
              <CardTitle>TixStock Source Preview</CardTitle>
              <CardDescription>
                Dynamic map + source tickets (before saving this event).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!tixStockEventId ? (
                <div className="text-sm text-muted-foreground border rounded-md p-3">
                  Missing TixStock source ID. Open from the TixStock list using Create Event.
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label>Dynamic Map</Label>
                    <div className="text-xs text-muted-foreground border rounded-md p-3 break-all">
                      {event.map_image_url || "No map URL set in Map Image."}
                    </div>
                  </div>

                  {/* Exclude sections toggle */}
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      size="sm"
                      variant={excludeSectionsMode ? "destructive" : "outline"}
                      onClick={() => setExcludeSectionsMode((v) => !v)}
                    >
                      {excludeSectionsMode ? "✕ Exit Exclude Mode" : "Exclude Sections"}
                    </Button>
                    {excludeSectionsMode && (
                      <span className="text-xs text-muted-foreground">Click sections on the map to exclude/include them</span>
                    )}
                  </div>

                  {/* Excluded sections list */}
                  {(event.tx_excluded_sections ?? []).length > 0 && (
                    <div className="space-y-1">
                      <Label className="text-xs text-destructive">Excluded Sections ({(event.tx_excluded_sections ?? []).length})</Label>
                      <div className="flex flex-wrap gap-1">
                        {(event.tx_excluded_sections ?? []).map((s) => (
                          <Badge
                            key={s}
                            variant="destructive"
                            className="cursor-pointer text-xs"
                            onClick={() =>
                              setEvent((prev) =>
                                prev
                                  ? { ...prev, tx_excluded_sections: (prev.tx_excluded_sections ?? []).filter((x) => x !== s) }
                                  : prev
                              )
                            }
                          >
                            {s} ✕
                          </Badge>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-5 text-xs text-muted-foreground"
                          onClick={() => setEvent((prev) => prev ? { ...prev, tx_excluded_sections: [] } : prev)}
                        >
                          Clear all
                        </Button>
                      </div>
                    </div>
                  )}

                  {mapSourceUrl ? (
                    <div className="venue-map-container flex items-center justify-center min-h-[380px] p-4 rounded-md border bg-[hsl(var(--background))]">
                      <style jsx global>{`
                        .venue-map-container text,
                        .venue-map-container tspan {
                          pointer-events: none !important;
                          user-select: none !important;
                          fill: #F0F0F2 !important;
                          font-weight: 600 !important;
                          text-shadow: 0px 0px 3px #000000;
                          font-family: Arial, Helvetica, sans-serif !important;
                        }
                        .venue-map-container .section-label {
                          font-size: 10px !important;
                        }
                        .venue-map-container path,
                        .venue-map-container rect,
                        .venue-map-container polygon,
                        .venue-map-container circle,
                        .venue-map-container [data-section] {
                          pointer-events: all !important;
                          cursor: pointer !important;
                        }
                        .venue-map-container [data-section] .block,
                        .venue-map-container [data-section].block {
                          fill: #277E89 !important;
                          fill-opacity: 0.35 !important;
                          stroke: #277E89 !important;
                          stroke-opacity: 0.9 !important;
                          stroke-width: 1px !important;
                          vector-effect: non-scaling-stroke;
                          transition: fill-opacity 0.2s ease, stroke-width 0.2s ease, stroke 0.2s ease;
                        }
                        .venue-map-container [data-section]:hover .block,
                        .venue-map-container [data-section].block:hover {
                          fill-opacity: 0.6 !important;
                          stroke: #F0F0F2 !important;
                          stroke-opacity: 1 !important;
                          stroke-width: 1.5px !important;
                        }
                        .venue-map-container [data-section].svg-highlighted path,
                        .venue-map-container [data-section].svg-highlighted rect,
                        .venue-map-container [data-section].svg-highlighted polygon,
                        .venue-map-container [data-section].svg-highlighted circle,
                        .venue-map-container [data-section].svg-highlighted .block,
                        .venue-map-container [data-section].svg-highlighted.block {
                          fill: #277E89 !important;
                          fill-opacity: 1 !important;
                          stroke: #F0F0F2 !important;
                          stroke-opacity: 1 !important;
                          stroke-width: 2px !important;
                          opacity: 1 !important;
                        }
                        .venue-map-container [data-section].svg-excluded path,
                        .venue-map-container [data-section].svg-excluded rect,
                        .venue-map-container [data-section].svg-excluded polygon,
                        .venue-map-container [data-section].svg-excluded circle,
                        .venue-map-container [data-section].svg-excluded .block,
                        .venue-map-container [data-section].svg-excluded.block {
                          fill: #e53e3e !important;
                          fill-opacity: 0.7 !important;
                          stroke: #fc8181 !important;
                          stroke-opacity: 1 !important;
                          stroke-width: 2px !important;
                          opacity: 1 !important;
                        }
                      `}</style>
                      {isLoadingMap ? (
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      ) : svgContent ? (
                        <div
                          ref={mapContainerRef}
                          className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-[560px] [&>svg]:w-auto [&>svg]:h-auto"
                          dangerouslySetInnerHTML={{ __html: svgContent }}
                          onClick={(e) => {
                            const elements = document.elementsFromPoint(e.clientX, e.clientY);

                            // Find the clicked section
                            let clickedSection: string | null = null;
                            for (const el of elements) {
                              if (!mapContainerRef.current?.contains(el)) continue;
                              const sectionEl = el.closest("[data-section]");
                              const dataSection = sectionEl?.getAttribute("data-section");
                              if (dataSection) { clickedSection = dataSection; break; }
                            }

                            // Exclude sections mode: toggle section in/out of excluded list
                            if (excludeSectionsMode) {
                              if (!clickedSection) return;
                              setEvent((prev) => {
                                if (!prev) return prev;
                                const current = prev.tx_excluded_sections ?? [];
                                const next = current.includes(clickedSection!)
                                  ? current.filter((s) => s !== clickedSection)
                                  : [...current, clickedSection!];
                                return { ...prev, tx_excluded_sections: next };
                              });
                              return;
                            }

                            let bestMatch: {
                              section: string;
                              category: string | null;
                              hasTickets: boolean;
                              isCategoryMatch: boolean;
                            } | null = null;
                            let firstSectionFound: string | null = null;

                            for (const el of elements) {
                              if (!mapContainerRef.current?.contains(el)) continue;

                              const sectionEl = el.closest("[data-section]");
                              const dataSection = sectionEl?.getAttribute("data-section");

                              if (dataSection && sectionEl) {
                                if (!firstSectionFound) firstSectionFound = dataSection;

                                const sectionMatch = tixStockTickets.some(
                                  (t) => !isCategoryOnlyTicket(t) && isTicketMatchingSection(t, dataSection)
                                );
                                if (sectionMatch) {
                                  bestMatch = {
                                    section: dataSection,
                                    category: null,
                                    hasTickets: true,
                                    isCategoryMatch: false,
                                  };
                                  break;
                                }

                                const parentCategory = sectionEl
                                  .closest("[data-category]")
                                  ?.getAttribute("data-category");
                                if (parentCategory) {
                                  const categoryMatch = tixStockTickets.some((t) =>
                                    isTicketMatchingCategory(t, parentCategory)
                                  );
                                  if (categoryMatch && !bestMatch) {
                                    bestMatch = {
                                      section: dataSection,
                                      category: parentCategory,
                                      hasTickets: true,
                                      isCategoryMatch: true,
                                    };
                                  }
                                }
                              }
                            }

                            const finalSection = bestMatch ? bestMatch.section : firstSectionFound;
                            const hasTickets = bestMatch ? bestMatch.hasTickets : false;

                            if (finalSection) {
                              if (hasTickets && bestMatch) {
                                if (bestMatch.isCategoryMatch && bestMatch.category) {
                                  const newCategory =
                                    selectedCategory === bestMatch.category ? null : bestMatch.category;
                                  setSelectedCategory(newCategory);
                                  setSelectedSection(null);
                                } else {
                                  const newSelection =
                                    selectedSection === finalSection ? null : finalSection;
                                  setSelectedSection(newSelection);
                                  setSelectedCategory(null);
                                }
                              } else {
                                setSelectedSection(null);
                                setSelectedCategory(null);
                              }
                            } else {
                              setSelectedSection(null);
                              setSelectedCategory(null);
                            }
                          }}
                        />
                      ) : (
                        <p className="text-muted-foreground">Failed to load map</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[80px] text-muted-foreground text-sm border-dashed border-2 rounded-md">
                      Set Map Image URL to preview sections
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Source Tickets</Label>
                      {(selectedSection || selectedCategory) && (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => {
                            setSelectedSection(null);
                            setSelectedCategory(null);
                          }}
                        >
                          Show all
                        </Button>
                      )}
                    </div>

                    <div className="max-h-[360px] overflow-auto border rounded-md">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 sticky top-0">
                          <tr>
                            <th className="text-left p-2">Category</th>
                            <th className="text-left p-2">Sections</th>
                            <th className="text-left p-2">Total Qty</th>
                            <th className="text-right p-2">From Price</th>
                            <th className="text-right p-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {isLoadingTixStockTickets ? (
                            <tr>
                              <td colSpan={5} className="p-3 text-center text-muted-foreground">
                                Loading tickets...
                              </td>
                            </tr>
                          ) : sourceTicketsForDisplay.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="p-3 text-center text-muted-foreground">
                                No source tickets found.
                              </td>
                            </tr>
                          ) : (
                            sourceTicketsForDisplay.map(({ ticket, sectionCount, totalQty }) => (
                                <tr
                                  key={ticket.seat_details.category}
                                  className="border-t hover:bg-muted/30"
                                  onMouseEnter={() => setHoveredTixTicket(ticket)}
                                  onMouseLeave={() => setHoveredTixTicket(null)}
                                >
                                  <td className="p-2">
                                    <div className="font-medium">{ticket.seat_details.category}</div>
                                  </td>
                                  <td className="p-2 text-muted-foreground">{sectionCount}</td>
                                  <td className="p-2">{totalQty}</td>
                                  <td className="p-2 text-right">
                                    {ticket.proceed_price.amount} {ticket.proceed_price.currency}
                                  </td>
                                  <td className="p-2 text-right">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isSourceTicketAdded(ticket.seat_details.category) ? "secondary" : "outline"}
                                      disabled={isSourceTicketAdded(ticket.seat_details.category)}
                                      onClick={() => handleAddSourceTicket(ticket)}
                                    >
                                      {isSourceTicketAdded(ticket.seat_details.category) ? "Added" : "Add"}
                                    </Button>
                                  </td>
                                </tr>
                              ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Plane className="h-5 w-5" />
                Offline Flights
              </CardTitle>
              <CardDescription>
                Charter flights linked to this event.
                {isNewEvent && stagedFlights.length > 0 && (
                  <span className="ml-1 text-amber-600 font-medium">
                    {stagedFlights.length} flight(s) will be created on save.
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFlightPanel((v) => v === "add" ? null : "add")}
              >
                <Plus className="mr-2 h-4 w-4" />
                {flightPanel === "add" ? "Cancel" : "New Flight"}
              </Button>
              {!isNewEvent && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFlightPanel((v) => v === "link" ? null : "link");
                    if (flightPanel !== "link" && allFlights.length === 0) {
                      setIsLoadingAllFlights(true);
                      getOfflineFlights()
                        .then(setAllFlights)
                        .catch(console.error)
                        .finally(() => setIsLoadingAllFlights(false));
                    }
                  }}
                >
                  {flightPanel === "link" ? "Cancel" : "Link Existing"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isNewEvent && (
              isLoadingLinkedFlights ? (
                <div className="text-sm text-muted-foreground">Loading flights...</div>
              ) : linkedFlights.length === 0 && flightPanel === null ? (
                <div className="text-sm text-muted-foreground py-2">
                  No offline flights linked to this event yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {linkedFlights.map((flight) => (
                    <div
                      key={flight.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {flight.metadata_name} ({flight.airline_code})
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {flight.outbound_departure_airport} → {flight.outbound_arrival_airport} ·{" "}
                          {flight.outbound_departure_time.slice(0, 10)} → {flight.inbound_departure_time.slice(0, 10)} ·{" "}
                          ${flight.price} · {flight.initial_quantity - flight.consumed_quantity} seats left
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" type="button" asChild>
                          <a href={`/offline-flights/${flight.id}/edit`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          title="Unlink flight"
                          onClick={async () => {
                            if (!confirm(`Unlink ${flight.metadata_name} (${flight.airline_code}) from this event?`)) return;
                            try {
                              await removeEventFromFlight(flight.id, event.id);
                              setLinkedFlights((prev) => prev.filter((f) => f.id !== flight.id));
                              setAllFlights((prev) => [...prev, flight]);
                              toast({ title: "Flight unlinked", description: `${flight.metadata_name} no longer linked.` });
                            } catch (err) {
                              toast({ variant: "destructive", title: "Error", description: (err as Error)?.message });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {isNewEvent && stagedFlights.length > 0 && (
              <div className="space-y-2">
                {stagedFlights.map((flight, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {flight.metadata_name} ({flight.airline_code})
                        <span className="ml-2 text-xs text-amber-600 font-normal">pending save</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {flight.outbound_departure_airport} → {flight.outbound_arrival_airport} ·{" "}
                        {flight.outbound_departure_time.slice(0, 10)} → {flight.inbound_departure_time.slice(0, 10)} ·{" "}
                        ${flight.price}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setStagedFlights((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {flightPanel === "add" && event && (
              isNewEvent ? (
                <InlineFlightForm
                  defaultDestinationIata={event.location?.city_iata ?? ""}
                  defaultDepartureDate={event.def_date_depart ?? ""}
                  defaultReturnDate={event.def_date_return ?? ""}
                  onStage={(data) => {
                    setStagedFlights((prev) => [...prev, data]);
                    setFlightPanel(null);
                  }}
                  onCancel={() => setFlightPanel(null)}
                />
              ) : (
                <InlineFlightForm
                  eventId={event.id}
                  defaultDestinationIata={event.location?.city_iata ?? ""}
                  defaultDepartureDate={event.def_date_depart ?? ""}
                  defaultReturnDate={event.def_date_return ?? ""}
                  onCreated={(newFlight) => {
                    setLinkedFlights((prev) => [...prev, newFlight]);
                    setFlightPanel(null);
                    toast({ title: "Flight added", description: "Linked to this event." });
                  }}
                  onCancel={() => setFlightPanel(null)}
                />
              )
            )}

            {flightPanel === "link" && !isNewEvent && event && (
              <div className="rounded-md border p-4 space-y-3">
                <p className="text-sm font-medium">Link an existing offline flight</p>
                {isLoadingAllFlights ? (
                  <p className="text-sm text-muted-foreground">Loading flights...</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {availableFlights.map((flight) => (
                      <div
                        key={flight.id}
                        className="flex items-center justify-between rounded-md border p-3 text-sm"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {flight.metadata_name} ({flight.airline_code}) · #{flight.id}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {flight.outbound_departure_airport} → {flight.outbound_arrival_airport} ·{" "}
                            {flight.outbound_departure_time.slice(0, 10)} → {flight.inbound_departure_time.slice(0, 10)} ·{" "}
                            ${flight.price}
                          </span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              const updated = await addEventToFlight(flight.id, event.id);
                              setLinkedFlights((prev) => [...prev, updated]);
                              setAllFlights((prev) => prev.filter((f) => f.id !== flight.id));
                              // Update event default dates + base flight price to match the linked flight.
                              // Return date = takeoff of the return leg (inbound_departure_time),
                              // NOT the landing-back-in-Israel time (inbound_arrival_time).
                              const newDepart = flight.outbound_departure_time.slice(0, 10);
                              const newReturn = flight.inbound_departure_time.slice(0, 10);
                              const newFlightPrice = Math.round(Number(flight.price));
                              await updateEvent(event.id, {
                                def_date_depart: newDepart,
                                def_date_return: newReturn,
                                base_flight_price: newFlightPrice,
                              });
                              setEvent((prev) => prev ? { ...prev, def_date_depart: newDepart, def_date_return: newReturn, base_flight_price: newFlightPrice } : prev);
                              toast({ title: "Flight linked", description: `${flight.metadata_name} linked. Dates ${newDepart} → ${newReturn}, base flight price $${newFlightPrice}.` });
                            } catch (err) {
                              toast({ variant: "destructive", title: "Error", description: (err as Error)?.message });
                            }
                          }}
                        >
                          Link
                        </Button>
                      </div>
                    ))}
                    {availableFlights.length === 0 && (
                      <p className="text-sm text-muted-foreground py-2">
                        No unlinked flights found matching this event&apos;s destination.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BedDouble className="h-5 w-5" />
                Offline Hotels
              </CardTitle>
              <CardDescription>
                Hotels linked to this event.
                {isNewEvent && stagedHotels.length > 0 && (
                  <span className="ml-1 text-amber-600 font-medium">
                    {stagedHotels.length} hotel(s) will be created on save.
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHotelPanel((v) => v === "add" ? null : "add")}
              >
                <Plus className="mr-2 h-4 w-4" />
                {hotelPanel === "add" ? "Cancel" : "New Hotel"}
              </Button>
              {!isNewEvent && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHotelPanel((v) => v === "link" ? null : "link");
                    if (hotelPanel !== "link" && allHotels.length === 0) {
                      setIsLoadingAllHotels(true);
                      getOfflineHotels()
                        .then(setAllHotels)
                        .catch(console.error)
                        .finally(() => setIsLoadingAllHotels(false));
                    }
                  }}
                >
                  {hotelPanel === "link" ? "Cancel" : "Link Existing"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isNewEvent && (
              isLoadingLinkedHotels ? (
                <div className="text-sm text-muted-foreground">Loading hotels...</div>
              ) : linkedHotels.length === 0 && hotelPanel === null ? (
                <div className="text-sm text-muted-foreground py-2">
                  No offline hotels linked to this event yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {linkedHotels.map((hotel) => (
                    <div
                      key={hotel.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{hotel.hotel_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {hotel.city} · {hotel.check_in} → {hotel.check_out} · {hotel.room_type} ·{" "}
                          ${Number(hotel.price).toFixed(0)} · {hotel.num_rooms - hotel.consumed_rooms}/{hotel.num_rooms} rooms left
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" type="button" asChild>
                          <a href={`/offline-hotels/${hotel.id}/edit`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          title="Unlink hotel"
                          onClick={async () => {
                            if (!confirm(`Unlink ${hotel.hotel_name} from this event?`)) return;
                            try {
                              await removeEventFromHotel(hotel.id, event.id);
                              setLinkedHotels((prev) => prev.filter((h) => h.id !== hotel.id));
                              setAllHotels((prev) => [...prev, hotel]);
                              toast({ title: "Hotel unlinked", description: `${hotel.hotel_name} no longer linked.` });
                            } catch (err) {
                              toast({ variant: "destructive", title: "Error", description: (err as Error)?.message });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {isNewEvent && stagedHotels.length > 0 && (
              <div className="space-y-2">
                {stagedHotels.map((hotel, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {hotel.hotel_name}
                        <span className="ml-2 text-xs text-amber-600 font-normal">pending save</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {hotel.city} · {hotel.check_in} → {hotel.check_out} · {hotel.room_type} · ${Number(hotel.price).toFixed(0)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setStagedHotels((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {hotelPanel === "add" && event && (
              isNewEvent ? (
                <InlineHotelForm
                  defaultCity={event.location?.name ?? ""}
                  defaultCheckIn={event.def_date_depart ?? ""}
                  defaultCheckOut={event.def_date_return ?? ""}
                  onStage={(data) => {
                    setStagedHotels((prev) => [...prev, data]);
                    setHotelPanel(null);
                  }}
                  onCancel={() => setHotelPanel(null)}
                />
              ) : (
                <InlineHotelForm
                  eventId={event.id}
                  defaultCity={event.location?.name ?? ""}
                  defaultCheckIn={event.def_date_depart ?? ""}
                  defaultCheckOut={event.def_date_return ?? ""}
                  onCreated={(newHotel) => {
                    setLinkedHotels((prev) => [...prev, newHotel]);
                    setHotelPanel(null);
                    toast({ title: "Hotel added", description: "Linked to this event." });
                  }}
                  onCancel={() => setHotelPanel(null)}
                />
              )
            )}

            {hotelPanel === "link" && !isNewEvent && event && (
              <div className="rounded-md border p-4 space-y-3">
                <p className="text-sm font-medium">Link an existing offline hotel</p>
                {isLoadingAllHotels ? (
                  <p className="text-sm text-muted-foreground">Loading hotels...</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {availableHotels.map((hotel) => {
                      const dateMatch = linkedFlightDateRanges.some(
                        (r) => hotel.check_in === r.checkIn && hotel.check_out === r.checkOut
                      );
                      return (
                      <div
                        key={hotel.id}
                        className={`flex items-center justify-between rounded-md border p-3 text-sm${dateMatch ? " border-primary/50 bg-primary/5" : ""}`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {hotel.hotel_name} · #{hotel.id}
                            {dateMatch && <span className="ml-2 text-xs text-primary font-normal">matches flight dates</span>}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {hotel.city} · {hotel.check_in} → {hotel.check_out} · {hotel.room_type} · ${Number(hotel.price).toFixed(0)}
                          </span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              const updated = await addEventToHotel(hotel.id, event.id);
                              setLinkedHotels((prev) => [...prev, updated]);
                              setAllHotels((prev) => prev.filter((h) => h.id !== hotel.id));
                              // offline `price` is the TOTAL per room; base_hotel_price is
                              // per-person in the main app → divide by room headcount (Double 2, Triple 3, ...)
                              const newHotelPrice = Math.round(
                                Number(hotel.price) / getOfflineRoomCapacity(hotel.room_type)
                              );
                              // Flight wins over hotel for def dates — only set hotel dates if no flight linked yet
                              const hasFlight = linkedFlights.length > 0;
                              const eventUpdate: Partial<Event> = {};
                              let priceUpdated = true;
                              if (!hasFlight) {
                                // We own the event dates → set them from the hotel; price always matches.
                                eventUpdate.def_date_depart = hotel.check_in;
                                eventUpdate.def_date_return = hotel.check_out;
                                eventUpdate.base_hotel_price = newHotelPrice;
                              } else {
                                // Dates owned by the flight. Only push the price if the hotel stay
                                // matches the event's default dates — otherwise the hotel won't show
                                // in the customer flow and the price would be a lie.
                                const datesMatch =
                                  (event.def_date_depart ?? "").slice(0, 10) === hotel.check_in &&
                                  (event.def_date_return ?? "").slice(0, 10) === hotel.check_out;
                                if (datesMatch) {
                                  eventUpdate.base_hotel_price = newHotelPrice;
                                } else {
                                  priceUpdated = false;
                                }
                              }
                              if (Object.keys(eventUpdate).length > 0) {
                                await updateEvent(event.id, eventUpdate);
                                setEvent((prev) => prev ? { ...prev, ...eventUpdate } : prev);
                              }
                              toast(
                                priceUpdated
                                  ? {
                                      title: "Hotel linked",
                                      description: hasFlight
                                        ? `${hotel.hotel_name} linked. Base hotel price $${newHotelPrice}.`
                                        : `${hotel.hotel_name} linked. Dates ${hotel.check_in} → ${hotel.check_out}, base hotel price $${newHotelPrice}.`,
                                    }
                                  : {
                                      variant: "destructive",
                                      title: "Hotel linked — price NOT updated",
                                      description: `Hotel stay ${hotel.check_in} → ${hotel.check_out} doesn't match event dates ${(event.def_date_depart ?? "").slice(0, 10)} → ${(event.def_date_return ?? "").slice(0, 10)}. base_hotel_price left unchanged so the hotel still shows in the customer flow.`,
                                    }
                              );
                            } catch (err) {
                              toast({ variant: "destructive", title: "Error", description: (err as Error)?.message });
                            }
                          }}
                        >
                          Link
                        </Button>
                      </div>
                    );
                    })}
                    {availableHotels.length === 0 && (
                      <p className="text-sm text-muted-foreground py-2">No unlinked hotels found.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Tickets and Rates</CardTitle>
              <CardDescription>
                Manage the ticket categories and prices for this event.
              </CardDescription>
            </div>
            <Button
              type="button"
              onClick={handleAddTicket}
              variant="outline"
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Ticket
            </Button>
          </CardHeader>
          <CardContent>
            {event.tickets_and_rates.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No tickets added yet. Click "Add Ticket" to create a new ticket
                category.
              </div>
            ) : (
              <div className="space-y-6">
                {event.tickets_and_rates.map((ticket, index) => (
                  <div key={ticket.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">Ticket #{index + 1}</h3>
                        {ticket.vip?.enabled && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-900 text-xs font-medium">
                            <Crown className="h-3 w-3" />
                            VIP
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveTicket(ticket.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`ticket-${ticket.id}-category`}>
                            Category
                          </Label>
                          <Input
                            id={`ticket-${ticket.id}-category`}
                            value={ticket.category}
                            onChange={(e) =>
                              handleTicketChange(
                                ticket.id,
                                "category",
                                e.target.value
                              )
                            }
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`ticket-${ticket.id}-price`}>
                            Price
                          </Label>
                          <Input
                            id={`ticket-${ticket.id}-price`}
                            type="number"
                            value={ticket.price}
                            onChange={(e) =>
                              handleTicketChange(
                                ticket.id,
                                "price",
                                Number.parseFloat(e.target.value)
                              )
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`ticket-${ticket.id}-vendor`}>
                          Vendor (Optional)
                        </Label>
                        <Input
                          id={`ticket-${ticket.id}-vendor`}
                          value={ticket.vendor || ""}
                          onChange={(e) =>
                            handleTicketChange(
                              ticket.id,
                              "vendor",
                              e.target.value
                            )
                          }
                          placeholder="Enter ticket vendor"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`ticket-${ticket.id}-description`}>
                          Description
                        </Label>
                        <Textarea
                          id={`ticket-${ticket.id}-description`}
                          value={ticket.description}
                          onChange={(e) =>
                            handleTicketChange(
                              ticket.id,
                              "description",
                              e.target.value
                            )
                          }
                          rows={2}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`ticket-${ticket.id}-color`}>
                          Color on the Map
                        </Label>
                        {event.type === "tx_event" ? (
                          <div className="rounded-md border p-3 text-sm text-muted-foreground flex items-center justify-between">
                            <span>Fixed for TixStock</span>
                            <span className="inline-flex items-center gap-2 font-medium text-foreground">
                              <span
                                className="h-3 w-3 rounded-full border"
                                style={{ backgroundColor: TX_TICKET_COLOR }}
                              />
                              {TX_TICKET_COLOR}
                            </span>
                          </div>
                        ) : (
                          <ColorPicker
                            value={ticket.colorOnTheMap}
                            onChange={(value) =>
                              handleTicketChange(
                                ticket.id,
                                "colorOnTheMap",
                                value
                              )
                            }
                            mapImageUrl={event.map_image_url}
                          />
                        )}
                      </div>

                      {/* VIP Section */}
                      <div className="border-t pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`ticket-${ticket.id}-vip`} className="flex items-center gap-2">
                            <Crown className="h-4 w-4 text-amber-600" />
                            VIP Ticket
                          </Label>
                          <Switch
                            id={`ticket-${ticket.id}-vip`}
                            checked={ticket.vip?.enabled ?? false}
                            onCheckedChange={(checked) =>
                              handleTicketVipChange(ticket.id, checked)
                            }
                          />
                        </div>

                        {ticket.vip?.enabled && (
                          <div className="space-y-2">
                            <Label htmlFor={`ticket-${ticket.id}-vip-details`}>
                              VIP Details
                            </Label>
                            <Textarea
                              id={`ticket-${ticket.id}-vip-details`}
                              value={ticket.vip.details}
                              onChange={(e) =>
                                handleTicketVipChange(
                                  ticket.id,
                                  true,
                                  e.target.value
                                )
                              }
                              placeholder="Enter VIP perks and benefits (e.g., Meet & Greet, Premium Lounge Access, etc.)"
                              rows={3}
                            />
                            <p className="text-xs text-muted-foreground">
                              Describe what makes this ticket VIP (optional)
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Event"}
          </Button>
        </div>
      </form>
    </div>
  );
}
