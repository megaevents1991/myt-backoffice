"use client";

/**
 * The tours part of Offline Flights > New Series: "Organized tour" + tour code
 * (+ the tour's name when the code is new), and the answer after the flights are
 * created - which sub-tours were made, joined or skipped. The page shows these
 * only in a tours company; Mega Events never sees them.
 * Server side: lib/actions/tours-flight-series-actions.ts.
 */
import Link from "next/link";
import { CheckCircle2, ExternalLink, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SubToursResult, TourCodeOption } from "@/lib/actions/tours-flight-series-actions";

export interface OrganizedSeries {
  on: boolean;
  code: string;
  /** Only for a new code: the name of the draft tour it creates. */
  tourName: string;
}

export const NO_ORGANIZED_SERIES: OrganizedSeries = { on: false, code: "", tourName: "" };

/** Same rule as the series codes of Add Tour and the Series screen. */
const CODE = /^[A-Z][A-Z0-9]{1,7}$/;
/** The server makes up to this many sub-tours in one go. */
export const MAX_ORGANIZED_FLIGHTS = 60;

export const findTourCode = (codes: TourCodeOption[], code: string): TourCodeOption | undefined =>
  codes.find((c) => c.code === code.trim().toUpperCase());

/** Why the organized part cannot be saved yet, or null when it can (or is off). */
export function organizedProblem(value: OrganizedSeries, codes: TourCodeOption[]): string | null {
  if (!value.on) return null;
  const code = value.code.trim().toUpperCase();
  if (!CODE.test(code)) return "Tour code: 2 to 8 letters (A-Z) and digits, starting with a letter";
  const found = findTourCode(codes, code);
  if (found && !found.tourName) return `Tour code ${code} has no live tour - link it to a tour on the Series screen, or choose another code`;
  if (!found && value.tourName.trim().length < 2) return `Tour code ${code} is new - give the new tour a name`;
  return null;
}

export function OrganizedSeriesFields({
  value,
  codes,
  onChange,
}: {
  value: OrganizedSeries;
  codes: TourCodeOption[];
  onChange: (next: OrganizedSeries) => void;
}) {
  const code = value.code.trim().toUpperCase();
  const found = code ? findTourCode(codes, code) : undefined;
  const problem = value.on && code ? organizedProblem(value, codes) : null;
  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3 md:col-span-3">
      <label className="flex cursor-pointer items-start gap-2">
        <Checkbox
          checked={value.on}
          onCheckedChange={(checked) => onChange({ ...value, on: checked === true })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Organized tour</span>
          <span className="block text-xs text-muted-foreground">
            Every flight becomes a sub-tour (a date) of the tour with this code, with the flight&apos;s dates, route and
            seats. A new code creates the tour as a draft. Prices are set later in Tours &gt; Pricing.
          </span>
        </span>
      </label>
      {value.on && (
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label htmlFor="organized-code">Tour code</Label>
            <Input
              id="organized-code"
              dir="ltr"
              list="organized-codes"
              value={value.code}
              placeholder="BBC"
              maxLength={8}
              onChange={(e) => onChange({ ...value, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
            />
            <datalist id="organized-codes">
              {codes
                .filter((c) => c.tourName)
                .map((c) => (
                  <option key={c.seriesId} value={c.code}>
                    {c.tourName}
                  </option>
                ))}
            </datalist>
          </div>
          {code && !found && (
            <div className="md:col-span-2">
              <Label htmlFor="organized-name">New tour name</Label>
              <Input
                id="organized-name"
                value={value.tourName}
                placeholder="שם הטיול כפי שיופיע באתר"
                onChange={(e) => onChange({ ...value, tourName: e.target.value })}
              />
            </div>
          )}
          <p className="text-sm md:col-span-3">
            {problem ? (
              <span className="text-destructive">{problem}</span>
            ) : found?.tourName ? (
              <span>
                Joins the tour <span className="font-medium">{found.tourName}</span>. The series name will be {code}.
              </span>
            ) : code ? (
              <span>
                A new draft tour with code <span className="font-mono">{code}</span> is created. Fill its page before
                putting it on the site.
              </span>
            ) : (
              <span className="text-muted-foreground">Type an existing code to add dates to its tour, or a new one.</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export function OrganizedSeriesResult({
  flights,
  result,
  error,
  retrying = false,
  onRetry,
}: {
  /** Flights created in the series. */
  flights: number;
  result: SubToursResult | null;
  /** The sub-tours step failed as a whole (the flights exist). */
  error: string | null;
  retrying?: boolean;
  /** Runs the sub-tours step again on the same flights - offered when it failed as a whole. */
  onRetry?: () => void;
}) {
  const ok = result && !error;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <TriangleAlert className="h-5 w-5 text-amber-600" />}
          {flights} flight(s) created
        </CardTitle>
        <CardDescription>
          {result
            ? `${result.createdTour ? "New draft tour" : "Tour"} "${result.tourName}": ${result.created.length} sub-tour(s) created, ${result.attached.length} existing joined, ${result.skipped.length} skipped.`
            : "The flights exist, but no sub-tours were made."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {result && result.created.length + result.attached.length > 0 && (
          <p className="font-mono text-xs" dir="ltr">
            {[...result.created, ...result.attached].map((d) => d.code).join(" · ")}
          </p>
        )}
        {result && (result.skipped.length > 0 || result.problems.length > 0) && (
          <ul className="list-disc space-y-1 ps-5 text-amber-700 dark:text-amber-400">
            {result.skipped.map((s) => (
              <li key={`s${s.flightId}`}>
                Flight #{s.flightId}: {s.reason}
              </li>
            ))}
            {result.problems.map((p, i) => (
              <li key={`p${i}`}>{p}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button onClick={onRetry} disabled={retrying}>
              {retrying ? "Creating the sub-tours..." : "Create the sub-tours again"}
            </Button>
          )}
          {result && (
            <>
              <Button asChild>
                <Link href={`/tours/pricing?tour=${result.packageId}`}>Set prices in Pricing</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/tours/packages/${result.packageId}?tab=${result.createdTour ? "general" : "dates"}`}>
                  Open the tour
                  <ExternalLink className="ms-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </>
          )}
          <Button asChild variant="ghost">
            <Link href="/offline-flights">Back to flights</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
