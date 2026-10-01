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
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { cardPrice, pricedRooms, type PriceMatrix } from "@/lib/tours/pricing";
import { CURRENCIES, PRICE_MATRIX_ROWS } from "@/types/tours.types";
import { saveDeparturePrices, saveVacationPricing, updateDeparture } from "@/lib/actions/tours-departure-actions";
import {
  activeFixedDiscount,
  currencySymbol,
  fmtDate,
  fmtMoney,
  isExpired,
  parsePrice,
  readRoomPrices,
  vacationDoublePerPerson,
} from "./departure-utils";
import type { DepartureCardData, HotelOptionInput, TicketOptionInput } from "./types";
import { Field, Ltr, Notice, selectClass } from "./ui-bits";

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
  const readOnly = Boolean(d.is_deleted);

  const parsed = PRICE_MATRIX_ROWS.map((r) => ({ row: r, value: parsePrice(draft[keyOf(r.paxType, r.position)] ?? "") }));
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
    const result = await saveDeparturePrices(
      d.id,
      parsed.map((p) => ({ paxType: p.row.paxType, position: p.row.position, price: p.value ?? null })),
      currency,
    );
    setSaving(false);
    if (!result.success) {
      toast.error(result.error, { duration: 7000 });
      return;
    }
    toast.success("המחירים נשמרו");
    await onSaved();
  };

  return (
    <div className="grid gap-6 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <fieldset disabled={readOnly || saving} className="min-w-0 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h3 className="text-sm font-semibold">מחיר לאדם לפי הרכב החדר</h3>
          <Field label="מטבע">
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
          מקור המחיר: <strong className="font-medium text-foreground">{d.price_source === "calculator" ? "מחשבון" : "ידני"}</strong>. שורה ריקה = אין מחיר
          להרכב הזה, והוא לא יוצע באתר.
        </p>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!dirty || invalid} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              שמירת מחירים
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
              ביטול השינויים
            </Button>
          </div>
        )}
      </fieldset>

      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-semibold">מה הלקוח רואה{dirty ? " (לפני שמירה)" : ""}</h3>
        {fixed.length > 0 && (
          <Notice tone="success" className="py-1.5 text-xs">
            הנחה קבועה פעילה: <Ltr>{fmtMoney(discount)}{sym}</Ltr> לנוסע
            {fixed.some((p) => isExpired(p.valid_until)) && (
              <span>
                {" "}
                - תאריך התפוגה ({fixed.map((p) => fmtDate(p.valid_until)).filter(Boolean).join(", ")}) עבר, אבל האתר ממשיך להציג אותה עד שתכובה
              </span>
            )}
          </Notice>
        )}
        {rooms.length === 0 ? (
          <Notice tone="warning">אין מחיר לחדר זוגי - אף הרכב לא ניתן לתמחור, והיציאה לא ניתנת לפרסום.</Notice>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm" data-testid="room-preview">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-start font-semibold">הרכב</th>
                  <th className="px-3 py-1.5 text-center font-semibold">נוסעים</th>
                  <th className="px-3 py-1.5 text-end font-semibold">מחיר לחדר</th>
                  {discount > 0 && <th className="px-3 py-1.5 text-end font-semibold">אחרי הנחה</th>}
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
            על כרטיס התאריך: החל מ-<Ltr className="font-semibold text-foreground">{fmtMoney(card.offer)}{sym}</Ltr> לאדם בחדר זוגי
            {card.regular != null && (
              <>
                {" "}
                במקום <Ltr className="line-through">{fmtMoney(card.regular)}{sym}</Ltr>
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
    const result = await saveVacationPricing(d.id, {
      hotels: hotelRows,
      tickets: ticketRows,
      markup_percent: num(markupPercent),
      markup_fixed: num(markupFixed),
    });
    if (result.success && currency !== d.currency) {
      const currencyResult = await updateDeparture(d.id, { currency });
      if (!currencyResult.success) toast.error(currencyResult.error);
    }
    setSaving(false);
    if (!result.success) {
      toast.error(result.error, { duration: 7000 });
      return;
    }
    toast.success("המחירים נשמרו");
    await onSaved();
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
          <h3 className="text-sm font-semibold">חבילת נופש: מלונות, כרטיסים ו-markup</h3>
          <p className="text-xs text-muted-foreground">
            השורה הראשונה בכל טבלה היא ברירת המחדל באתר. השאר מוצגות כהפרש מחיר. מקור המחיר:{" "}
            <strong className="font-medium text-foreground">{d.price_source === "calculator" ? "מחשבון" : "ידני"}</strong>.
          </p>
        </div>
        <Field label="מטבע">
          <CurrencySelect value={currency} onChange={setCurrency} />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground">מלונות (מחיר לחדר לכל השהות)</h4>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setHotels((prev) => [...prev, { ref_code: "", label: "", board: "", nights: "", double: "", triple: "", quad: "" }])}
          >
            <Plus />
            מלון
          </Button>
        </div>
        {hotels.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">אין מלונות. בלי מלון עם מחיר לחדר זוגי היציאה לא ניתנת לפרסום.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-start font-semibold">מלון</th>
                  <th className="px-2 py-1.5 text-start font-semibold">בסיס אירוח</th>
                  <th className="px-2 py-1.5 text-start font-semibold">לילות</th>
                  <th className="px-2 py-1.5 text-start font-semibold">זוגי</th>
                  <th className="px-2 py-1.5 text-start font-semibold">טריפל</th>
                  <th className="px-2 py-1.5 text-start font-semibold">רביעייה</th>
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
                          aria-label="מלון"
                          className={`${selectClass} h-8 w-52 max-w-full`}
                          value={h.ref_code}
                          onChange={(e) => setHotel(i, { ref_code: e.target.value })}
                        >
                          <option value="">בחרו מלון…</option>
                          {!known && h.ref_code && <option value={h.ref_code}>{h.ref_code} (לא בקטלוג)</option>}
                          {data.hotels.map((x) => (
                            <option key={x.code} value={x.code}>
                              {x.name}
                              {x.city ? ` · ${x.city}` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label="בסיס אירוח" className="h-8 w-28" value={h.board} onChange={(e) => setHotel(i, { board: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          dir="ltr"
                          inputMode="numeric"
                          aria-label="לילות"
                          className="h-8 w-14 text-end"
                          value={h.nights}
                          onChange={(e) => setHotel(i, { nights: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">{priceInput(h.double, (v) => setHotel(i, { double: v }), "מחיר חדר זוגי")}</td>
                      <td className="px-2 py-1.5">{priceInput(h.triple, (v) => setHotel(i, { triple: v }), "מחיר חדר טריפל")}</td>
                      <td className="px-2 py-1.5">{priceInput(h.quad, (v) => setHotel(i, { quad: v }), "מחיר חדר רביעייה")}</td>
                      <td className="px-1 py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="הסרת המלון"
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
          <h4 className="text-xs font-semibold text-muted-foreground">כרטיסים (מחיר לאדם)</h4>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTickets((prev) => [...prev, { label: "", price: "" }])}>
            <Plus />
            קטגוריית כרטיס
          </Button>
        </div>
        {tickets.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">אין כרטיסים ביציאה הזו.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            {tickets.map((t, i) => (
              <div key={t.id ?? `new-${i}`} className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
                <Input
                  aria-label="קטגוריית כרטיס"
                  className="h-8 flex-1"
                  value={t.label}
                  placeholder="שם הקטגוריה, למשל ישיבה תחתונה"
                  onChange={(e) => setTicket(i, { label: e.target.value })}
                />
                {priceInput(t.price, (v) => setTicket(i, { price: v }), "מחיר כרטיס")}
                <span className="w-4 text-xs text-muted-foreground">{sym}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="הסרת הכרטיס"
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
        <Field label="Markup באחוזים">
          {priceInput(markupPercent, setMarkupPercent, "markup באחוזים")}
        </Field>
        <Field label={`Markup קבוע לנוסע (${sym})`}>{priceInput(markupFixed, setMarkupFixed, "markup קבוע")}</Field>
        <Field label="טיסה" hint="נערך בלשונית כללי">
          <span className="flex h-8 items-center text-sm">
            {d.flight_mode === "priced" ? (
              <Ltr>
                {fmtMoney(d.flight_price)}
                {sym}
              </Ltr>
            ) : d.flight_mode === "included" ? (
              "כלולה במחיר"
            ) : (
              "ללא טיסה"
            )}
          </span>
        </Field>
      </div>

      {perPerson == null ? (
        <Notice tone="warning">אין מלון עם מחיר לחדר זוגי - היציאה לא ניתנת לפרסום.</Notice>
      ) : (
        <Notice tone="info" className="text-xs">
          מחיר &quot;החל מ&quot; לאדם בחדר זוגי:{" "}
          <Ltr className="text-sm font-semibold">
            {fmtMoney(perPerson)}
            {sym}
          </Ltr>{" "}
          = חצי חדר זוגי במלון הראשון + הכרטיס הראשון{d.flight_mode === "priced" ? " + טיסה" : ""} + markup קבוע. ה-markup באחוזים נשמר ואינו נכנס
          לחישוב הזה.
        </Notice>
      )}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!dirty || invalid} onClick={save}>
            {saving && <Loader2 className="animate-spin" />}
            שמירת מחירים
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
            ביטול השינויים
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
