"use client";

/**
 * Section 5 of the approvals screen: how many rows each list of the data
 * problems screen (/tours/exceptions) holds right now. The lists themselves
 * stay there - this block only says they exist and how big they are.
 *
 * It loads on its own (getDataProblems reads every departure and block of the
 * company), so the queue above never waits for it.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataProblems, type DataProblems } from "@/lib/actions/tours-reports-actions";
import { CountBadge } from "./queue-ui";

type ProblemKey = Exclude<keyof DataProblems, "today" | "includePast">;

/** The lists of /tours/exceptions, in its order and with its titles. */
const KINDS: { key: ProblemKey; label: string }[] = [
  { key: "noLiveBlock", label: "Published without a live flight" },
  { key: "allBlocksDead", label: "Departures whose flight blocks were all cancelled or declined" },
  { key: "dateMismatch", label: "Allocations whose flight date differs from the departure date" },
  { key: "routeMismatch", label: "Allocations whose route does not match the departure" },
  { key: "noDoublePrice", label: "Departures with no double-room price" },
  { key: "negativeRemaining", label: "Departures with fewer than zero seats left" },
  { key: "blocksMissingData", label: "Confirmed flight blocks with no PNR or no contract" },
];

const HREF = "/tours/exceptions";

export function ExceptionsSummary({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<DataProblems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getDataProblems(false)
      .then((res) => {
        if (!alive) return;
        if (res.success) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error);
        }
      })
      .catch((e) => {
        console.error("approvals: data problems load failed", e);
        if (alive) setError("Couldn't load the data problems.");
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, attempt]);

  const total = data ? KINDS.reduce((sum, kind) => sum + data[kind.key].length, 0) : 0;

  return (
    <section id="exceptions" className="scroll-mt-20 rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-semibold">Data problems</h2>
            {data && <CountBadge count={total} />}
          </div>
          <p className="mt-1 max-w-[90ch] text-xs text-muted-foreground">
            Mismatches between departures, prices and flight blocks, in departures and flights still ahead. The full
            lists, with a link on every row, are on the Data problems screen. Some rows also appear above, where you
            can handle them in place.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={HREF}>
            Open Data Problems
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>

      {error && !data ? (
        <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm text-destructive" role="alert">
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Try Again
          </Button>
        </div>
      ) : !data ? (
        <div className="grid gap-px border-t bg-border sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading">
          {KINDS.map((kind) => (
            <div key={kind.key} className="bg-card px-4 py-2.5">
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="grid gap-px border-t bg-border sm:grid-cols-2 xl:grid-cols-4">
          {KINDS.map((kind) => {
            const count = data[kind.key].length;
            return (
              <li key={kind.key} className="bg-card">
                <Link
                  href={HREF}
                  className="flex h-full items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className={cn(count === 0 && "text-muted-foreground")}>{kind.label}</span>
                  <span
                    className={cn(
                      "font-display font-semibold tabular-nums",
                      count === 0 && "font-normal text-muted-foreground",
                    )}
                  >
                    {count.toLocaleString("he-IL")}
                  </span>
                </Link>
              </li>
            );
          })}
          {/* Seven lists in a grid of two or four columns leave one cell over. */}
          <li aria-hidden className="hidden bg-card sm:block" />
        </ul>
      )}
    </section>
  );
}
