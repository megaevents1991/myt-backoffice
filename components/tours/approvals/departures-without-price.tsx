"use client";

/**
 * Section 4 of the approvals screen: departures that are on the site with no
 * price for an adult in a double room - the price every card and every room
 * composition is built from. The manager types the price here
 * (saveDeparturePrices) or takes the departure off the site
 * (setDeparturesPublished), the same two actions the departure card uses.
 */
import { useState } from "react";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/components/confirm-provider";
import { saveDeparturePrices, setDeparturesPublished } from "@/lib/actions/tours-departure-actions";
import type { ApprovalsData, DepartureWithoutPrice } from "@/lib/actions/tours-approvals-actions";
import { daysBetween, formatDateShort } from "@/lib/tours/deadlines";
import { currencySymbol, fmtMoney, parsePrice } from "@/components/tours/departures/departure-utils";
import { Ltr } from "@/components/tours/flights/block-ui";
import {
  ActionButton,
  OpenLink,
  QueueSection,
  departureHref,
  inDays,
  linkClass,
  type QueueControls,
} from "./queue-ui";

export function DeparturesWithoutPrice({ data, run, busy }: QueueControls & { data: ApprovalsData }) {
  const rows = data.departuresWithoutPrice;
  return (
    <QueueSection
      id="no-price"
      title="Published with no price"
      count={rows.length}
      description="Upcoming departures shown on the site with no price for an adult in a double room - the price the tour card and every room combination are built from. Enter the per-person double-room price here, or take the departure off the site until its price list is settled. The other price rows are filled in on the departure card."
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-3 text-xs">Departure</TableHead>
            <TableHead className="h-9 px-3 text-xs">Dates</TableHead>
            <TableHead className="h-9 px-3 text-xs">Price per Person, Double Room</TableHead>
            <TableHead className="h-9 px-3 text-xs">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <PriceRow key={row.id} row={row} today={data.today} run={run} busy={busy} />
          ))}
        </TableBody>
      </Table>
    </QueueSection>
  );
}

const cell = "px-3 py-2 align-top";

function PriceRow({ row, today, run, busy }: QueueControls & { row: DepartureWithoutPrice; today: string }) {
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const price = parsePrice(text);
  const valid = typeof price === "number" && price > 0;
  const symbol = currencySymbol(row.currency);
  const isVacation = row.packageKind === "vacation";
  const saveKey = `price:${row.id}`;
  const unpublishKey = `unpublish:${row.id}`;
  const inputId = `price-${row.id}`;

  const save = () => {
    if (typeof price !== "number" || price <= 0) return;
    void run(
      saveKey,
      () => saveDeparturePrices(row.id, [{ paxType: "adult", position: 2, price }]),
      `Price saved for ${row.code}`,
    );
  };

  const unpublish = async () => {
    const ok = await confirm({
      title: `Take ${row.code} off the site?`,
      description:
        "The departure stops showing on the site after the next site publish. It stays on the departures board and can be published again once it has a price.",
      confirmLabel: "Take Off Site",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    await run(
      unpublishKey,
      async () => {
        const res = await setDeparturesPublished([row.id], false);
        if (res.success && res.data.done.length === 0) {
          return { success: false, error: "The departure was not found in the active company" };
        }
        return res;
      },
      `${row.code} taken off the site`,
    );
  };

  return (
    <TableRow data-departure={row.code}>
      <TableCell className={cell}>
        <Link href={departureHref(row.code, "prices")} className={linkClass} title="Open the departure card">
          <Ltr className="font-mono">{row.code}</Ltr>
        </Link>
        {row.packageName && <span className="ms-2 text-sm">{row.packageName}</span>}
      </TableCell>
      <TableCell className={`${cell} whitespace-nowrap`}>
        <Ltr>
          {formatDateShort(row.startDate)} - {formatDateShort(row.endDate)}
        </Ltr>
        <div className="mt-0.5 text-xs text-muted-foreground">{inDays(daysBetween(today, row.startDate))}</div>
      </TableCell>
      <TableCell className={cell}>
        {isVacation ? (
          <p className="max-w-[44ch] text-sm text-muted-foreground">
            A vacation package is priced by hotel and ticket. A hotel with a double-room price is missing - add it on the
            departure card.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label htmlFor={inputId} className="sr-only">
                Per-person double-room price for {row.code}
              </label>
              <Input
                id={inputId}
                dir="ltr"
                inputMode="decimal"
                placeholder="0"
                className="h-9 w-28 tabular-nums"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid && busy === null) save();
                }}
                disabled={busy !== null}
                aria-invalid={text.trim() !== "" && !valid}
              />
              <Ltr className="text-sm text-muted-foreground">{row.currency ?? ""}</Ltr>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {text.trim() !== "" && !valid ? (
                <span className="text-destructive">The price must be a number above zero</span>
              ) : row.seriesPrices ? (
                <>
                  Other departures in the series:{" "}
                  <Ltr>
                    {row.seriesPrices.min === row.seriesPrices.max
                      ? `${symbol}${fmtMoney(row.seriesPrices.min)}`
                      : `${symbol}${fmtMoney(row.seriesPrices.min)} - ${symbol}${fmtMoney(row.seriesPrices.max)}`}
                  </Ltr>
                </>
              ) : (
                "No other departure in the series has a price in this currency"
              )}
            </div>
          </>
        )}
      </TableCell>
      <TableCell className={cell}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isVacation && (
            <ActionButton actionKey={saveKey} busy={busy} disabled={!valid} onClick={save}>
              Save Price
            </ActionButton>
          )}
          <ActionButton actionKey={unpublishKey} busy={busy} variant="outline" onClick={() => void unpublish()}>
            Take Off Site
          </ActionButton>
          <OpenLink href={departureHref(row.code, "prices")}>Departure Card</OpenLink>
        </div>
      </TableCell>
    </TableRow>
  );
}
