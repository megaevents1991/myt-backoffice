"use client";

/**
 * Contract and costs of a flight block.
 *
 * Contract: one of the company's airline contracts - its day offsets drive the
 * block's deadlines, its wording is the reference for every seat change.
 * Costs: adult fare, child fare and tax per seat; potential = what the original
 * order would have cost, actual = what the seats held today cost.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  setTourBlockContract,
  updateTourBlockCosts,
  type TourBlockData,
} from "@/lib/actions/tours-flight-actions";
import { CURRENCIES } from "@/types/tours.types";
import {
  Field,
  Ltr,
  Notice,
  Section,
  Stat,
  formatMoney,
  parseNumber,
  type RunAction,
} from "@/components/tours/flights/block-ui";

interface SectionProps {
  data: TourBlockData;
  run: RunAction;
}

export const CONTRACT_KIND_LABELS: Record<string, string> = {
  series_contract: "חוזה סדרה",
  closed_group: "קבוצה סגורה",
};

export const COMMITMENT_UNIT_LABELS: Record<string, string> = {
  per_group: "לקבוצה",
  per_pax: "לנוסע",
  pct_of_fare: "אחוז מהמחיר",
};

const NO_CONTRACT = "__none__";

const daysText = (days: number | null) => (days === null ? "לא הוגדר" : `${days} ימים לפני היציאה`);

export function BlockContractSection({ data, run }: SectionProps) {
  const { block, contract } = data;
  const [saving, setSaving] = useState(false);

  const change = async (value: string) => {
    setSaving(true);
    await run(() => setTourBlockContract(block.id, value === NO_CONTRACT ? null : value), "החוזה עודכן");
    setSaving(false);
  };

  return (
    <Section
      title="חוזה"
      description="החוזה קובע כמה ימים לפני היציאה חל כל מועד. החלפת חוזה לא משנה מועדים שכבר הוזנו."
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/tours/contracts">כל החוזים</Link>
        </Button>
      }
    >
      <Field label="החוזה של הבלוק">
        <Select dir="rtl" value={block.contract_id ?? NO_CONTRACT} onValueChange={change} disabled={saving}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CONTRACT}>בלי חוזה</SelectItem>
            {data.contracts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.airline_group ? ` · ${c.airline_group}` : ""}
                {c.is_active ? "" : " (לא פעיל)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {contract ? (
        <div className="mt-3 grid gap-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground">סוג</dt>
            <dd>{CONTRACT_KIND_LABELS[contract.kind] ?? contract.kind}</dd>
            <dt className="text-muted-foreground">ביטול ראשון</dt>
            <dd>{daysText(contract.cxx1_days_before)}</dd>
            <dt className="text-muted-foreground">ביטול אחרון</dt>
            <dd>{daysText(contract.cxx2_days_before)}</dd>
            <dt className="text-muted-foreground">שמות</dt>
            <dd>{daysText(contract.names_days_before)}</dd>
            <dt className="text-muted-foreground">כרטוס</dt>
            <dd>{daysText(contract.ticketing_days_before)}</dd>
            {contract.commitment_amount !== null && (
              <>
                <dt className="text-muted-foreground">התחייבות</dt>
                <dd>
                  <Ltr>
                    {contract.commitment_unit === "pct_of_fare"
                      ? `${contract.commitment_amount}%`
                      : formatMoney(contract.commitment_amount, contract.currency)}
                  </Ltr>{" "}
                  {contract.commitment_unit ? (COMMITMENT_UNIT_LABELS[contract.commitment_unit] ?? "") : ""}
                </dd>
              </>
            )}
            {contract.name_change_fee !== null && (
              <>
                <dt className="text-muted-foreground">שינוי שם</dt>
                <dd>
                  <Ltr>{formatMoney(contract.name_change_fee, contract.currency)}</Ltr>
                </dd>
              </>
            )}
          </dl>
          <div>
            <div className="mb-1 font-medium">נוסח מקורי</div>
            {contract.terms_text?.trim() ? (
              <div
                className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed [unicode-bidi:plaintext] text-right"
              >
                {contract.terms_text}
              </div>
            ) : data.sourceTerms?.trim() ? (
              <details className="rounded-md border bg-muted/30 p-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  לחוזה הזה לא הוזן נוסח. להצגת מסמך המקור של תנאי הביטול וההתחייבות
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed [unicode-bidi:plaintext] text-right">
                  {data.sourceTerms}
                </div>
              </details>
            ) : (
              <span className="text-muted-foreground">לא הוזן נוסח.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Notice>לבלוק אין חוזה. בלי חוזה אי אפשר לסמן שחברת התעופה אישרה, ואין מועדים לחשב.</Notice>
        </div>
      )}
    </Section>
  );
}

const text = (value: number | null) => (value === null ? "" : String(value));

export function BlockCostsSection({ data, run }: SectionProps) {
  const { block } = data;
  const [adult, setAdult] = useState(text(block.cost_price));
  const [child, setChild] = useState(text(block.cost_child_price));
  const [tax, setTax] = useState(text(block.cost_tax));
  const [currency, setCurrency] = useState(block.cost_currency ?? "");
  const [saving, setSaving] = useState(false);

  // A reload brings the stored values back into the form.
  useEffect(() => {
    setAdult(text(block.cost_price));
    setChild(text(block.cost_child_price));
    setTax(text(block.cost_tax));
    setCurrency(block.cost_currency ?? "");
  }, [block.cost_price, block.cost_child_price, block.cost_tax, block.cost_currency]);

  const adultValue = parseNumber(adult);
  const childValue = parseNumber(child);
  const taxValue = parseNumber(tax);
  const invalid = [adultValue, childValue, taxValue].some((v) => v === undefined || (typeof v === "number" && v < 0));
  const dirty =
    adult !== text(block.cost_price) ||
    child !== text(block.cost_child_price) ||
    tax !== text(block.cost_tax) ||
    currency !== (block.cost_currency ?? "");

  // Totals follow what is typed, so the operator sees the effect before saving.
  const taxNumber = typeof taxValue === "number" ? taxValue : 0;
  const adultTotal = typeof adultValue === "number" ? adultValue + taxNumber : null;
  const childTotal = typeof childValue === "number" ? childValue + taxNumber : null;
  const original = block.original_quantity ?? block.initial_quantity;
  const shownCurrency = currency || null;

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    await run(
      () =>
        updateTourBlockCosts(block.id, {
          cost_price: adultValue ?? null,
          cost_child_price: childValue ?? null,
          cost_tax: taxValue ?? null,
          cost_currency: currency || null,
        }),
      "העלויות נשמרו",
    );
    setSaving(false);
  };

  return (
    <Section title="עלויות" description="עלות למושב. סך הכל = מחיר ועוד מס.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="מבוגר" htmlFor="cost-adult">
          <Input id="cost-adult" dir="ltr" inputMode="decimal" value={adult} onChange={(e) => setAdult(e.target.value)} />
        </Field>
        <Field label="ילד" htmlFor="cost-child">
          <Input id="cost-child" dir="ltr" inputMode="decimal" value={child} onChange={(e) => setChild(e.target.value)} />
        </Field>
        <Field label="מס" htmlFor="cost-tax">
          <Input id="cost-tax" dir="ltr" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
        </Field>
        <Field label="מטבע">
          <Select dir="rtl" value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue placeholder="בחרו" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || invalid || saving}>
          {saving ? "שומר..." : "שמירת עלויות"}
        </Button>
        {invalid && <span className="text-sm text-destructive">עלות חייבת להיות מספר, 0 ומעלה</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="סך הכל למבוגר" value={<Ltr>{formatMoney(adultTotal, shownCurrency)}</Ltr>} />
        <Stat label="סך הכל לילד" value={<Ltr>{formatMoney(childTotal, shownCurrency)}</Ltr>} />
        <Stat
          label="פוטנציאל"
          value={<Ltr>{formatMoney(adultTotal === null ? null : adultTotal * original, shownCurrency)}</Ltr>}
          hint={`${original} מושבים בהזמנה המקורית`}
        />
        <Stat
          label="בפועל"
          value={<Ltr>{formatMoney(adultTotal === null ? null : adultTotal * block.initial_quantity, shownCurrency)}</Ltr>}
          hint={`${block.initial_quantity} מושבים היום`}
        />
      </div>
    </Section>
  );
}
