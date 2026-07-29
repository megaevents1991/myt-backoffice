"use client";

/**
 * The public form renderer, used by /f/[slug], /f/i/[token] and the builder
 * preview — so what staff see while authoring is exactly what a client fills in.
 *
 * Branding is per form: the deep indigo brand canvas (or a light variant), one
 * accent from the MYT neon palette, an optional logo and cover image. Layout is
 * a sticky cover panel beside the questions rather than a single centred card,
 * which is what makes it read as the brand's own surface and not a generic form.
 */

import { useMemo, useState, useTransition } from "react";
import { Check, Star } from "lucide-react";
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
import { CANVAS, DEFAULT_ACCENT, INK, hexToRgb, onAccent } from "@/lib/forms/brand";
import { BrandGlow } from "./brand-glow";
import { Wordmark } from "./wordmark";
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
  /** Builder preview: renders identically but never submits, single column. */
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
  const canToggle = showLangToggle && form.languages === "both";

  const theme = useThemeTokens(form.theme, form.accent_color);

  const title = useMemo(
    () => pickLang(form.title_en, form.title_he, lang),
    [form.title_en, form.title_he, lang],
  );
  const description = useMemo(
    () => pickLang(form.description_en, form.description_he, lang),
    [form.description_en, form.description_he, lang],
  );

  const questions = useMemo(
    () => fields.filter((field) => field.type !== "section"),
    [fields],
  );

  // Progress counts required questions only — optional ones would make a form
  // look unfinished when the client has done everything that is actually asked.
  const requiredIds = questions.filter((f) => f.required).map((f) => String(f.id));
  const answeredRequired = requiredIds.filter((id) => {
    const value = answers[id];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== "";
  }).length;
  const progress =
    requiredIds.length === 0 ? 0 : Math.round((answeredRequired / requiredIds.length) * 100);

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
      // Focus management: take the client straight to the first problem.
      const first = Object.keys(result.errors)[0];
      document.getElementById(`field-${first}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
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

  const shellProps = {
    dir: dirFor(lang),
    style: {
      ...theme.vars,
      colorScheme: form.theme === "light" ? ("light" as const) : ("dark" as const),
    },
    className: cn(
      "min-h-dvh w-full bg-[var(--canvas)] text-[var(--ink)] antialiased",
      rtl && "text-right",
    ),
  };

  if (done) {
    return (
      <div {...shellProps}>
        <div className="relative mx-auto flex min-h-dvh max-w-2xl items-center justify-center px-6 py-20">
          <BrandGlow accent={theme.accent} />
          <div className="relative text-center">
            <span
              className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: theme.accent, color: theme.onAccent }}
            >
              <Check className="h-8 w-8" strokeWidth={3} />
            </span>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-5 whitespace-pre-line text-lg leading-relaxed text-[var(--muted)]">
              {done}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div {...shellProps}>
      <div
        className={cn(
          "mx-auto grid w-full max-w-[1200px] gap-0",
          !preview && "lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]",
        )}
      >
        {/* Cover — the brand surface: logo, title, progress, ambient glow. */}
        <aside
          className={cn(
            "relative overflow-hidden px-6 pb-10 pt-12 sm:px-10",
            !preview && "lg:sticky lg:top-0 lg:h-dvh lg:pb-14 lg:pt-16",
          )}
        >
          {form.cover_image_url && (
            <div aria-hidden className="absolute inset-0">
              {/* Plain img: next.config sets images.unoptimized, so next/image
                  would render the same tag while coupling this page to the
                  remote-pattern config. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.cover_image_url}
                alt=""
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: theme.coverScrim }} />
            </div>
          )}
          <BrandGlow accent={theme.accent} />

          <div className={cn("relative flex h-full flex-col", !preview && "lg:justify-between")}>
            <div>
              <div className="flex items-start justify-between gap-4">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logo_url}
                    alt=""
                    className="h-10 w-auto max-w-[190px] object-contain"
                  />
                ) : (
                  // No logo set: fall back to the real brand wordmark, with the
                  // trailing dot picking up this form's accent.
                  <Wordmark className="h-6 w-auto text-[var(--ink)]" dotColor={theme.accent} />
                )}

                {canToggle && (
                  <button
                    type="button"
                    onClick={() => setLang(lang === "he" ? "en" : "he")}
                    className="shrink-0 rounded-full border border-[var(--line)] px-4 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
                  >
                    {t.switchLang}
                  </button>
                )}
              </div>

              <h1 className="mt-12 text-[clamp(2rem,5vw,3.25rem)] font-black leading-[1.05] tracking-tight">
                {title}
              </h1>
              {description && (
                <p className="mt-5 max-w-md whitespace-pre-line text-[17px] leading-relaxed text-[var(--muted)]">
                  {description}
                </p>
              )}
            </div>

            {requiredIds.length > 0 && (
              <div className={cn("mt-10", !preview && "lg:mt-0")}>
                <div className="mb-2.5 flex items-baseline justify-between text-xs font-medium text-[var(--muted)]">
                  <span>
                    {answeredRequired} / {requiredIds.length}
                  </span>
                  <span>{progress}%</span>
                </div>
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-strong)]"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${progress}%`, background: theme.accent }}
                  />
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Questions */}
        <main className="relative px-6 pb-20 pt-4 sm:px-10 lg:py-16">
          <form onSubmit={handleSubmit} noValidate>
            {/* Honeypot — off-screen for people, tempting to bots. */}
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

            <div className="space-y-3">
              {fields.map((field) => (
                <FieldBlock
                  key={field.id}
                  field={field}
                  index={questions.findIndex((q) => q.id === field.id)}
                  lang={lang}
                  accent={theme.accent}
                  onAccentColor={theme.onAccent}
                  value={answers[String(field.id)]}
                  error={errors[String(field.id)]}
                  onChange={(value) => setAnswer(field, value)}
                />
              ))}
            </div>

            {fields.length === 0 && (
              <p className="rounded-2xl border border-dashed border-[var(--line)] p-12 text-center text-sm text-[var(--muted)]">
                No questions yet.
              </p>
            )}

            {banner && (
              <p
                role="alert"
                className="mt-8 rounded-xl border border-[#FF4F61]/40 bg-[#FF4F61]/10 px-4 py-3 text-sm text-[#FF8A94]"
              >
                {banner}
              </p>
            )}

            <button
              type="submit"
              disabled={pending || preview}
              style={{ background: theme.accent, color: theme.onAccent }}
              className="mt-10 inline-flex h-14 min-w-[200px] items-center justify-center rounded-full px-10 text-base font-bold transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--canvas)] motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              {pending ? t.submitting : t.submit}
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}

