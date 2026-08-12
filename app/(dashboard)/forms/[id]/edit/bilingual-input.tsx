"use client";

/**
 * An EN / עב pair of inputs behind two small tabs.
 *
 * There is no i18n library here - every user-visible string on a form is a
 * `*_en` / `*_he` column pair, so this is the one control staff use to author
 * both languages of any string.
 *
 * A form set to a single language passes just that one in `langs`: the tabs
 * disappear and only the language the form actually renders is editable.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FormLang } from "@/types/form.types";

const LANG_LABEL: Record<FormLang, string> = { en: "EN", he: "עב" };

type Props = {
  label: string;
  valueEn: string;
  valueHe: string;
  onChangeEn: (value: string) => void;
  onChangeHe: (value: string) => void;
  /** Languages this form offers. One entry hides the tabs. */
  langs?: FormLang[];
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
  langs = ["en", "he"],
  placeholder,
  multiline = false,
  rows = 3,
  required = false,
}: Props) {
  const available = langs.length > 0 ? langs : (["en", "he"] as FormLang[]);
  const [tab, setTab] = useState<FormLang>(available[0]);

  // The form's language set can change while the builder is open.
  const active = available.includes(tab) ? tab : available[0];
  const isHe = active === "he";
  const value = isHe ? valueHe : valueEn;
  const onChange = isHe ? onChangeHe : onChangeEn;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>

        {available.length > 1 ? (
          <div className="flex overflow-hidden rounded-md border text-[11px]">
            {available.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setTab(code)}
                className={cn(
                  "px-2 py-0.5 transition-colors",
                  active === code
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                  // A filled translation gets bolder so half-done fields show.
                  code === "he" && valueHe && active !== "he" && "font-semibold",
                )}
              >
                {LANG_LABEL[code]}
              </button>
            ))}
          </div>
        ) : (
          <span className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
            {LANG_LABEL[available[0]]}
          </span>
        )}
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
