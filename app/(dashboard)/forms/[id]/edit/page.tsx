import { notFound } from "next/navigation";
import { getForm, getForms, listFormSeries } from "@/lib/actions/form-actions";
import { adminLabel } from "@/lib/forms/i18n";
import { getSession } from "@/lib/auth/guards";
import { FormBuilder } from "./form-builder";

export const dynamic = "force-dynamic";

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const formId = Number(id);
  if (!Number.isFinite(formId)) notFound();

  // Staff build every form; a forms operator builds the forms opened to operators
  // (Dor 21.10) - getForm returns null for any other, and every save re-checks it.
  const session = await getSession();
  const isOperator = session?.role === "forms_operator";

  const [loaded, forms, seriesOptions] = await Promise.all([
    getForm(formId),
    getForms(),
    // A failed tours read leaves the builder without the series picker, never broken.
    listFormSeries().catch(() => []),
  ]);
  if (!loaded) notFound();

  return (
    <FormBuilder
      form={loaded.form}
      initialFields={loaded.fields}
      seriesOptions={seriesOptions}
      isOperator={isOperator}
      otherForms={forms
        .filter((f) => f.id !== formId)
        .map((f) => ({
          id: f.id,
          title: adminLabel(f.title_en, f.title_he) || `Form #${f.id}`,
          series: f.series?.code ?? null,
          seriesId: f.series_id ?? null,
        }))}
    />
  );
}
