"use client";

/**
 * The public form renderer. Used by /f/[slug], /f/i/[token] and the builder
 * preview, so what staff see while authoring is exactly what a client fills in.
 */

import { useMemo, useState, useTransition } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { submitFormResponse } from "@/lib/actions/form-response-actions";
import {
  dirFor,
  fieldHelp,
  fieldLabel,
  fieldPlaceholder,
  isRtl,
  optionLabel,
  pickLang,
  strings,
} from "@/lib/forms/i18n";
import { validateAnswers } from "@/lib/forms/validation";
import type {
  AnswerMap,
  AnswerValue,
  FormField,
  FormLang,
  PublicForm,
} from "@/types/form.types";

type Props = {
  payload: PublicForm;
  initialLang: FormLang;
  prefill?: AnswerMap;
  slug?: string;
  token?: string;
  /** Builder preview: renders identically but never submits. */
  preview?: boolean;
  showLangToggle?: boolean;
};

export function FormRenderer({
  payload,
  initialLang,
  prefill,
  slug,
  token,
  preview = false,
  showLangToggle = true,
}: Props) {
  const { form, fields } = payload;
  const [lang, setLang] = useState<FormLang>(initialLang);
  const [answers, setAnswers] = useState<AnswerMap>(() => ({ ...(prefill ?? {}) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [hp, setHp] = useState("");
  const [pending, startTransition] = useTransition();

  const t = strings(lang);
  const rtl = isRtl(lang);
  // Only a bilingual form has anything to toggle to.
  const canToggle = showLangToggle && form.languages === "both";

  const title = useMemo(
    () => pickLang(form.title_en, form.title_he, lang),
    [form.title_en, form.title_he, lang],
  );
  const description = useMemo(
    () => pickLang(form.description_en, form.description_he, lang),
    [form.description_en, form.description_he, lang],
  );

  function setAnswer(field: FormField, value: AnswerValue) {
    const key = String(field.id);
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (preview) return;

    setBanner(null);
    const result = validateAnswers(fields, answers, lang);
    if (!result.ok) {
      setErrors(result.errors);
      setBanner(t.fixErrors);
      return;
    }
    setErrors({});

    startTransition(async () => {
      const response = await submitFormResponse({
        slug,
        token,
        answers: result.values,
        lang,
        hp,
      });
      if (response.ok) {
        setDone(response.thankYou);
        return;
      }
      if (response.errors) setErrors(response.errors);
      setBanner(response.message);
    });
  }

  if (done) {
    return (
      <div dir={dirFor(lang)} className={cn("mx-auto max-w-2xl px-4 py-16", rtl && "text-right")}>
        <div className="rounded-xl border bg-card p-10 text-center">
          <div className="text-2xl font-semibold">{title}</div>
          <p className="mt-4 whitespace-pre-line text-muted-foreground">{done}</p>
        </div>
      </div>
    );
  }

  return (
    <div dir={dirFor(lang)} className={cn("mx-auto max-w-2xl px-4 py-10", rtl && "text-right")}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-2 whitespace-pre-line text-muted-foreground">{description}</p>
          )}
        </div>
        {canToggle && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setLang(lang === "he" ? "en" : "he")}
          >
            {t.switchLang}
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Honeypot — hidden from people, tempting to bots. */}
        <div aria-hidden className="pointer-events-none absolute -left-[9999px] opacity-0">
          <label>
            Company
            <input
              tabIndex={-1}
              autoComplete="off"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
            />
          </label>
        </div>

        {fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            lang={lang}
            value={answers[String(field.id)]}
            error={errors[String(field.id)]}
            onChange={(value) => setAnswer(field, value)}
          />
        ))}

        {fields.length === 0 && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No questions yet.
          </p>
        )}

        {banner && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {banner}
          </p>
        )}

        <Button type="submit" disabled={pending || preview} className="w-full sm:w-auto">
          {pending ? t.submitting : t.submit}
        </Button>
      </form>
    </div>
  );
}

