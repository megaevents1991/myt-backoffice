"use client";

/**
 * Create Tour (/tours/packages/new) - the tours side of "Add Event": one page
 * of cards, saved once from the bar at the bottom. It creates the tour page,
 * its series, its first dates with one price list, links the flight blocks
 * picked for each date and keeps the hotels; then it opens the new tour's page,
 * where its Ready for the Site list says what is left.
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  FileText,
  Hotel,
  Info,
  ListChecks,
  Map as MapIcon,
  Plane,
  Plus,
  RefreshCw,
  Route,
  Tag,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useToast } from "@/hooks/use-toast";
import { useActionData } from "@/hooks/use-action-data";
import { CurrencySelect, EmptyLine, Field, Ltr, Notice } from "@/components/tours/ui";
import { ImageUrlField, StringListEditor } from "@/components/tours/content/fields";
import { ItineraryDaysEditor } from "@/components/tours/content/itinerary-days-editor";
import { TourLeadersPicker } from "@/components/tours/content/tour-leaders-picker";
import { HtmlField } from "@/components/tours/content/html-field";
import { PackageGeneralFields, PackageTermsPicker } from "@/components/tours/content/package-general-fields";
import { TourHotelsEditor } from "@/components/tours/content/tour-hotels-editor";
import { createTour } from "@/lib/actions/tours-tour-actions";
import { listUpcomingBlocks } from "@/lib/actions/tours-departure-actions";
import { addDays, daysBetween, fmtDateTime, isDateOnly, nightsBetween, parsePrice } from "@/lib/tours/format";
import { checkBlockFitsDeparture, flightRouteLabel } from "@/lib/tours/routes";
import { departureCode } from "@/components/tours/departures/departure-utils";
import { CURRENCIES, PRICE_MATRIX_ROWS } from "@/types/tours.types";
import type { CardFlight } from "@/components/tours/departures/types";
import {
  createProblemsKey,
  EMPTY_PACKAGE_FORM,
  slugFromName,
  type ItineraryDay,
  type NewTourContext,
  type NewTourSeries,
  type PackageForm,
} from "@/components/tours/content/shared";

/** Blocks fly within this many days of the date they serve (the allocation rule). */
const DAY_WINDOW = 2;
const CODE = /^[A-Z][A-Z0-9]{1,7}$/;
const AIRPORT = /^[A-Z]{3}$/;
const MAX_DATES = 60;
const MAX_NIGHTS = 60;
const priceKey = (paxType: string, position: number) => `${paxType}:${position}`;

const freeSeats = (b: CardFlight) => b.initial_quantity - Math.max(b.allocatedOutbound, b.allocatedInbound);

/**
 * The open blocks that can serve a date both ways - out within two days of
 * its departure, back within two days of its return, landing and leaving
 * where the series does: the blocks addFlightAllocation accepts for "both".
 */
function blocksFor(blocks: CardFlight[], start: string, end: string, route: { arrival: string; ret: string }): CardFlight[] {
  if (!isDateOnly(start) || !isDateOnly(end)) return [];
  const near = (flightDay: string | undefined, day: string) =>
    !!flightDay && Math.abs(daysBetween(day, flightDay)) <= DAY_WINDOW;
  const ends = { arrival_airport: route.arrival || null, return_airport: route.ret || null };
  return blocks.filter(
    (b) =>
      near(b.outbound_departure_time?.slice(0, 10), start) &&
      near(b.inbound_departure_time?.slice(0, 10), end) &&
      checkBlockFitsDeparture(b, ends, "both").ok,
  );
}

