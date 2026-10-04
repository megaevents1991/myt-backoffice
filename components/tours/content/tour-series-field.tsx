"use client";

/**
 * The series code of a tour on its Details tab (Alon, 04.10.2026): the English
 * name of the series - CBP, FPAR - shown large, and typed here for a tour that
 * has none yet. Every date and flight of the tour is named by it (CBP927 = the
 * date that leaves on 27.9), so the code is locked once dates were built from it.
 */
import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/hooks/use-action-toast";
import { setTourSeriesCode } from "@/lib/actions/tours-tour-actions";
import { departureRouteLabel } from "@/lib/tours/routes";
import { linkClass } from "@/lib/tours/links";
import { Ltr, Section } from "@/components/tours/ui";
import type { BoardSeries } from "@/components/tours/departures/types";

const CODE = /^[A-Z][A-Z0-9]{1,7}$/;

export function TourSeriesField({
  packageId,
  series,
  fallbackCodes,
  hasDates,
  onChanged,
}: {
  packageId: string;
  /** The series of the tour; null while the dates tab loads (the codes of the page load are shown meanwhile). */
  series: BoardSeries[] | null;
  fallbackCodes: string[];
  hasDates: boolean;
  onChanged: () => void;
}) {
  const run = useActionToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const code = text.trim().toUpperCase();
  const valid = CODE.test(code);
  const none = series ? series.length === 0 : fallbackCodes.length === 0;

  const save = async (seriesId: string | null) => {
    if (!valid || busy) return;
    setBusy(true);
    const res = await run(() => setTourSeriesCode(packageId, seriesId, code), (a) => `Series code ${a.data.code} saved`);
    setBusy(false);
    if (!res.success) return;
    setEditing(null);
    setText("");
    onChanged();
  };

  const editor = (seriesId: string | null) => (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        dir="ltr"
        maxLength={8}
        value={text}
        placeholder="CBP"
        aria-label="Series code"
        className="h-11 w-36 font-mono text-xl font-semibold uppercase tracking-wide"
        onChange={(e) => setText(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save(seriesId);
          }
          if (e.key === "Escape") setEditing(null);
        }}
      />
      <Button type="button" size="sm" disabled={!valid || busy} onClick={() => void save(seriesId)}>
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
        Save Code
      </Button>
      {seriesId !== null && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
          <X />
          Cancel
        </Button>
      )}
      {text !== "" && !valid && (
        <span className="text-xs text-destructive">2 to 8 characters, letters A-Z and digits, starting with a letter</span>
      )}
    </span>
  );

  return (
    <Section
      title="Series code"
      description="The English code of the series (CBP, FPAR). Every date and flight of the tour is named by it: CBP927 is the date that leaves on 27.9. Give the same code to its flight series in Offline Flights > New Series."
    >
      {none ? (
        editor(null)
      ) : (
        <ul className="flex flex-wrap items-start gap-3">
          {(series ?? fallbackCodes.map((c) => ({ id: c, code: c }) as Pick<BoardSeries, "id" | "code"> & Partial<BoardSeries>)).map((s) => (
            <li key={s.id} className="rounded-lg border bg-card px-4 py-3">
              {editing === s.id ? (
                editor(s.id)
              ) : (
                <span className="flex items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground">Series:</span>
                  <Ltr className="font-mono text-2xl font-bold tracking-wider">{s.code}</Ltr>
                  {series && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={hasDates && series.length === 1}
                      title={
                        hasDates && series.length === 1
                          ? "Dates were built from this code, so it can't change"
                          : "Change the code (possible while no date carries it)"
                      }
                      onClick={() => {
                        setText(s.code);
                        setEditing(s.id);
                      }}
                    >
                      <Pencil />
                    </Button>
                  )}
                </span>
              )}
              {series && editing !== s.id && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {s.label ? <span dir="auto">{s.label} · </span> : null}
                  {s.arrival_airport || s.return_airport ? (
                    <Ltr className="font-mono">{departureRouteLabel(s.arrival_airport ?? null, s.return_airport ?? s.arrival_airport ?? null)}</Ltr>
                  ) : (
                    "route from its first flight"
                  )}
                  {s.is_active === false ? " · inactive" : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {none ? "This tour has no series yet - type its code. " : ""}
        Route, weekdays, ages and a second series (a tour sold in both directions):{" "}
        <Link href="/tours/series" className={linkClass}>
          Series
        </Link>
        .
      </p>
    </Section>
  );
}
