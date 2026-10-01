"use client";

/**
 * Section 2 of the approvals screen: departures that are on the site and have
 * no live flight block. For each one the server looked for live blocks of the
 * company that land and return in the departure's cities, fly within two days
 * of its dates and still have free seats; one click allocates the block with
 * the same action the departure card uses (addFlightAllocation).
 */
import { useState } from "react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { addFlightAllocation } from "@/lib/actions/tours-departure-actions";
import type { ApprovalsData, BlockCandidate, DepartureWithoutBlock } from "@/lib/actions/tours-approvals-actions";
import { daysBetween, formatDateShort } from "@/lib/tours/deadlines";
import { BlockStatusBadge, Ltr } from "@/components/tours/flights/block-ui";
import {
  ActionButton,
  OpenLink,
  QueueSection,
  blockHref,
  departureHref,
  inDays,
  linkClass,
  type QueueControls,
} from "./queue-ui";

export function DeparturesWithoutBlock({ data, run, busy }: QueueControls & { data: ApprovalsData }) {
  const rows = data.departuresWithoutBlock;
  return (
    <QueueSection
      id="no-block"
      title="Published without a live flight"
      count={rows.length}
      description='Upcoming departures shown on the site with no confirmed flight block allocated - the site shows them "flight details will be updated". Each one is offered live flight blocks of the company that land and return in its cities, fly within two days of its dates and still have seats left.'
    >
      <ul className="divide-y">
        {rows.map((departure) => (
          <DepartureItem key={departure.id} departure={departure} today={data.today} run={run} busy={busy} />
        ))}
      </ul>
    </QueueSection>
  );
}

function DepartureItem({
  departure,
  today,
  run,
  busy,
}: QueueControls & { departure: DepartureWithoutBlock; today: string }) {
  return (
    <li data-departure={departure.code} className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={departureHref(departure.code, "flights")} className={linkClass} title="Open the departure card">
            <Ltr className="font-mono">{departure.code}</Ltr>
          </Link>
          {departure.packageName && <span className="truncate text-sm">{departure.packageName}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <Ltr>
            {formatDateShort(departure.startDate)} - {formatDateShort(departure.endDate)}
          </Ltr>
          {" · "}
          {inDays(daysBetween(today, departure.startDate))}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Route <Ltr className="font-medium text-foreground/80">{departure.route || "not set"}</Ltr>
          {departure.deadBlocks > 0 && (
            <> · {departure.deadBlocks === 1 ? "one flight block allocated, not live" : `${departure.deadBlocks} flight blocks allocated, none live`}</>
          )}
        </div>
      </div>

      <div className="min-w-0">
        {departure.candidates.length === 0 ? (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {departure.fullCandidates > 0
              ? departure.fullCandidates === 1
                ? "A live flight block matches the dates and cities, but all its seats are already allocated to other departures."
                : `${departure.fullCandidates} live flight blocks match the dates and cities, but all their seats are already allocated to other departures.`
              : "No live flight block matches the dates and cities of this departure. Book a flight block, or take the departure off the site."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {departure.candidates.map((candidate) => (
              <CandidateRow
                key={candidate.flightId}
                departure={departure}
                candidate={candidate}
                run={run}
                busy={busy}
              />
            ))}
            {departure.moreCandidates > 0 && (
              <li className="text-xs text-muted-foreground">
                {departure.moreCandidates} more matching flight blocks on the departure card, under Flights.
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex items-start justify-end">
        <OpenLink href={departureHref(departure.code, "flights")}>Departure Card</OpenLink>
      </div>
    </li>
  );
}

function CandidateRow({
  departure,
  candidate,
  run,
  busy,
}: QueueControls & { departure: DepartureWithoutBlock; candidate: BlockCandidate }) {
  const [seats, setSeats] = useState(String(candidate.suggestedSeats));
  const count = /^\d+$/.test(seats.trim()) ? Number(seats.trim()) : Number.NaN;
  const valid = Number.isInteger(count) && count >= 1 && count <= candidate.freeSeats;
  const key = `allocate:${departure.id}:${candidate.flightId}`;
  const airlines = candidate.inboundAirline ? `${candidate.airline} / ${candidate.inboundAirline}` : candidate.airline;
  const flights = [candidate.outboundFlight, candidate.inboundFlight].filter(Boolean).join(" · ");
  const exact = candidate.gapOut === 0 && candidate.gapIn === 0;
  const inputId = `seats-${departure.id}-${candidate.flightId}`;

  return (
    <li
      data-candidate={candidate.flightId}
      className="grid items-center gap-x-4 gap-y-2 rounded-md border bg-background px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Ltr className="font-semibold">{airlines}</Ltr>
          <Ltr className="font-medium">{candidate.route}</Ltr>
          {candidate.status !== "confirmed" && <BlockStatusBadge status={candidate.status} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Ltr>
            {formatDateShort(candidate.outboundDate)} - {formatDateShort(candidate.inboundDate)}
          </Ltr>
          {exact ? (
            <span>Same dates</span>
          ) : (
            <span className="font-medium text-amber-700 dark:text-amber-400">{gapText(candidate)}</span>
          )}
          {flights && <Ltr>{flights}</Ltr>}
          <span>
            {candidate.freeSeats} left of {candidate.seats}
          </span>
          <Link href={blockHref(candidate.flightId)} className={linkClass}>
            <span dir="auto">{candidate.seriesName ?? `Flight block ${candidate.flightId}`}</span>
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          Seats
        </label>
        <Input
          id={inputId}
          dir="ltr"
          inputMode="numeric"
          className="h-9 w-16 text-center tabular-nums"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          disabled={busy !== null}
          aria-invalid={!valid}
        />
        <ActionButton
          actionKey={key}
          busy={busy}
          disabled={!valid}
          title={valid ? undefined : `Allocate between 1 and ${candidate.freeSeats} seats`}
          onClick={() =>
            void run(
              key,
              () => addFlightAllocation(departure.id, candidate.flightId, count, "both"),
              `${count} seats allocated to ${departure.code}`,
            )
          }
        >
          Allocate
        </ActionButton>
      </div>
    </li>
  );
}

function gapText(candidate: BlockCandidate): string {
  const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);
  const parts: string[] = [];
  if (candidate.gapOut > 0) parts.push(`outbound off by ${days(candidate.gapOut)}`);
  if (candidate.gapIn > 0) parts.push(`return off by ${days(candidate.gapIn)}`);
  return parts.join(", ");
}
