"use client";

/**
 * A section of the approvals screen: sub-tours made from a flight (Offline
 * Flights > New Series, organized tour) whose dates no longer match that flight.
 * A sub-tour without customers follows its flight on its own
 * (lib/tours/flight-sync.ts); the ones listed here had customers when the flight
 * moved, or the flight changed through a path that does not sync. The manager
 * fixes the dates on the sub-tour's card, or moves the flight back.
 */
import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ApprovalsData } from "@/lib/actions/tours-approvals-actions";
import { formatDateShort } from "@/lib/tours/format";
import { blockHref, departureHref, linkClass } from "@/lib/tours/links";
import { Ltr } from "@/components/tours/ui";
import { OpenLink, QueueSection } from "./queue-ui";

const range = (from: string | null, to: string | null) =>
  `${from ? formatDateShort(from) : "-"} – ${to ? formatDateShort(to) : "-"}`;

export function SubToursOffFlight({ data }: { data: ApprovalsData }) {
  const rows = data.subToursOffFlight;
  return (
    <QueueSection
      id="off-flight"
      title="Sub-tours off their flight"
      count={rows.length}
      description="Sub-tours created from a flight whose flight now flies on other days. One without customers follows its flight by itself; these had customers when the flight moved (a task was opened), or the flight changed another way. Change the dates on the sub-tour's card after telling the customers, or move the flight back."
    >
      <Table look="list">
        <TableHeader>
          <TableRow>
            <TableHead>Sub-tour</TableHead>
            <TableHead>Its dates</TableHead>
            <TableHead>The flight flies</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link href={departureHref(row.code, "flights")} className={linkClass}>
                  <Ltr className="font-mono">{row.code}</Ltr>
                </Link>
                {row.packageName && <div className="text-xs text-muted-foreground">{row.packageName}</div>}
              </TableCell>
              <TableCell>{range(row.startDate, row.endDate)}</TableCell>
              <TableCell className="font-medium text-amber-700 dark:text-amber-400">
                {range(row.flightOut, row.flightBack)}
              </TableCell>
              <TableCell className="text-end">
                <OpenLink href={blockHref(row.flightId)}>Flight #{row.flightId}</OpenLink>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </QueueSection>
  );
}
