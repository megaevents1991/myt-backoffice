"use client";

/**
 * "Create sub-tours" of the flights sheet (Alon, 07.10.2026): flights that were
 * opened without a tour - a series built with "Organized tour" unticked, or a
 * single flight - get their sub-tours here, without building the series again.
 * It asks for the tour code only; the rest is the step New Series runs
 * (createSubToursFromFlightSeries): a date that already exists with the code of
 * a flight's day gets that flight, a missing one is created as a draft.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSubToursFromFlightSeries,
  getTourCodes,
  type SubToursResult,
  type TourCodeOption,
} from "@/lib/actions/tours-flight-series-actions";
import {
  MAX_ORGANIZED_FLIGHTS,
  SubToursNextSteps,
  SubToursSummary,
  findTourCode,
  organizedProblem,
  subToursLine,
} from "./organized-series";

const CODE = /^[A-Z][A-Z0-9]{1,7}$/;

export function CreateSubToursDialog({
  seriesName,
  flightIds,
  onClose,
  onDone,
}: {
  /** The name of the flight series - offered as the tour code when it reads like one. */
  seriesName: string;
  /** The flights with no sub-tour. */
  flightIds: number[];
  onClose: () => void;
  /** Sub-tours were made or joined: the sheet reloads. */
  onDone: () => void;
}) {
  const guess = seriesName.trim().toUpperCase();
  const [code, setCode] = useState(CODE.test(guess) ? guess : "");
  const [tourName, setTourName] = useState("");
  const [codes, setCodes] = useState<TourCodeOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubToursResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getTourCodes()
      .then((res) => {
        if (!alive) return;
        if (res.success) setCodes(res.data);
        else setLoadError(res.error);
      })
      .catch(() => alive && setLoadError("Could not load the tour codes"));
    return () => {
      alive = false;
    };
  }, []);

  const clean = code.trim().toUpperCase();
  const found = codes && clean ? findTourCode(codes, clean) : undefined;
  const tooMany = flightIds.length > MAX_ORGANIZED_FLIGHTS;
  const problem = tooMany
    ? `Up to ${MAX_ORGANIZED_FLIGHTS} flights at a time - filter the sheet to fewer flights and run it again`
    : !codes
      ? (loadError ?? "Loading the tour codes…")
      : !clean
        ? "Type the tour code"
        : organizedProblem({ on: true, code: clean, tourName }, codes);

  const create = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createSubToursFromFlightSeries({ flightIds, code: clean, tourName: found ? null : tourName.trim() });
      if (res.success) {
        setResult(res.data);
        onDone();
      } else setError(res.error);
    } catch {
      setError("Could not create the sub-tours. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pt-4 text-start sm:text-start">
          <DialogTitle>Create sub-tours</DialogTitle>
          <DialogDescription>
            {result
              ? subToursLine(result)
              : `${flightIds.length} flight(s)${seriesName ? ` of ${seriesName}` : ""} have no sub-tour. Each one opens a date of the tour with this code - the flight's dates, route and seats - as a draft. A date that already exists on a flight's day gets that flight instead of a second date.`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <SubToursSummary result={result} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="sub-tours-code">Tour code</Label>
              <Input
                id="sub-tours-code"
                dir="ltr"
                list="sub-tours-codes"
                value={code}
                placeholder="BBC"
                maxLength={8}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              />
              <datalist id="sub-tours-codes">
                {(codes ?? [])
                  .filter((c) => c.tourName)
                  .map((c) => (
                    <option key={c.seriesId} value={c.code}>
                      {c.tourName}
                    </option>
                  ))}
              </datalist>
            </div>
            {codes && clean && !found && (
              <div className="sm:col-span-2">
                <Label htmlFor="sub-tours-name">New tour name</Label>
                <Input
                  id="sub-tours-name"
                  dir="auto"
                  value={tourName}
                  placeholder="שם הטיול כפי שיופיע באתר"
                  onChange={(e) => setTourName(e.target.value)}
                />
              </div>
            )}
            <p className="text-sm sm:col-span-3">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : problem ? (
                <span className={clean && codes ? "text-destructive" : "text-muted-foreground"}>{problem}</span>
              ) : found?.tourName ? (
                <span>
                  The dates join the tour <span className="font-medium">{found.tourName}</span>.
                </span>
              ) : (
                <span>
                  A new draft tour with code <span className="font-mono">{clean}</span> is created. Fill its page before putting it
                  on the site.
                </span>
              )}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {result ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
              <SubToursNextSteps result={result} />
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void create()} disabled={!!problem || busy}>
                {busy && <Loader2 className="animate-spin" />}
                Create {flightIds.length} sub-tour(s)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
