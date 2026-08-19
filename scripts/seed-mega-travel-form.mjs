// Seeds the "משוב טיול - מגה תיירות" trip-feedback form.
//
// Usage: node scripts/seed-mega-travel-form.mjs
//
// Idempotent: keyed on the form slug, and fields are matched by their Hebrew
// label so re-running updates them in place. `form_responses.answers` is keyed
// by field id, so this script must never delete-and-reinsert a field that
// already collected answers.
//
// Run AFTER 20260819120000_forms_trip_feedback.sql is applied (it adds
// forms.review_link_url, form_fields.staff_only, form_invites.multi_use/label).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SLUG = "mega-travel-feedback";

const REVIEW_URL =
  "https://www.google.com/search?q=%D7%9E%D7%92%D7%94+%D7%AA%D7%99%D7%99%D7%A8%D7%95%D7%AA&rlz=1C1OKWM_enIL1194IL1194&oq=%D7%9E%D7%92%D7%94+%D7%AA%D7%99%D7%99%D7%A8%D7%95%D7%AA+&gs_lcrp=EgZjaHJvbWUyBggAEEUYOTIGCAEQIxgnMgkIAhAAGBMYgAQyCQgDEAAYExiABDIJCAQQABgTGIAEMgkIBRAAGBMYgAQyBggGEEUYQTIGCAcQRRg90gEIMTgzOGowajeoAgCwAgA&sourceid=chrome&source=chrome.ob&ie=UTF-8#lrd=0x2a546394ee8a9dc9:0xca45a9d51f54f280,3,,,,";

const FORM = {
  slug: SLUG,
  title_en: "Trip feedback",
  title_he: "משוב על הטיול",
  description_en: null,
  description_he:
    "תודה שנסעתם איתנו! כמה שאלות קצרות שיעזרו לנו להשתפר - לוקח פחות משתי דקות.",
  status: "draft",
  languages: "he",
  default_lang: "he",
  // The trip link is shared with a whole group, so many people answer it.
  allow_multiple: true,
  thank_you_en: null,
  thank_you_he: "תודה רבה על המשוב! נשמח לראותכם שוב בטיול הבא.",
  review_link_url: REVIEW_URL,
  theme: "light",
  // The brand purple from megatr.co.il (rgba(83,49,93) in its homepage styles).
  accent_color: "#53315D",
  logo_url: "/brands/mega-travel-logo.svg",
};

/** `star(label)` - a 1-5 rating; `yesno(label)` - a Yes/No question. */
const star = (he, extra = {}) => ({
  type: "rating",
  label_he: he,
  required: true,
  config: { max: 5 },
  ...extra,
});
const yesno = (he, extra = {}) => ({
  type: "yes_no",
  label_he: he,
  required: true,
  config: {},
  ...extra,
});

// `showIfLabel` names the Yes/No question a conditional rating depends on -
// resolved to the real field id in pass 2, once every row exists.
const FIELDS = [
  {
    type: "section",
    label_he: "פרטי הטיול",
    help_he: "למילוי המלווה בלבד - הלקוחות לא רואים את זה",
    staff_only: true,
  },
  { type: "short_text", label_he: "שם המלווה", required: true, staff_only: true },
  { type: "short_text", label_he: "קוד טיול", required: true, staff_only: true },
  { type: "date", label_he: "מועד יציאה", required: true, staff_only: true },

  { type: "section", label_he: "פרטי הנוסע" },
  { type: "short_text", label_he: "שם הנוסע", required: true },
  {
    type: "number",
    label_he: "מספר נוסעים",
    help_he: "כמה נוסעים נסעו יחד ומדורגים במשוב הזה",
    required: true,
    config: { min: 1, max: 30, step: 1 },
  },

  { type: "section", label_he: "איך היה?" },
  star("חוויה כללית מהטיול"),
  star("מסלול הטיול"),
  star("מלווה הקבוצה"),
  star("ליווי בפארקים עם המלווה"),
  star("בתי המלון בטיול"),

  yesno("נכחת במפגש הקבוצה?"),
  star("איך היה מפגש הקבוצה?", {
    required: false,
    showIfLabel: "נכחת במפגש הקבוצה?",
    showIfEquals: true,
  }),

  yesno("האם נסעת בעבר עם מגה?"),

  yesno("האם ביקרת באתר מגה תיירות?"),
  star("נוחות השימוש באתר", {
    required: false,
    showIfLabel: "האם ביקרת באתר מגה תיירות?",
    showIfEquals: true,
  }),
];

async function main() {
  const { data: existing, error: readError } = await supabase
    .from("forms")
    .select("id")
    .eq("slug", SLUG)
    .maybeSingle();
  if (readError) throw readError;

  let formId = existing?.id;
  if (formId) {
    // status stays whatever it is - re-seeding must not un-publish a live form.
    const { status: _keep, ...patch } = FORM;
    const { error } = await supabase
      .from("forms")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", formId);
    if (error) throw error;
    console.log(`Updated form #${formId} (${SLUG})`);
  } else {
    const { data, error } = await supabase
      .from("forms")
      .insert(FORM)
      .select("id")
      .single();
    if (error) throw error;
    formId = data.id;
    console.log(`Created form #${formId} (${SLUG})`);
  }

  const { data: currentFields, error: fieldsError } = await supabase
    .from("form_fields")
    .select("id,label_he")
    .eq("form_id", formId);
  if (fieldsError) throw fieldsError;

  const byLabel = new Map((currentFields ?? []).map((f) => [f.label_he, f.id]));

  // Pass 1: upsert every field without its condition - the source field must
  // exist and own a real id before anything can point at it.
  for (const [position, field] of FIELDS.entries()) {
    const row = {
      form_id: formId,
      type: field.type,
      position,
      label_en: "",
      label_he: field.label_he,
      help_he: field.help_he ?? null,
      required: Boolean(field.required),
      staff_only: Boolean(field.staff_only),
      options: [],
      config: field.config ?? {},
    };

    const id = byLabel.get(field.label_he);
    if (id) {
      const { error } = await supabase.from("form_fields").update(row).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("form_fields")
        .insert(row)
        .select("id")
        .single();
      if (error) throw error;
      byLabel.set(field.label_he, data.id);
    }
  }

  // Pass 2: wire the conditional ratings to their Yes/No source.
  for (const field of FIELDS) {
    if (!field.showIfLabel) continue;
    const sourceId = byLabel.get(field.showIfLabel);
    const targetId = byLabel.get(field.label_he);
    if (!sourceId || !targetId) {
      throw new Error(`Could not resolve condition for "${field.label_he}"`);
    }
    const { error } = await supabase
      .from("form_fields")
      .update({
        config: {
          ...(field.config ?? {}),
          show_if: { field: sourceId, equals: field.showIfEquals },
        },
      })
      .eq("id", targetId);
    if (error) throw error;
  }

  console.log(
    `Seeded ${FIELDS.length} fields. Open /forms/${formId}/edit and set it Live.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
