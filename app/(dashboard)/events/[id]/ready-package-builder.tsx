"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  buildReadyPackage,
  getReadyBuildOptions,
  getReadyInventory,
  searchReadyFlights,
  searchReadyHotels,
  suggestReadyBuild,
  type ReadyCardData,
} from "@/lib/actions/ready-package-actions";
import { READY_MAX_TRAVELERS_CAP, SWAP_ALL, SWAP_NONE, anySwap, mealLabel } from "@/lib/ready-package";
import {
  READY_PIECES,
  type ReadyBuildOptions,
  type ReadyFlightChoice,
  type ReadyFlightSpec,
  type ReadyHotelChoice,
  type ReadyHotelSpec,
  type ReadyInventory,
  type ReadyPackageSpec,
  type ReadyPiece,
  type ReadySwap,
  type ReadyTicketChoice,
} from "@/types/ready-package.types";

/** What "Change a piece" opens the builder on: the package as it stands. */
export type ReadyBuilderInitial = {
  spec: ReadyPackageSpec;
  swap: ReadySwap;
  flightLabel: string;
  hotelLabel: string;
};

const FLIGHT_ROWS = 40;
const HOTEL_ROWS = 60;

const PIECE_LABEL: Record<ReadyPiece, string> = { ticket: "Ticket", flight: "Flight", hotel: "Hotel" };

const SUPPLIER_LABEL: Record<string, string> = {
  tixstock: "TixStock",
  livetickets: "LiveTickets",
  xs2event: "XS2Event",
  p1: "P1",
};

const ticketLine = (t: ReadyTicketChoice): string =>
  [
    t.category,
    `$${t.price}`,
    t.supplier === "static"
      ? `our stock${t.stock != null ? ` (${t.stock} seats)` : ""}`
      : t.supplier
        ? (SUPPLIER_LABEL[t.supplier] ?? t.supplier)
        : "",
  ]
    .filter(Boolean)
    .join(" · ");

const ticketKeyOf = (t: ReadyTicketChoice): string => t.id ?? t.category;

/** The dates a stored package was built on - "Change a piece" opens on them. */
const specDates = (spec: ReadyPackageSpec): { departureDate: string; returnDate: string } | null => {
  if (spec.flight.mode === "live") {
    return { departureDate: spec.flight.departureDate, returnDate: spec.flight.returnDate };
  }
  if (spec.hotel.mode === "live") return { departureDate: spec.hotel.checkin, returnDate: spec.hotel.checkout };
  return null;
};

/** "26/11 06:00" from a supplier's ISO time, as written (their local time). */
const when = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;

const flightLine = (f: ReadyFlightChoice): string =>
  [
    f.airline,
    [f.outbound.flightNumber, f.inbound.flightNumber].filter(Boolean).join(" / "),
    `${when(f.outbound.departure)} → ${when(f.inbound.departure)}`,
    f.direct ? "direct" : "with a stop",
    f.checkedBag ? "checked bag" : "no checked bag",
  ]
    .filter(Boolean)
    .join(" · ");

const flightNote = (f: ReadyFlightChoice): string =>
  `${f.outbound.from} → ${f.outbound.to}, lands ${when(f.outbound.arrival)} · back lands ${when(f.inbound.arrival)}`;

const hotelLine = (h: ReadyHotelChoice): string =>
  [h.name, h.stars ? `${h.stars}★` : "", h.roomName, mealLabel(h.meal)].filter(Boolean).join(" · ");

const hotelNote = (h: ReadyHotelChoice): string =>
  [
    `$${h.totalPrice.toLocaleString("en-US")} for the stay`,
    h.refundable ? "free cancellation" : "non-refundable",
    h.distanceM != null ? `${(h.distanceM / 1000).toFixed(1)} km from the centre` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const tag = "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

function Row({
  selected,
  onPick,
  title,
  price,
  note,
  inventory,
}: {
  selected: boolean;
  onPick: () => void;
  title: string;
  price: string;
  note?: string;
  inventory: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start justify-between gap-3 rounded-md border p-2.5 text-left text-sm transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <span className="min-w-0">
        <span className="block break-words">{title}</span>
        {(note || inventory) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
            {inventory && (
              <Badge variant="outline" className={tag}>
                our inventory
              </Badge>
            )}
            {note}
          </span>
        )}
      </span>
      <span className="shrink-0 font-medium tabular-nums">{price}</span>
    </button>
  );
}

