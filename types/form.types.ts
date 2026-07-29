/**
 * Dynamic forms (טפסים) — staff-built bilingual questionnaires sent to clients.
 *
 * Backoffice-only. Not mirrored in ../myt-main.
 */

export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "email",
  "phone",
  "date",
  "select",
  "radio",
  "checkbox",
  "yes_no",
  "rating",
  "scale",
  "section",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Types that render a choice list and therefore own `options`. */
export const CHOICE_TYPES: FormFieldType[] = ["select", "radio", "checkbox"];

/** Types that accept free text and therefore own `placeholder_*`. */
export const TEXTUAL_TYPES: FormFieldType[] = [
  "short_text",
  "long_text",
  "number",
  "email",
  "phone",
];

export type FormLang = "en" | "he";
export type FormStatus = "draft" | "live" | "closed";

export type FormFieldOption = {
  value: string;
  label_en: string;
  label_he: string | null;
};

export type FormFieldConfig = {
  /** number, scale */
  min?: number;
  /** number, scale, rating (star count) */
  max?: number;
  /** number */
  step?: number;
  /** long_text textarea height */
  rows?: number;
};

export type FormField = {
  id: number;
  form_id: number;
  type: FormFieldType;
  position: number;
  label_en: string;
  label_he: string | null;
  help_en: string | null;
  help_he: string | null;
  placeholder_en: string | null;
  placeholder_he: string | null;
  required: boolean;
  options: FormFieldOption[];
  config: FormFieldConfig;
  created_at?: string;
};

export type Form = {
  id: number;
  slug: string;
  title_en: string;
  title_he: string | null;
  description_en: string | null;
  description_he: string | null;
  status: FormStatus;
  default_lang: FormLang;
  allow_multiple: boolean;
  thank_you_en: string | null;
  thank_you_he: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: string | null;
};

/** Row shape for the forms list: the form plus its two counters. */
export type FormSummary = Form & {
  field_count: number;
  response_count: number;
};

export type FormInvite = {
  id: number;
  form_id: number;
  token: string;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  lang: FormLang;
  prefill: Record<string, AnswerValue>;
  reservation_id: number | null;
  event_id: number | null;
  sent_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  send_error: string | null;
  created_at: string;
};

export type AnswerValue = string | number | boolean | string[] | null;

/** Answers are keyed by `String(field.id)`. */
export type AnswerMap = Record<string, AnswerValue>;

export type FormResponse = {
  id: number;
  form_id: number;
  invite_id: number | null;
  answers: AnswerMap;
  lang: FormLang;
  ip: string | null;
  user_agent: string | null;
  submitted_at: string;
};

/** A response joined with the invite it came from, for the results table. */
export type FormResponseRow = FormResponse & {
  recipient_name: string | null;
  recipient_email: string | null;
};

/** Everything the public fill page needs in one payload. */
export type PublicForm = {
  form: Pick<
    Form,
    | "id"
    | "slug"
    | "title_en"
    | "title_he"
    | "description_en"
    | "description_he"
    | "default_lang"
    | "thank_you_en"
    | "thank_you_he"
    | "status"
  >;
  fields: FormField[];
};

/** Draft shape used by the builder before a field exists in the DB. */
export type FormFieldDraft = Omit<FormField, "id" | "form_id" | "created_at"> & {
  /** Negative for unsaved fields, real row id once persisted. */
  id: number;
};

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  email: "Email",
  phone: "Phone",
  date: "Date",
  select: "Dropdown",
  radio: "Single choice",
  checkbox: "Multiple choice",
  yes_no: "Yes / No",
  rating: "Star rating",
  scale: "Scale (1–10)",
  section: "Section header",
};
