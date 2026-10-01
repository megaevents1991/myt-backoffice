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
      title="יציאות מפורסמות בלי מחיר"
      count={rows.length}
      description="יציאות עתידיות שמוצגות באתר בלי מחיר למבוגר בחדר זוגי, המחיר שממנו נבנים כרטיס הטיול וכל הרכבי החדרים. מזינים כאן את המחיר לאדם בחדר זוגי, או מסירים את היציאה מהאתר עד שהמחירון ייסגר. את שאר שורות המחירון משלימים בכרטיס היציאה."
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-3 text-xs">יציאה</TableHead>
            <TableHead className="h-9 px-3 text-xs">תאריכים</TableHead>
            <TableHead className="h-9 px-3 text-xs">מחיר לאדם בחדר זוגי</TableHead>
            <TableHead className="h-9 px-3 text-xs">
              <span className="sr-only">פעולות</span>
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
      `המחיר של ${row.code} נשמר`,
    );
  };

  const unpublish = async () => {
    const ok = await confirm({
      title: `להסיר את ${row.code} מהאתר?`,
      description:
        "היציאה תפסיק להופיע באתר אחרי הפרסום הבא לאתר. היא נשארת בלוח היציאות, ואפשר לפרסם אותה שוב אחרי שיוזן לה מחיר.",
      confirmLabel: "הסרה מהאתר",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!ok) return;
    await run(
      unpublishKey,
      async () => {
        const res = await setDeparturesPublished([row.id], false);
        if (res.success && res.data.done.length === 0) {
          return { success: false, error: "היציאה לא נמצאה בחברה הפעילה" };
        }
        return res;
      },
      `${row.code} הוסרה מהאתר`,
    );
  };

  return (
    <TableRow data-departure={row.code}>
      <TableCell className={cell}>
        <Link href={departureHref(row.code, "prices")} className={linkClass} title="פתיחת כרטיס היציאה">
          <Ltr className="font-mono">{row.code}</Ltr>
        </Link>
        {row.packageName && <span className="mr-2 text-sm">{row.packageName}</span>}
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
            חבילת נופש מתומחרת לפי מלון וכרטיס. חסר מלון עם מחיר לחדר זוגי - משלימים בכרטיס היציאה.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label htmlFor={inputId} className="sr-only">
                מחיר לאדם בחדר זוגי ליציאה {row.code}
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
                <span className="text-destructive">מחיר חייב להיות מספר גדול מאפס</span>
              ) : row.seriesPrices ? (
                <>
                  ביציאות אחרות של הסדרה:{" "}
                  <Ltr>
                    {row.seriesPrices.min === row.seriesPrices.max
                      ? `${symbol}${fmtMoney(row.seriesPrices.min)}`
                      : `${symbol}${fmtMoney(row.seriesPrices.min)} - ${symbol}${fmtMoney(row.seriesPrices.max)}`}
                  </Ltr>
                </>
              ) : (
                "אין יציאה אחרת בסדרה עם מחיר במטבע הזה"
              )}
            </div>
          </>
        )}
      </TableCell>
      <TableCell className={cell}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isVacation && (
            <ActionButton actionKey={saveKey} busy={busy} disabled={!valid} onClick={save}>
              שמירת מחיר
            </ActionButton>
          )}
          <ActionButton actionKey={unpublishKey} busy={busy} variant="outline" onClick={() => void unpublish()}>
            הסרה מהאתר
          </ActionButton>
          <OpenLink href={departureHref(row.code, "prices")}>כרטיס היציאה</OpenLink>
        </div>
      </TableCell>
    </TableRow>
  );
}
