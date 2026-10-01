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
import { formatDateShort } from "@/lib/tours/deadlines";
import { Ltr, formatNumber } from "@/components/tours/flights/block-ui";
import { ActionButton, OpenLink, QueueSection, departureHref, linkClass, type QueueControls } from "./queue-ui";

export function UnmatchedHotels({ data, run, busy }: QueueControls & { data: ApprovalsData }) {
  const rows = data.unmatchedHotels;
  return (
    <QueueSection
      id="hotels"
      title="מלונות של חבילות נופש שלא נמצאו בקטלוג"
      count={rows.length}
      description="שורות מלון ביציאות של חבילות נופש שהקוד שלהן בגיליון לא תואם אף מלון בקטלוג המלונות, ולכן האתר לא יודע איזה מלון להציג. בוחרים את המלון הנכון מהקטלוג ושומרים; מלון שחסר בקטלוג מוסיפים קודם במסך המלונות."
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-3 text-xs">יציאה</TableHead>
            <TableHead className="h-9 px-3 text-xs">הקוד בגיליון</TableHead>
            <TableHead className="h-9 px-3 text-xs">מחירי החדרים</TableHead>
            <TableHead className="h-9 px-3 text-xs">המלון בקטלוג</TableHead>
            <TableHead className="h-9 px-3 text-xs">
              <span className="sr-only">פעולות</span>
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
          קטלוג המלונות של החברה ריק.{" "}
          <Link href="/tours/hotels" className={linkClass}>
            למסך המלונות
          </Link>
        </p>
      )}
    </QueueSection>
  );
}

const cell = "px-3 py-2 align-top";

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
    row.roomPrices.double !== null ? `זוגי ${formatNumber(row.roomPrices.double)}` : null,
    row.roomPrices.triple !== null ? `טריפל ${formatNumber(row.roomPrices.triple)}` : null,
    row.roomPrices.quad !== null ? `רביעייה ${formatNumber(row.roomPrices.quad)}` : null,
  ].filter((p): p is string => p !== null);
  const chosen = catalog.find((h) => h.code === code);

  return (
    <TableRow data-option-id={row.optionId}>
      <TableCell className={cell}>
        <Link href={departureHref(row.departureCode, "prices")} className={linkClass} title="פתיחת כרטיס היציאה">
          <Ltr className="font-mono">{row.departureCode}</Ltr>
        </Link>
        {row.packageName && <span className="mr-2 text-sm">{row.packageName}</span>}
        <div className="mt-0.5 text-xs text-muted-foreground">
          <Ltr>
            {formatDateShort(row.startDate)} - {formatDateShort(row.endDate)}
          </Ltr>
          {" · "}
          {row.isPast ? "היציאה כבר חזרה" : row.isPublished ? "מפורסמת" : "לא מפורסמת"}
        </div>
      </TableCell>
      <TableCell className={cell}>
        {sheetCode ? <Ltr className="font-mono text-[0.9em]">{sheetCode}</Ltr> : <span className="text-muted-foreground">אין קוד</span>}
        <div className="mt-0.5 text-xs text-muted-foreground">
          מלון {row.position} ביציאה
          {row.board && <> · {row.board}</>}
          {row.nights !== null && <> · {row.nights} לילות</>}
        </div>
      </TableCell>
      <TableCell className={`${cell} whitespace-nowrap`}>
        {prices.length > 0 ? (
          <>
            {prices.join(" · ")}
            {row.currency && <Ltr className="mr-1.5 text-xs text-muted-foreground">{row.currency}</Ltr>}
          </>
        ) : (
          <span className="text-muted-foreground">בלי מחירים</span>
        )}
      </TableCell>
      <TableCell className={`${cell} w-[22rem] max-w-[22rem]`}>
        <Select dir="rtl" value={code} onValueChange={setCode} disabled={busy !== null || catalog.length === 0}>
          <SelectTrigger className="h-9" aria-label={`המלון בקטלוג של ${sheetCode ?? row.departureCode}`}>
            <SelectValue placeholder="בחרו מלון מהקטלוג" />
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
            {row.suggestedCode === chosen.code && "הוצע לפי דמיון הקוד, בדקו שזה המלון · "}
            <Ltr className="font-mono">{chosen.code}</Ltr>
          </div>
        )}
      </TableCell>
      <TableCell className={cell}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionButton
            actionKey={key}
            busy={busy}
            disabled={!chosen}
            onClick={() =>
              void run(
                key,
                () => setHotelOptionCatalogCode(row.optionId, code),
                `המלון ביציאה ${row.departureCode} עודכן`,
              )
            }
          >
            שמירה
          </ActionButton>
          <OpenLink href={departureHref(row.departureCode, "prices")}>כרטיס היציאה</OpenLink>
        </div>
      </TableCell>
    </TableRow>
  );
}
