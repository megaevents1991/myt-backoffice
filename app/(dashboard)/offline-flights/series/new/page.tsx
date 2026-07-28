"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "react-hot-toast";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import type { OfflineFlight } from "@/types/offline-flight.types";
import {
  createOfflineFlightSeries,
  type SeriesFlightDraft,
} from "@/lib/actions/offline-flight-bulk-actions";
import { getRelevantEventsForFlight } from "@/lib/actions/offline-flight-actions";

type RelevantEvent = { id: number; name: string; date: string };

type Template = {
  seriesName: string;
  airline_code: string;
  metadata_iata: string;
  metadata_name: string;
  metadata_logo: string;
  price: string;
  initial_quantity: string;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
  outbound_flight_number: string;
  inbound_flight_number: string;
  outboundDepartureTime: string;
  outboundArrivalTime: string;
  inboundDepartureTime: string;
  inboundArrivalTime: string;
  outbound_check_bags_included: boolean;
  outbound_cabin_bags_included: boolean;
  inbound_check_bags_included: boolean;
  inbound_cabin_bags_included: boolean;
  supplier: string;
  cost_price: string;
  cost_currency: string;
  block_status: string;
};

type DraftRow = {
  departDate: string;
  returnDate: string;
  price: string;
  initial_quantity: string;
  outbound_flight_number: string;
  inbound_flight_number: string;
  outboundDepartureTime: string;
  outboundArrivalTime: string;
  inboundDepartureTime: string;
  inboundArrivalTime: string;
  suggestedEvents: RelevantEvent[];
  eventIds: number[];
};

const EMPTY_TEMPLATE: Template = {
  seriesName: "",
  airline_code: "",
  metadata_iata: "",
  metadata_name: "",
  metadata_logo: "",
  price: "",
  initial_quantity: "",
  outbound_departure_airport: "TLV",
  outbound_arrival_airport: "",
  inbound_departure_airport: "",
  inbound_arrival_airport: "TLV",
  outbound_flight_number: "",
  inbound_flight_number: "",
  outboundDepartureTime: "08:00",
  outboundArrivalTime: "12:00",
  inboundDepartureTime: "18:00",
  inboundArrivalTime: "22:00",
  outbound_check_bags_included: false,
  outbound_cabin_bags_included: true,
  inbound_check_bags_included: false,
  inbound_cabin_bags_included: true,
  supplier: "",
  cost_price: "",
  cost_currency: "USD",
  block_status: "confirmed",
};

const pad = (n: number) => String(n).padStart(2, "0");

const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const addDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/** An arrival earlier in the clock than its departure landed the next day. */
const sameOrNextDay = (date: string, depart: string, arrive: string): string =>
  arrive >= depart ? date : addDays(date, 1);

/** Minutes between two "HH:mm" clock times on consecutive-or-same days. */
const isoDurationBetween = (
  departDate: string,
  departTime: string,
  arriveDate: string,
  arriveTime: string,
): string => {
  const start = new Date(`${departDate}T${departTime}:00Z`).getTime();
  const end = new Date(`${arriveDate}T${arriveTime}:00Z`).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 ? `${rest}M` : hours > 0 ? "" : "0M"}`;
};

const addIsoDurations = (a: string, b: string): string => {
  const parse = (iso: string) => {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    return (Number(m?.[1] ?? 0) || 0) * 60 + (Number(m?.[2] ?? 0) || 0);
  };
  const total = parse(a) + parse(b);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : hours > 0 ? "" : "0M"}`;
};

export default function NewOfflineFlightSeriesPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [template, setTemplate] = useState<Template>(EMPTY_TEMPLATE);
  const [dates, setDates] = useState<Date[]>([]);
  const [nights, setNights] = useState("3");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof Template>(key: K, value: Template[K]) =>
    setTemplate((prev) => ({ ...prev, [key]: value }));

  const step1Valid =
    template.seriesName.trim() !== "" &&
    template.airline_code.trim() !== "" &&
    template.metadata_name.trim() !== "" &&
    template.outbound_departure_airport.length === 3 &&
    template.outbound_arrival_airport.length === 3 &&
    template.inbound_departure_airport.length === 3 &&
    template.inbound_arrival_airport.length === 3 &&
    Number(template.price) > 0 &&
    Number.parseInt(template.initial_quantity, 10) > 0;

  const nightsNum = Number.parseInt(nights, 10);
  const step2Valid = dates.length > 0 && Number.isInteger(nightsNum) && nightsNum > 0;

  const buildRows = async () => {
    setIsBuilding(true);
    try {
      const sorted = [...dates].map(toIsoDate).sort();
      const built = await Promise.all(
        sorted.map(async (departDate) => {
          const returnDate = addDays(departDate, nightsNum);
          let suggested: RelevantEvent[] = [];
          try {
            suggested = (await getRelevantEventsForFlight(
              template.outbound_arrival_airport,
              departDate,
              returnDate,
            )) as RelevantEvent[];
          } catch (error) {
            console.error("Failed to load relevant events:", error);
          }
          return {
            departDate,
            returnDate,
            price: template.price,
            initial_quantity: template.initial_quantity,
            outbound_flight_number: template.outbound_flight_number,
            inbound_flight_number: template.inbound_flight_number,
            outboundDepartureTime: template.outboundDepartureTime,
            outboundArrivalTime: template.outboundArrivalTime,
            inboundDepartureTime: template.inboundDepartureTime,
            inboundArrivalTime: template.inboundArrivalTime,
            suggestedEvents: suggested,
            eventIds: suggested.map((e) => e.id),
          } satisfies DraftRow;
        }),
      );
      setRows(built);
      setStep(3);
    } finally {
      setIsBuilding(false);
    }
  };

  const updateRow = (index: number, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const drafts: SeriesFlightDraft[] = useMemo(
    () =>
      rows.map((row) => {
        const outArrivalDate = sameOrNextDay(
          row.departDate,
          row.outboundDepartureTime,
          row.outboundArrivalTime,
        );
        const inArrivalDate = sameOrNextDay(
          row.returnDate,
          row.inboundDepartureTime,
          row.inboundArrivalTime,
        );
        const outboundDuration = isoDurationBetween(
          row.departDate,
          row.outboundDepartureTime,
          outArrivalDate,
          row.outboundArrivalTime,
        );
        const inboundDuration = isoDurationBetween(
          row.returnDate,
          row.inboundDepartureTime,
          inArrivalDate,
          row.inboundArrivalTime,
        );
        return {
          airline_code: template.airline_code,
          price: Number(row.price),
          initial_quantity: Number.parseInt(row.initial_quantity, 10),
          stops: 0,
          duration: addIsoDurations(outboundDuration, inboundDuration),
          outbound_departure_airport: template.outbound_departure_airport,
          outbound_arrival_airport: template.outbound_arrival_airport,
          // `timestamp without time zone` columns — pure string composition,
          // no timezone or DST maths.
          outbound_departure_time: `${row.departDate}T${row.outboundDepartureTime}:00`,
          outbound_arrival_time: `${outArrivalDate}T${row.outboundArrivalTime}:00`,
          outbound_duration: outboundDuration,
          outbound_flight_number: row.outbound_flight_number,
          outbound_check_bags_included: template.outbound_check_bags_included,
          outbound_cabin_bags_included: template.outbound_cabin_bags_included,
          inbound_departure_airport: template.inbound_departure_airport,
          inbound_arrival_airport: template.inbound_arrival_airport,
          inbound_departure_time: `${row.returnDate}T${row.inboundDepartureTime}:00`,
          inbound_arrival_time: `${inArrivalDate}T${row.inboundArrivalTime}:00`,
          inbound_duration: inboundDuration,
          inbound_flight_number: row.inbound_flight_number,
          inbound_check_bags_included: template.inbound_check_bags_included,
          inbound_cabin_bags_included: template.inbound_cabin_bags_included,
          metadata_iata: template.metadata_iata || template.airline_code,
          metadata_name: template.metadata_name,
          metadata_logo: template.metadata_logo,
          event_ids: row.eventIds,
          supplier: template.supplier || null,
          cost_price: template.cost_price ? Number(template.cost_price) : null,
          cost_currency: template.cost_currency || null,
          block_status: (template.block_status ||
            null) as OfflineFlight["block_status"],
        } satisfies SeriesFlightDraft;
      }),
    [rows, template],
  );

  const create = () => {
    startTransition(async () => {
      try {
        const result = await createOfflineFlightSeries(template.seriesName, drafts);
        toast.success(`Created ${result.created} flight(s)`);
        router.push("/offline-flights");
      } catch (error) {
        console.error("Failed to create series:", error);
        toast.error(error instanceof Error ? error.message : "Could not create series");
      }
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/offline-flights">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">New flight series</h1>
          <p className="text-sm text-muted-foreground">
            Step {step} of 3 — build one template, pick the departure dates, then
            fine-tune each flight before creating them all.
          </p>
        </div>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Shared template</CardTitle>
            <CardDescription>
              Everything except the dates. You can still change price, quantity,
              flight numbers and times per flight in step 3.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Series name</Label>
              <Input
                value={template.seriesName}
                onChange={(e) => set("seriesName", e.target.value)}
                placeholder="Barcelona summer 2026"
              />
            </div>
            <div>
              <Label>Airline code</Label>
              <Input
                value={template.airline_code}
                onChange={(e) => set("airline_code", e.target.value.toUpperCase())}
                placeholder="LY"
              />
            </div>
            <div>
              <Label>Airline name</Label>
              <Input
                value={template.metadata_name}
                onChange={(e) => set("metadata_name", e.target.value)}
                placeholder="El Al"
              />
            </div>
            <div>
              <Label>Airline IATA (metadata)</Label>
              <Input
                value={template.metadata_iata}
                onChange={(e) => set("metadata_iata", e.target.value.toUpperCase())}
                placeholder="defaults to airline code"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Airline logo URL</Label>
              <Input
                value={template.metadata_logo}
                onChange={(e) => set("metadata_logo", e.target.value)}
                placeholder="https://…"
              />
            </div>

            <div>
              <Label>Price per seat (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={template.price}
                onChange={(e) => set("price", e.target.value)}
              />
            </div>
            <div>
              <Label>Seats per flight (ORG)</Label>
              <Input
                type="number"
                value={template.initial_quantity}
                onChange={(e) => set("initial_quantity", e.target.value)}
              />
            </div>
            <div>
              <Label>Block status</Label>
              <select
                className="mt-1 block h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={template.block_status}
                onChange={(e) => set("block_status", e.target.value)}
              >
                <option value="confirmed">confirmed</option>
                <option value="option">option</option>
                <option value="ticketed">ticketed</option>
              </select>
            </div>

            <div>
              <Label>Outbound from</Label>
              <Input
                value={template.outbound_departure_airport}
                onChange={(e) =>
                  set("outbound_departure_airport", e.target.value.toUpperCase())
                }
                maxLength={3}
              />
            </div>
            <div>
              <Label>Outbound to</Label>
              <Input
                value={template.outbound_arrival_airport}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase();
                  set("outbound_arrival_airport", value);
                  if (!template.inbound_departure_airport) {
                    set("inbound_departure_airport", value);
                  }
                }}
                maxLength={3}
              />
            </div>
            <div>
              <Label>Outbound flight no.</Label>
              <Input
                value={template.outbound_flight_number}
                onChange={(e) =>
                  set("outbound_flight_number", e.target.value.toUpperCase())
                }
              />
            </div>
            <div>
              <Label>Return from</Label>
              <Input
                value={template.inbound_departure_airport}
                onChange={(e) =>
                  set("inbound_departure_airport", e.target.value.toUpperCase())
                }
                maxLength={3}
              />
            </div>
            <div>
              <Label>Return to</Label>
              <Input
                value={template.inbound_arrival_airport}
                onChange={(e) =>
                  set("inbound_arrival_airport", e.target.value.toUpperCase())
                }
                maxLength={3}
              />
            </div>
            <div>
              <Label>Return flight no.</Label>
              <Input
                value={template.inbound_flight_number}
                onChange={(e) =>
                  set("inbound_flight_number", e.target.value.toUpperCase())
                }
              />
            </div>

            <div>
              <Label>Outbound departure time</Label>
              <Input
                type="time"
                value={template.outboundDepartureTime}
                onChange={(e) => set("outboundDepartureTime", e.target.value)}
              />
            </div>
            <div>
              <Label>Outbound arrival time</Label>
              <Input
                type="time"
                value={template.outboundArrivalTime}
                onChange={(e) => set("outboundArrivalTime", e.target.value)}
              />
            </div>
            <div />
            <div>
              <Label>Return departure time</Label>
              <Input
                type="time"
                value={template.inboundDepartureTime}
                onChange={(e) => set("inboundDepartureTime", e.target.value)}
              />
            </div>
            <div>
              <Label>Return arrival time</Label>
              <Input
                type="time"
                value={template.inboundArrivalTime}
                onChange={(e) => set("inboundArrivalTime", e.target.value)}
              />
            </div>
            <div />

            <div>
              <Label>Supplier</Label>
              <Input
                value={template.supplier}
                onChange={(e) => set("supplier", e.target.value)}
              />
            </div>
            <div>
              <Label>Cost price</Label>
              <Input
                type="number"
                step="0.01"
                value={template.cost_price}
                onChange={(e) => set("cost_price", e.target.value)}
              />
            </div>
            <div>
              <Label>Cost currency</Label>
              <select
                className="mt-1 block h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={template.cost_currency}
                onChange={(e) => set("cost_currency", e.target.value)}
              >
                {["USD", "EUR", "GBP", "ILS"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-6 md:col-span-3">
              {(
                [
                  ["outbound_check_bags_included", "Outbound checked bag"],
                  ["outbound_cabin_bags_included", "Outbound cabin bag"],
                  ["inbound_check_bags_included", "Return checked bag"],
                  ["inbound_cabin_bags_included", "Return cabin bag"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={template[key]}
                    onCheckedChange={(checked) => set(key, Boolean(checked))}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="md:col-span-3">
              <Button disabled={!step1Valid} onClick={() => setStep(2)}>
                Next: pick dates
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Departure dates</CardTitle>
            <CardDescription>
              Pick every departure date. The return of each flight is that date plus
              the number of days below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Calendar
              mode="multiple"
              selected={dates}
              onSelect={(selected) => setDates(selected ?? [])}
              className="rounded-md border"
            />
            <div className="flex items-end gap-4">
              <div>
                <Label>Number of days</Label>
                <Input
                  type="number"
                  min={1}
                  className="w-32"
                  value={nights}
                  onChange={(e) => setNights(e.target.value)}
                />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">
                {dates.length} date(s) selected → {dates.length} flight(s)
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button disabled={!step2Valid || isBuilding} onClick={buildRows}>
                {isBuilding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Next: preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview &amp; adjust</CardTitle>
            <CardDescription>
              {rows.length} flight(s) will be created in series &ldquo;
              {template.seriesName}&rdquo;. Edit any cell, uncheck an event, or drop a
              row before creating.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Departure</th>
                    <th className="py-2">Return</th>
                    <th className="py-2">Out time</th>
                    <th className="py-2">Out arr.</th>
                    <th className="py-2">Ret time</th>
                    <th className="py-2">Ret arr.</th>
                    <th className="py-2">Out no.</th>
                    <th className="py-2">Ret no.</th>
                    <th className="py-2">Price</th>
                    <th className="py-2">Seats</th>
                    <th className="py-2">Events</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.departDate} className="border-t align-top">
                      <td className="py-2 pr-2 font-medium">{row.departDate}</td>
                      <td className="py-2 pr-2">{row.returnDate}</td>
                      {(
                        [
                          "outboundDepartureTime",
                          "outboundArrivalTime",
                          "inboundDepartureTime",
                          "inboundArrivalTime",
                        ] as const
                      ).map((key) => (
                        <td key={key} className="py-1 pr-2">
                          <Input
                            className="h-8 w-24"
                            type="time"
                            value={row[key]}
                            onChange={(e) => updateRow(index, { [key]: e.target.value })}
                          />
                        </td>
                      ))}
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-24"
                          value={row.outbound_flight_number}
                          onChange={(e) =>
                            updateRow(index, {
                              outbound_flight_number: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-24"
                          value={row.inbound_flight_number}
                          onChange={(e) =>
                            updateRow(index, {
                              inbound_flight_number: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-24"
                          type="number"
                          step="0.01"
                          value={row.price}
                          onChange={(e) => updateRow(index, { price: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-20"
                          type="number"
                          value={row.initial_quantity}
                          onChange={(e) =>
                            updateRow(index, { initial_quantity: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2 pr-2">
                        {row.suggestedEvents.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            none in range
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {row.suggestedEvents.map((event) => (
                              <label
                                key={event.id}
                                className="flex items-center gap-2 text-xs"
                              >
                                <Checkbox
                                  checked={row.eventIds.includes(event.id)}
                                  onCheckedChange={(checked) =>
                                    updateRow(index, {
                                      eventIds: checked
                                        ? [...row.eventIds, event.id]
                                        : row.eventIds.filter((id) => id !== event.id),
                                    })
                                  }
                                />
                                {event.name}
                              </label>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Remove this flight"
                          onClick={() =>
                            setRows((prev) => prev.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button disabled={isPending || rows.length === 0} onClick={create}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create {rows.length} flight(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