/** Theme tokens as CSS variables, so every control reads the same palette. */
function useThemeTokens(theme: PublicForm["form"]["theme"], accentInput: string) {
  return useMemo(() => {
    const accent = /^#[0-9a-f]{6}$/i.test(accentInput ?? "") ? accentInput : DEFAULT_ACCENT;
    const dark = theme !== "light";

    const canvas = dark ? CANVAS : "#FAFAF5";
    const ink = dark ? INK : "#0B0A1F";
    const inkRgb = dark ? "250, 250, 245" : "11, 10, 31";

    return {
      accent,
      onAccent: onAccent(accent),
      coverScrim: dark
        ? `linear-gradient(180deg, rgba(7,6,24,0.72) 0%, rgba(7,6,24,0.92) 100%)`
        : `linear-gradient(180deg, rgba(250,250,245,0.78) 0%, rgba(250,250,245,0.94) 100%)`,
      vars: {
        "--canvas": canvas,
        "--ink": ink,
        "--muted": `rgba(${inkRgb}, 0.64)`,
        "--surface": `rgba(${inkRgb}, ${dark ? 0.045 : 0.028})`,
        "--surface-strong": `rgba(${inkRgb}, ${dark ? 0.1 : 0.07})`,
        "--line": `rgba(${inkRgb}, ${dark ? 0.14 : 0.13})`,
        "--accent": accent,
        "--accent-soft": `rgba(${hexToRgb(accent)}, 0.14)`,
      } as React.CSSProperties,
    };
  }, [theme, accentInput]);
}

const CONTROL_BASE =
  "w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-[16px] text-[var(--ink)] " +
  "placeholder:text-[var(--muted)] transition-colors duration-150 " +
  "focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";

