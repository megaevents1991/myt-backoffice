"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import type {
  Form,
  FormField,
  FormFieldDraft,
  FormFieldType,
  FormLang,
  FormLanguages,
  FormStatus,
  FormSummary,
} from "@/types/form.types";
import { FORM_FIELD_TYPES } from "@/types/form.types";

// `forms` isn't in the generated client types — same untyped-table pattern as
// template-crud.ts / coupon-actions.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
const formsTable = () => (supabase as any).from("forms");
const fieldsTable = () => (supabase as any).from("form_fields");
const responsesTable = () => (supabase as any).from("form_responses");
/* eslint-enable @typescript-eslint/no-explicit-any */

const FORM_COLUMNS =
  "id,slug,title_en,title_he,description_en,description_he,status,languages,default_lang," +
  "allow_multiple,thank_you_en,thank_you_he,created_by,created_at,updated_at,is_deleted";

const FIELD_COLUMNS =
  "id,form_id,type,position,label_en,label_he,help_en,help_he," +
  "placeholder_en,placeholder_he,required,options,config";

/** House soft-delete convention: "MM-DD-YYYY". */
function todayStamp(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${now.getFullYear()}`;
}

/** URL-safe slug. Hebrew titles keep their letters (valid in a URL path). */
export async function slugify(input: string): Promise<string> {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9֐-׿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "form";
}

/** Append -2, -3 … until the slug is free. `ignoreId` skips the form's own row. */
async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
  let candidate = base;
  for (let n = 2; n < 200; n++) {
    let query = formsTable().select("id").eq("slug", candidate).limit(1);
    if (ignoreId) query = query.neq("id", ignoreId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

export async function getForms(): Promise<FormSummary[]> {
  await requireStaff();
  const { data, error } = await formsTable()
    .select(`${FORM_COLUMNS},form_fields(count),form_responses(count)`)
    .is("is_deleted", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getForms failed:", JSON.stringify(error));
    throw error;
  }

  // PostgREST returns embedded counts as [{ count: n }].
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const { form_fields, form_responses, ...form } = row;
    return {
      ...(form as Form),
      field_count: form_fields?.[0]?.count ?? 0,
      response_count: form_responses?.[0]?.count ?? 0,
    };
  });
}

export async function getForm(
  id: number,
): Promise<{ form: Form; fields: FormField[] } | null> {
  await requireStaff();

  const { data: form, error } = await formsTable()
    .select(FORM_COLUMNS)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();

  if (error) {
    console.error("getForm failed:", JSON.stringify(error));
    throw error;
  }
  if (!form) return null;

  const { data: fields, error: fieldsError } = await fieldsTable()
    .select(FIELD_COLUMNS)
    .eq("form_id", id)
    .order("position", { ascending: true });

  if (fieldsError) {
    console.error("getForm fields failed:", JSON.stringify(fieldsError));
    throw fieldsError;
  }

  return { form: form as Form, fields: (fields ?? []) as FormField[] };
}

export async function createForm(): Promise<Form> {
  const actor = await requireStaff();
  const slug = await uniqueSlug(await slugify("untitled form"));

  const payload = {
    slug,
    title_en: "Untitled form",
    title_he: null,
    status: "draft" as FormStatus,
    languages: "both" as FormLanguages,
    default_lang: "en" as FormLang,
    allow_multiple: false,
    created_by: actor.email ?? null,
  };

  const { data, error } = await formsTable().insert(payload).select(FORM_COLUMNS);
  if (error) {
    console.error("createForm failed:", JSON.stringify(error));
    throw error;
  }

  const created = data[0] as Form;
  await logAudit({ action: "create", entityType: "form", entityId: created.id });
  revalidatePath("/forms");
  return created;
}

export type FormMetaInput = {
  title_en: string;
  title_he: string | null;
  description_en: string | null;
  description_he: string | null;
  thank_you_en: string | null;
  thank_you_he: string | null;
  slug: string;
  languages: FormLanguages;
  default_lang: FormLang;
  allow_multiple: boolean;
};

/** Columns mapped one by one — never spread a client object into the row. */
export async function updateFormMeta(
  id: number,
  input: FormMetaInput,
): Promise<Form> {
  await requireStaff();

  // A form may be authored in Hebrew only — require one language, not English.
  const titleEn = input.title_en?.trim() ?? "";
  const titleHe = input.title_he?.trim() ?? "";
  if (!titleEn && !titleHe) throw new Error("Add a title in English or Hebrew");

  const languages: FormLanguages = (["en", "he", "both"] as const).includes(
    input.languages,
  )
    ? input.languages
    : "both";
  // A single-language form has nothing to toggle to.
  const defaultLang: FormLang =
    languages === "both" ? (input.default_lang === "he" ? "he" : "en") : languages;

  const requestedSlug = await slugify(input.slug || titleEn || titleHe);
  const slug = await uniqueSlug(requestedSlug, id);

  const patch = {
    title_en: titleEn,
    title_he: input.title_he?.trim() || null,
    description_en: input.description_en?.trim() || null,
    description_he: input.description_he?.trim() || null,
    thank_you_en: input.thank_you_en?.trim() || null,
    thank_you_he: input.thank_you_he?.trim() || null,
    slug,
    languages,
    default_lang: defaultLang,
    allow_multiple: Boolean(input.allow_multiple),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await formsTable()
    .update(patch)
    .eq("id", id)
    .select(FORM_COLUMNS);

  if (error) {
    console.error("updateFormMeta failed:", JSON.stringify(error));
    throw error;
  }

  await logAudit({ action: "update", entityType: "form", entityId: id, changes: patch });
  revalidatePath("/forms");
  revalidatePath(`/forms/${id}/edit`);
  return data[0] as Form;
}

export async function setFormStatus(id: number, status: FormStatus): Promise<Form> {
  await requireStaff();
  if (!["draft", "live", "closed"].includes(status)) {
    throw new Error("Invalid status");
  }

  const { data, error } = await formsTable()
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(FORM_COLUMNS);

  if (error) {
    console.error("setFormStatus failed:", JSON.stringify(error));
    throw error;
  }

  await logAudit({
    action: "update",
    entityType: "form",
    entityId: id,
    changes: { status },
  });
  revalidatePath("/forms");
  return data[0] as Form;
}

function normalizeField(field: FormFieldDraft, position: number) {
  const type: FormFieldType = FORM_FIELD_TYPES.includes(field.type)
    ? field.type
    : "short_text";

  return {
    type,
    position,
    label_en: (field.label_en ?? "").trim(),
    label_he: field.label_he?.trim() || null,
    help_en: field.help_en?.trim() || null,
    help_he: field.help_he?.trim() || null,
    placeholder_en: field.placeholder_en?.trim() || null,
    placeholder_he: field.placeholder_he?.trim() || null,
    required: Boolean(field.required),
    options: (field.options ?? []).map((option) => ({
      value: String(option.value ?? "").trim(),
      label_en: String(option.label_en ?? "").trim(),
      label_he: option.label_he?.trim() || null,
    })),
    config: field.config ?? {},
  };
}

/**
 * Replace the form's field set.
 *
 * Existing fields are UPDATED in place rather than deleted and re-inserted:
 * `form_responses.answers` is keyed by field id, so regenerating ids would
 * orphan every answer already collected. Drafts arrive with a negative id.
 */
export async function saveFormFields(
  formId: number,
  fields: FormFieldDraft[],
): Promise<FormField[]> {
  await requireStaff();

  const { data: existing, error: existingError } = await fieldsTable()
    .select("id")
    .eq("form_id", formId);

  if (existingError) {
    console.error("saveFormFields read failed:", JSON.stringify(existingError));
    throw existingError;
  }

  const existingIds = new Set<number>((existing ?? []).map((r: { id: number }) => r.id));
  const keptIds = new Set<number>();

  for (const [index, field] of fields.entries()) {
    const row = normalizeField(field, index);

    if (field.id > 0 && existingIds.has(field.id)) {
      keptIds.add(field.id);
      const { error } = await fieldsTable().update(row).eq("id", field.id).eq("form_id", formId);
      if (error) {
        console.error("saveFormFields update failed:", JSON.stringify(error));
        throw error;
      }
    } else {
      const { error } = await fieldsTable().insert({ ...row, form_id: formId });
      if (error) {
        console.error("saveFormFields insert failed:", JSON.stringify(error));
        throw error;
      }
    }
  }

  const removed = [...existingIds].filter((id) => !keptIds.has(id));
  if (removed.length > 0) {
    const { error } = await fieldsTable().delete().in("id", removed).eq("form_id", formId);
    if (error) {
      console.error("saveFormFields delete failed:", JSON.stringify(error));
      throw error;
    }
  }

  await formsTable().update({ updated_at: new Date().toISOString() }).eq("id", formId);
  await logAudit({
    action: "update",
    entityType: "form_fields",
    entityId: formId,
    changes: { field_count: fields.length, removed: removed.length },
  });

  const { data, error } = await fieldsTable()
    .select(FIELD_COLUMNS)
    .eq("form_id", formId)
    .order("position", { ascending: true });

  if (error) throw error;
  revalidatePath(`/forms/${formId}/edit`);
  return (data ?? []) as FormField[];
}

export async function duplicateForm(id: number): Promise<Form> {
  const actor = await requireStaff();
  const loaded = await getForm(id);
  if (!loaded) throw new Error("Form not found");

  const slug = await uniqueSlug(await slugify(`${loaded.form.title_en} copy`));
  const { data, error } = await formsTable()
    .insert({
      slug,
      title_en: `${loaded.form.title_en} (copy)`,
      title_he: loaded.form.title_he,
      description_en: loaded.form.description_en,
      description_he: loaded.form.description_he,
      thank_you_en: loaded.form.thank_you_en,
      thank_you_he: loaded.form.thank_you_he,
      status: "draft",
      languages: loaded.form.languages,
      default_lang: loaded.form.default_lang,
      allow_multiple: loaded.form.allow_multiple,
      created_by: actor.email ?? null,
    })
    .select(FORM_COLUMNS);

  if (error) {
    console.error("duplicateForm failed:", JSON.stringify(error));
    throw error;
  }

  const created = data[0] as Form;

  if (loaded.fields.length > 0) {
    const rows = loaded.fields.map((field, index) => ({
      ...normalizeField(field as FormFieldDraft, index),
      form_id: created.id,
    }));
    const { error: fieldsError } = await fieldsTable().insert(rows);
    if (fieldsError) {
      console.error("duplicateForm fields failed:", JSON.stringify(fieldsError));
      throw fieldsError;
    }
  }

  await logAudit({ action: "create", entityType: "form", entityId: created.id, metadata: { duplicated_from: id } });
  revalidatePath("/forms");
  return created;
}

export async function softDeleteForm(id: number): Promise<boolean> {
  await requireStaff();
  const { error } = await formsTable()
    .update({ is_deleted: todayStamp(), status: "closed" })
    .eq("id", id);

  if (error) {
    console.error("softDeleteForm failed:", JSON.stringify(error));
    throw error;
  }

  await logAudit({ action: "delete", entityType: "form", entityId: id });
  revalidatePath("/forms");
  return true;
}

/** Counts for the responses page header. */
export async function getFormResponseCount(formId: number): Promise<number> {
  await requireStaff();
  const { count, error } = await responsesTable()
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId);

  if (error) throw error;
  return count ?? 0;
}
