"use client";

/**
 * One departure on the board. Memoised: the board holds a few hundred of these
 * (a few thousand later), and an edit must re-render one row, not the table.
 * Every callback it receives is stable and takes the row, so the props of the
 * untouched rows stay identical between renders.
 */
import { memo, useEffect, useRef, useState } from "react";
import { CalendarDays, Clock, Loader2, Shuffle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTE_TYPE_LABELS, departureRouteLabel, routeType } from "@/lib/tours/routes";
import { BLOCK_STATUS_LABELS, type BlockStatus, type SaleStatus } from "@/types/tours.types";
import {
  activeFixedDiscount,
  currencySymbol,
  doublePricePerPerson,
  effectiveRoute,
  fmtDateRange,
  fmtMoney,
  isExpired,
  nightsBetween,
  parsePrice,
  promotionSummary,
  suggestedSaleStatus,
} from "./departure-utils";
import type { BoardRow, BoardSeries } from "./types";
import { Chip, Ltr, SaleStatusBadge, SaleStatusSelect, Toggle } from "./ui-bits";
import { SALE_STATUS_LABELS } from "@/types/tours.types";

export type CardTab = "general" | "prices" | "promotions" | "flights" | "sales";

export interface BoardRowProps {
  row: BoardRow;
  series: BoardSeries | undefined;
  /** Names of the holiday periods the trip touches, one per line. Empty = none. */
  holidays: string;
  selected: boolean;
  busy: boolean;
  isPast: boolean;
  today: string;
  priceEditing: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: (row: BoardRow, tab?: CardTab) => void;
  onPublish: (row: BoardRow, next: boolean) => void;
  onSaleStatus: (row: BoardRow, next: SaleStatus) => void;
  onLabels: (row: BoardRow, labels: string[]) => void;
  onPriceEdit: (id: string | null) => void;
  /** `next` = also move the editor to the row below (Enter), like a spreadsheet. */
  onDoublePrice: (row: BoardRow, price: number | null, next: boolean) => void;
  /**
   * A sales agent's view: no checkbox, no publish toggle, no docket, nothing
   * editable in place. The cells that opened an editor open the card instead.
   */
  readOnly?: boolean;
}

const cell = "px-1.5 py-1.5 align-middle";

function PriceEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: number | null;
  onCommit: (price: number | null, next: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial == null ? "" : String(initial));
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = (next: boolean) => {
    if (done.current) return;
    const parsed = parsePrice(value);
    if (parsed === undefined) {
      setBad(true);
      return;
    }
    done.current = true;
    if (parsed === initial) {
      if (next) onCommit(parsed, true);
      else onCancel();
      return;
    }
    onCommit(parsed, next);
  };
  return (
    <input
      ref={ref}
      dir="ltr"
      inputMode="decimal"
      aria-label="מחיר לאדם בחדר זוגי"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        setBad(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => commit(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(true);
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      className={cn(
        "h-7 w-20 rounded border bg-background px-1.5 text-end text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2",
        bad ? "border-destructive focus-visible:ring-destructive" : "border-input focus-visible:ring-ring",
      )}
    />
  );
}

function LabelsEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string[];
  onCommit: (labels: string[]) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial.join(", "));
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => ref.current?.focus(), []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const labels = Array.from(new Set(value.split(",").map((l) => l.trim()).filter(Boolean)));
    if (labels.join("|") === initial.join("|")) onCancel();
    else onCommit(labels);
  };
  return (
    <input
      ref={ref}
      list="tours-date-label-suggestions"
      aria-label="תגיות תאריך, מופרדות בפסיק"
      placeholder="תגית, תגית"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      className="h-7 w-44 rounded border border-input bg-background px-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function BoardRowImpl({
  row,
  series,
  holidays,
  selected,
  busy,
  isPast,
  today,
  priceEditing,
  onSelect,
  onOpen,
  onPublish,
  onSaleStatus,
  onLabels,
  onPriceEdit,
  onDoublePrice,
  readOnly = false,
}: BoardRowProps) {
  const [editingLabels, setEditingLabels] = useState(false);
  const deleted = Boolean(row.is_deleted);
  /** Cells that edit in place do nothing of the kind on a deleted row or for a read-only viewer. */
  const locked = deleted || readOnly;
  const route = effectiveRoute(row, series);
  const type = routeType(route.arrival_airport, route.return_airport);
  const routeLabel = departureRouteLabel(route.arrival_airport, route.return_airport);
  const inheritedRoute = !row.arrival_airport || !row.return_airport;
  const nights = nightsBetween(row.start_date, row.end_date);

  // A read-only viewer gets the finished price from the server (it has no options or markup to derive it from).
  const { price: double, derived } = row.doublePrice ?? doublePricePerPerson(row);
  const discount = activeFixedDiscount(row.promotions);
  const sym = currencySymbol(row.currency);

  const liveFlights = row.flights.filter((f) => f.isLive);
  const noLiveFlight = row.stats.liveBlocks === 0;
  const suggestion = suggestedSaleStatus({
    sale_status: row.sale_status,
    allocated: row.stats.allocated,
    remaining: row.stats.remaining,
  });

  const firstPromotion = row.promotions[0];

  return (
    <tr
      data-state={selected ? "selected" : undefined}
      data-code={row.code}
      className={cn(
        "border-b text-[13px] transition-colors hover:bg-muted/50 data-[state=selected]:bg-accent/60",
        (isPast || deleted) && "text-muted-foreground",
      )}
    >
      {!readOnly && (
        <td className={cn(cell, "w-8 ps-2")}>
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
            checked={selected}
            aria-label={`בחירת ${row.code}`}
            onChange={(e) => onSelect(row.id, e.target.checked)}
          />
        </td>
      )}

      {!readOnly && (
        <td className={cn(cell, "w-12")}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Toggle
              size="sm"
              checked={row.is_published}
              disabled={deleted}
              label={row.is_published ? "מפורסם באתר - לחצו להסרה" : "לא מפורסם - לחצו לפרסום"}
              onChange={(next) => onPublish(row, next)}
            />
          )}
        </td>
      )}

      <td className={cn(cell, "whitespace-nowrap", readOnly && "ps-3")}>
        <button
          type="button"
          onClick={() => onOpen(row)}
          title="פתיחת כרטיס היציאה"
          className={cn(
            "rounded font-mono text-[13px] font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            deleted && "text-muted-foreground line-through",
          )}
        >
          <Ltr>{row.code}</Ltr>
        </button>
        {deleted && <Chip className="ms-1 border-destructive/30 bg-destructive/10 text-destructive">מחוקה</Chip>}
      </td>

      <td className={cn(cell, "whitespace-nowrap tabular-nums")}>
        <Ltr>{fmtDateRange(row.start_date, row.end_date)}</Ltr>
        {holidays && (
          <span title={holidays} className="ms-1 inline-flex align-middle text-warning" aria-label={`חג או חופשה: ${holidays}`}>
            <CalendarDays className="h-3.5 w-3.5" />
          </span>
        )}
      </td>

      <td className={cn(cell, "text-center tabular-nums")}>{nights ?? ""}</td>

      <td className={cn(cell, "whitespace-nowrap")}>
        {routeLabel ? (
          <Ltr
            className={cn("font-mono text-xs", inheritedRoute && "text-muted-foreground")}
            title={inheritedRoute ? "המסלול נלקח מהסדרה" : undefined}
          >
            {routeLabel}
          </Ltr>
        ) : (
          <span className="text-xs text-destructive">אין מסלול</span>
        )}
        {type === "open_jaw" && (
          <span
            title={ROUTE_TYPE_LABELS.open_jaw}
            aria-label={ROUTE_TYPE_LABELS.open_jaw}
            className="ms-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-info/30 bg-info-muted align-middle text-info"
          >
            <Shuffle className="h-3 w-3" />
          </span>
        )}
      </td>

      <td className={cn(cell, "whitespace-nowrap")}>{row.season ?? ""}</td>

      <td className={cell}>
        {readOnly ? (
          <SaleStatusBadge status={row.sale_status} />
        ) : (
          <SaleStatusSelect value={row.sale_status} disabled={deleted || busy} onChange={(next) => onSaleStatus(row, next)} />
        )}
      </td>

      <td
        className={cn(cell, "min-w-24 max-w-52", !locked && "cursor-text")}
        onClick={() => !locked && !editingLabels && setEditingLabels(true)}
        title={locked ? undefined : "לחצו לעריכת תגיות התאריך"}
      >
        {editingLabels ? (
          <LabelsEditor
            initial={row.date_labels}
            onCancel={() => setEditingLabels(false)}
            onCommit={(labels) => {
              setEditingLabels(false);
              onLabels(row, labels);
            }}
          />
        ) : row.date_labels.length || row.card_badge ? (
          <span className="flex flex-wrap gap-1">
            {row.card_badge && (
              <Chip
                className="border-destructive/30 bg-destructive/10 text-destructive"
                title={readOnly ? "תגית הכרטיס באתר" : "תגית הכרטיס - נערכת בכרטיס היציאה"}
              >
                {row.card_badge}
              </Chip>
            )}
            {row.date_labels.map((l) => (
              <Chip key={l}>{l}</Chip>
            ))}
          </span>
        ) : readOnly ? null : (
          <span className="text-muted-foreground/50">+</span>
        )}
      </td>

      <td className={cn(cell, "text-center text-xs")}>
        <Ltr>{row.currency}</Ltr>
      </td>

      <td
        className={cn(cell, "whitespace-nowrap text-end tabular-nums", !deleted && "cursor-pointer")}
        onClick={() => {
          if (deleted || priceEditing) return;
          if (derived || readOnly) onOpen(row, "prices");
          else onPriceEdit(row.id);
        }}
        title={
          deleted
            ? undefined
            : readOnly
              ? "מחיר לאדם בחדר זוגי. לחצו לכל המחירים."
              : derived
              ? "חבילת נופש: המחיר מחושב ממלון, כרטיס, טיסה ו-markup. לחצו לפתיחת לשונית המחירים."
              : "מחיר לאדם בחדר זוגי - לחצו לעריכה, Enter עובר לשורה הבאה"
        }
      >
        {priceEditing ? (
          <PriceEditor
            initial={row.prices["adult:2"] ?? null}
            onCancel={() => onPriceEdit(null)}
            onCommit={(price, next) => onDoublePrice(row, price, next)}
          />
        ) : double == null ? (
          <span className="text-xs font-medium text-destructive">אין מחיר</span>
        ) : (
          <span className="inline-flex flex-col items-end leading-tight">
            <Ltr className={cn("font-medium", discount > 0 && "text-muted-foreground line-through decoration-1", derived && "italic")}>
              {derived ? "~" : ""}
              {fmtMoney(double)}
              {sym}
            </Ltr>
            {discount > 0 && (
              <Ltr className="font-semibold text-success">
                {fmtMoney(double - discount)}
                {sym}
              </Ltr>
            )}
          </span>
        )}
      </td>

      <td className={cn(cell, "max-w-40")}>
        {firstPromotion ? (
          <button
            type="button"
            onClick={() => onOpen(row, "promotions")}
            title={row.promotions
              .map(
                (p) =>
                  `${promotionSummary(p, row.currency)}${p.valid_until ? ` (עד ${p.valid_until.split("-").reverse().join(".")}${isExpired(p.valid_until, today) ? ", פג תוקף" : ""})` : ""}${p.scope === "series" ? " - מהסדרה" : ""}`,
              )
              .join("\n")}
            className="flex max-w-full items-center gap-1 text-start text-xs hover:underline"
          >
            <span className="truncate">{promotionSummary(firstPromotion, row.currency)}</span>
            {row.promotions.length > 1 && <Chip className="px-1.5">+{row.promotions.length - 1}</Chip>}
            {row.promotions.some((p) => isExpired(p.valid_until, today)) && (
              <span className="inline-flex shrink-0 text-warning" aria-label="תאריך התפוגה עבר, ההטבה עדיין פעילה">
                <Clock className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        ) : null}
      </td>

      <td className={cn(cell, "whitespace-nowrap")}>
        <button type="button" onClick={() => onOpen(row, "flights")} className="text-start text-xs hover:underline">
          {readOnly ? (
            // The viewer gets live blocks only, and no block status.
            noLiveFlight ? (
              <span className="text-muted-foreground">יעודכן</span>
            ) : (
              <span>
                <Ltr className="font-mono font-semibold">{Array.from(new Set(liveFlights.map((f) => f.airline))).join("+")}</Ltr>
                {liveFlights.length > 1 && <span className="text-muted-foreground"> ×{liveFlights.length}</span>}
              </span>
            )
          ) : noLiveFlight ? (
            <span className="font-semibold text-destructive">
              אין טיסה
              {row.flights.length > 0 && (
                <span className="ms-1 font-normal text-muted-foreground">
                  ({Array.from(new Set(row.flights.map((f) => BLOCK_STATUS_LABELS[f.blockStatus as BlockStatus] ?? "טיוטה"))).join(", ")})
                </span>
              )}
            </span>
          ) : (
            <span>
              <Ltr className="font-mono font-semibold">{Array.from(new Set(liveFlights.map((f) => f.airline))).join("+")}</Ltr>
              {liveFlights.length > 1 && <span className="text-muted-foreground"> ×{liveFlights.length}</span>}
              <span className="ms-1 text-muted-foreground">
                {Array.from(new Set(liveFlights.map((f) => BLOCK_STATUS_LABELS[f.blockStatus as BlockStatus] ?? ""))).join(", ")}
              </span>
            </span>
          )}
        </button>
      </td>

      <td className={cn(cell, "whitespace-nowrap text-center tabular-nums")}>
        <button
          type="button"
          // The sales tab is staff only; the viewer's card opens on the flights (the seats sit there).
          onClick={() => onOpen(row, readOnly ? "flights" : "sales")}
          title={
            readOnly
              ? `מקומות ${row.stats.allocated} · נמכרו ${row.stats.sold} · נשארו ${row.stats.remaining}`
              : `משויכים ${row.stats.allocated} · נמכרו ${row.stats.sold} · יתרה ${row.stats.remaining}`
          }
          className="hover:underline"
        >
          <Ltr>
            {row.stats.allocated} / {row.stats.sold} /{" "}
            <span
              className={cn(
                "font-semibold",
                row.stats.remaining < 0 ? "text-destructive" : row.stats.allocated > 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {row.stats.remaining}
            </span>
          </Ltr>
        </button>
        {suggestion && !readOnly && (
          <span
            className="ms-1 inline-flex align-middle text-warning"
            title={`לפי היתרה כדאי לשקול לשנות את סטטוס המכירה ל"${SALE_STATUS_LABELS[suggestion]}"`}
          >
            <TriangleAlert className="h-3.5 w-3.5" />
          </span>
        )}
      </td>

      {!readOnly && (
        <td className={cn(cell, "pe-2 text-xs tabular-nums")} title={row.docket_no ?? undefined}>
          <Ltr className="block max-w-[3.5rem] truncate">{row.docket_no ?? ""}</Ltr>
        </td>
      )}
    </tr>
  );
}

export const BoardRowView = memo(BoardRowImpl);