function FieldInput({
  field,
  lang,
  value,
  error,
  onChange,
}: {
  field: FormField;
  lang: FormLang;
  value: AnswerValue | undefined;
  error?: string;
  onChange: (value: AnswerValue) => void;
}) {
  const t = strings(lang);
  const rtl = isRtl(lang);
  const label = fieldLabel(field, lang);
  const help = fieldHelp(field, lang);
  const placeholder = fieldPlaceholder(field, lang);
  const inputClass = cn(rtl && "text-right");

  if (field.type === "section") {
    return (
      <div className="border-b pb-2 pt-4">
        <h2 className="text-lg font-semibold">{label}</h2>
        {help && <p className="mt-1 text-sm text-muted-foreground">{help}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">
        {label}
        {field.required && <span className="text-destructive"> *</span>}
        {!field.required && (
          <span className="ms-2 text-xs font-normal text-muted-foreground">({t.optional})</span>
        )}
      </Label>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}

      {renderControl()}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  function renderControl() {
    switch (field.type) {
      case "long_text":
        return (
          <Textarea
            dir={dirFor(lang)}
            className={inputClass}
            rows={field.config.rows ?? 4}
            placeholder={placeholder}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "number":
        return (
          <Input
            type="number"
            dir={dirFor(lang)}
            className={inputClass}
            placeholder={placeholder}
            min={field.config.min}
            max={field.config.max}
            step={field.config.step}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        );

      case "date":
        return (
          <Input
            type="date"
            className={inputClass}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "email":
      case "phone":
      case "short_text":
        return (
          <Input
            type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
            dir={field.type === "short_text" ? dirFor(lang) : "ltr"}
            className={field.type === "short_text" ? inputClass : undefined}
            placeholder={placeholder}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "select":
        return (
          <Select
            value={(value as string) ?? ""}
            onValueChange={(next) => onChange(next)}
          >
            <SelectTrigger dir={dirFor(lang)} className={inputClass}>
              <SelectValue placeholder={placeholder || t.select} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {optionLabel(option, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "radio":
        return (
          <RadioGroup
            value={(value as string) ?? ""}
            onValueChange={(next) => onChange(next)}
            className="gap-2"
          >
            {field.options.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem value={option.value} id={`f${field.id}-${option.value}`} />
                <Label htmlFor={`f${field.id}-${option.value}`} className="font-normal">
                  {optionLabel(option, lang)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        );

      case "checkbox": {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="space-y-2">
            {field.options.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`f${field.id}-${option.value}`}
                  checked={selected.includes(option.value)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...selected, option.value]
                        : selected.filter((v) => v !== option.value),
                    )
                  }
                />
                <Label htmlFor={`f${field.id}-${option.value}`} className="font-normal">
                  {optionLabel(option, lang)}
                </Label>
              </div>
            ))}
          </div>
        );
      }

      case "yes_no":
        return (
          <RadioGroup
            value={value === true ? "true" : value === false ? "false" : ""}
            onValueChange={(next) => onChange(next === "true")}
            className="flex gap-6"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="true" id={`f${field.id}-yes`} />
              <Label htmlFor={`f${field.id}-yes`} className="font-normal">
                {t.yes}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="false" id={`f${field.id}-no`} />
              <Label htmlFor={`f${field.id}-no`} className="font-normal">
                {t.no}
              </Label>
            </div>
          </RadioGroup>
        );

      case "rating": {
        const max = field.config.max ?? 5;
        const current = typeof value === "number" ? value : 0;
        return (
          <div className="flex gap-1">
            {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`${star}`}
                onClick={() => onChange(star === current ? null : star)}
                className="p-0.5 text-muted-foreground transition-colors hover:text-amber-500"
              >
                <Star
                  className={cn(
                    "h-7 w-7",
                    star <= current && "fill-amber-400 text-amber-400",
                  )}
                />
              </button>
            ))}
          </div>
        );
      }

      case "scale": {
        const min = field.config.min ?? 1;
        const max = field.config.max ?? 10;
        const steps = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
        return (
          <div className="flex flex-wrap gap-1.5">
            {steps.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => onChange(step === value ? null : step)}
                className={cn(
                  "h-9 w-9 rounded-md border text-sm transition-colors",
                  step === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {step}
              </button>
            ))}
          </div>
        );
      }

      default:
        return null;
    }
  }
}
