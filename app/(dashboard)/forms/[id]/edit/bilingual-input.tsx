"use client";

/**
 * An EN / עב pair of inputs behind two small tabs.
 *
 * There is no i18n library here — every user-visible string on a form is a
 * `*_en` / `*_he` column pair, so this is the one control staff use to author
 * both languages of any string.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  valueEn: string;
  valueHe: string;
  onChangeEn: (value: string) => void;
  onChangeHe: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
};

export function BilingualInput({
  label,
  valueEn,
  valueHe,
  onChangeEn,
  onChangeHe,
  placeholder,
  multiline = false,
  rows = 3,
  required = false,
}: Props) {
  const [tab, setTab] = useState<"en" | "he">("en");
  const isHe = tab === "he";
  const value = isHe ? valueHe : valueEn;
  const onChange = isHe ? onChangeHe : onChangeEn;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        <div className="flex overflow-hidden rounded-md border text-[11px]">
          {(["en", "he"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setTab(code)}
              className={cn(
                "px-2 py-0.5 transition-colors",
                tab === code
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent",
                // A filled translation gets a dot so half-done fields are obvious.
                code === "he" && valueHe && tab !== "he" && "font-semibold",
              )}
            >
              {code === "en" ? "EN" : "עב"}
            </button>
          ))}
        </div>
      </div>

      {multiline ? (
        <Textarea
          dir={isHe ? "rtl" : "ltr"}
          className={cn(isHe && "text-right")}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          dir={isHe ? "rtl" : "ltr"}
          className={cn(isHe && "text-right")}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
