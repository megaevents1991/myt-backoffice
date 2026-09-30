"use client";

/**
 * Event editor: "Suppliers & zones" (multi-supplier events).
 *
 * Three jobs, all manual - nothing here happens on its own:
 *  1. Own the seat map: copy the supplier's SVG into our storage and define OUR
 *     zones on it by clicking sections.
 *  2. Put every ticket - of any supplier - into one of our zones. Suppliers
 *     slice a stadium differently; offers only compete inside one zone.
 *  3. Attach a second supplier (LiveTickets) to this event: pick their event,
 *     pick categories, zone them. And connect / change / remove the TixStock show
 *     (28.09): an event built without TixStock tickets had no way to get them - the
 *     editor's "Source Tickets" list only knew a show through a ticket already on it.
 *
 * Works on the editor's form state (`onEventChange`); tickets are saved with
 * the event. Zones and the venue template save on their own (they belong to
 * the venue, not to this event).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Event, EventTicket } from "@/types/app.types";
import {
  normalizeSupplierCategory,
  ticketSupplier,
} from "@/lib/suppliers";
import {
  newZoneId,
  type VenueMap,
  type VenueZone,
} from "@/lib/venue-maps/svg-zones";
import {
  suggestZoneTiered,
  type TieredSuggestion,
} from "@/lib/venue-maps/zone-suggest";
import { isSectionExcluded } from "@/lib/tixstock-map";
import {
  adoptVenueMap,
  getVenueMapByUrl,
  getVenueMapDrawing,
  listVenueMaps,
  rememberSupplierCategories,
  saveVenueZones,
} from "@/lib/actions/venue-map-actions";
import {
  buildLiveTicketsDrafts,
  findLiveTicketsCandidates,
  findTixStockCandidates,
  getLiveTicketsMapUrl,
  getOwnStockHeld,
  type LiveTicketsCandidate,
  type LiveTicketsDraft,
  type TixStockCandidate,
} from "@/lib/actions/supplier-attach-actions";
import { useConfirm } from "@/components/confirm-provider";
import { hasOwnStock, ownSeating, stockLeft } from "@/lib/own-stock";

const NO_ZONE = "__none__";
const NEW_VENUE = "__new__";

/** The zones board, left to right: TixStock, the supplier we attach, our own stock. */
const BOARD_COLUMNS = ["TixStock", "LiveTickets", "Our stock"] as const;

/** Map colour of our own tickets - the brand forest. */
const OWN_TICKET_COLOR = "rgb(10, 26, 20)";

const ZONE_FILL = "#C2FFD8";
const ACTIVE_ZONE_FILL = "#0E6F57";
const IDLE_FILL = "#E8E6E0";
/** A section this event does not sell (`tx_excluded_sections`) - red, as on
 *  the TixStock map's exclude mode (Alon 25.09). */
const EXCLUDED_FILL = "#E53E3E";

type Props = {
  event: Event;
  onEventChange: (update: (prev: Event) => Event) => void;
  /** The TixStock show the editor's "Source Tickets" list loads (null = none). */
  tixStockEventId?: string | null;
  /** Point "Source Tickets" at another TixStock show, or at none (null). */
  onTixStockShowChange?: (showId: string | null) => void;
};

/** Strip scripts / inline handlers - the drawing came from a supplier. */
function sanitizeSvg(raw: string): string | null {
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return null;
  svg
    .querySelectorAll("script, foreignObject, iframe, object, embed")
    .forEach((n) => n.remove());
  svg.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const isScriptUrl =
        (name === "href" || name === "xlink:href") &&
        /^\s*javascript:/i.test(attr.value);
      if (name.startsWith("on") || isScriptUrl) el.removeAttribute(attr.name);
    });
  });
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.removeAttribute("style");
  return svg.outerHTML;
}

// UTC on purpose: the day printed here must be the day the date gap was counted from
// (supplier-attach-actions.ts `dayIndex`). In the operator's own timezone a late kick-off
// rolls over midnight and the list shows a different day than the gap beside it.
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Tickets with no zone yet take it from the venue template (supplier +
 * category → zone). Tickets the operator already zoned are never touched.
 */
function zoneFromTemplate(
  tickets: EventTicket[],
  eventType: Event["type"],
  map: VenueMap,
): EventTicket[] {
  return tickets.map((ticket) => {
    if (ticket.zoneId) return ticket;
    const category = ticket.supplierCategory || ticket.category;
    const zoneId =
      map.supplier_categories?.[ticketSupplier(ticket, eventType)]?.[
        normalizeSupplierCategory(category)
      ];
    const zone = map.zones.find((z) => z.id === zoneId);
    if (!zone) return ticket;
    return {
      ...ticket,
      supplierCategory: category,
      zoneId: zone.id,
      zoneLabel: zone.label,
    };
  });
}

/** The name a fresh zone gets from a ticket: its Hebrew description when it is short enough to be a title. */
const zoneNameFromTicket = (ticket: EventTicket): string => {
  const description = (ticket.description || "").trim();
  return description && description.length <= 60
    ? description
    : ticket.category;
};