/** Our own inventory for a piece, shown before any search - or one line saying there is none. */
function InventoryBlock({
  kind,
  empty,
  children,
}: {
  kind: "flight" | "hotel";
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
      <p className="text-sm font-medium">Our inventory</p>
      {empty ? (
        <p className="text-sm text-muted-foreground">
          {kind === "flight"
            ? "No flight block of ours is linked to this event for this party size. Link one under Offline Flights and it shows here."
            : "No room of ours is linked to this event for this party size. Link one under Offline Hotels and it shows here."}
        </p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

/**
 * "Build closed package": the event's ready package, built right here - a ticket of the event
 * (ours or a supplier's), a flight and a hotel from OUR inventory (listed the moment the builder
 * opens) or from the same searches the site runs, or all three filled by "Compose automatically".
 * Opened on an existing package ("Change a piece") it starts from what the package holds: a piece
 * staff do not touch is kept as it is. The browser only NAMES the pieces; saving looks them up and
 * prices them again on the server. No supplier is searched until staff ask.
 */
export function ReadyPackageBuilder({
  eventId,
  disabled,
  initial,
  onBuilt,
}: {
  eventId: number;
  disabled?: boolean;
  initial?: ReadyBuilderInitial | null;
  onBuilt: (data: ReadyCardData) => void | Promise<void>;
}) {
  const [options, setOptions] = useState<ReadyBuildOptions | null>(null);
  const [inventory, setInventory] = useState<ReadyInventory>({ flights: [], hotels: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"options" | "inventory" | "compose" | "flights" | "hotels" | "save" | null>(
    "options",
  );
  const [notes, setNotes] = useState<string[]>([]);

  const [travelers, setTravelers] = useState(initial?.spec.defaultTravelers ?? 2);
  const [ticketKey, setTicketKey] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  // A new package starts closed (Dor: "a closed event"); a changed one keeps what staff decided.
  const [swap, setSwap] = useState<ReadySwap>(initial?.swap ?? SWAP_NONE);

  // A piece of the current package staff have not replaced: its identity rides into the new spec as is.
  const [keptFlight, setKeptFlight] = useState<ReadyFlightSpec | null>(
    initial && initial.spec.flight.mode !== "none" ? initial.spec.flight : null,
  );
  const [keptHotel, setKeptHotel] = useState<ReadyHotelSpec | null>(
    initial && initial.spec.hotel.mode !== "none" ? initial.spec.hotel : null,
  );

  const [noFlight, setNoFlight] = useState(initial?.spec.flight.mode === "none");
  const [flights, setFlights] = useState<ReadyFlightChoice[] | null>(null);
  const [flight, setFlight] = useState<ReadyFlightChoice | null>(null);
  const [directOnly, setDirectOnly] = useState(true);
  const [bagOnly, setBagOnly] = useState(false);

  const [noHotel, setNoHotel] = useState(initial?.spec.hotel.mode === "none");
  const [hotels, setHotels] = useState<ReadyHotelChoice[] | null>(null);
  const [hotel, setHotel] = useState<ReadyHotelChoice | null>(null);
  const [hotelQuery, setHotelQuery] = useState("");
  const [minStars, setMinStars] = useState(4);
  const [mealOnly, setMealOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    // One action: tickets, the default dates and our inventory for the opening party size.
    getReadyBuildOptions(eventId, initial?.spec.defaultTravelers ?? 2)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOptions(res.options);
        setInventory(res.options.inventory);
        const dates = (initial && specDates(initial.spec)) || res.options;
        setDepartureDate(dates.departureDate);
        setReturnDate(dates.returnDate);
        const current = initial
          ? res.options.tickets.find((t) => !!initial.spec.ticket.id && t.id === initial.spec.ticket.id) ??
            res.options.tickets.find((t) => t.category === initial.spec.ticket.category)
          : undefined;
        const first = current ?? res.options.tickets[0];
        setTicketKey(first ? ticketKeyOf(first) : "");
      })
      .catch(() => alive && setError("Could not load the event."))
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
    };
    // `initial` is read once, when the builder opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  /** A searched flight or hotel is priced for one party and one pair of dates - change either and it is gone. */
  const forgetSearches = () => {
    setFlights(null);
    setFlight(null);
    setHotels(null);
    setHotel(null);
    setNotes([]);
  };

  const changeDates = (next: { departureDate?: string; returnDate?: string }) => {
    if (next.departureDate !== undefined) setDepartureDate(next.departureDate);
    if (next.returnDate !== undefined) setReturnDate(next.returnDate);
    forgetSearches();
    // A kept flight or hotel belongs to the old dates.
    setKeptFlight(null);
    setKeptHotel(null);
  };

  const changeTravelers = async (next: number) => {
    setTravelers(next);
    forgetSearches();
    // Inventory rooms are counted per party; a kept online piece is the same piece for any size.
    setKeptHotel((kept) => (kept?.mode === "offline" ? null : kept));
    setBusy("inventory");
    const res = await getReadyInventory(eventId, next).catch(() => null);
    setBusy(null);
    if (res?.ok) setInventory(res.inventory);
    else setError(res?.error ?? "Could not load our inventory.");
  };

  const ticket = useMemo(
    () => options?.tickets.find((t) => ticketKeyOf(t) === ticketKey) ?? null,
    [options, ticketKey],
  );

  // Our inventory has its own block above the search - a searched list never repeats it.
  const shownFlights = useMemo(
    () => (flights ?? []).filter((f) => !f.offline && (!directOnly || f.direct) && (!bagOnly || f.checkedBag)),
    [flights, directOnly, bagOnly],
  );
  const shownHotels = useMemo(() => {
    const q = hotelQuery.trim().toLowerCase();
    return (hotels ?? []).filter(
      (h) =>
        !h.offline &&
        h.stars >= minStars &&
        (!mealOnly || h.meal !== "nomeal") &&
        (!q || h.name.toLowerCase().includes(q)),
    );
  }, [hotels, hotelQuery, minStars, mealOnly]);

  const datesOk = !!departureDate && !!returnDate && departureDate < returnDate;
  const locked = !!disabled || busy !== null;

  const findFlights = async () => {
    setBusy("flights");
    setError(null);
    const res = await searchReadyFlights(eventId, { departureDate, returnDate, travelers }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(res?.error ?? "The flight search failed. Try again.");
      return;
    }
    setFlights(res.flights);
    if (res.flights.length === 0) setError("No flight came back for these dates.");
  };

  const findHotels = async () => {
    setBusy("hotels");
    setError(null);
    const res = await searchReadyHotels(eventId, {
      checkin: departureDate,
      checkout: returnDate,
      travelers,
      query: hotelQuery,
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(res?.error ?? "The hotel search failed. Try again.");
      return;
    }
    setHotels(res.hotels);
    if (res.hotels.length === 0) setError("No hotel came back for these dates.");
  };

  const compose = async () => {
    setBusy("compose");
    setError(null);
    const res = await suggestReadyBuild(eventId, travelers).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(res?.error ?? "Could not compose a package.");
      return;
    }
    setDepartureDate(res.departureDate);
    setReturnDate(res.returnDate);
    setTicketKey(ticketKeyOf(res.ticket));
    setFlights(null);
    setHotels(null);
    setFlight(res.flight);
    setKeptFlight(null);
    setNoFlight(false);
    setHotel(res.hotel);
    setKeptHotel(null);
    setNoHotel(false);
    setNotes(res.notes);
  };

  const flightSpec: ReadyFlightSpec | null = noFlight ? { mode: "none" } : (flight?.spec ?? keptFlight);
  const hotelSpec: ReadyHotelSpec | null = noHotel ? { mode: "none" } : (hotel?.spec ?? keptHotel);
  const ready = !!ticket && !!flightSpec && !!hotelSpec;

  const save = async () => {
    if (!ticket || !flightSpec || !hotelSpec) return;
    const spec: ReadyPackageSpec = {
      ticket: { id: ticket.id, category: ticket.category },
      flight: flightSpec,
      hotel: hotelSpec,
      defaultTravelers: travelers,
      swap,
    };
    setBusy("save");
    setError(null);
    const res = await buildReadyPackage(eventId, { spec }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(res?.error ?? "Could not save the ready package.");
      return;
    }
    await onBuilt(res.data);
  };

  if (busy === "options") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the event&apos;s tickets and our inventory
      </div>
    );
  }
  if (!options) return <p className="text-sm text-destructive">{error ?? "Could not load the event."}</p>;

  const perPerson = (n: number) => `$${n.toLocaleString("en-US")} pp`;
  const closed = !anySwap(swap);

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Built for</Label>
          <Select value={String(travelers)} disabled={locked} onValueChange={(value) => changeTravelers(Number(value))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: READY_MAX_TRAVELERS_CAP }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} traveller{n === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ready-depart">Departure</Label>
          <Input
            id="ready-depart"
            type="date"
            className="w-40"
            value={departureDate}
            disabled={locked}
            onChange={(e) => changeDates({ departureDate: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ready-return">Return</Label>
          <Input
            id="ready-return"
            type="date"
            className="w-40"
            value={returnDate}
            disabled={locked}
            onChange={(e) => changeDates({ returnDate: e.target.value })}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={locked} onClick={compose}>
          {busy === "compose" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {busy === "compose" ? "Composing" : "Compose automatically"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Choose each piece yourself - our inventory is listed first, the site&apos;s searches come on request. The hotel
        stay follows the flight dates. &quot;Compose automatically&quot; fills all three by a plain rule (cheapest
        ticket, cheapest direct flight with a checked bag, cheapest 4★ with a meal) and you change what does not fit.
        The party size here is only the one it is BUILT for: on the site the customer picks their own number.
      </p>
      {notes.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">{notes.join(" · ")}</p>}

      <div className="space-y-1.5">
        <Label>1. Ticket</Label>
        <Select value={ticketKey} disabled={locked} onValueChange={setTicketKey}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a ticket category" />
          </SelectTrigger>
          <SelectContent>
            {options.tickets.map((t) => (
              <SelectItem key={ticketKeyOf(t)} value={ticketKeyOf(t)}>
                {ticketLine(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!options.tickets.some((t) => t.supplier === "static") && (
          <p className="text-sm text-muted-foreground">
            This event has no ticket of our own stock. Add one under Suppliers &amp; zones → &quot;Our own ticket&quot; and it
            is listed here first.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>2. Flight</Label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={noFlight} disabled={locked} onCheckedChange={(v) => setNoFlight(v === true)} />
            No flight in this package
          </label>
        </div>
        {!noFlight && (
          <>
            {flight ? (
              <div className="rounded-md border border-primary bg-primary/5 p-2.5 text-sm">
                <span className="font-medium">Chosen: </span>
                {flightLine(flight)} · {perPerson(flight.pricePerPerson)}
                {flight.offline && " · our inventory"}
              </div>
            ) : keptFlight && initial ? (
              <div className="rounded-md border border-primary bg-primary/5 p-2.5 text-sm">
                <span className="font-medium">Kept from the package: </span>
                {initial.flightLabel}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No flight chosen yet.</p>
            )}
            <InventoryBlock kind="flight" empty={inventory.flights.length === 0}>
              {inventory.flights.map((f) => (
                <Row
                  key={f.key}
                  selected={flight?.key === f.key}
                  onPick={() => setFlight(f)}
                  title={flightLine(f)}
                  price={perPerson(f.pricePerPerson)}
                  note={flightNote(f)}
                  inventory
                />
              ))}
            </InventoryBlock>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={locked || !datesOk} onClick={findFlights}>
                {busy === "flights" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {busy === "flights" ? "Searching (up to 30s)" : flights ? "Search again" : "Search online flights"}
              </Button>
              {flights && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={directOnly} onCheckedChange={(v) => setDirectOnly(v === true)} /> Direct only
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={bagOnly} onCheckedChange={(v) => setBagOnly(v === true)} /> With a checked bag
                  </label>
                </>
              )}
            </div>
            {flights && (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {shownFlights.slice(0, FLIGHT_ROWS).map((f) => (
                  <Row
                    key={f.key}
                    selected={flight?.key === f.key}
                    onPick={() => setFlight(f)}
                    title={flightLine(f)}
                    price={perPerson(f.pricePerPerson)}
                    note={flightNote(f)}
                    inventory={false}
                  />
                ))}
                {shownFlights.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing matches the filters - untick one.</p>
                )}
                {shownFlights.length > FLIGHT_ROWS && (
                  <p className="text-sm text-muted-foreground">
                    Showing the {FLIGHT_ROWS} cheapest of {shownFlights.length}.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>3. Hotel</Label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={noHotel} disabled={locked} onCheckedChange={(v) => setNoHotel(v === true)} />
            No hotel in this package
          </label>
        </div>
        {!noHotel && (
          <>
            {hotel ? (
              <div className="rounded-md border border-primary bg-primary/5 p-2.5 text-sm">
                <span className="font-medium">Chosen: </span>
                {hotelLine(hotel)} · {perPerson(hotel.pricePerPerson)}
                {hotel.offline && " · our inventory"}
              </div>
            ) : keptHotel && initial ? (
              <div className="rounded-md border border-primary bg-primary/5 p-2.5 text-sm">
                <span className="font-medium">Kept from the package: </span>
                {initial.hotelLabel}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hotel chosen yet.</p>
            )}
            <InventoryBlock kind="hotel" empty={inventory.hotels.length === 0}>
              {inventory.hotels.map((h) => (
                <Row
                  key={h.key}
                  selected={hotel?.key === h.key}
                  onPick={() => setHotel(h)}
                  title={hotelLine(h)}
                  price={perPerson(h.pricePerPerson)}
                  note={hotelNote(h)}
                  inventory
                />
              ))}
            </InventoryBlock>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                aria-label="Hotel name"
                placeholder="Hotel name (optional)"
                className="w-56"
                value={hotelQuery}
                disabled={locked}
                onChange={(e) => setHotelQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && datesOk && !locked) {
                    e.preventDefault();
                    findHotels();
                  }
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={locked || !datesOk} onClick={findHotels}>
                {busy === "hotels" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {busy === "hotels" ? "Searching (up to 30s)" : hotels ? "Search again" : "Search online hotels"}
              </Button>
              {hotels && (
                <>
                  <Select value={String(minStars)} onValueChange={(v) => setMinStars(Number(v))}>
                    <SelectTrigger className="w-32" aria-label="Minimum stars">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any stars</SelectItem>
                      <SelectItem value="3">3★ and up</SelectItem>
                      <SelectItem value="4">4★ and up</SelectItem>
                      <SelectItem value="5">5★</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={mealOnly} onCheckedChange={(v) => setMealOnly(v === true)} /> With a meal
                  </label>
                </>
              )}
            </div>
            {hotels && (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {shownHotels.slice(0, HOTEL_ROWS).map((h) => (
                  <Row
                    key={h.key}
                    selected={hotel?.key === h.key}
                    onPick={() => setHotel(h)}
                    title={hotelLine(h)}
                    price={perPerson(h.pricePerPerson)}
                    note={hotelNote(h)}
                    inventory={false}
                  />
                ))}
                {shownHotels.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing matches the filters - lower the stars, clear the name, or search again by name.
                  </p>
                )}
                {shownHotels.length > HOTEL_ROWS && (
                  <p className="text-sm text-muted-foreground">
                    Showing the {HOTEL_ROWS} cheapest of {shownHotels.length}. Narrow by name or stars.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-3 border-t pt-3">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Switch
              id="ready-closed"
              checked={closed}
              disabled={locked}
              onCheckedChange={(on) => setSwap(on ? SWAP_NONE : SWAP_ALL)}
            />
            <Label htmlFor="ready-closed" className="cursor-pointer">
              Closed package - the customer cannot swap anything
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="text-muted-foreground">Or open only some pieces - the customer may swap:</span>
            {READY_PIECES.map((piece) => (
              <label key={piece} className="flex items-center gap-2">
                <Checkbox
                  checked={swap[piece]}
                  disabled={locked}
                  onCheckedChange={(v) => setSwap((prev) => ({ ...prev, [piece]: v === true }))}
                />
                {PIECE_LABEL[piece]}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Saving does not put it on the site: it is saved in Preview, and you switch it to Live on the card.
          </p>
          <Button type="button" size="sm" disabled={locked || !ready} onClick={save}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy === "save" ? "Saving (looking the pieces up again)" : "Save as the ready package"}
          </Button>
        </div>
      </div>
    </div>
  );
}
