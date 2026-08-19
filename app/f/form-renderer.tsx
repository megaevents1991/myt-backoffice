"use client";

/**
 * The public form renderer, used by /f/[slug], /f/i/[token] and the builder
 * preview - so what staff see while authoring is exactly what a client fills in.
 *
 * Branding is per form: the deep indigo brand canvas (or a light variant), one
 * accent from the MYT neon palette, an optional logo and cover image. Layout is
 * a sticky cover panel beside the questions rather than a single centred card,
 * which is what makes it read as the brand's own surface and not a generic form.
 */

import { useMemo, useState, useTransition } from "react";
import { Check, Lock, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitFormResponse } from "@/lib/actions/form-response-actions";
import type { StaffSummaryItem } from "@/lib/actions/form-response-actions";
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
import { isFieldVisible, validateAnswers } from "@/lib/forms/validation";
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
  /** Escort answers from a trip link - rendered as a read-only trip ticket. */
  staffSummary?: StaffSummaryItem[];
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
  staffSummary,
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
  const [done, setDone] = useState<{
    message: string;
    reviewLink: string | null;
  } | null>(null);
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

  // The public payload never contains staff-only fields; the builder preview
  // does, so staff can see (and badge) them. Conditional fields render only
  // while their condition holds - in the preview too, so it can be tried live.
  const visibleFields = useMemo(
    () =>
      fields
        .filter((field) => preview || !field.staff_only)
        .filter((field) => isFieldVisible(field, answers)),
    [fields, answers, preview],
  );

  const questions = useMemo(
    () => visibleFields.filter((field) => field.type !== "section"),
    [visibleFields],
  );

  // Progress counts required questions only - optional ones would make a form
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
        setDone({
          message: response.thankYou,
          reviewLink: response.reviewLink ?? null,
        });
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
              className="mx-auto mb-8 flex h-16 w-16 animate-in zoom-in-75 items-center justify-center rounded-full duration-500 motion-reduce:animate-none"
              style={{ background: theme.accent, color: theme.onAccent }}
            >
              <Check className="h-8 w-8" strokeWidth={3} />
            </span>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-5 whitespace-pre-line text-lg leading-relaxed text-[var(--muted)]">
              {done.message}
            </p>
            {done.reviewLink && (
              <div className="mt-10">
                <p className="text-sm text-[var(--muted)]">{t.reviewHint}</p>
                <a
                  href={done.reviewLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{ background: theme.accent, color: theme.onAccent }}
                  className="mt-4 inline-flex h-13 items-center justify-center gap-2 rounded-full px-8 py-3.5 text-base font-bold transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:scale-100"
                >
                  <Star className="h-5 w-5" fill="currentColor" />
                  {t.reviewCta}
                </a>
              </div>
            )}
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
        {/* Cover - the brand surface: logo, title, progress, ambient glow. */}
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
            {/* Honeypot - off-screen for people, tempting to bots. */}
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

            {staffSummary && staffSummary.length > 0 && (
              <TripTicket items={staffSummary} lang={lang} />
            )}

            <div className="space-y-3">
              {visibleFields.map((field) => (
                <FieldBlock
                  key={field.id}
                  field={field}
                  lang={lang}
                  accent={theme.accent}
                  onAccentColor={theme.onAccent}
                  value={answers[String(field.id)]}
                  error={errors[String(field.id)]}
                  onChange={(value) => setAnswer(field, value)}
                  staffBadge={preview && field.staff_only}
                />
              ))}
            </div>

            {visibleFields.length === 0 && (
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

    // Light canvas leans warm paper, not clinical white - these are feedback
    // and lead forms, not admin screens.
    const canvas = dark ? CANVAS : "#FAF8F4";
    const ink = dark ? INK : "#141019";
    const inkRgb = dark ? "250, 250, 245" : "20, 16, 25";

    return {
      accent,
      onAccent: onAccent(accent),
      coverScrim: dark
        ? `linear-gradient(180deg, rgba(7,6,24,0.72) 0%, rgba(7,6,24,0.92) 100%)`
        : `linear-gradient(180deg, rgba(250,248,244,0.78) 0%, rgba(250,248,244,0.94) 100%)`,
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

/** Builder-preview marker for fields the client never receives. */
function StaffBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
      {label}
    </span>
  );
}

/** "2026-09-12" reads as a date to a machine; people get "12.09.2026". */
function formatStaffValue(item: StaffSummaryItem, lang: FormLang): string {
  const { field, value } = item;
  if (field.type === "date" && typeof value === "string") {
    const [y, m, d] = value.split("-");
    if (y && m && d) return `${d}.${m}.${y}`;
  }
  if (typeof value === "boolean") return value ? strings(lang).yes : strings(lang).no;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * The trip ticket: the escort's details rendered as a boarding-pass stub -
 * dashed tear line, punched notches, deliberately grey. Read-only on purpose:
 * these values identify the trip being rated and belong to staff, so nothing
 * here is focusable or editable.
 */
function TripTicket({ items, lang }: { items: StaffSummaryItem[]; lang: FormLang }) {
  const t = strings(lang);
  return (
    <section
      aria-label={t.tripDetails}
      className="relative mb-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]"
    >
      {/* Stub: what this ticket is, and the lock that says "not yours to edit". */}
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
          {t.tripDetails}
        </span>
        <Lock aria-hidden className="h-3.5 w-3.5 text-[var(--muted)]" />
      </div>

      {/* Tear line with punched notches at both ends. */}
      <div aria-hidden className="relative">
        <div className="mx-5 border-t border-dashed border-[var(--line)]" />
        <span className="absolute -start-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-[var(--line)] bg-[var(--canvas)]" />
        <span className="absolute -end-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-[var(--line)] bg-[var(--canvas)]" />
      </div>

      <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 pt-4 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.field.id} className="min-w-0">
            <dt className="text-[11px] font-medium text-[var(--muted)]">
              {fieldLabel(item.field, lang)}
            </dt>
            <dd className="mt-0.5 truncate text-[15px] font-bold tabular-nums text-[var(--ink)] opacity-80">
              {formatStaffValue(item, lang)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const CONTROL_BASE =
  "w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-[16px] text-[var(--ink)] " +
  "placeholder:text-[var(--muted)] transition-colors duration-150 " +
  "focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";

function FieldBlock({
  field,
  lang,
  accent,
  onAccentColor,
  value,
  error,
  onChange,
  staffBadge = false,
}: {
  field: FormField;
  lang: FormLang;
  accent: string;
  onAccentColor: string;
  value: AnswerValue | undefined;
  error?: string;
  onChange: (value: AnswerValue) => void;
  /** Builder preview only: mark a staff-only field clients will never see. */
  staffBadge?: boolean;
}) {
  const t = strings(lang);
  const rtl = isRtl(lang);
  const label = fieldLabel(field, lang);
  const help = fieldHelp(field, lang);
  const placeholder = fieldPlaceholder(field, lang);

  // A conditional question mounts the moment its Yes/No flips - ease it in so
  // the form reads as opening up, not jumping.
  const conditional = Boolean(field.config.show_if);
  const revealClass = conditional
    ? "animate-in fade-in slide-in-from-top-2 duration-300 motion-reduce:animate-none"
    : undefined;

  if (field.type === "section") {
    return (
      <div className={cn("pb-2 pt-12 first:pt-2", revealClass)}>
        <h2 className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
          <span
            aria-hidden
            className="h-5 w-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
          />
          {label}
          {staffBadge && <StaffBadge label={t.staffBadge} />}
        </h2>
        {help && <p className="mt-1.5 ps-4 text-sm text-[var(--muted)]">{help}</p>}
      </div>
    );
  }

  return (
    <div
      id={`field-${field.id}`}
      className={cn(
        "rounded-3xl border border-transparent bg-[var(--surface)] p-5 transition-colors duration-200 focus-within:border-[var(--accent)] sm:p-6",
        revealClass,
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={`input-${field.id}`}
          className="block text-[17px] font-bold leading-snug"
        >
          {label}
          {field.required && <span style={{ color: accent }}> *</span>}
          {staffBadge && (
            <span className="ms-2 align-middle">
              <StaffBadge label={t.staffBadge} />
            </span>
          )}
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
          <div className="flex gap-1">
            {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`${star}`}
                aria-pressed={star <= current}
                onClick={() => onChange(star === current ? null : star)}
                className="group rounded-xl p-1.5 transition-transform duration-150 hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] motion-reduce:transition-none motion-reduce:hover:scale-100"
              >
                <Star
                  className={cn(
                    "h-8 w-8 transition-all duration-150 sm:h-9 sm:w-9",
                    star <= current && "drop-shadow-sm",
                  )}
                  strokeWidth={1.5}
                  style={{
                    color: star <= current ? accent : "var(--muted)",
                    fill: star <= current ? accent : "transparent",
                    opacity: star <= current ? 1 : 0.55,
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
