/**
 * Answer validation for dynamic forms.
 *
 * Isomorphic on purpose: the renderer runs it in the browser for instant
 * feedback, and the public submit action runs it again on the server, where it
 * is the actual security boundary. The server MUST NOT trust the client result.
 *
 * The schema is derived from the stored field definitions, so a respondent can
 * only submit answers to fields that exist on this form, with values inside the
 * ranges and option sets the builder defined.
 */

import { z } from "zod";
import type { AnswerMap, AnswerValue, FormField, FormLang } from "@/types/form.types";
import { strings } from "./i18n";

/** Hard caps so a public endpoint cannot be used to store arbitrary blobs. */
export const MAX_SHORT_TEXT = 500;
export const MAX_LONG_TEXT = 5000;
export const MAX_CHECKBOX_SELECTIONS = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isEmptyAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Yes/No arrives as a boolean from React, or "true"/"false" over the wire. */
const booleanish = z.union([
  z.boolean(),
  z.literal("true").transform(() => true),
  z.literal("false").transform(() => false),
]);

/**
 * Build the zod schema for a single field. Returns null for `section`, which is
 * a display-only block and never stores an answer.
 */
export function buildFieldSchema(field: FormField): z.ZodTypeAny | null {
  const { config } = field;

  switch (field.type) {
    case "section":
      return null;

    case "short_text":
    case "phone":
      return z.string().trim().min(1).max(MAX_SHORT_TEXT);

    case "long_text":
      return z.string().trim().min(1).max(MAX_LONG_TEXT);

    case "email":
      return z.string().trim().toLowerCase().email().max(MAX_SHORT_TEXT);

    case "date":
      return z
        .string()
        .trim()
        .regex(DATE_RE)
        .refine((v) => !Number.isNaN(Date.parse(v)));

    case "number": {
      let schema = z.coerce.number().finite();
      if (typeof config.min === "number") schema = schema.min(config.min);
      if (typeof config.max === "number") schema = schema.max(config.max);
      return schema;
    }

    case "rating": {
      const max = typeof config.max === "number" ? config.max : 5;
      return z.coerce.number().int().min(1).max(max);
    }

    case "scale": {
      const min = typeof config.min === "number" ? config.min : 1;
      const max = typeof config.max === "number" ? config.max : 10;
      return z.coerce.number().int().min(min).max(max);
    }

    case "yes_no":
      return booleanish;

    case "select":
    case "radio": {
      const values = field.options.map((o) => o.value);
      // A choice field with no options yet accepts nothing.
      if (values.length === 0) return z.never();
      return z.string().refine((v) => values.includes(v));
    }

    case "checkbox": {
      const values = field.options.map((o) => o.value);
      if (values.length === 0) return z.never();
      return z
        .array(z.string())
        .max(MAX_CHECKBOX_SELECTIONS)
        .refine((arr) => arr.every((v) => values.includes(v)));
    }

    default:
      // Unknown type persisted by an older build — reject rather than store junk.
      return z.never();
  }
}

export type ValidationOk = { ok: true; values: AnswerMap };
export type ValidationFail = { ok: false; errors: Record<string, string> };
export type ValidationResult = ValidationOk | ValidationFail;

/**
 * Validate a raw answer map against the form's fields.
 *
 * Iterates the FIELDS, never the submitted keys — so unknown or forged field ids
 * in `raw` are silently dropped and never reach the database.
 */
export function validateAnswers(
  fields: FormField[],
  raw: Record<string, unknown>,
  lang: FormLang = "en",
): ValidationResult {
  const t = strings(lang);
  const values: AnswerMap = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (field.type === "section") continue;

    const key = String(field.id);
    const value = raw[key];

    if (isEmptyAnswer(value)) {
      if (field.required) errors[key] = t.required;
      else values[key] = null;
      continue;
    }

    const schema = buildFieldSchema(field);
    if (!schema) continue;

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      errors[key] = field.type === "email" ? t.invalidEmail : t.invalid;
      continue;
    }
    values[key] = parsed.data as AnswerValue;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values };
}

/** Human-readable answer for tables, drawers and the xlsx export. */
export function formatAnswer(
  field: FormField,
  value: AnswerValue | undefined,
  lang: FormLang = "en",
): string {
  if (value === undefined || value === null || value === "") return "";

  const labelOf = (v: string) => {
    const option = field.options.find((o) => o.value === v);
    if (!option) return v;
    return (lang === "he" ? option.label_he : option.label_en) || option.label_en || v;
  };

  if (field.type === "yes_no") {
    return value ? strings(lang).yes : strings(lang).no;
  }
  if (Array.isArray(value)) return value.map(labelOf).join(", ");
  if (field.type === "select" || field.type === "radio") return labelOf(String(value));
  if (field.type === "rating") {
    const max = typeof field.config.max === "number" ? field.config.max : 5;
    return `${value} / ${max}`;
  }
  return String(value);
}