/** One card of the page, in the look of the Add Event cards. */
function SectionCard({
  id,
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  icon: typeof Info;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {title}
          </CardTitle>
          {description && <CardDescription className="mt-1.5">{description}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function CreateTour({ context }: { context: NewTourContext }) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<PackageForm>(EMPTY_PACKAGE_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [series, setSeries] = useState<NewTourSeries>({
    code: "",
    label: "",
    arrivalAirport: "",
    returnAirport: "",
    currency: "USD",
    capacity: 45,
    childMaxAge: 16,
  });
  const [dates, setDates] = useState<{ start: string; end: string }[]>([{ start: "", end: "" }]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  /** `${start}|${flightId}` -> seats */
  const [links, setLinks] = useState<Record<string, number>>({});
  const [days, setDays] = useState<ItineraryDay[]>([]);
  // what is created here joins the lists at once
  const [terms, setTerms] = useState(context.terms);
  const [leaders, setLeaders] = useState(context.leaders);
  const [saving, setSaving] = useState(false);
  const blocks = useActionData(() => listUpcomingBlocks(), []);

  const set = <K extends keyof PackageForm>(key: K, value: PackageForm[K]) => {
    if (key === "slug") setSlugTouched(true);
    setForm((current) => {
      const next = { ...current, [key]: value };
      // the address follows the name until it is typed by hand
      if (key === "name" && !slugTouched) next.slug = slugFromName(String(value));
      return next;
    });
  };
  const setSeriesField = <K extends keyof NewTourSeries>(key: K, value: NewTourSeries[K]) =>
    setSeries((current) => ({ ...current, [key]: value }));

  const nights = form.nights;
  const setDate = (index: number, field: "start" | "end", value: string) =>
    setDates((current) =>
      current.map((d, i) => {
        if (i !== index) return d;
        const next = { ...d, [field]: value };
        // the return date follows the departure date by the tour's nights, until it is set by hand
        const followed = !d.end || d.end < value || (isDateOnly(d.start) && nights != null && d.end === addDays(d.start, nights));
        if (field === "start" && isDateOnly(value) && nights != null && followed) next.end = addDays(value, nights);
        return next;
      }),
    );

  const code = series.code.trim().toUpperCase();
  const takenSlugs = useMemo(() => new Set(context.slugs), [context.slugs]);
  const takenCodes = useMemo(() => new Set(context.seriesCodes), [context.seriesCodes]);
  const filledDates = dates.filter((d) => d.start);
  const parsedPrices = PRICE_MATRIX_ROWS.map((r) => ({
    paxType: r.paxType,
    position: r.position,
    label: r.label,
    price: parsePrice(prices[priceKey(r.paxType, r.position)] ?? ""),
  }));
  const badPrice = parsedPrices.find((p) => p.price === undefined);

  const problem = !form.name.trim()
    ? "Tour name is required"
    : !form.slug.trim()
      ? "Slug is required"
      : takenSlugs.has(form.slug.trim())
        ? "Another tour already uses this slug"
        : !CODE.test(code)
          ? "Series code: 2-8 English letters and digits, starting with a letter"
          : takenCodes.has(code)
            ? `Series ${code} already exists`
            : !AIRPORT.test(series.arrivalAirport) || !AIRPORT.test(series.returnAirport)
              ? "Arrival and return airports are 3 English letters (e.g. LHR)"
              : series.capacity !== null && series.capacity > 2000
                ? "Seats per date: up to 2000"
                : series.childMaxAge > 25
                  ? "Child age: up to 25"
                  : (form.nights ?? 0) > MAX_NIGHTS
                    ? `A tour of more than ${MAX_NIGHTS} nights - check the nights`
                    : filledDates.length > MAX_DATES
                      ? `Up to ${MAX_DATES} dates here - add more from the tour page (Add Season)`
                      : filledDates.some((d) => !isDateOnly(d.start) || !isDateOnly(d.end) || d.end < d.start)
                        ? "Every date needs a departure date and a later return date"
                        : filledDates.some((d) => (nightsBetween(d.start, d.end) ?? 0) > MAX_NIGHTS)
                          ? `A date of more than ${MAX_NIGHTS} nights - check the return date`
                          : new Set(filledDates.map((d) => d.start)).size !== filledDates.length
                            ? "Two dates start on the same day"
                            : badPrice
                              ? `${badPrice.label}: not a valid price`
                              : null;

  const create = async () => {
    if (problem || saving) return;
    setSaving(true);
    const starts = new Set(filledDates.map((d) => d.start));
    const result = await createTour({
      page: form,
      series: { ...series, code },
      dates: filledDates,
      prices: parsedPrices.map(({ paxType, position, price }) => ({ paxType, position, price: price ?? null })),
      itinerary: days,
      flights: Object.entries(links)
        .map(([key, seats]) => {
          const [start, id] = key.split("|");
          return { start, flightId: Number(id), seats, legs: "both" as const };
        })
        .filter((f) => starts.has(f.start) && f.seats > 0),
    }).catch(() => null);
    if (!result) {
      // the request broke off: the steps already run on the server stay done
      setSaving(false);
      toast({
        variant: "destructive",
        title: "The connection broke off",
        description: "The tour may already exist. Check the Tours list before trying again.",
      });
      return;
    }
    if (!result.success) {
      setSaving(false);
      toast({ variant: "destructive", title: "The tour was not created", description: result.error });
      return;
    }
    // saving stays on: the page is leaving, a second click must not create it again
    const { id, departures, flights, problems } = result.data;
    toast({
      title: "Tour created",
      description: `${departures} dates, ${flights} flight links. It stays inactive until you switch it on.`,
    });
    if (problems.length) {
      try {
        sessionStorage.setItem(createProblemsKey(id), JSON.stringify(problems));
      } catch {
        toast({ variant: "destructive", title: "Some steps were not done", description: problems.slice(0, 4).join(" · ") });
      }
    }
    router.push(`/tours/packages/${id}?tab=dates`);
  };

  const upcoming = blocks.data ?? [];
  const siteUrl = context.siteUrl;

  return (
    <div className="space-y-6 pb-28">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.push("/tours/packages")}>
          <ArrowLeft className="me-2 h-4 w-4" />
          Back
        </Button>
        <div className="ms-4">
          <h1 className="text-3xl font-bold tracking-tight">Create Tour</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything a tour needs, on one page. FAQ and SEO can be added on the tour page after it is created.
          </p>
        </div>
      </div>

      <SectionCard id="section-basic" icon={Info} title="Basic Information">
        <PackageGeneralFields
          form={form}
          set={set}
          kinds={["organized"]}
          slugHint={
            form.slug && takenSlugs.has(form.slug.trim())
              ? "Another tour already uses this slug."
              : "The last part of the tour's address on the site. Filled from the name; no spaces."
          }
        />
      </SectionCard>

      <SectionCard
        id="section-series"
        icon={Route}
        title="Series & Route"
        description="The series code starts every date code (BBC + 1203 = BBC1203). The route, currency and seats apply to every date."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Series code" hint={takenCodes.has(code) ? "This code is taken." : "e.g. BBC, FPAR"}>
            <Input
              dir="ltr"
              className="font-mono uppercase"
              maxLength={8}
              value={series.code}
              onChange={(e) => setSeriesField("code", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Arrival airport" hint="Where the tour lands, e.g. LHR">
            <Input
              dir="ltr"
              className="font-mono uppercase"
              maxLength={3}
              value={series.arrivalAirport}
              onChange={(e) => setSeriesField("arrivalAirport", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Return airport" hint="Where it flies home from">
            <Input
              dir="ltr"
              className="font-mono uppercase"
              maxLength={3}
              value={series.returnAirport}
              onChange={(e) => setSeriesField("returnAirport", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Currency" htmlFor="tour-currency">
            <CurrencySelect
              id="tour-currency"
              value={series.currency}
              currencies={CURRENCIES}
              onChange={(c) => setSeriesField("currency", c)}
            />
          </Field>
          <Field label="Seats per date">
            <Input
              type="number"
              min={0}
              dir="ltr"
              value={series.capacity ?? ""}
              onChange={(e) =>
                setSeriesField("capacity", e.target.value === "" ? null : Math.max(0, Math.trunc(Number(e.target.value) || 0)))
              }
            />
          </Field>
          <Field label="Child up to age">
            <Input
              type="number"
              min={0}
              max={25}
              dir="ltr"
              value={series.childMaxAge}
              onChange={(e) => setSeriesField("childMaxAge", Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        id="section-dates"
        icon={CalendarDays}
        title="Dates"
        description="Each date is created as a draft. Put dates on the site from the tour page when they are ready; a whole season can be added there too."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => setDates((d) => [...d, { start: "", end: "" }])}>
            <Plus className="me-2 h-4 w-4" />
            Add Date
          </Button>
        }
      >
        {dates.length === 0 && <EmptyLine>No dates. You can add them later from the tour page.</EmptyLine>}
        {dates.map((d, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3">
            <Field label="Departure">
              <Input dir="ltr" type="date" className="h-9" value={d.start} onChange={(e) => setDate(index, "start", e.target.value)} />
            </Field>
            <Field label="Return">
              <Input
                dir="ltr"
                type="date"
                className="h-9"
                value={d.end}
                min={d.start || undefined}
                onChange={(e) => setDate(index, "end", e.target.value)}
              />
            </Field>
            {CODE.test(code) && isDateOnly(d.start) && (
              <span className="pb-2 text-sm text-muted-foreground">
                Code <Ltr className="font-mono text-foreground">{departureCode(code, d.start)}</Ltr>
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove date"
              onClick={() => setDates((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </SectionCard>

      <SectionCard
        id="section-prices"
        icon={Wallet}
        title="Prices"
        description="Price per person, the same for every new date. The site needs at least the double-room price; one date's prices change later in its card."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRICE_MATRIX_ROWS.map((r) => {
            const key = priceKey(r.paxType, r.position);
            return (
              <Field key={key} label={`${r.label} (${series.currency})`}>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={prices[key] ?? ""}
                  aria-invalid={parsePrice(prices[key] ?? "") === undefined}
                  onChange={(e) => setPrices((p) => ({ ...p, [key]: e.target.value }))}
                />
              </Field>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        id="section-flights"
        icon={Plane}
        title="Offline Flights"
        description="Each date lists the flight blocks that fly out and back within two days of it, on the series route. Tick the ones that serve it."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/offline-flights/new" target="_blank" rel="noreferrer">
                <Plus className="me-2 h-4 w-4" />
                New Flight
                <ExternalLink className="ms-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void blocks.reload()}>
              <RefreshCw className="me-2 h-4 w-4" />
              Refresh
            </Button>
          </>
        }
      >
        {blocks.error && <Notice tone="error">{blocks.error}</Notice>}
        {filledDates.length === 0 ? (
          <EmptyLine>Add dates first - each date lists the flight blocks that fit it.</EmptyLine>
        ) : (
          filledDates.map((d) => {
            const fits = blocksFor(upcoming, d.start, d.end, { arrival: series.arrivalAirport, ret: series.returnAirport });
            return (
              <div key={d.start} className="space-y-2 rounded-md border p-3">
                <div className="text-sm font-medium">
                  <Ltr>{d.end ? `${d.start} - ${d.end}` : d.start}</Ltr>
                </div>
                {blocks.loading && !blocks.data ? (
                  <p className="text-sm text-muted-foreground">Loading flights...</p>
                ) : fits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No flight block flies this route on these dates yet.</p>
                ) : (
                  fits.map((b) => {
                    const key = `${d.start}|${b.id}`;
                    const linked = key in links;
                    const free = freeSeats(b);
                    return (
                      <div key={b.id} className="flex flex-wrap items-center gap-3 text-sm">
                        <Checkbox
                          checked={linked}
                          disabled={free <= 0 && !linked}
                          onCheckedChange={(on) =>
                            setLinks((current) => {
                              const next = { ...current };
                              if (on === true) next[key] = Math.max(1, Math.min(free, series.capacity || free));
                              else delete next[key];
                              return next;
                            })
                          }
                          aria-label={`Link flight block ${b.id}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">
                            {b.airline_code} <Ltr className="font-mono">{b.outbound_flight_number}</Ltr>
                          </span>{" "}
                          <Ltr className="font-mono text-muted-foreground">{flightRouteLabel(b)}</Ltr>{" "}
                          <Ltr className="text-muted-foreground">{fmtDateTime(b.outbound_departure_time)}</Ltr>
                          <span className="text-muted-foreground">
                            {" "}
                            · {free} free of {b.initial_quantity}
                          </span>
                        </span>
                        {linked && (
                          <Field label="Seats" className="w-24">
                            <Input
                              type="number"
                              min={1}
                              max={free}
                              dir="ltr"
                              className="h-8"
                              value={links[key]}
                              onChange={(e) =>
                                setLinks((current) => ({ ...current, [key]: Math.max(1, Math.trunc(Number(e.target.value) || 1)) }))
                              }
                            />
                          </Field>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })
        )}
      </SectionCard>

      <SectionCard id="section-hotels" icon={Hotel} title="Hotels" description="The hotels of the tour, in the order the site lists them.">
        <TourHotelsEditor
          value={form.hotels}
          onChange={(hotels) => set("hotels", hotels)}
          catalog={context.hotels}
          siteUrl={siteUrl}
        />
      </SectionCard>

      <SectionCard id="section-content" icon={FileText} title="Images & Description">
        <div className="grid gap-4 lg:grid-cols-2">
          <ImageUrlField
            label="Hero image (top of the page)"
            value={form.heroImage}
            onChange={(value) => set("heroImage", value)}
            siteUrl={siteUrl}
            folder="packages"
          />
          <ImageUrlField
            label="Card image (in lists)"
            value={form.cardImage}
            onChange={(value) => set("cardImage", value)}
            siteUrl={siteUrl}
            folder="packages"
          />
        </div>
        <HtmlField
          label="Tour description"
          value={form.descriptionHtml}
          onChange={(value) => set("descriptionHtml", value)}
          siteUrl={siteUrl}
          rows={8}
        />
      </SectionCard>

      <SectionCard
        id="section-itinerary"
        icon={MapIcon}
        title="Itinerary"
        description="The day-by-day plan. Open a day to write its route and text; a picture per day is optional."
      >
        <ItineraryDaysEditor
          days={days}
          onChange={setDays}
          siteUrl={siteUrl}
          removeNote="The day will be removed from the itinerary."
        />
      </SectionCard>

      <SectionCard id="section-included" icon={ListChecks} title="What's Included">
        <div className="grid gap-6 lg:grid-cols-2">
          <StringListEditor label="Included" value={form.included} onChange={(value) => set("included", value)} />
          <StringListEditor label="Not included" value={form.notIncluded} onChange={(value) => set("notIncluded", value)} />
        </div>
        <HtmlField
          label="Additional info"
          value={form.extraInfoHtml}
          onChange={(value) => set("extraInfoHtml", value)}
          siteUrl={siteUrl}
          rows={6}
          hint="A plain list (bullets) shows on the site as bullet points."
        />
      </SectionCard>

      <SectionCard
        id="section-leaders"
        icon={Users}
        title="Group Leaders"
        description="Who escorts the tour - listed on the tour page on the site. A new one is created by name; the leader of each date is set later in its card."
      >
        <TourLeadersPicker
          value={form.leaderIds}
          onChange={(ids) => set("leaderIds", ids)}
          options={leaders}
          onOptionCreated={(leader) => setLeaders((list) => [...list, leader])}
          siteUrl={siteUrl}
        />
      </SectionCard>

      <SectionCard
        id="section-terms"
        icon={Tag}
        title="Categories & Tags"
        description="Tick existing ones or add a new one in place. The audience decides the homepage tab the tour shows under."
      >
        <PackageTermsPicker
          terms={terms}
          value={form.termIds}
          onChange={(ids) => set("termIds", ids)}
          onTermCreated={(term) => setTerms((list) => [...list, term])}
        />
      </SectionCard>

      <StickySaveBar
        isDirty
        isSaving={saving}
        onSave={() => void create()}
        onDiscard={() => router.push("/tours/packages")}
        saveLabel="Create Tour"
        savingLabel="Creating..."
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message="The tour is created as an inactive draft, with its dates unpublished."
      />
    </div>
  );
}
