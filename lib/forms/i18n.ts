/**
 * Bilingual helpers for dynamic forms.
 *
 * There is no i18n library in this repo. Every user-visible string on a form is a
 * column pair (`*_en` / `*_he`); Hebrew falls back to English when blank, so a
 * half-translated form still renders.
 */

import type { FormField, FormLang } from "@/types/form.types";

/** Pick the string for `lang`, falling back to English when the Hebrew is blank. */
export function pickLang(
  en: string | null | undefined,
  he: string | null | undefined,
  lang: FormLang,
): string {
  if (lang === "he") return he?.trim() || en?.trim() || "";
  return en?.trim() || he?.trim() || "";
}

export function fieldLabel(field: FormField, lang: FormLang): string {
  return pickLang(field.label_en, field.label_he, lang);
}

export function fieldHelp(field: FormField, lang: FormLang): string {
  return pickLang(field.help_en, field.help_he, lang);
}

export function fieldPlaceholder(field: FormField, lang: FormLang): string {
  return pickLang(field.placeholder_en, field.placeholder_he, lang);
}

export function optionLabel(
  option: { label_en: string; label_he: string | null },
  lang: FormLang,
): string {
  return pickLang(option.label_en, option.label_he, lang);
}

export const isRtl = (lang: FormLang) => lang === "he";
export const dirFor = (lang: FormLang) => (isRtl(lang) ? "rtl" : "ltr");

/** Static chrome on the public fill page. */
export const FILL_STRINGS = {
  en: {
    submit: "Submit",
    submitting: "Submitting…",
    required: "This field is required",
    invalid: "Please check this answer",
    invalidEmail: "Enter a valid email address",
    optional: "optional",
    thankYou: "Thanks! Your answers were sent.",
    closed: "This form is no longer accepting responses.",
    alreadySubmitted: "You have already filled in this form. Thank you!",
    chooseOne: "Choose one",
    chooseMany: "Choose all that apply",
    select: "Select…",
    yes: "Yes",
    no: "No",
    fixErrors: "Please fix the highlighted answers.",
    sendFailed: "Could not send your answers. Please try again.",
    switchLang: "עברית",
  },
  he: {
    submit: "שליחה",
    submitting: "שולח…",
    required: "שדה חובה",
    invalid: "בדקו את התשובה",
    invalidEmail: "הזינו כתובת אימייל תקינה",
    optional: "לא חובה",
    thankYou: "תודה! התשובות נשלחו.",
    closed: "הטופס סגור ואינו מקבל תשובות נוספות.",
    alreadySubmitted: "כבר מילאתם את הטופס הזה. תודה!",
    chooseOne: "בחרו אפשרות אחת",
    chooseMany: "בחרו כל מה שמתאים",
    select: "בחרו…",
    yes: "כן",
    no: "לא",
    fixErrors: "נא לתקן את התשובות המסומנות.",
    sendFailed: "לא הצלחנו לשלוח את התשובות. נסו שוב.",
    switchLang: "English",
  },
} as const;

export type FillStrings = (typeof FILL_STRINGS)["en"];

export const strings = (lang: FormLang): FillStrings =>
  FILL_STRINGS[lang] as FillStrings;
