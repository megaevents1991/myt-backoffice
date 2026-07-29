"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// qty/unit_price stay RAW STRINGS while typing (repo convention — cf.
// creative-form.tsx `price`): coercing to number on every keystroke makes
// decimals untypable ("199.99" → 19999). Parsed only for the running-total
// display and once at submit.
type LineItemRow = {
  label: string;
  qty: string;
  unit_price: string;
  _key: number;
  /** Seeded from the event's package price — the row the baseline applies to. */
  fromEvent?: boolean;
};

export function QuoteForm({
  events,
  terms,
}: {
  events: QuoteEventOption[];
  /** The agent's commission, used to show their discount ceiling. */
  terms: { type: CommissionType; rate: number } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  // null = nothing chosen yet (placeholder shown); "" = explicit "ללא אירוע";
  // otherwise the string id of the selected event.
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");

  // Stable per-row keys (not array index) so removing a middle row doesn't
  // shift focus/state onto the wrong input.
  const nextKeyRef = useRef(0);
  const newKey = () => nextKeyRef.current++;
  const [lineItems, setLineItems] = useState<LineItemRow[]>(() => [
    { label: "", qty: "1", unit_price: "0", _key: newKey() },
  ]);

  const selectedEvent =
    eventId && eventId !== "" ? events.find((e) => String(e.id) === eventId) : undefined;

  const eventTriggerLabel =
    eventId === null ? "בחר אירוע..." : eventId === "" ? "ללא אירוע" : selectedEvent?.name ?? "בחר אירוע...";

  const onEventSelect = (value: string) => {
    setEventId(value);
    setEventOpen(false);
    if (!value) return; // "ללא אירוע" — leave title/line items as-is (free-form quote).
    const event = events.find((e) => String(e.id) === value);
    if (!event) return;
    if (!titleTouched) {
      setTitle(`הצעת מחיר — ${event.name}`);
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
  // their own commission — that is worth knowing before sending, not after.
  //
  // The suggested price is PER TRAVELLER, so it is scaled by the package row's
  // quantity. Comparing it to the whole total would tell a partner quoting a
  // family of four at the system price that they had added three packages of
  // margin.
  const packageRow = lineItems.find((item) => item.fromEvent);
  const packageQty = Number(packageRow?.qty);
  const basePrice =
    selectedEvent?.suggested_price != null && Number.isFinite(packageQty) && packageQty > 0
      ? selectedEvent.suggested_price * packageQty
      : null;
  const delta = basePrice == null ? null : Math.round((total - basePrice) * 100) / 100;

  // An agent may give away their own commission and no more. Mirrors the
  // server rule in createQuote — this copy is the warning, that one is the gate.
  // Per traveller, matching the server. For a percentage the commission is
  // paid on the DISCOUNTED price, so the largest legal discount d solves
  // d = (base - d) * r/100  →  d = base*r / (100 + r).
  const baseUnit = selectedEvent?.suggested_price ?? null;
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

    // Parse the string row state into QuoteLineItem[] once, here — reject
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
        notes: notes.trim() || null,
        valid_until: validUntil || null,
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
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <Label>שורות</Label>
        <div className="space-y-2">
          {lineItems.map((item) => (
            <div key={item._key} className="flex items-end gap-2">
              <div className="flex-1">
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeLineItem(item._key)}
                aria-label="הסר שורה"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
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
                ? `הורדתם ${usd.format(Math.abs(delta))} — הסכום יירד מהעמלה שלכם`
                : `הוספתם ${usd.format(delta)} — הסכום יתווסף לעמלה שלכם`}
            </div>
          )}
          {/* The server refuses a discount larger than the commission — say so
              here rather than letting them finish the quote and be rejected. */}
          {maxDiscountPerTraveller != null &&
            discountPerTraveller != null &&
            discountPerTraveller > maxDiscountPerTraveller && (
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
  );
}