function FieldBlock({
  field,
  index,
  lang,
  accent,
  onAccentColor,
  value,
  error,
  onChange,
}: {
  field: FormField;
  index: number;
  lang: FormLang;
  accent: string;
  onAccentColor: string;
  value: AnswerValue | undefined;
  error?: string;
  onChange: (value: AnswerValue) => void;
}) {
  const t = strings(lang);
  const rtl = isRtl(lang);
  const label = fieldLabel(field, lang);
  const help = fieldHelp(field, lang);
  const placeholder = fieldPlaceholder(field, lang);

  if (field.type === "section") {
    return (
      <div className="pb-2 pt-12 first:pt-2">
        <h2 className="text-xl font-extrabold tracking-tight">{label}</h2>
        {help && <p className="mt-1.5 text-sm text-[var(--muted)]">{help}</p>}
        <div className="mt-5 h-px w-full bg-[var(--line)]" />
      </div>
    );
  }

  return (
    <div
      id={`field-${field.id}`}
      className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors duration-200 focus-within:border-[var(--accent)] sm:p-6"
    >
      <div className="flex gap-3">
        {/* A questionnaire is a real sequence, so the index carries order. */}
        <span
          aria-hidden
          className="mt-0.5 shrink-0 text-xs font-bold tabular-nums"
          style={{ color: accent }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="min-w-0 flex-1">
          <label
            htmlFor={`input-${field.id}`}
            className="block text-[17px] font-bold leading-snug"
          >
            {label}
            {field.required && <span style={{ color: accent }}> *</span>}
          </label>
          {!field.required && (
            <span className="mt-0.5 block text-xs text-[var(--muted)]">{t.optional}</span>
          )}
          {help && <p className="mt-1.5 text-sm text-[var(--muted)]">{help}</p>}

          <div className="mt-4">{renderControl()}</div>

          {error && (
            <p role="alert" className="mt-2.5 text-sm font-medium text-[#FF8A94]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  function chipClass(selected: boolean) {
    return cn(
      "min-h-[46px] rounded-full border px-5 text-[15px] font-medium transition-all duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]",
      selected
        ? "border-transparent"
        : "border-[var(--line)] bg-[var(--surface-strong)] hover:border-[var(--accent)]",
    );
  }

  function chipStyle(selected: boolean) {
    return selected ? { background: accent, color: onAccentColor } : undefined;
  }

  function renderControl() {
    switch (field.type) {
      case "long_text":
        return (
          <textarea
            id={`input-${field.id}`}
            dir={dirFor(lang)}
            rows={field.config.rows ?? 4}
            placeholder={placeholder}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={cn(CONTROL_BASE, "resize-y py-3 leading-relaxed", rtl && "text-right")}
          />
        );

      case "number":
        return (
          <input
            id={`input-${field.id}`}
            type="number"
            inputMode="decimal"
            dir="ltr"
            placeholder={placeholder}
            min={field.config.min}
            max={field.config.max}
            step={field.config.step}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            className={cn(CONTROL_BASE, "h-12")}
          />
        );

      case "date":
        return (
          <input
            id={`input-${field.id}`}
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={cn(CONTROL_BASE, "h-12")}
          />
        );

      case "email":
      case "phone":
      case "short_text":
        return (
          <input
            id={`input-${field.id}`}
            type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
            inputMode={field.type === "phone" ? "tel" : undefined}
            autoComplete={
              field.type === "email" ? "email" : field.type === "phone" ? "tel" : undefined
            }
            dir={field.type === "short_text" ? dirFor(lang) : "ltr"}
            placeholder={placeholder}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              CONTROL_BASE,
              "h-12",
              field.type === "short_text" && rtl && "text-right",
            )}
          />
        );

      case "select":
        // Native on purpose: mobile gets the OS picker, which beats any custom
        // dropdown on a form a client fills once on their phone.
        return (
          <select
            id={`input-${field.id}`}
            dir={dirFor(lang)}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={cn(CONTROL_BASE, "h-12 cursor-pointer appearance-none", rtl && "text-right")}
          >
            <option value="" disabled>
              {placeholder || t.select}
            </option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {optionLabel(option, lang)}
              </option>
            ))}
          </select>
        );

      case "radio":
        return (
          <div className="flex flex-wrap gap-2.5">
            {field.options.map((option) => {
              const selected = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(option.value)}
                  className={chipClass(selected)}
                  style={chipStyle(selected)}
                >
                  {optionLabel(option, lang)}
                </button>
              );
            })}
          </div>
        );

      case "checkbox": {
        const selectedValues = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="flex flex-wrap gap-2.5">
            {field.options.map((option) => {
              const selected = selectedValues.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    onChange(
                      selected
                        ? selectedValues.filter((v) => v !== option.value)
                        : [...selectedValues, option.value],
                    )
                  }
                  className={chipClass(selected)}
                  style={chipStyle(selected)}
                >
                  {optionLabel(option, lang)}
                </button>
              );
            })}
          </div>
        );
      }

      case "yes_no":
        return (
          <div className="flex flex-wrap gap-2.5">
            {[
              { label: t.yes, val: true },
              { label: t.no, val: false },
            ].map((option) => {
              const selected = value === option.val;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(option.val)}
                  className={cn(chipClass(selected), "min-w-[96px]")}
                  style={chipStyle(selected)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        );

      case "rating": {
        const max = field.config.max ?? 5;
        const current = typeof value === "number" ? value : 0;
        return (
          <div className="flex gap-1.5">
            {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`${star}`}
                aria-pressed={star <= current}
                onClick={() => onChange(star === current ? null : star)}
                className="rounded-lg p-1.5 transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] motion-reduce:hover:scale-100"
              >
                <Star
                  className="h-7 w-7"
                  strokeWidth={1.75}
                  style={{
                    color: star <= current ? accent : "var(--muted)",
                    fill: star <= current ? accent : "transparent",
                  }}
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
          <div className="flex flex-wrap gap-2">
            {steps.map((step) => {
              const selected = step === value;
              return (
                <button
                  key={step}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(step === value ? null : step)}
                  className={cn(
                    "h-11 w-11 rounded-xl border text-[15px] font-semibold tabular-nums transition-all duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]",
                    selected
                      ? "border-transparent"
                      : "border-[var(--line)] bg-[var(--surface-strong)] hover:border-[var(--accent)]",
                  )}
                  style={chipStyle(selected)}
                >
                  {step}
                </button>
              );
            })}
          </div>
        );
      }

      default:
        return null;
    }
  }
}
