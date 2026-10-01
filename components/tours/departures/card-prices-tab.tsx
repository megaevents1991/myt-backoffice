"use client";

/**
 * Card tab "מחירים".
 *
 * Organized trips: the six-row occupancy matrix, with a live preview of the
 * room compositions and the price the customer sees (lib/tours/pricing.ts),
 * the fixed per-passenger discount included.
 * Vacation packages: the selectable parts instead - hotels with double /
 * triple / quad prices, ticket categories, markup.
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Field, Ltr, Notice, selectClass } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { currencySymbol, fmtDate, fmtMoney, parsePrice } from "@/lib/tours/format";
import { cardPrice, pricedRooms, type PriceMatrix } from "@/lib/tours/pricing";
import { CURRENCIES, PRICE_MATRIX_ROWS } from "@/types/tours.types";
import { saveDeparturePrices, saveVacationPricing, updateDeparture } from "@/lib/actions/tours-departure-actions";
import { activeFixedDiscount, isExpired, readRoomPrices, vacationDoublePerPerson } from "./departure-utils";
import type { DepartureCardData, HotelOptionInput, TicketOptionInput } from "./types";

const keyOf = (paxType: string, position: number) => `${paxType}:${position}`;

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select dir="ltr" className={`${selectClass} w-24`} value={value} onChange={(e) => onChange(e.target.value)}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- matrix
function MatrixEditor({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const stored = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of data.prices) out[keyOf(p.pax_type, p.room_position)] = String(p.price);
    return out;
  }, [data.prices]);
  const [draft, setDraft] = useState<Record<string, string>>(stored);
  const [currency, setCurrency] = useState(d.currency);
  const [saving, setSaving] = useState(false);
  const run = useActionToast();
  const readOnly = Boolean(d.is_deleted);

  const parsed =PRICE_MATRIX_ROWS.map((r) => ({ row: r, value: parsePrice(draft[keyOf(r.paxType, r.position)] ?? "") }));
  const invalid = parsed.some((p) => p.value === undefined);
  const dirty =
    currency !== d.currency ||
    PRICE_MATRIX_ROWS.some((r) => {
      const k = keyOf(r.paxType, r.position);
      return (draft[k] ?? "").trim() !== (stored[k] ?? "");
    });

  const matrix: PriceMatrix = {};
  for (const p of parsed) if (typeof p.value === "number") matrix[`${p.row.paxType}:${p.row.position}`] = p.value;

  const fixed = data.promotions.filter((p) => p.is_active && p.kind === "fixed_per_pax");
  const discount = activeFixedDiscount(data.promotions);
  const rooms = pricedRooms(matrix, discount);
  const card = cardPrice(matrix, discount);
  const sym = currencySymbol(currency);

  const save = async () => {
    setSaving(true);
    const result = await run(
      () =>
        saveDeparturePrices(
          d.id,
          parsed.map((p) => ({ paxType: p.row.paxType, position: p.row.position, price: p.value ?? null })),
          currency,
        ),
      "Prices saved",
    );
    setSaving(false);
    if (result.success) await onSaved();
  };

  return (
    <div className="grid gap-6 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <fieldset disabled={readOnly || saving} className="min-w-0 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h3 className="text-sm font-semibold">Price per person by room composition</h3>
          <Field label="Currency">
            <CurrencySelect value={currency} onChange={setCurrency} />
          </Field>
        </div>
        <div className="overflow-hidden rounded-md border">
          {parsed.map(({ row, value }) => {
            const k = keyOf(row.paxType, row.position);
            return (
              <label key={k} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-sm last:border-b-0">
                <span>{row.label}</span>
                <span className="flex items-center gap-1.5">
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    aria-label={row.label}
                    data-price-key={k}
                    className={cn("h-8 w-28 text-end tabular-nums", value === undefined && "border-destructive")}
                    value={draft[k] ?? ""}
                    placeholder="—"
                    onChange={(e) => setDraft((prev) => ({ ...prev, [k]: e.target.value }))}
                  />
                  <span className="w-4 text-xs text-muted-foreground">{sym}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Price source: <strong className="font-medium text-foreground">{d.price_source === "calculator" ? "Calculator" : "Manual"}</strong>. An empty row = no
          price for that composition, and the site won&apos;t offer it.
        </p>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!dirty || invalid} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              Save Prices
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setDraft(stored);
                setCurrency(d.currency);
              }}
            >
              Discard Changes
            </Button>
          </div>
        )}
      </fieldset>

      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-semibold">What the customer sees{dirty ? " (before saving)" : ""}</h3>
        {fixed.length > 0 && (
          <Notice tone="success" className="py-1.5 text-xs">
            Active fixed discount: <Ltr>{fmtMoney(discount)}{sym}</Ltr> per traveler
            {fixed.some((p) => isExpired(p.valid_until)) && (
              <span>
                {" "}
                - the expiry date ({fixed.map((p) => fmtDate(p.valid_until)).filter(Boolean).join(", ")}) has passed, but the site keeps showing it until it is switched off
              </span>
            )}
          </Notice>
        )}
        {rooms.length === 0 ? (
          <Notice tone="warning">No double-room price - no composition can be priced, and the departure can&apos;t be published.</Notice>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm" data-testid="room-preview">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-start font-semibold">Room composition</th>
                  <th className="px-3 py-1.5 text-center font-semibold">Travelers</th>
                  <th className="px-3 py-1.5 text-end font-semibold">Room price</th>
                  {discount > 0 && <th className="px-3 py-1.5 text-end font-semibold">After discount</th>}
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.key} className="border-t" data-room={r.key}>
                    <td className="px-3 py-1.5">
                      {r.title}
                      <span className="ms-2 text-xs text-muted-foreground">{r.summaryLabel}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{r.passengers}</td>
                    <td className={cn("px-3 py-1.5 text-end tabular-nums", discount > 0 && "text-muted-foreground line-through decoration-1")}>
                      <Ltr>{fmtMoney(r.price)}{sym}</Ltr>
                    </td>
                    {discount > 0 && (
                      <td className="px-3 py-1.5 text-end font-semibold tabular-nums text-success">
                        <Ltr>{fmtMoney(r.priceSale)}{sym}</Ltr>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {card.offer != null && (
          <p className="text-xs text-muted-foreground">
            On the date card: from <Ltr className="font-semibold text-foreground">{fmtMoney(card.offer)}{sym}</Ltr> per person in a double room
            {card.regular != null && (
              <>
                {" "}
                instead of <Ltr className="line-through">{fmtMoney(card.regular)}{sym}</Ltr>
              </>
            )}
            .
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- vacation
interface HotelDraft {
  id?: string;
  ref_code: string;
  label: string;
  board: string;
  nights: string;
  double: string;
  triple: string;
  quad: string;
}
interface TicketDraft {
  id?: string;
  label: string;
  price: string;
}

const s = (v: string | number | null | undefined): string => (v == null ? "" : String(v));

function VacationEditor({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const initial = useMemo(() => {
    const hotels: HotelDraft[] = data.options
      .filter((o) => o.kind === "hotel")
      .map((o) => {
        const rp = readRoomPrices(o.room_prices);
        return {
          id: o.id,
          ref_code: s(o.ref_code),
          label: s(o.label),
          board: s(o.board),
          nights: s(o.nights),
          double: s(rp.double),
          triple: s(rp.triple),
          quad: s(rp.quad),
        };
      });
    const tickets: TicketDraft[] = data.options
      .filter((o) => o.kind === "ticket")
      .map((o) => ({ id: o.id, label: s(o.label), price: s(o.price) }));
    return { hotels, tickets, markup_percent: s(d.markup_percent), markup_fixed: s(d.markup_fixed), currency: d.currency };
  }, [data.options, d.markup_percent, d.markup_fixed, d.currency]);

  const [hotels, setHotels] = useState<HotelDraft[]>(initial.hotels);
  const [tickets, setTickets] = useState<TicketDraft[]>(initial.tickets);
  const [markupPercent, setMarkupPercent] = useState(initial.markup_percent);
  const [markupFixed, setMarkupFixed] = useState(initial.markup_fixed);
  const [currency, setCurrency] = useState(initial.currency);
  const [saving, setSaving] = useState(false);
  const run = useActionToast();
  const readOnly = Boolean(d.is_deleted);
  const sym = currencySymbol(currency);

  const dirty =
    JSON.stringify({ hotels, tickets, markup_percent: markupPercent, markup_fixed: markupFixed, currency }) !== JSON.stringify(initial);

  const numbers = [
    ...hotels.flatMap((h) => [h.double, h.triple, h.quad, h.nights]),
    ...tickets.map((t) => t.price),
    markupPercent,
    markupFixed,
  ];
  const invalid = numbers.some((n) => parsePrice(n) === undefined);
  const num = (v: string): number | null => parsePrice(v) ?? null;

  const perPerson = vacationDoublePerPerson({
    options: [
      ...hotels.map((h, i) => ({ kind: "hotel", position: i + 1, price: null, room_prices: { double: num(h.double) } })),
      ...tickets.map((t, i) => ({ kind: "ticket", position: i + 1, price: num(t.price), room_prices: null })),
    ],
    flight_mode: d.flight_mode,
    flight_price: d.flight_price,
    markup_fixed: num(markupFixed),
  });

  const setHotel = (index: number, patch: Partial<HotelDraft>) =>
    setHotels((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  const setTicket = (index: number, patch: Partial<TicketDraft>) =>
    setTickets((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const save = async () => {
    setSaving(true);
    const hotelRows: HotelOptionInput[] = hotels.map((h) => ({
      id: h.id,
      ref_code: h.ref_code.trim() || null,
      label: h.label.trim() || null,
      board: h.board.trim() || null,
      nights: num(h.nights),
      double: num(h.double),
      triple: num(h.triple),
      quad: num(h.quad),
    }));
    const ticketRows: TicketOptionInput[] = tickets.map((t) => ({ id: t.id, label: t.label.trim() || null, price: num(t.price) }));
    const result = await run(
      () =>
        saveVacationPricing(d.id, {
          hotels: hotelRows,
          tickets: ticketRows,
          markup_percent: num(markupPercent),
          markup_fixed: num(markupFixed),
        }),
      "Prices saved",
    );
    if (result.success && currency !== d.currency) await run(() => updateDeparture(d.id, { currency }));
    setSaving(false);
    if (result.success) await onSaved();
  };

  const priceInput = (value: string, onChange: (v: string) => void, label: string) => (
    <Input
      dir="ltr"
      inputMode="decimal"
      aria-label={label}
      className={cn("h-8 w-20 text-end tabular-nums", parsePrice(value) === undefined && "border-destructive")}
      value={value}
      placeholder="—"
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <fieldset disabled={readOnly || saving} className="min-w-0 space-y-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Vacation package: hotels, tickets and markup</h3>
          <p className="text-xs text-muted-foreground">
            The first row of each table is the site default. The rest show as a price difference. Price source:{" "}
            <strong className="font-medium text-foreground">{d.price_source === "calculator" ? "Calculator" : "Manual"}</strong>.
          </p>
        </div>
        <Field label="Currency">
          <CurrencySelect value={currency} onChange={setCurrency} />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground">Hotels (room price for the whole stay)</h4>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setHotels((prev) => [...prev, { ref_code: "", label: "", board: "", nights: "", double: "", triple: "", quad: "" }])}
          >
            <Plus />
            Add Hotel
          </Button>
        </div>
        {hotels.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No hotels. Without a hotel with a double-room price the departure can&apos;t be published.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-start font-semibold">Hotel</th>
                  <th className="px-2 py-1.5 text-start font-semibold">Board basis</th>
                  <th className="px-2 py-1.5 text-start font-semibold">Nights</th>
                  <th className="px-2 py-1.5 text-start font-semibold">Double</th>
                  <th className="px-2 py-1.5 text-start font-semibold">Triple</th>
                  <th className="px-2 py-1.5 text-start font-semibold">Quad</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {hotels.map((h, i) => {
                  const known = data.hotels.some((x) => x.code === h.ref_code);
                  return (
                    <tr key={h.id ?? `new-${i}`} className="border-t align-top">
                      <td className="px-2 py-1.5">
                        <select
                          dir="ltr"
                          aria-label="Hotel"
                          className={`${selectClass} h-8 w-52 max-w-full`}
                          value={h.ref_code}
                          onChange={(e) => setHotel(i, { ref_code: e.target.value })}
                        >
                          <option value="">Select a hotel…</option>
                          {!known && h.ref_code && <option value={h.ref_code}>{h.ref_code} (not in catalog)</option>}
                          {data.hotels.map((x) => (
                            <option key={x.code} value={x.code}>
                              {x.name}
                              {x.city ? ` · ${x.city}` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input dir="auto" aria-label="Board basis" className="h-8 w-28" value={h.board} onChange={(e) => setHotel(i, { board: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          dir="ltr"
                          inputMode="numeric"
                          aria-label="Nights"
                          className="h-8 w-14 text-end"
                          value={h.nights}
                          onChange={(e) => setHotel(i, { nights: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">{priceInput(h.double, (v) => setHotel(i, { double: v }), "Double-room price")}</td>
                      <td className="px-2 py-1.5">{priceInput(h.triple, (v) => setHotel(i, { triple: v }), "Triple-room price")}</td>
                      <td className="px-2 py-1.5">{priceInput(h.quad, (v) => setHotel(i, { quad: v }), "Quad-room price")}</td>
                      <td className="px-1 py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Remove hotel"
                          onClick={() => setHotels((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground">Tickets (price per person)</h4>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTickets((prev) => [...prev, { label: "", price: "" }])}>
            <Plus />
            Add Ticket Category
          </Button>
        </div>
        {tickets.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No tickets on this departure.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            {tickets.map((t, i) => (
              <div key={t.id ?? `new-${i}`} className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
                <Input
                  dir="auto"
                  aria-label="Ticket category"
                  className="h-8 flex-1"
                  value={t.label}
                  placeholder="Category name, e.g. lower tier"
                  onChange={(e) => setTicket(i, { label: e.target.value })}
                />
                {priceInput(t.price, (v) => setTicket(i, { price: v }), "Ticket price")}
                <span className="w-4 text-xs text-muted-foreground">{sym}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="Remove ticket"
                  onClick={() => setTickets((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Markup %">
          {priceInput(markupPercent, setMarkupPercent, "Markup percent")}
        </Field>
        <Field label={`Fixed markup per traveler (${sym})`}>{priceInput(markupFixed, setMarkupFixed, "Fixed markup")}</Field>
        <Field label="Flight" hint="Edited in the General tab">
          <span className="flex h-8 items-center text-sm">
            {d.flight_mode === "priced" ? (
              <Ltr>
                {fmtMoney(d.flight_price)}
                {sym}
              </Ltr>
            ) : d.flight_mode === "included" ? (
              "Included in the price"
            ) : (
              "No flight"
            )}
          </span>
        </Field>
      </div>

      {perPerson == null ? (
        <Notice tone="warning">No hotel with a double-room price - the departure can&apos;t be published.</Notice>
      ) : (
        <Notice tone="info" className="text-xs">
          &quot;From&quot; price per person in a double room:{" "}
          <Ltr className="text-sm font-semibold">
            {fmtMoney(perPerson)}
            {sym}
          </Ltr>{" "}
          = half a double room in the first hotel + the first ticket{d.flight_mode === "priced" ? " + flight" : ""} + fixed markup. The markup % is
          saved but not part of this calculation.
        </Notice>
      )}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!dirty || invalid} onClick={save}>
            {saving && <Loader2 className="animate-spin" />}
            Save Prices
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty}
            onClick={() => {
              setHotels(initial.hotels);
              setTickets(initial.tickets);
              setMarkupPercent(initial.markup_percent);
              setMarkupFixed(initial.markup_fixed);
              setCurrency(initial.currency);
            }}
          >
            Discard Changes
          </Button>
        </div>
      )}
    </fieldset>
  );
}

export function CardPricesTab({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const vacation = data.package?.kind === "vacation";
  // The editors keep a draft; remount them when the stored prices change under them (another tab, a bulk action).
  const version = JSON.stringify([data.prices, data.options]);
  if (vacation) {
    return (
      <>
        <VacationEditor key={`v-${version}`} data={data} onSaved={onSaved} />
        {data.prices.length > 0 && <MatrixEditor key={`m-${version}`} data={data} onSaved={onSaved} />}
      </>
    );
  }
  return <MatrixEditor key={`m-${version}`} data={data} onSaved={onSaved} />;
}
