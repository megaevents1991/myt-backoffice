"use client";

/**
 * Section 3 of the approvals screen: hotel rows of vacation departures whose
 * code is not a hotel of the company's catalog. The import kept the sheet's own
 * code on the row; a person who knows the hotels picks the catalog hotel it
 * stands for, and the row is pointed at it (setHotelOptionCatalogCode).
 */
import { useState } from "react";
import Link from "next/link";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  setHotelOptionCatalogCode,
  type ApprovalsData,
  type CatalogHotel,
  type UnmatchedHotelOption,
} from "@/lib/actions/tours-approvals-actions";
import { formatDateShort, formatNumber } from "@/lib/tours/format";
import { departureHref, linkClass } from "@/lib/tours/links";
import { Ltr } from "@/components/tours/ui";
import { ActionButton, OpenLink, QueueSection, type QueueControls } from "./queue-ui";

export function UnmatchedHotels({ data, run, busy }: QueueControls & { data: ApprovalsData }) {
  const rows = data.unmatchedHotels;
  return (
    <QueueSection
      id="hotels"
      title="Hotels not in catalog"
      count={rows.length}
      description="Hotel rows on vacation-package departures whose sheet code matches no hotel in the hotel catalog, so the site does not know which hotel to show. Pick the right hotel from the catalog and save; a hotel missing from the catalog is added first on the Hotels screen."
    >
      <Table look="list">
        <TableHeader>
          <TableRow>
            <TableHead>Departure</TableHead>
            <TableHead>Sheet Code</TableHead>
            <TableHead>Room Prices</TableHead>
            <TableHead>Catalog Hotel</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <HotelRow key={row.optionId} row={row} catalog={data.hotelCatalog} run={run} busy={busy} />
          ))}
        </TableBody>
      </Table>
      {data.hotelCatalog.length === 0 && (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          The hotel catalog is empty.{" "}
          <Link href="/tours/hotels" className={linkClass}>
            Go to Hotels
          </Link>
        </p>
      )}
    </QueueSection>
  );
}

function HotelRow({
  row,
  catalog,
  run,
  busy,
}: QueueControls & { row: UnmatchedHotelOption; catalog: CatalogHotel[] }) {
  const [code, setCode] = useState(row.suggestedCode ?? "");
  const key = `hotel:${row.optionId}`;
  const sheetCode = row.refCode ?? row.label;
  const prices = [
    row.roomPrices.double !== null ? `Double ${formatNumber(row.roomPrices.double)}` : null,
    row.roomPrices.triple !== null ? `Triple ${formatNumber(row.roomPrices.triple)}` : null,
    row.roomPrices.quad !== null ? `Quad ${formatNumber(row.roomPrices.quad)}` : null,
  ].filter((p): p is string => p !== null);
  const chosen = catalog.find((h) => h.code === code);

  return (
    <TableRow data-option-id={row.optionId}>
      <TableCell>
        <Link href={departureHref(row.departureCode, "prices")} className={linkClass} title="Open the departure card">
          <Ltr className="font-mono">{row.departureCode}</Ltr>
        </Link>
        {row.packageName && <span className="ms-2 text-sm">{row.packageName}</span>}
        <div className="mt-0.5 text-xs text-muted-foreground">
          <Ltr>
            {formatDateShort(row.startDate)} - {formatDateShort(row.endDate)}
          </Ltr>
          {" · "}
          {row.isPast ? "Already returned" : row.isPublished ? "Published" : "Not published"}
        </div>
      </TableCell>
      <TableCell>
        {sheetCode ? <Ltr className="font-mono text-[0.9em]">{sheetCode}</Ltr> : <span className="text-muted-foreground">No code</span>}
        <div className="mt-0.5 text-xs text-muted-foreground">
          Hotel {row.position} of the departure
          {row.board && <> · {row.board}</>}
          {row.nights !== null && <> · {row.nights} nights</>}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {prices.length > 0 ? (
          <>
            {prices.join(" · ")}
            {row.currency && <Ltr className="ms-1.5 text-xs text-muted-foreground">{row.currency}</Ltr>}
          </>
        ) : (
          <span className="text-muted-foreground">No prices</span>
        )}
      </TableCell>
      <TableCell className="w-[22rem] max-w-[22rem]">
        <Select value={code} onValueChange={setCode} disabled={busy !== null || catalog.length === 0}>
          <SelectTrigger className="h-9" aria-label={`Catalog hotel for ${sheetCode ?? row.departureCode}`}>
            <SelectValue placeholder="Pick a catalog hotel" />
          </SelectTrigger>
          <SelectContent>
            {catalog.map((hotel) => (
              <SelectItem key={hotel.code} value={hotel.code}>
                {hotel.name}
                {hotel.city ? `, ${hotel.city}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosen && (
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {row.suggestedCode === chosen.code && "Suggested from a similar code, check it is the right hotel · "}
            <Ltr className="font-mono">{chosen.code}</Ltr>
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionButton
            actionKey={key}
            busy={busy}
            disabled={!chosen}
            onClick={() =>
              void run(
                key,
                () => setHotelOptionCatalogCode(row.optionId, code),
                `Hotel updated on ${row.departureCode}`,
              )
            }
          >
            Save
          </ActionButton>
          <OpenLink href={departureHref(row.departureCode, "prices")}>Departure Card</OpenLink>
        </div>
      </TableCell>
    </TableRow>
  );
}
