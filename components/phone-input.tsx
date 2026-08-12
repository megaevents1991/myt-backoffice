"use client";

import * as React from "react";
import PhoneInputBase from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { Input } from "@/components/ui/input";

/**
 * International phone input: country flag dropdown + auto-formatting.
 * Emits E.164 ("+9725...") or "" - store verbatim in user_profiles.phone.
 * Validate on submit with isValidPhoneNumber from react-phone-number-input.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <PhoneInputBase
      id={id}
      international
      defaultCountry="IL"
      value={value || undefined}
      onChange={(v) => onChange(v ?? "")}
      disabled={disabled}
      inputComponent={Input}
      // Flag button inherits height from the shadcn Input next to it.
      className="flex items-stretch gap-2 [&_.PhoneInputCountry]:mr-0"
      countrySelectProps={{ "aria-label": "Country" }}
    />
  );
}
