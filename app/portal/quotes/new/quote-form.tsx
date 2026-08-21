"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  createQuote,
  type QuoteEventOption,
  type QuoteLineItem,
} from "@/lib/actions/quote-actions";
import type { CommissionType } from "@/types/partner.types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatEventDate(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("he-IL");
}

// qty/unit_price stay RAW STRINGS while typing (repo convention - cf.
// creative-form.tsx `price`): coercing to number on every keystroke makes
// decimals untypable ("199.99" → 19999). Parsed only for the running-total
// display and once at submit.
type LineItemRow = {
  label: string;
  qty: string;
  unit_price: string;
  _key: number;
  /** Seeded from the event's package price - the row the baseline applies to. */
  fromEvent?: boolean;
};

export interface QuotePrefill {
  /** The prepared package the quote is built from - its id rides to the
   *  server so the discount baseline is the package price, not the event's. */
  packageId: number;
  eventId: number;
  qty: number;
  note: string;
  /** The package's coded order link - offered as the PDF's pay CTA. */
  paymentLink: string;
  /** Per-traveller price of the package composition (the seeded unit price
   *  AND the baseline the discount is measured against). */
  unitPrice: number | null;
}

export function QuoteForm({
  events,
  terms,
  prefill = null,
}: {
  events: QuoteEventOption[];
  /** The agent's commission, used to show their discount ceiling. */
  terms: { type: CommissionType; rate: number } | null;
  /** Seeded from a prepared package ("שלח הצעה ללקוח"). */
  prefill?: QuotePrefill | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  // A prefill only sticks when its event is still quotable (in the list).
  const prefillEvent = prefill
    ? events.find((e) => e.id === prefill.eventId) ?? null
    : null;

  // null = nothing chosen yet (placeholder shown); "" = explicit "ללא אירוע";
  // otherwise the string id of the selected event.
  const [eventId, setEventId] = useState<string | null>(
    prefillEvent ? String(prefillEvent.id) : null,
  );
  const [eventOpen, setEventOpen] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [title, setTitle] = useState(
    prefillEvent ? `הצעת מחיר - ${prefillEvent.name}` : "",
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [notes, setNotes] = useState(prefill?.note ?? "");
  const [validUntil, setValidUntil] = useState("");
  // Attach the package's order link to the PDF - the agent may switch the
  // offer to information-only instead.
  const [includeLink, setIncludeLink] = useState(!!prefill?.paymentLink);

  // Stable per-row keys (not array index) so removing a middle row doesn't
  // shift focus/state onto the wrong input.
  const nextKeyRef = useRef(0);
  const newKey = () => nextKeyRef.current++;
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() =>
    prefillEvent
      ? [
          {
            label: `חבילה: ${prefillEvent.name}`,
            qty: String(prefill?.qty ?? 1),
            // The package's own composition price when seeded from one - the
            // generic event price overstated no-flight packages (H5).
            unit_price: String(
              prefill?.unitPrice ?? prefillEvent.suggested_price ?? 0,
            ),
            _key: newKey(),
            fromEvent: true,
          },
        ]
      : [{ label: "", qty: "1", unit_price: "0", _key: newKey() }],
  );

  // Discount UI for the package row (QA-6): mode + raw input, same
  // string-while-typing convention as qty/unit_price above. Component-level,
  // not per-row - there is only ever one `fromEvent` row at a time.
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [discountInput, setDiscountInput] = useState("0");

  const selectedEvent =
    eventId && eventId !== "" ? events.find((e) => String(e.id) === eventId) : undefined;

  const eventTriggerLabel =
    eventId === null ? "בחר אירוע..." : eventId === "" ? "ללא אירוע" : selectedEvent?.name ?? "בחר אירוע...";

  const onEventSelect = (value: string) => {
    setEventId(value);
    setEventOpen(false);
    if (!value) return; // "ללא אירוע" - leave title/line items as-is (free-form quote).
    const event = events.find((e) => String(e.id) === value);
    if (!event) return;
    if (!titleTouched) {
      setTitle(`הצעת מחיר - ${event.name}`);
    }
    setLineItems([
      {
        label: `חבילה: ${event.name}`,
        qty: "1",
        unit_price: String(event.suggested_price ?? 0),
        _key: newKey(),
        fromEvent: true,
      },
    ]);
    // A discount typed against the PREVIOUS event's price no longer means
    // anything against this one's - reset to "no discount" rather than
    // silently reapplying a stale $/% figure to the new baseline.
    setDiscountInput("0");
  };

  const updateLineItem = (key: number, patch: Partial<Omit<LineItemRow, "_key">>) => {
    setLineItems((current) =>
      current.map((item) => (item._key === key ? { ...item, ...patch } : item)),
    );
  };

  const addLineItem = () => {
    setLineItems((current) => [
      ...current,
      { label: "", qty: "1", unit_price: "0", _key: newKey() },
    ]);
  };

  const removeLineItem = (key: number) => {
    setLineItems((current) => current.filter((item) => item._key !== key));
  };

  // Display-only parse; invalid/in-progress input counts as 0 until fixed.
  const total = lineItems.reduce((sum, item) => {
    const qty = Number(item.qty);
    const price = Number(item.unit_price);
    return Number.isFinite(qty) && Number.isFinite(price) ? sum + qty * price : sum;
  }, 0);

  // What the partner is giving up or adding versus the system price. Shown
  // while they type, because under the agreement the difference comes out of
  // their own commission - that is worth knowing before sending, not after.
  //
  // The suggested price is PER TRAVELLER, so it is scaled by the package row's
  // quantity. Comparing it to the whole total would tell a partner quoting a
  // family of four at the system price that they had added three packages of
  // margin.
  const packageRow = lineItems.find((item) => item.fromEvent);
  const packageQty = Number(packageRow?.qty);

  // The prefill's package baseline holds only while its event stays selected -
  // switching events falls back to that event's generic price.
  const packagePrefillActive =
    prefill != null && eventId === String(prefill.eventId);
  const baseUnit = packagePrefillActive
    ? (prefill.unitPrice ?? selectedEvent?.suggested_price ?? null)
    : (selectedEvent?.suggested_price ?? null);

  const basePrice =
    baseUnit != null && Number.isFinite(packageQty) && packageQty > 0
      ? baseUnit * packageQty
      : null;
  const delta = basePrice == null ? null : Math.round((total - basePrice) * 100) / 100;

  // An agent may give away their own commission and no more. Mirrors the
  // server rule in createQuote - this copy is the warning, that one is the gate.
  // Per traveller, matching the server. For a percentage the commission is
  // paid on the DISCOUNTED price, so the largest legal discount d solves
  // d = (base - d) * r/100  →  d = base*r / (100 + r).
  const maxDiscountPerTraveller =
    baseUnit == null || !terms
      ? null
      : Math.round(
          (terms.type === "percent_of_sale"
            ? (baseUnit * terms.rate) / (100 + terms.rate)
            : terms.rate) * 100
        ) / 100;

  const packageUnitPrice = Number(packageRow?.unit_price);
  const discountPerTraveller =
    baseUnit == null || !Number.isFinite(packageUnitPrice)
      ? null
      : Math.round((baseUnit - packageUnitPrice) * 100) / 100;

  // Same cap, expressed as a % of the package price - the discount input's
  // ceiling when the agent is working in percent mode.
  const maxDiscountPercent =
    maxDiscountPerTraveller == null || baseUnit == null || baseUnit <= 0
      ? null
      : Math.round(((maxDiscountPerTraveller / baseUnit) * 100) * 100) / 100;

  const maxDiscountForMode =
    discountMode === "percent" ? maxDiscountPercent : maxDiscountPerTraveller;

  // Switching $ <-> % keeps the same effective discount instead of resetting
  // to 0, so toggling mid-entry doesn't throw away what the agent typed.
  const switchDiscountMode = (nextMode: "amount" | "percent") => {
    if (nextMode === discountMode) return;
    if (baseUnit != null && baseUnit > 0) {
      const current = Number(discountInput);
      if (Number.isFinite(current)) {
        const converted =
          nextMode === "percent" ? (current / baseUnit) * 100 : (current / 100) * baseUnit;
        setDiscountInput(String(Math.round(converted * 100) / 100));
      }
    }
    setDiscountMode(nextMode);
  };

  // The discount input can never go PAST the agent's commission cap (QA-6 #2)
  // - clamped here on every keystroke rather than only warned about after the
  // fact. Mirrors the server's own math (createQuote), which re-validates
  // independently against whatever unit_price actually lands in the DB.
  const applyDiscount = (key: number, raw: string, mode: "amount" | "percent") => {
    setDiscountInput(raw);
    if (baseUnit == null) return;
    const num = Number(raw);
    if (!raw.trim() || !Number.isFinite(num)) return; // mid-typing - leave unit_price as last valid value
    const max = mode === "percent" ? maxDiscountPercent : maxDiscountPerTraveller;
    const clamped = max != null ? Math.min(num, max) : num;
    if (clamped !== num) setDiscountInput(String(clamped));
    const finalPrice =
      mode === "percent" ? baseUnit * (1 - clamped / 100) : baseUnit - clamped;
    updateLineItem(key, { unit_price: String(Math.max(0, Math.round(finalPrice * 100) / 100)) });
  };

  const onSubmit = () => {
    const trimmedCustomer = customerName.trim();
    const trimmedTitle = title.trim();

    if (!trimmedCustomer) {
      toast({ variant: "destructive", title: "שדה חובה", description: "יש למלא שם לקוח." });
      return;
    }
    if (!trimmedTitle) {
      toast({ variant: "destructive", title: "שדה חובה", description: "יש למלא כותרת." });
      return;
    }
    if (lineItems.length === 0) {
      toast({
        variant: "destructive",
        title: "אין שורות",
        description: "יש להוסיף לפחות שורה אחת.",
      });
      return;
    }

    // Parse the string row state into QuoteLineItem[] once, here - reject
    // invalid rows instead of silently clamping them.
    const parsedItems: QuoteLineItem[] = [];
    for (const item of lineItems) {
      const qty = Number(item.qty);
      const unit_price = Number(item.unit_price);
      if (!item.qty.trim() || !Number.isInteger(qty) || qty < 1) {
        toast({
          variant: "destructive",
          title: "כמות לא תקינה",
          description: "כמות חייבת להיות מספר שלם של 1 ומעלה.",
        });
        return;
      }
      if (!item.unit_price.trim() || !Number.isFinite(unit_price) || unit_price < 0) {
        toast({
          variant: "destructive",
          title: "מחיר לא תקין",
          description: "מחיר יחידה חייב להיות מספר 0 ומעלה.",
        });
        return;
      }
      parsedItems.push({ label: item.label, qty, unit_price });
    }

    startTransition(async () => {
      const result = await createQuote({
        event_id: eventId && eventId !== "" ? Number(eventId) : null,
        customer_name: trimmedCustomer,
        title: trimmedTitle,
        line_items: parsedItems,
        // Sent explicitly so the server measures the discount against the
        // package row itself rather than guessing which row that is.
        package:
          packageRow && Number.isFinite(packageUnitPrice)
            ? { qty: Number(packageRow.qty) || 1, unit_price: packageUnitPrice }
            : null,
        // The server re-derives the package's composition price as the
        // baseline - the id is a pointer, never a price.
        package_id: packagePrefillActive ? prefill.packageId : null,
        notes: notes.trim() || null,
        valid_until: validUntil || null,
        payment_link:
          prefill?.paymentLink && includeLink ? prefill.paymentLink : null,
      });

      if (!result.ok) {
        toast({ variant: "destructive", title: "שגיאה", description: result.error });
        return;
      }

      toast({ title: "הצעת המחיר נוצרה" });
      router.push("/portal/quotes");
    });
  };

  return (
    // Provider for the disabled-trash tooltip on the package row below.
    <TooltipProvider>
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">הצעת מחיר חדשה</h1>
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <div>
          <Label>אירוע</Label>
          <Popover open={eventOpen} onOpenChange={setEventOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={eventOpen}
                className="w-full justify-between font-normal"
              >
                {eventTriggerLabel}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="חפש לפי שם, עיר או תאריך..." />
                <CommandList>
                  <CommandEmpty>לא נמצאו אירועים</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="none|ללא אירוע" onSelect={() => onEventSelect("")}>
                      ללא אירוע
                    </CommandItem>
                    {events.map((event) => (
                      <CommandItem
                        key={event.id}
                        value={`${event.id}|${event.name} ${event.location ?? ""} ${event.date ?? ""}`}
                        onSelect={() => onEventSelect(String(event.id))}
                      >
                        <div className="flex flex-col">
                          <span>{event.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatEventDate(event.date)}
                            {event.location ? ` · ${event.location}` : ""}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <Label htmlFor="qf-customer">שם לקוח</Label>
          <Input
            id="qf-customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="qf-title">כותרת</Label>
          <Input
            id="qf-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
          />
        </div>

        <div>
          <Label htmlFor="qf-notes">הערות</Label>
          <Textarea id="qf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="qf-valid-until">בתוקף עד</Label>
          <Input
            id="qf-valid-until"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="w-48"
          />
        </div>

        {prefill?.paymentLink && (
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">לינק להרשמה ותשלום ב-PDF</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {includeLink
                  ? "ההצעה תכלול כפתור שמוביל את הלקוח ישר לחבילה באתר, על הקוד שלכם."
                  : "הצעה למידע בלבד - בלי לינק תשלום."}
              </p>
            </div>
            <Switch checked={includeLink} onCheckedChange={setIncludeLink} />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <Label>שורות</Label>
        <div className="space-y-2">
          {lineItems.map((item) => {
            const isPackageRow = item.fromEvent === true;
            // Without a known baseline (no suggested_price on the event)
            // there is nothing to discount against - fall back to a plain,
            // directly-editable price like any other row.
            const showDiscountUi = isPackageRow && baseUnit != null;
            return (
              <div key={item._key} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <Label
                    htmlFor={`qf-li-${item._key}-label`}
                    className="text-xs text-muted-foreground"
                  >
                    תיאור
                  </Label>
                  <Input
                    id={`qf-li-${item._key}-label`}
                    value={item.label}
                    onChange={(e) => updateLineItem(item._key, { label: e.target.value })}
                  />
                </div>
                <div className="w-20">
                  <Label
                    htmlFor={`qf-li-${item._key}-qty`}
                    className="text-xs text-muted-foreground"
                  >
                    כמות
                  </Label>
                  <Input
                    id={`qf-li-${item._key}-qty`}
                    type="number"
                    min={1}
                    step={1}
                    value={item.qty}
                    onChange={(e) => updateLineItem(item._key, { qty: e.target.value })}
                  />
                </div>

                {showDiscountUi ? (
                  <div className="w-60">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Label
                        htmlFor={`qf-li-${item._key}-discount`}
                        className="text-xs text-muted-foreground"
                      >
                        הנחה
                      </Label>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        value={discountMode}
                        onValueChange={(v) => v && switchDiscountMode(v as "amount" | "percent")}
                        className="gap-0.5"
                      >
                        <ToggleGroupItem
                          value="amount"
                          className="h-6 px-2 text-xs"
                          aria-label="הנחה בדולרים"
                        >
                          $
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          value="percent"
                          className="h-6 px-2 text-xs"
                          aria-label="הנחה באחוזים"
                        >
                          %
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <Input
                      id={`qf-li-${item._key}-discount`}
                      type="number"
                      min={0}
                      step={discountMode === "percent" ? 1 : 0.01}
                      value={discountInput}
                      onChange={(e) => applyDiscount(item._key, e.target.value, discountMode)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {maxDiscountForMode != null &&
                        `עד ${
                          discountMode === "percent"
                            ? `${maxDiscountForMode}%`
                            : usd.format(maxDiscountForMode)
                        } לנוסע`}
                      {discountMode === "percent" &&
                        ` · מחיר סופי: ${usd.format(Number(item.unit_price) || 0)} לנוסע`}
                    </p>
                  </div>
                ) : (
                  <div className="w-28">
                    <Label
                      htmlFor={`qf-li-${item._key}-price`}
                      className="text-xs text-muted-foreground"
                    >
                      מחיר יחידה ($)
                    </Label>
                    <Input
                      id={`qf-li-${item._key}-price`}
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(item._key, { unit_price: e.target.value })}
                    />
                  </div>
                )}

                {isPackageRow ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* A disabled button alone won't fire the hover events
                          Radix's tooltip trigger needs - wrap it in a span. */}
                      <span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled
                          aria-label="לא ניתן להסיר את שורת הבסיס של החבילה"
                          className="cursor-not-allowed opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>שורת הבסיס של החבילה</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLineItem(item._key)}
                    aria-label="הסר שורה"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
          <Plus className="ml-2 h-4 w-4" />
          הוסף שורה
        </Button>

        <div className="space-y-1 border-t pt-3">
          <div className="flex justify-end text-lg font-bold">
            סה&quot;כ: {usd.format(total)}
          </div>
          {basePrice != null && (
            <div className="flex justify-end text-sm text-muted-foreground">
              מחיר המערכת: {usd.format(basePrice)}
              {packageQty > 1 && ` (${packageQty} × ${usd.format(basePrice / packageQty)})`}
            </div>
          )}
          {delta != null && delta !== 0 && (
            <div
              className={`flex justify-end text-sm font-medium ${
                delta < 0 ? "text-destructive" : "text-foreground"
              }`}
            >
              {delta < 0
                ? `הורדתם ${usd.format(Math.abs(delta))} - הסכום יירד מהעמלה שלכם`
                : `הוספתם ${usd.format(delta)} - הסכום יתווסף לעמלה שלכם`}
            </div>
          )}
          {/* Defensive display only - the discount input above is clamped to
              this same cap, so this should never actually fire. Kept as a
              safety net (e.g. float rounding) with the server's own epsilon. */}
          {maxDiscountPerTraveller != null &&
            discountPerTraveller != null &&
            discountPerTraveller > maxDiscountPerTraveller + 0.001 && (
              <div className="flex justify-end text-sm font-medium text-destructive">
                ההנחה המקסימלית שלכם היא{" "}
                {usd.format(maxDiscountPerTraveller)} לנוסע
              </div>
            )}
        </div>
      </div>

      <Button onClick={onSubmit} disabled={isPending} className="w-full">
        {isPending ? "שומר..." : "צור הצעת מחיר"}
      </Button>
    </div>
    </TooltipProvider>
  );
}
