"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ComponentMarkupValues = {
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
  skip_hotel_markup?: number | null;
};

const FIELDS: {
  key: keyof ComponentMarkupValues;
  label: string;
  hint: string;
}[] = [
  {
    key: "markup_ticket",
    label: "Markup: Ticket (USD per ticket)",
    hint: "Always charged. Setting ANY of the three component markups switches this event to composed pricing (the global 175 no longer applies).",
  },
  {
    key: "markup_flight",
    label: "Markup: Flight (USD per ticket)",
    hint: "Charged only when the customer takes the flight.",
  },
  {
    key: "markup_hotel",
    label: "Markup: Hotel (USD per ticket)",
    hint: "Charged only when the customer takes the hotel.",
  },
  {
    key: "skip_hotel_markup",
    label: "Skip-Hotel Markup (USD per ticket)",
    hint: "Charged when the customer skips the hotel (composed pricing only; can be 1 or 0). Legacy events keep the env 100/150 fee.",
  },
];

/**
 * Per-event component markups (composed pricing). Leave ALL of
 * markup_ticket/flight/hotel empty → the event prices exactly as before
 * (global 175 + env hotel-skip fee + skip-flight markup).
 */
export function EventMarkupFields({
  values,
  onChange,
}: {
  values: ComponentMarkupValues;
  onChange: (field: keyof ComponentMarkupValues, value: number | null) => void;
}) {
  return (
    <>
      {FIELDS.map(({ key, label, hint }) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>{label}</Label>
          <Input
            id={key}
            name={key}
            type="number"
            min={0}
            step={1}
            value={values[key] ?? ""}
            placeholder="Empty = legacy pricing"
            onChange={(e) => {
              const v = e.target.value;
              onChange(key, v === "" ? null : Number(v));
            }}
          />
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      ))}
    </>
  );
}