/** The supplier's OWN picture of the venue - how they slice the stands. */
function SupplierMap({ url, label }: { url: string; label: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {/* A supplier's PNG behind our proxy - next/image has no loader for it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/proxy-image?url=${encodeURIComponent(url)}`}
          alt={label}
          className="max-h-[420px] w-auto max-w-full rounded-md border bg-white"
        />
      </a>
    </div>
  );
}

/** What the colours on our drawings mean. */
function MapLegend() {
  const items: [string, string][] = [
    [ACTIVE_ZONE_FILL, "This zone"],
    [ZONE_FILL, "Another zone"],
    [IDLE_FILL, "No zone"],
    [EXCLUDED_FILL, "Excluded on this event"],
  ];
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {items.map(([color, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-sm border"
            style={{ backgroundColor: color }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * The seating line main's ticket card prints for one of our own tickets
 * (`ownSeating`), in the site's own words. Every supplier card on the page
 * says "ישיבה ביחד מובטחת"; ours says nothing until Together is set, and the
 * board says so instead of leaving it to be noticed on the site (Dor 30.09).
 */
function OwnSeatingPromise({ seatsTogether }: { seatsTogether?: number }) {
  if (ownSeating({ seatsTogether }, 2).seating !== "together" || !seatsTogether) {
    return (
      <span className="text-xs text-amber-700">
        No seating promise on the site - set Together to show{" "}
        <span dir="rtl">&quot;ישיבה ביחד מובטחת&quot;</span> like the suppliers&apos;
        tickets
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        On the site:
        <span dir="rtl" className="ml-1">
          ישיבה ביחד מובטחת
        </span>
      </Badge>
      <span className="text-muted-foreground">
        {seatsTogether === 2 ? "a pair" : `a party of 2-${seatsTogether}`}; a
        bigger one:{" "}
        <span dir="rtl">ישיבה יחד בקבוצות של עד {seatsTogether}</span>
      </span>
    </span>
  );
}

export function EventSuppliersPanel({
  event,
  onEventChange,
  tixStockEventId = null,
  onTixStockShowChange,
}: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const mapUrl = event.map_image_url || "";

  const [venueMap, setVenueMap] = useState<VenueMap | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [adopting, setAdopting] = useState(false);
  // "Same stadium, new season": venues we already zoned, to start from.
  const [otherMaps, setOtherMaps] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [copyFromId, setCopyFromId] = useState(NEW_VENUE);

  /* ── 1. The venue map behind this event ─────────────────────────── */

  useEffect(() => {
    if (!mapUrl) {
      setVenueMap(null);
      return;
    }
    let cancelled = false;
    setLoadingMap(true);
    getVenueMapByUrl(mapUrl)
      .then((map) => {
        if (!cancelled) setVenueMap(map);
      })
      .catch((error) => console.error("venue map lookup failed", error))
      .finally(() => {
        if (!cancelled) setLoadingMap(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapUrl]);

  const isOurMap = !!venueMap?.svg_url && mapUrl === venueMap.svg_url;

  // A drawing nobody adopted yet may still be a stadium we know (TixStock
  // publishes a new file every season) - offer our venues to start from.
  useEffect(() => {
    if (loadingMap || !mapUrl || venueMap) return;
    let cancelled = false;
    listVenueMaps()
      .then((maps) => {
        if (!cancelled) setOtherMaps(maps);
      })
      .catch((error) => console.error("venue maps list failed", error));
    return () => {
      cancelled = true;
    };
  }, [loadingMap, mapUrl, venueMap]);

  /** Point the event at our copy and zone its tickets from the venue template. */
  const switchToOurMap = (map: VenueMap) => {
    const svgUrl = map.svg_url;
    if (!svgUrl) return;
    onEventChange((prev) => ({
      ...prev,
      map_image_url: svgUrl,
      tickets_and_rates: zoneFromTemplate(
        prev.tickets_and_rates,
        prev.type,
        map,
      ),
    }));
  };

  // A venue we already own is recognised on its own: the event moves to our
  // copy and its tickets take their zones from the venue template. Runs once
  // per event + venue - after that the operator's choices stand.
  const recognisedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!venueMap?.svg_url) return;
    const key = `${event.id}:${venueMap.id}`;
    if (recognisedRef.current === key) return;
    recognisedRef.current = key;

    const needsSwitch = mapUrl === venueMap.source_url;
    const zoned = zoneFromTemplate(
      event.tickets_and_rates,
      event.type,
      venueMap,
    ).filter((ticket, i) => ticket !== event.tickets_and_rates[i]).length;
    if (!needsSwitch && zoned === 0) return;

    switchToOurMap(venueMap);
    toast({
      title: needsSwitch
        ? "We already own this venue's map"
        : "Tickets zoned from the venue template",
      description: `${needsSwitch ? "Switched to our copy. " : ""}${zoned} ticket(s) linked to our zones. Save the event to keep it.`,
    });
    // Once per event + venue map; the rest is read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, venueMap?.id, venueMap?.svg_url]);

  // Tickets that appear while the editor is open (added from "Source Tickets") are zoned from
  // the venue template at once - the recognition above ran when the page opened, before they
  // existed. Oasis Munich 06.07 (29.09) went live with four TixStock rows showing their raw
  // German names and competing with LiveTickets in the middle ring. Only NEW ticket ids and
  // only unzoned ones: a ticket the operator took out of a zone stays out.
  const seenTicketsRef = useRef<{ eventId: Event["id"]; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = event.tickets_and_rates.map((ticket) => ticket.id);
    if (!seenTicketsRef.current || seenTicketsRef.current.eventId !== event.id) {
      seenTicketsRef.current = { eventId: event.id, ids: new Set(ids) };
      return;
    }
    const seen = seenTicketsRef.current.ids;
    const fresh = new Set(ids.filter((id) => !seen.has(id)));
    fresh.forEach((id) => seen.add(id));
    if (fresh.size === 0 || !venueMap || !isOurMap) return;
    const zoneFresh = (tickets: EventTicket[], type: Event["type"]) =>
      tickets.map((ticket) =>
        fresh.has(ticket.id) ? zoneFromTemplate([ticket], type, venueMap)[0] : ticket,
      );
    const zoned = zoneFresh(event.tickets_and_rates, event.type);
    if (zoned.every((ticket, i) => ticket === event.tickets_and_rates[i])) return;
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: zoneFresh(prev.tickets_and_rates, prev.type),
    }));
  }, [event.id, event.tickets_and_rates, event.type, venueMap, isOurMap, onEventChange]);

  const handleAdopt = async () => {
    setAdopting(true);
    try {
      const categoryLabels = Object.fromEntries(
        event.tickets_and_rates
          .filter((t) => ticketSupplier(t, event.type) === "tixstock")
          .map((t) => [
            normalizeSupplierCategory(t.supplierCategory || t.category),
            zoneNameFromTicket(t),
          ]),
      );
      const result = await adoptVenueMap(
        mapUrl,
        event.location?.name || event.name_english || event.name,
        {
          categoryLabels,
          copyFromId: copyFromId === NEW_VENUE ? undefined : copyFromId,
        },
      );
      if (!result.ok) {
        toast({
          title: "Could not adopt the map",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      // Recognition must not fire a second time for the map we just made.
      recognisedRef.current = `${event.id}:${result.data.id}`;
      setVenueMap(result.data);
      switchToOurMap(result.data);
      setZoneEditorOpen(true);
      toast({
        title: "The map is ours",
        description: `${result.data.zones.length} zone(s) created and the TixStock tickets are linked. Rename the zones if needed, then save the event.`,
      });
    } finally {
      setAdopting(false);
    }
  };

  /* ── 2. Zone editor ─────────────────────────────────────────────── */

  const [zones, setZones] = useState<VenueZone[]>([]);
  const [zonesDirty, setZonesDirty] = useState(false);
  const [savingZones, setSavingZones] = useState(false);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [newZoneLabel, setNewZoneLabel] = useState("");
  const [drawing, setDrawing] = useState<string | null>(null);
  const drawingRef = useRef<HTMLDivElement>(null);
  // Folded by default: once a venue is zoned the editor is rarely needed, and
  // the event page is long enough without a second stadium drawing on it.
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  // Draft ticket id → zone the operator opened for it with "Own zone" - only
  // to keep the "mark its sections" note on that draft.
  const [openedForDraft, setOpenedForDraft] = useState<
    Record<string, string>
  >({});

  const venueMapId = venueMap?.id ?? null;

  useEffect(() => {
    setZones(venueMap?.zones ?? []);
    setZonesDirty(false);
    // Only when a different map loads - saving returns the same zones back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueMapId]);

  useEffect(() => {
    setDrawing(null);
  }, [venueMapId]);

  // Fetched once per venue: the editor draws it and every row of the zones
  // board shows a thumbnail of it with that zone painted.
  useEffect(() => {
    if (!venueMapId) return;
    let cancelled = false;
    getVenueMapDrawing(venueMapId)
      .then((result) => {
        if (cancelled) return;
        setDrawing(result.ok ? sanitizeSvg(result.data.svg) : null);
      })
      .catch((error) => console.error("venue map drawing failed", error));
    return () => {
      cancelled = true;
    };
  }, [venueMapId]);

  // Sections this EVENT does not sell (the TixStock map's exclude mode). Zones
  // belong to the venue, so they keep these sections - but the zone editor's
  // drawing shows them as excluded, which is also what main does on the site.
  const excludedSections = useMemo(
    () => new Set(event.tx_excluded_sections ?? []),
    [event.tx_excluded_sections],
  );
  // Exclude straight on OUR drawing (Alon 24.09: once the map was ours there
  // was no way to exclude). Same list as the TixStock map's exclude mode,
  // saved with the event; a click here never touches a zone.
  const [excludeMode, setExcludeMode] = useState(false);

  // Paint: the active zone dark, sections of any other zone light, rest idle.
  useEffect(() => {
    const root = drawingRef.current;
    if (!root || !drawing) return;
    const zoned = new Set(zones.flatMap((z) => z.sections));
    const active = new Set(
      zones.find((z) => z.id === activeZoneId)?.sections ?? [],
    );
    const excludedList = [...excludedSections];
    root.querySelectorAll("[data-section]").forEach((el) => {
      const id = el.getAttribute("data-section") || "";
      const fill = isSectionExcluded(id, excludedList)
        ? EXCLUDED_FILL
        : active.has(id)
          ? ACTIVE_ZONE_FILL
          : zoned.has(id)
            ? ZONE_FILL
            : IDLE_FILL;
      const blocks = el.querySelectorAll(".block");
      const shapes = blocks.length
        ? blocks
        : el.querySelectorAll("polygon, path, rect, circle, ellipse");
      shapes.forEach((shape) => {
        (shape as SVGElement).style.fill = fill;
        (shape as SVGElement).style.cursor =
          activeZoneId || excludeMode ? "pointer" : "default";
      });
    });
  }, [drawing, zones, activeZoneId, zoneEditorOpen, excludedSections, excludeMode]);

  /* One small picture of our map per zone, that zone painted - the zones
     board's left column (Alon 23.09: "to be sure everything is right").
     Built as images, not live SVG: eight copies of a stadium in the DOM
     would be heavy, and these are only looked at. The zone alone: excluded
     sections are marked in the zone editor only (Alon 25.09). */
  const zoneThumbs = useMemo(() => {
    const thumbs = new Map<string, string>();
    if (!drawing) return thumbs;
    const open = drawing.indexOf(">", drawing.indexOf("<svg"));
    if (open < 0) return thumbs;
    const shapes = ":is(.block, polygon, path, rect, circle, ellipse)";
    const sel = (id: string) => `[data-section="${id.replace(/["\\]/g, "\\$&")}"] ${shapes}`;
    for (const zone of zones) {
      const css =
        `[data-section] ${shapes}{fill:${IDLE_FILL}}` +
        zone.sections.map((id) => `${sel(id)}{fill:${ACTIVE_ZONE_FILL}}`).join("");
      const svg = `${drawing.slice(0, open + 1)}<style>${css}</style>${drawing.slice(open + 1)}`;
      thumbs.set(zone.id, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    return thumbs;
  }, [drawing, zones]);

  // Click a section = toggle it in the active zone, or - in exclude mode - in
  // the sections this event does not sell.
  useEffect(() => {
    const root = drawingRef.current;
    if (!root || (!activeZoneId && !excludeMode)) return;
    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as Element | null)?.closest("[data-section]");
      const id = el?.getAttribute("data-section");
      if (!id) return;
      if (excludeMode) {
        onEventChange((prev) => {
          const current = prev.tx_excluded_sections ?? [];
          return {
            ...prev,
            tx_excluded_sections: current.includes(id)
              ? current.filter((s) => s !== id)
              : [...current, id],
          };
        });
        return;
      }
      setZones((prev) =>
        prev.map((zone) =>
          zone.id !== activeZoneId
            ? zone
            : {
                ...zone,
                sections: zone.sections.includes(id)
                  ? zone.sections.filter((s) => s !== id)
                  : [...zone.sections, id],
              },
        ),
      );
      setZonesDirty(true);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [drawing, activeZoneId, zoneEditorOpen, excludeMode, onEventChange]);

  const handleAddZone = () => {
    const label = newZoneLabel.trim();
    if (!label) return;
    const zone: VenueZone = {
      id: newZoneId(label, zones),
      label,
      sections: [],
    };
    setZones((prev) => [...prev, zone]);
    setExcludeMode(false);
    setActiveZoneId(zone.id);
    setNewZoneLabel("");
    setZonesDirty(true);
  };

  const handleRemoveZone = (zoneId: string) => {
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
    if (activeZoneId === zoneId) setActiveZoneId(null);
    setZonesDirty(true);
  };

  /**
   * Save the zone list. Returns whether it is saved now. Called by the button
   * AND before a ticket takes a zone that exists only here - the zone lists
   * used to be two (saved vs. being edited), and a zone added or renamed but
   * not saved was missing from every "choose zone" list (QA 23.09).
   */
  const saveZones = async (quiet = false): Promise<boolean> => {
    if (!venueMap) return false;
    setSavingZones(true);
    try {
      const result = await saveVenueZones(venueMap.id, zones);
      if (!result.ok) {
        toast({
          title: "Zones not saved",
          description: result.error,
          variant: "destructive",
        });
        return false;
      }
      setVenueMap(result.data);
      setZones(result.data.zones);
      setZonesDirty(false);
      // A renamed or removed zone must not leave a stale label on a ticket.
      const byId = new Map(result.data.zones.map((z) => [z.id, z]));
      onEventChange((prev) => ({
        ...prev,
        tickets_and_rates: prev.tickets_and_rates.map((ticket) => {
          if (!ticket.zoneId) return ticket;
          const zone = byId.get(ticket.zoneId);
          if (!zone) {
            return { ...ticket, zoneId: undefined, zoneLabel: undefined };
          }
          return zone.label === ticket.zoneLabel
            ? ticket
            : { ...ticket, zoneLabel: zone.label };
        }),
      }));
      if (!quiet) {
        toast({
          title: "Zones saved",
          description: "The map on the site updates within a minute.",
        });
      }
      return true;
    } finally {
      setSavingZones(false);
    }
  };

  const handleSaveZones = () => {
    void saveZones();
  };

  /* ── 3. Tickets → zones ─────────────────────────────────────────── */

  const savedZones = useMemo(() => venueMap?.zones ?? [], [venueMap?.zones]);

  /** In the list being edited but not (or not so) in the database. */
  const isUnsavedZone = useCallback(
    (zone: VenueZone) =>
      !savedZones.some((z) => z.id === zone.id && z.label === zone.label),
    [savedZones],
  );

  /** Before a ticket takes `zoneId`: make sure the zone exists in the database. */
  const ensureZoneSaved = async (zoneId: string | undefined) => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone || !isUnsavedZone(zone)) return true;
    return saveZones(true);
  };

  /** The zone the supplier's own words point at - offered, never applied unseen. */
  const suggestionFor = useCallback(
    (ticket: EventTicket): TieredSuggestion | null =>
      suggestZoneTiered(ticket.description || ticket.category, zones),
    [zones],
  );

  const templateZoneFor = useCallback(
    (ticket: EventTicket): string | undefined => {
      const supplier = ticketSupplier(ticket, event.type);
      const key = normalizeSupplierCategory(
        ticket.supplierCategory || ticket.category,
      );
      const zoneId = venueMap?.supplier_categories?.[supplier]?.[key];
      return zoneId && savedZones.some((z) => z.id === zoneId)
        ? zoneId
        : undefined;
    },
    [event.type, venueMap?.supplier_categories, savedZones],
  );

  const withZone = useCallback(
    (ticket: EventTicket, zoneId: string | undefined): EventTicket => {
      const zone = zones.find((z) => z.id === zoneId);
      return {
        ...ticket,
        supplierCategory: ticket.supplierCategory || ticket.category,
        zoneId: zone?.id,
        zoneLabel: zone?.label.trim(),
      };
    },
    [zones],
  );

  const rememberInTemplate = (
    supplier: string,
    categoryToZone: Record<string, string>,
  ) => {
    if (!venueMap) return;
    // The venue remembers: the next event here starts from this mapping.
    rememberSupplierCategories(venueMap.id, supplier, categoryToZone)
      .then((result) => {
        if (!result.ok) return;
        setVenueMap((prev) =>
          prev ? { ...prev, supplier_categories: result.data } : prev,
        );
      })
      .catch((error) => console.error("venue template save failed", error));
  };

  const handleTicketZone = async (ticket: EventTicket, value: string) => {
    const zoneId = value === NO_ZONE ? undefined : value;
    // A zone only edited here must reach the database before a ticket points at it.
    if (!(await ensureZoneSaved(zoneId))) return;
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: prev.tickets_and_rates.map((t) =>
        t.id === ticket.id ? withZone(t, zoneId) : t,
      ),
    }));
    // Clearing ONE ticket on ONE event is not the venue forgetting the category (QA 2026-09-18).
    // Sent as "" it deleted the mapping from `venue_maps.supplier_categories`: the "Apply venue
    // template" button, which is counted from that same mapping, appeared and vanished a moment
    // later with nothing left to restore - here and at the next event in that stadium. Only a
    // zone that was CHOSEN is remembered. Our own tickets are placed by hand per game - the
    // venue template is for suppliers' category names.
    if (!zoneId || hasOwnStock(ticket)) return;
    rememberInTemplate(ticketSupplier(ticket, event.type), {
      [ticket.supplierCategory || ticket.category]: zoneId,
    });
  };

  const unzonedFromTemplate = useMemo(
    () =>
      event.tickets_and_rates.filter((t) => !t.zoneId && templateZoneFor(t)),
    [event.tickets_and_rates, templateZoneFor],
  );

  const handleApplyTemplate = () => {
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: prev.tickets_and_rates.map((t) =>
        t.zoneId ? t : withZone(t, templateZoneFor(t)),
      ),
    }));
  };

  /* ── 4. Attach LiveTickets ──────────────────────────────────────── */

  const [attachOpen, setAttachOpen] = useState(false);
  const [candidates, setCandidates] = useState<LiveTicketsCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<LiveTicketsCandidate | null>(null);
  // A REAL date gap is the operator's call, made on the spot (football fixtures move a day with
  // no final date) - but it has to be made, not scrolled past: the Add button waits for this.
  const [gapAcknowledged, setGapAcknowledged] = useState(false);
  const [drafts, setDrafts] = useState<LiveTicketsDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [draftZones, setDraftZones] = useState<Record<string, string>>({});
  // Where a draft's pre-filled zone came from: the venue template, or our
  // suggestion (strong / weak). Gone once a person picks the zone.
  const [draftZoneOrigin, setDraftZoneOrigin] = useState<
    Record<string, "template" | "strong" | "weak">
  >({});
  // "Bring non-instant-confirm too" (Alon 23.09): internal only - the ticket
  // is flagged `nonInstant` and warned about on the event and on the order.
  const [includeNonInstant, setIncludeNonInstant] = useState(false);

  const isAttachable = (category: LiveTicketsDraft["category"]) =>
    category.sellable || (includeNonInstant && category.nonInstantOnly);

  const setDraftZone = (ticketId: string, zoneId: string | undefined) => {
    setDraftZones((prev) => {
      const next = { ...prev };
      if (zoneId) next[ticketId] = zoneId;
      else delete next[ticketId];
      return next;
    });
    setDraftZoneOrigin((prev) => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
  };

  const attachedIds = useMemo(
    () =>
      new Set(
        event.tickets_and_rates
          .filter((t) => ticketSupplier(t, event.type) === "livetickets")
          .map((t) => t.id),
      ),
    [event.tickets_and_rates, event.type],
  );
  const hasLiveTickets = attachedIds.size > 0;

  // LiveTickets' picture of the stadium: of the event being attached, else of
  // the one already attached. One copy, under our map in the zone editor, and
  // small beside their tickets on the board (QA 23.09: it vanished once the
  // attach was done, and showed twice while it was open).
  const attachedLiveEid = useMemo(
    () =>
      event.tickets_and_rates.find(
        (t) => ticketSupplier(t, event.type) === "livetickets" && t.eid,
      )?.eid ?? null,
    [event.tickets_and_rates, event.type],
  );
  const [attachedLiveMapUrl, setAttachedLiveMapUrl] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!attachedLiveEid) {
      setAttachedLiveMapUrl(null);
      return;
    }
    let cancelled = false;
    getLiveTicketsMapUrl(attachedLiveEid)
      .then((result) => {
        if (!cancelled) setAttachedLiveMapUrl(result.ok ? result.data : null);
      })
      .catch((error) => console.error("LiveTickets map lookup failed", error));
    return () => {
      cancelled = true;
    };
  }, [attachedLiveEid]);
  const liveMapUrl =
    (attachOpen && picked?.venueMapUrl) || attachedLiveMapUrl || null;

  const loadCandidates = async (term?: string) => {
    setLoadingCandidates(true);
    try {
      const result = await findLiveTicketsCandidates(
        event.name_english || event.name,
        event.date,
        term,
      );
      if (!result.ok) {
        toast({
          title: "LiveTickets",
          description: result.error,
          variant: "destructive",
        });
        return;
      }
      setCandidates(result.data);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleOpenAttach = () => {
    setAttachOpen(true);
    setPicked(null);
    setDrafts([]);
    loadCandidates();
  };

  const handlePick = async (candidate: LiveTicketsCandidate) => {
    setPicked(candidate);
    // Their categories are matched inside the zone editor, beside both maps.
    setZoneEditorOpen(true);
    setGapAcknowledged(false);
    setLoadingDrafts(true);
    try {
      const result = await buildLiveTicketsDrafts(candidate.eventId);
      if (!result.ok) {
        toast({
          title: "LiveTickets",
          description: result.error,
          variant: "destructive",
        });
        setDrafts([]);
        return;
      }
      setDrafts(result.data);
      const startZones: Record<string, string> = {};
      const origin: Record<string, "template" | "strong" | "weak"> = {};
      const preselected: Record<string, boolean> = {};
      for (const draft of result.data) {
        const fromTemplate = templateZoneFor(draft.ticket);
        // No template answer: our suggestion from their own words ("סקטורים
        // 500-600", "מאחורי השער"), shown as such until someone confirms it.
        const suggestion = fromTemplate ? null : suggestionFor(draft.ticket);
        const zoneId = fromTemplate ?? suggestion?.zoneId;
        if (zoneId) startZones[draft.ticket.id] = zoneId;
        if (fromTemplate) origin[draft.ticket.id] = "template";
        else if (suggestion) {
          origin[draft.ticket.id] = suggestion.strong ? "strong" : "weak";
        }
        // Pre-tick only what is sellable AND already zoned by the venue
        // template - a suggestion still needs the operator's eyes.
        preselected[draft.ticket.id] =
          draft.category.sellable &&
          !!fromTemplate &&
          !attachedIds.has(draft.ticket.id);
      }
      setDraftZones(startZones);
      setDraftZoneOrigin(origin);
      setChosen(preselected);
    } finally {
      setLoadingDrafts(false);
    }
  };

  /**
   * The supplier slices the stand differently from every zone we have: open a
   * zone of its own for this category. The draft takes it at once; the
   * operator marks its sections on our drawing (their map is shown next to
   * it), and the zones are saved with "Save zones" or, at the latest, by Add.
   */
  const handleZoneForDraft = (draft: LiveTicketsDraft) => {
    const label =
      draft.category.description ||
      draft.category.hebTitle ||
      draft.category.title;
    const zone: VenueZone = {
      id: newZoneId(draft.category.title || label, zones),
      label: label.slice(0, 80),
      sections: [],
    };
    setZones((prev) => [...prev, zone]);
    setActiveZoneId(zone.id);
    setZonesDirty(true);
    setZoneEditorOpen(true);
    setOpenedForDraft((prev) => ({ ...prev, [draft.ticket.id]: zone.id }));
    setDraftZone(draft.ticket.id, zone.id);
    setChosen((prev) => ({ ...prev, [draft.ticket.id]: true }));
    document
      .getElementById("venue-zone-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const zoneExists = (zoneId: string | undefined) =>
    !!zoneId && zones.some((z) => z.id === zoneId);

  const selectedDrafts = drafts.filter(
    (d) =>
      chosen[d.ticket.id] &&
      isAttachable(d.category) &&
      !attachedIds.has(d.ticket.id),
  );
  const selectedWithoutZone = selectedDrafts.filter(
    (d) => !zoneExists(draftZones[d.ticket.id]),
  );

  const gapNeedsDecision = !!picked && picked.dateGapDays !== 0 && !gapAcknowledged;

  const handleAttach = async () => {
    if (selectedDrafts.length === 0 || selectedWithoutZone.length > 0 || gapNeedsDecision) return;
    // Zones opened or renamed for these categories go to the database first -
    // a ticket must never point at a zone that exists only in this editor.
    if (zonesDirty && !(await saveZones(true))) return;
    const tickets = selectedDrafts.map((d) => {
      const zoned = withZone(d.ticket, draftZones[d.ticket.id]);
      return d.category.sellable
        ? zoned
        : { ...zoned, available: true, nonInstant: true };
    });
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: [...prev.tickets_and_rates, ...tickets],
    }));
    rememberInTemplate(
      "livetickets",
      Object.fromEntries(
        selectedDrafts.map((d) => [
          d.ticket.supplierCategory || d.ticket.category,
          draftZones[d.ticket.id],
        ]),
      ),
    );
    setAttachOpen(false);
    setOpenedForDraft({});
    const nonInstantCount = tickets.filter((t) => t.nonInstant).length;
    toast({
      title: `${tickets.length} LiveTickets ticket(s) added`,
      description: `Save the event to put them on sale.${
        nonInstantCount > 0
          ? ` ${nonInstantCount} of them are NOT instant-confirm - orders for them are flagged.`
          : ""
      }`,
    });
  };

  /** One click for an unzoned ticket: take the zone its own words point at. */
  const handleUseSuggestion = (ticket: EventTicket, zoneId: string) => {
    void handleTicketZone(ticket, zoneId);
  };

  const handleDetachLiveTickets = () => {
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: prev.tickets_and_rates.filter(
        (t) => ticketSupplier(t, prev.type) !== "livetickets",
      ),
    }));
  };

  /* ── 4b. The TixStock show ──────────────────────────────────────── */

  // One TixStock show per event: its tickets all carry its id (`eid`), and the site reads the
  // show off the first of them. Changing the show therefore takes the old show's tickets off.
  const tixStockTicketCount = event.tickets_and_rates.filter(
    (t) => ticketSupplier(t, event.type) === "tixstock",
  ).length;
  const [txPickerOpen, setTxPickerOpen] = useState(false);
  const [txSearch, setTxSearch] = useState("");
  const [txCandidates, setTxCandidates] = useState<TixStockCandidate[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const loadTxCandidates = async (term?: string) => {
    setTxLoading(true);
    try {
      const result = await findTixStockCandidates(
        event.name_english || event.name,
        event.date,
        term,
      );
      if (!result.ok) {
        toast({ title: "TixStock", description: result.error, variant: "destructive" });
        return;
      }
      setTxCandidates(result.data);
    } finally {
      setTxLoading(false);
    }
  };

  const handleOpenTxPicker = () => {
    setTxPickerOpen(true);
    setTxSearch("");
    loadTxCandidates();
  };

  const dropTixStockTickets = () =>
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: prev.tickets_and_rates.filter(
        (t) => ticketSupplier(t, prev.type) !== "tixstock",
      ),
    }));

  const handleConnectTx = async (candidate: TixStockCandidate) => {
    if (candidate.eventId === tixStockEventId && tixStockTicketCount > 0) {
      setTxPickerOpen(false);
      return;
    }
    if (tixStockTicketCount > 0) {
      const ok = await confirm({
        title: "Change the TixStock show?",
        description: `The ${tixStockTicketCount} TixStock ticket(s) of the current show come off this event - an event sells from one TixStock show. Nothing is saved until you save the event.`,
        confirmLabel: "Change show",
        destructive: true,
      });
      if (!ok) return;
      dropTixStockTickets();
    }
    onTixStockShowChange?.(candidate.eventId);
    setTxPickerOpen(false);
    toast({
      title: `TixStock: ${candidate.name}`,
      description:
        "Connected. Add its categories from Source Tickets above, zone them here, then save the event.",
    });
  };

  const handleDetachTixStock = async () => {
    const ok = await confirm({
      title: "Remove the TixStock tickets?",
      description: `${tixStockTicketCount} TixStock ticket(s) come off this event and the TixStock show is disconnected. Nothing is saved until you save the event.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    dropTixStockTickets();
    onTixStockShowChange?.(null);
  };

  /* ── 5. Our own tickets ─────────────────────────────────────────── */

  // Seats WE hold for this game (`supplier: "static"` + `stock`). Main sells
  // them beside the suppliers - in their zone, the cheaper offer wins - and
  // stops at the stock: seats left = stock - seats held by live reservations,
  // checked again at checkout (lib/own-stock.ts, same count here and there).
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownCategory, setOwnCategory] = useState("");
  const [ownDescription, setOwnDescription] = useState("");
  const [ownPrice, setOwnPrice] = useState("");
  const [ownStock, setOwnStock] = useState("");
  // How many of these seats sit together (Alon 29.09) - empty = no promise.
  const [ownTogether, setOwnTogether] = useState("");
  const [ownZone, setOwnZone] = useState(NO_ZONE);
  const [held, setHeld] = useState<Map<string, number>>(new Map());

  const ownTicketCount = event.tickets_and_rates.filter(hasOwnStock).length;
  useEffect(() => {
    if (ownTicketCount === 0 || !event.id) return;
    let cancelled = false;
    getOwnStockHeld(event.id)
      .then((result) => {
        if (!cancelled && result.ok) setHeld(new Map(Object.entries(result.data)));
      })
      .catch((error) => console.error("own stock count failed", error));
    return () => {
      cancelled = true;
    };
  }, [event.id, ownTicketCount]);

  const ownPriceValue = Number(ownPrice);
  const ownStockValue = Number(ownStock);
  const ownTogetherValue = ownTogether.trim() === "" ? undefined : Number(ownTogether);

  const handleAddOwnTicket = async () => {
    if (ownProblems.length > 0) return;
    const zoneId = ownZone === NO_ZONE ? undefined : ownZone;
    if (!(await ensureZoneSaved(zoneId))) return;
    const category = ownCategory.trim();
    const ticket: EventTicket = withZone(
      {
        id: crypto.randomUUID(),
        supplier: "static",
        vendor: "Mega Events",
        category,
        description: ownDescription.trim(),
        price: Math.round(ownPriceValue),
        stock: ownStockValue,
        ...(ownTogetherValue !== undefined ? { seatsTogether: ownTogetherValue } : {}),
        colorOnTheMap: OWN_TICKET_COLOR,
        available: true,
      },
      zoneId,
    );
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: [...prev.tickets_and_rates, ticket],
    }));
    setOwnCategory("");
    setOwnDescription("");
    setOwnPrice("");
    setOwnStock("");
    setOwnTogether("");
    setOwnZone(NO_ZONE);
    setOwnOpen(false);
    toast({
      title: "Our ticket added",
      description: `${ownStockValue} seat(s) of "${category}". Save the event to put them on sale.`,
    });
  };

  /** Price / stock of one of our own tickets, edited in place. */
  const updateOwnTicket = (
    ticketId: string,
    patch: Partial<Pick<EventTicket, "price" | "stock" | "available" | "seatsTogether">>,
  ) => {
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: prev.tickets_and_rates.map((t) =>
        t.id === ticketId ? { ...t, ...patch } : t,
      ),
    }));
  };

  const removeOwnTicket = (ticketId: string) => {
    onEventChange((prev) => ({
      ...prev,
      tickets_and_rates: prev.tickets_and_rates.filter((t) => t.id !== ticketId),
    }));
  };

  /* ── Render ─────────────────────────────────────────────────────── */

  // Zones being edited count: a zone added or renamed a moment ago is offered
  // at once and saved the moment a ticket takes it (`ensureZoneSaved`).
  const canZone = isOurMap && zones.length > 0;
  // What still stops "Add" on our own ticket - shown, never guessed.
  const ownProblems = [
    !ownCategory.trim() && "a name",
    !(Number.isFinite(ownPriceValue) && ownPriceValue > 0) && "a price above $0",
    !(Number.isInteger(ownStockValue) && ownStockValue > 0) && "a whole number of seats",
    ownTogetherValue !== undefined &&
      !(Number.isInteger(ownTogetherValue) && ownTogetherValue >= 2) &&
      "seats together as a whole number of 2 or more (or empty)",
    canZone && ownZone === NO_ZONE && "a zone",
  ].filter((problem): problem is string => !!problem);
  const hiddenTickets = event.tickets_and_rates.filter(
    (t) => ticketSupplier(t, event.type) !== "tixstock" && !t.zoneId,
  );
  const nonInstantTickets = event.tickets_and_rates.filter((t) => t.nonInstant);

  const zoneName = (zone: VenueZone) => zone.label.trim() || zone.id;
  const zoneSelectItems = zones.map((zone) => (
    <SelectItem key={zone.id} value={zone.id}>
      {zoneName(zone)}
      {isUnsavedZone(zone) ? " · unsaved" : ""}
    </SelectItem>
  ));

  /* The board: one row per zone - our map with the zone painted, our tickets,
     LiveTickets' map + their tickets (QA 23.09). Drafts of an event being
     attached are matched in the zone editor, not here. */
  const showDrafts = attachOpen && !!picked && !loadingDrafts;
  const boardDrafts = showDrafts
    ? drafts.filter((d) => !attachedIds.has(d.ticket.id))
    : [];
  const columnOf = (ticket: EventTicket) =>
    hasOwnStock(ticket)
      ? 2
      : ticketSupplier(ticket, event.type) === "livetickets"
        ? 1
        : 0;
  const boardRows: { key: string; zone: VenueZone | null }[] = [
    ...zones.map((zone) => ({ key: zone.id, zone })),
    { key: NO_ZONE, zone: null },
  ];
  const ticketsIn = (zone: VenueZone | null) =>
    event.tickets_and_rates.filter((t) =>
      zone ? t.zoneId === zone.id : !zoneExists(t.zoneId),
    );
  const nonInstantDrafts = drafts.filter(
    (d) => d.category.nonInstantOnly && !attachedIds.has(d.ticket.id),
  ).length;
  const suggestedCount = boardDrafts.filter(
    (d) => draftZoneOrigin[d.ticket.id] === "strong" || draftZoneOrigin[d.ticket.id] === "weak",
  ).length;

  /** Price, seats and what is left of one of our own tickets. */
  const renderOwnStock = (ticket: EventTicket) => {
    const sold = held.get(ticket.id) ?? 0;
    const left = stockLeft(ticket, held) ?? 0;
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          $
          <Input
            type="number"
            min={1}
            className="h-8 w-20"
            value={ticket.price}
            onChange={(e) =>
              updateOwnTicket(ticket.id, {
                price: Math.max(0, Math.round(Number(e.target.value) || 0)),
              })
            }
          />
        </label>
        <label className="flex items-center gap-1">
          Seats
          <Input
            type="number"
            min={0}
            className="h-8 w-20"
            value={ticket.stock ?? 0}
            onChange={(e) =>
              updateOwnTicket(ticket.id, {
                stock: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })
            }
          />
        </label>
        <label
          className="flex items-center gap-1"
          title="How many of these seats sit together - empty = no seating promise"
        >
          Together ≤
          <Input
            type="number"
            min={2}
            className="h-8 w-16"
            value={ticket.seatsTogether ?? ""}
            onChange={(e) => {
              const value = Math.floor(Number(e.target.value));
              updateOwnTicket(ticket.id, {
                // Any whole number is kept while typing ("1" on the way to "12");
                // under 2 promises nothing (`ownSeating`).
                seatsTogether: e.target.value === "" || !(value >= 1) ? undefined : value,
              });
            }}
          />
        </label>
        <span className="tabular-nums text-muted-foreground">
          sold {sold} · left {left}
        </span>
        {left === 0 && <Badge variant="outline">Sold out</Badge>}
        {(ticket.stock ?? 0) < sold && (
          <span className="text-amber-700">below the seats already sold</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={sold > 0}
          title={
            sold > 0
              ? `${sold} seat(s) already sold - set the seats to what you still hold instead`
              : "Remove this ticket"
          }
          onClick={() => removeOwnTicket(ticket.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <div className="basis-full">
          <OwnSeatingPromise seatsTogether={ticket.seatsTogether} />
        </div>
      </div>
    );
  };

  const renderTicket = (ticket: EventTicket) => {
    const suggestion = !zoneExists(ticket.zoneId)
      ? suggestionFor(ticket)
      : null;
    const suggested = zones.find((z) => z.id === suggestion?.zoneId);
    return (
      <div
        key={ticket.id}
        className={cn(
          "space-y-2 rounded-md border bg-background p-2 text-sm",
          ticket.available === false && "opacity-60",
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {ticket.supplierCategory || ticket.category}
            </div>
            <div dir="rtl" className="truncate text-xs text-muted-foreground">
              {ticket.description}
            </div>
          </div>
          <span className="tabular-nums">${ticket.price}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ticket.available === false && (
            <Badge variant="outline">Off sale</Badge>
          )}
          {ticket.nonInstant && (
            <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100">
              <AlertTriangle className="h-3 w-3" /> Not instant-confirm
            </Badge>
          )}
          <Select
            value={zoneExists(ticket.zoneId) ? ticket.zoneId : NO_ZONE}
            onValueChange={(value) => void handleTicketZone(ticket, value)}
            disabled={!canZone || savingZones}
          >
            <SelectTrigger className="h-8 w-full sm:w-60" dir="rtl">
              <SelectValue placeholder="No zone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ZONE}>— No zone —</SelectItem>
              {zoneSelectItems}
            </SelectContent>
          </Select>
          {suggested && canZone && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => handleUseSuggestion(ticket, suggested.id)}
            >
              Suggested:{" "}
              <span dir="rtl" className="ml-1">
                {zoneName(suggested)}
              </span>
            </Button>
          )}
        </div>
        {hasOwnStock(ticket) && renderOwnStock(ticket)}
      </div>
    );
  };

  const renderDraft = (draft: LiveTicketsDraft) => {
    const { ticket, category } = draft;
    const attachable = isAttachable(category);
    return (
      <div
        key={`draft-${ticket.id}`}
        className={cn(
          "space-y-2 rounded-md border border-dashed border-primary/50 bg-primary/5 p-2 text-sm",
          !attachable && "opacity-60",
        )}
      >
        <div className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={!!chosen[ticket.id] && attachable}
            disabled={!attachable}
            onCheckedChange={(value) =>
              setChosen((prev) => ({ ...prev, [ticket.id]: value === true }))
            }
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {category.title}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                new · up to {category.maxPerOrder}/order
              </span>
            </div>
            <div dir="rtl" className="truncate text-xs text-muted-foreground">
              {category.description}
            </div>
          </div>
          <span className="tabular-nums">${ticket.price}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!category.sellable && (
            <Badge
              variant="outline"
              className={cn(
                category.nonInstantOnly &&
                  attachable &&
                  "border-amber-400 text-amber-800",
              )}
            >
              {category.blockedReason}
            </Badge>
          )}
          {category.maxPerOrder === 1 && (
            <Badge variant="outline">Shown to a party of 1 only</Badge>
          )}
          {attachable && (
            <>
              <Select
                value={
                  zoneExists(draftZones[ticket.id])
                    ? draftZones[ticket.id]
                    : NO_ZONE
                }
                onValueChange={(value) =>
                  setDraftZone(ticket.id, value === NO_ZONE ? undefined : value)
                }
              >
                <SelectTrigger className="h-8 w-full sm:w-60" dir="rtl">
                  <SelectValue placeholder="Zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ZONE}>— Choose zone —</SelectItem>
                  {zoneSelectItems}
                </SelectContent>
              </Select>
              {draftZoneOrigin[ticket.id] === "template" && (
                <Badge variant="secondary">From the venue template</Badge>
              )}
              {draftZoneOrigin[ticket.id] === "strong" && (
                <Badge variant="secondary">Suggested - check it</Badge>
              )}
              {draftZoneOrigin[ticket.id] === "weak" && (
                <Badge variant="outline" className="border-amber-400 text-amber-800">
                  Closest zone - a guess, check it
                </Badge>
              )}
              {!zoneExists(draftZones[ticket.id]) && (
                <span className="text-xs text-muted-foreground">
                  No zone of ours matches - pick one or open its own
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!!openedForDraft[ticket.id]}
                onClick={() => handleZoneForDraft(draft)}
              >
                <Plus className="mr-1 h-4 w-4" /> Own zone
              </Button>
            </>
          )}
        </div>
        {openedForDraft[ticket.id] && (
          <p className="text-xs text-amber-700">
            Zone opened above - mark its sections on our map. It is saved with
            “Save zones”, or by “Add” at the latest.
          </p>
        )}
      </div>
    );
  };

  const attachBar = showDrafts && (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {selectedWithoutZone.length > 0 && (
        <span className="text-sm text-amber-700">
          {selectedWithoutZone.length} selected ticket(s) still need a zone.
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAttachOpen(false)}
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => void handleAttach()}
        disabled={
          selectedDrafts.length === 0 ||
          selectedWithoutZone.length > 0 ||
          gapNeedsDecision ||
          savingZones
        }
      >
        {savingZones && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Add {selectedDrafts.length} ticket(s)
      </Button>
    </div>
  );

  return (
    <Card
      id="section-suppliers"
      data-editor-section="Suppliers & zones"
      className="scroll-mt-20"
    >
      <CardHeader>
        <CardTitle>Suppliers &amp; zones</CardTitle>
        <CardDescription>
          Sell tickets from more than one supplier on this event. Every step
          here is manual: you decide whether to add a supplier, which of their
          events it is, and which of our zones each category belongs to.
        </CardDescription>
        {nonInstantTickets.length > 0 && (
          <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {nonInstantTickets.length} ticket(s) on this event are NOT
            instant-confirm - every order for them must be confirmed with
            LiveTickets by hand. The customer is not told.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-8">
        {/* ── Map ownership ── */}
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 font-medium">
            <MapPin className="h-4 w-4" /> Seat map
          </h3>
          {loadingMap ? (
            <p className="text-sm text-muted-foreground">Checking the map…</p>
          ) : !mapUrl ? (
            <p className="text-sm text-muted-foreground">
              This event has no map yet.
            </p>
          ) : isOurMap ? (
            <p className="text-sm">
              <Badge className="mr-2">Ours</Badge>
              {venueMap?.name} — served from our storage, matched by our zones.
            </p>
          ) : venueMap ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                We already own this drawing (<b>{venueMap.name}</b>), but this
                event still loads the supplier&apos;s file.
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => switchToOurMap(venueMap)}
              >
                Use our map
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                The map is loaded from the supplier. Copy it into our storage: a
                zone is opened for every TixStock category on it and the tickets
                are linked — you only rename. Required before adding a second
                supplier.
              </span>
              {otherMaps.length > 0 && (
                <Select value={copyFromId} onValueChange={setCopyFromId}>
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_VENUE}>
                      New venue — zones from TixStock categories
                    </SelectItem>
                    {otherMaps.map((map) => (
                      <SelectItem key={map.id} value={map.id}>
                        Same stadium as: {map.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleAdopt}
                disabled={adopting}
              >
                {adopting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Make this map ours
              </Button>
            </div>
          )}
        </section>

        {/* ── Attach LiveTickets ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Add a supplier</h3>
            <div className="flex flex-wrap gap-2">
              {tixStockTicketCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDetachTixStock}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Remove TixStock tickets
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleOpenTxPicker}
              >
                {tixStockEventId ? (
                  <>
                    <Search className="mr-1 h-4 w-4" /> Change TixStock show
                  </>
                ) : (
                  <>
                    <Plus className="mr-1 h-4 w-4" /> Connect TixStock show
                  </>
                )}
              </Button>
              {hasLiveTickets && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDetachLiveTickets}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Remove LiveTickets tickets
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleOpenAttach}
                disabled={!canZone}
              >
                <Plus className="mr-1 h-4 w-4" /> Add LiveTickets tickets
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOwnOpen((open) => !open)}
              >
                <Plus className="mr-1 h-4 w-4" /> Our own ticket
              </Button>
            </div>
          </div>
          {txPickerOpen && (
            <div className="space-y-2 rounded-md border p-3" id="tixstock-show-picker">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">TixStock show</span>
                <Input
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      loadTxCandidates(txSearch);
                    }
                  }}
                  placeholder="Search by name, e.g. Oasis"
                  className="h-8 max-w-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => loadTxCandidates(txSearch)}
                  disabled={txLoading}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setTxPickerOpen(false)}
                >
                  Close
                </Button>
              </div>
              {txLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking for TixStock shows…
                </p>
              ) : txCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No TixStock show within 3 days of this event&apos;s date shares its name - search by name.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {txCandidates.map((candidate) => {
                    const current = candidate.eventId === tixStockEventId;
                    return (
                      <li
                        key={candidate.eventId}
                        className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            {candidate.name}{" "}
                            <span className="tabular text-muted-foreground">
                              {candidate.showDate.slice(0, 10)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[candidate.venue, candidate.city].filter(Boolean).join(", ")}
                            {` · ${candidate.ticketCount} tickets`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {candidate.dateGapDays !== 0 && (
                            <Badge variant="destructive">
                              {candidate.dateGapDays > 0 ? "+" : ""}
                              {candidate.dateGapDays} day(s)
                            </Badge>
                          )}
                          {current && <Badge variant="secondary">Connected</Badge>}
                          <Button
                            type="button"
                            size="sm"
                            variant={current ? "ghost" : "default"}
                            onClick={() => handleConnectTx(candidate)}
                            disabled={current && tixStockTicketCount > 0}
                          >
                            {current ? "Connected" : tixStockEventId ? "Switch to this" : "Connect"}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Only instant-confirm categories can be added. After saving, their
            prices refresh automatically; a new category at the supplier is
            never published on its own.
          </p>

          {ownOpen && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm text-muted-foreground">
                Seats we hold ourselves for this game. The site sells them next
                to the suppliers - in the same zone the cheaper offer wins - and
                stops at the number of seats: every live reservation of this
                ticket (not Cancelled / Lost / 24Save) takes seats, and checkout
                re-counts before it books.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_110px_110px_130px_minmax(0,1.5fr)]">
                <Input
                  dir="auto"
                  placeholder="Ticket name, e.g. לאורך המגרש - קומה 1"
                  value={ownCategory}
                  onChange={(e) => setOwnCategory(e.target.value)}
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="Price $"
                  value={ownPrice}
                  onChange={(e) => setOwnPrice(e.target.value)}
                />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Seats"
                  value={ownStock}
                  onChange={(e) => setOwnStock(e.target.value)}
                />
                <Input
                  type="number"
                  min={2}
                  step={1}
                  placeholder="Together (up to)"
                  title="How many of these seats sit together. A party up to this size is promised to sit together; a bigger one sits in groups of up to this many. Empty = no seating promise."
                  value={ownTogether}
                  onChange={(e) => setOwnTogether(e.target.value)}
                />
                <Select
                  value={ownZone}
                  onValueChange={setOwnZone}
                  disabled={!canZone}
                >
                  <SelectTrigger dir="rtl">
                    <SelectValue placeholder="Zone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ZONE}>— Choose zone —</SelectItem>
                    {zoneSelectItems}
                  </SelectContent>
                </Select>
              </div>
              <OwnSeatingPromise seatsTogether={ownTogetherValue} />
              <Input
                dir="auto"
                placeholder="Description the customer sees (optional)"
                value={ownDescription}
                onChange={(e) => setOwnDescription(e.target.value)}
              />
              <div className="flex flex-wrap items-center justify-end gap-3">
                {ownProblems.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    Needs {ownProblems.join(", ")}.
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOwnOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddOwnTicket()}
                  disabled={ownProblems.length > 0 || savingZones}
                >
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The price is the ticket part of the package in USD, like every
                other ticket here - the site adds its markup on top.
              </p>
            </div>
          )}

          {attachOpen && (
            <div className="space-y-4 rounded-md border p-3">
              {!picked ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search LiveTickets by event name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          loadCandidates(search);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => loadCandidates(search)}
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                  {loadingCandidates ? (
                    <p className="text-sm text-muted-foreground">
                      Looking for the same event at LiveTickets…
                    </p>
                  ) : candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing close to this event&apos;s name and date. Try a
                      search.
                    </p>
                  ) : (
                    <div className="divide-y rounded-md border">
                      {candidates.map((candidate) => (
                        <button
                          key={candidate.eventId}
                          type="button"
                          className="flex w-full flex-wrap items-center gap-3 p-2 text-left text-sm hover:bg-muted"
                          onClick={() => handlePick(candidate)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              {candidate.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(candidate.showDate)} ·{" "}
                              {candidate.venue} · #{candidate.eventId}
                            </div>
                          </div>
                          {candidate.dateGapDays !== 0 && (
                            <Badge variant="destructive">
                              {candidate.dateGapDays > 0 ? "+" : ""}
                              {candidate.dateGapDays}d vs our date
                            </Badge>
                          )}
                          <Badge variant="secondary">
                            {candidate.sellableCategories} sellable
                          </Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <b>{picked.name}</b> · {formatDate(picked.showDate)} · #
                      {picked.eventId}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPicked(null)}
                    >
                      Pick another event
                    </Button>
                  </div>
                  {picked.dateGapDays !== 0 && (
                    <div className="space-y-1.5 rounded-md border border-destructive/40 p-2">
                      <p className="flex items-center gap-2 text-sm text-destructive">
                        <AlertTriangle className="h-4 w-4" />
                        Their date ({formatDate(picked.showDate)}) is{" "}
                        {Math.abs(picked.dateGapDays)} day(s){" "}
                        {picked.dateGapDays > 0 ? "after" : "before"} ours (
                        {formatDate(event.date)}).
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={gapAcknowledged}
                          onCheckedChange={(v) => setGapAcknowledged(v === true)}
                        />
                        Same fixture - the date is not final. Attach anyway.
                      </label>
                    </div>
                  )}
                  {loadingDrafts ? (
                    <p className="text-sm text-muted-foreground">
                      Reading their categories…
                    </p>
                  ) : (
                    <>
                      <label
                        className={cn(
                          "flex items-start gap-2 rounded-md border p-2 text-sm",
                          includeNonInstant && "border-amber-400 bg-amber-50",
                        )}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={includeNonInstant}
                          disabled={nonInstantDrafts === 0}
                          onCheckedChange={(v) =>
                            setIncludeNonInstant(v === true)
                          }
                        />
                        <span>
                          Bring non-instant-confirm categories too (
                          {nonInstantDrafts}).{" "}
                          <span className="text-muted-foreground">
                            Internal only: the customer sees a normal ticket;
                            the event and every order for it are flagged so ops
                            confirm with LiveTickets by hand.
                          </span>
                        </span>
                      </label>
                      <p className="text-sm text-muted-foreground">
                        Their {boardDrafts.length} categories are placed in the
                        zone editor below - our map beside theirs
                        {suggestedCount > 0
                          ? ` - ${suggestedCount} on a suggested zone (read off their sectors and wording), check each one`
                          : ""}
                        .
                      </p>
                    </>
                  )}
                  {attachBar}
                </>
              )}
            </div>
          )}
        </section>

        {/* ── Zone editor ── */}
        {venueMap && (
          <section id="venue-zone-editor" className="scroll-mt-20 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">
                Our zones at this venue{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · {zones.length} zone(s), shared by every event here
                </span>
              </h3>
              <div className="flex gap-2">
                {zoneEditorOpen && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveZones}
                    disabled={!zonesDirty || savingZones}
                  >
                    {savingZones && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save zones
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setZoneEditorOpen((open) => !open)}
                >
                  {zoneEditorOpen ? "Close" : "Edit zones"}
                </Button>
              </div>
            </div>
            {zoneEditorOpen && (
            <>
            <p className="text-sm text-muted-foreground">
              Zones belong to the venue and are shared by every event here. Pick
              a zone (the dot), then click sections on the map to add or remove
              them. The zone name is what the customer sees.
            </p>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-2">
                {zones.map((zone) => (
                  <div
                    key={zone.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border p-2",
                      activeZoneId === zone.id && "border-primary bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      className="h-4 w-4 shrink-0 rounded-full border"
                      style={{
                        backgroundColor:
                          activeZoneId === zone.id
                            ? ACTIVE_ZONE_FILL
                            : ZONE_FILL,
                      }}
                      aria-label={`Edit sections of ${zone.label}`}
                      onClick={() => {
                        setExcludeMode(false);
                        setActiveZoneId(
                          activeZoneId === zone.id ? null : zone.id,
                        );
                      }}
                    />
                    <Input
                      dir="rtl"
                      value={zone.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        setZones((prev) =>
                          prev.map((z) =>
                            z.id === zone.id ? { ...z, label } : z,
                          ),
                        );
                        setZonesDirty(true);
                      }}
                    />
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {zone.sections.length} sections
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveZone(zone.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    dir="rtl"
                    placeholder="שם אזור חדש, למשל: לאורך המגרש - קומה 3"
                    value={newZoneLabel}
                    onChange={(e) => setNewZoneLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddZone();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddZone}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Zone
                  </Button>
                </div>
                {/* Their categories sit HERE, beside our map and theirs, so
                    each one is matched to a zone while both drawings are in
                    view (QA 23.09 - at the bottom of the page they could not
                    be compared). */}
                {showDrafts && (
                  <div className="space-y-2 pt-4">
                    <h4 className="text-sm font-medium">
                      LiveTickets categories - choose our zone for each
                    </h4>
                    {boardDrafts.map(renderDraft)}
                    {attachBar}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={excludeMode ? "destructive" : "outline"}
                    onClick={() => {
                      setActiveZoneId(null);
                      setExcludeMode((on) => !on);
                    }}
                  >
                    {excludeMode ? "✕ Done excluding" : "Exclude sections"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {excludeMode
                      ? "Click the sections this event does not sell - they turn red and TixStock tickets there drop off the site. Saved with the event (Save at the bottom); zones are not changed."
                      : `${excludedSections.size} section(s) excluded on this event.`}
                  </span>
                </div>
                <div className="rounded-md border bg-[#f5f6f7] p-2">
                  {drawing ? (
                    <div
                      ref={drawingRef}
                      dir="ltr"
                      className="[&_svg]:h-auto [&_svg]:max-h-[60vh] [&_svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: drawing }}
                    />
                  ) : (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      Loading the drawing…
                    </p>
                  )}
                </div>
                <MapLegend />
                {liveMapUrl && (
                  <SupplierMap
                    url={liveMapUrl}
                    label="LiveTickets' map of this event - how they slice the stands."
                  />
                )}
              </div>
            </div>
            </>
            )}
            {zonesDirty && (
              <p className="text-sm text-amber-700">
                Unsaved zone changes - saved with “Save zones”, or on their own
                the moment a ticket takes one of them.
              </p>
            )}
          </section>
        )}

        {/* ── Zones board: our tickets | LiveTickets ── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Tickets by zone</h3>
            {unzonedFromTemplate.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleApplyTemplate}
              >
                Apply venue template ({unzonedFromTemplate.length})
              </Button>
            )}
          </div>
          {!canZone && (
            <p className="text-sm text-muted-foreground">
              Own the map and add at least one zone to start zoning tickets.
            </p>
          )}
          {hiddenTickets.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              {hiddenTickets.length} ticket(s) from another supplier have no
              zone — they stay hidden on the site until zoned.
            </p>
          )}
          <div className="space-y-2">
            {boardRows.map(({ key, zone }) => {
              const tickets = ticketsIn(zone);
              if (!zone && tickets.length === 0) return null;
              const columns: [ReactNode[], ReactNode[], ReactNode[]] = [[], [], []];
              for (const ticket of tickets) {
                columns[columnOf(ticket)].push(renderTicket(ticket));
              }
              const thumb = zone ? zoneThumbs.get(zone.id) : undefined;
              return (
                <div
                  key={key}
                  className={cn("rounded-md border", !zone && "border-amber-300")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
                    <span dir="rtl" className="font-medium">
                      {zone ? zoneName(zone) : "ללא אזור"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {zone
                        ? `${zone.sections.length} sections${isUnsavedZone(zone) ? " · unsaved" : ""}`
                        : "Not on the map yet"}
                    </span>
                  </div>
                  {/* Left to right (Alon 23.09): our map with this zone
                      painted, the TixStock tickets, LiveTickets' own map beside
                      their tickets - so every match can be checked by eye - and
                      the seats we hold ourselves. */}
                  <div className="grid gap-3 p-2 lg:grid-cols-[160px_repeat(3,minmax(0,1fr))]">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Our map
                      </div>
                      {thumb ? (
                        // A data: URL of our own sanitized drawing - no loader applies.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt={zone ? `Zone ${zoneName(zone)} on our map` : ""}
                          className="w-full max-w-[160px] rounded-md border bg-[#f5f6f7]"
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">—</p>
                      )}
                    </div>
                    {BOARD_COLUMNS.map((label, i) => (
                      <div key={label} className="space-y-2">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {label}
                        </div>
                        {i === 1 && liveMapUrl && columns[1].length > 0 && (
                          <a
                            href={liveMapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="LiveTickets' map - open full size"
                          >
                            {/* A supplier's PNG behind our proxy - next/image has no loader for it. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/proxy-image?url=${encodeURIComponent(liveMapUrl)}`}
                              alt="LiveTickets' map"
                              className="max-h-40 w-auto rounded-md border bg-white"
                            />
                          </a>
                        )}
                        {columns[i].length > 0 ? (
                          columns[i]
                        ) : (
                          <p className="text-xs text-muted-foreground">—</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
