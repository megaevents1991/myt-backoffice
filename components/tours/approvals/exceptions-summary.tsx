"use client";

/**
 * Section 5 of the approvals screen: how many rows each list of the data
 * problems screen (/tours/exceptions) holds right now. The lists themselves
 * stay there - this block only says they exist and how big they are.
 *
 * It loads on its own (getDataProblems reads every departure and block of the
 * company), so the queue above never waits for it.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionData } from "@/hooks/use-action-data";
import { getDataProblems, type DataProblems } from "@/lib/actions/tours-reports-actions";
import { formatNumber } from "@/lib/tours/format";
import { LoadError } from "@/components/tours/ui";
import { QueueSection } from "./queue-ui";

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
  // Counts again after every change on the screen (refreshKey); a failed recount keeps the last counts.
  const { data, error, reload } = useActionData(
    () =>
      getDataProblems(false).catch((e) => {
        console.error("approvals: data problems load failed", e);
        return { success: false as const, error: "Couldn't load the data problems." };
      }),
    [refreshKey],
  );

  const total = data ? KINDS.reduce((sum, kind) => sum + data[kind.key].length, 0) : null;

  return (
    <QueueSection
      id="exceptions"
      title="Data problems"
      count={total}
      alwaysOpen
      description="Mismatches between departures, prices and flight blocks, in departures and flights still ahead. The full lists, with a link on every row, are on the Data problems screen. Some rows also appear above, where you can handle them in place."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href={HREF}>
            Open Data Problems
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      }
    >
      {error && !data ? (
        <div className="p-4">
          <LoadError message={error} onRetry={() => void reload()} />
        </div>
      ) : !data ? (
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading">
          {KINDS.map((kind) => (
            <div key={kind.key} className="bg-card px-4 py-2.5">
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
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
                    {formatNumber(count)}
                  </span>
                </Link>
              </li>
            );
          })}
          {/* Seven lists in a grid of two or four columns leave one cell over. */}
          <li aria-hidden className="hidden bg-card sm:block" />
        </ul>
      )}
    </QueueSection>
  );
}
