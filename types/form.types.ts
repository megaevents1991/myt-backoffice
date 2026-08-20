/**
 * Dynamic forms (טפסים) - staff-built bilingual questionnaires sent to clients.
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

/**
 * Which languages a form actually offers. `both` shows one language at a time
 * with an EN/עב toggle, starting at `default_lang`; `en` / `he` show that
 * language only, with no toggle.
 */
export type FormLanguages = FormLang | "both";

/** Dark uses the brand indigo canvas; light is ink on off-white, same accent. */
export type FormTheme = "dark" | "light";

/** The languages a form is authored in - drives which tabs the builder shows. */
export function enabledLangs(languages: FormLanguages): FormLang[] {
  return languages === "both" ? ["en", "he"] : [languages];
}

/** Clamp a requested language to what the form actually offers. */
export function resolveLang(
  languages: FormLanguages,
  requested: FormLang | null | undefined,
  fallback: FormLang,
): FormLang {
  if (languages !== "both") return languages;
  return requested ?? fallback;
}

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
  /**
   * Conditional visibility: render (and require) this field only when the
   * referenced field's answer equals `equals`. The source must be a field of
   * the same form with a persisted id (a saved row, never a builder draft).
   */
  show_if?: { field: number; equals: boolean | string };
  /**
   * Rating fields only: counts toward the review-gate average that decides
   * whether the thank-you screen offers the external (Google) review link.
   * When NO field of a form is flagged, every rating field counts.
   */
  review_score?: boolean;
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
  /**
   * Filled by staff (trip escort) through an invite's prefill, never by the
   * client - stripped from the public payload and ignored in submissions.
   */
  staff_only: boolean;
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
  languages: FormLanguages;
  default_lang: FormLang;
  allow_multiple: boolean;
  /** Branding for the public fill page. */
  theme: FormTheme;
  accent_color: string;
  logo_url: string | null;
  cover_image_url: string | null;
  thank_you_en: string | null;
  thank_you_he: string | null;
  /**
   * External review URL (e.g. Google reviews). Shown on the thank-you screen
   * only when every answered star rating scored full marks - the submit action
   * decides; the link never reaches the client beforehand.
   */
  review_link_url: string | null;
  /** Review-gate threshold: average of the flagged ratings must reach this. null = 5. */
  review_min_avg: number | null;
  /** Whether forms_operator accounts may see and run this form. */
  operator_visible: boolean;
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
  /**
   * Trip link: one token shared with a whole group, submittable any number of
   * times; `prefill` carries the escort's staff-field answers and `label`
   * names the trip in the invites table.
   */
  multi_use: boolean;
  label: string | null;
  /** Split trip code ("BBC" + "124") - the trip identity trip reports group by. */
  trip_code_prefix: string | null;
  trip_code_num: string | null;
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
    | "languages"
    | "default_lang"
    | "thank_you_en"
    | "thank_you_he"
    | "status"
    | "theme"
    | "accent_color"
    | "logo_url"
    | "cover_image_url"
  >;
  fields: FormField[];
};

/** Draft shape used by the builder before a field exists in the DB. */
export type FormFieldDraft = Omit<
  FormField,
  "id" | "form_id" | "created_at"
> & {
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
