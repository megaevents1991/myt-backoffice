import { notFound } from "next/navigation";
import { getForm } from "@/lib/actions/form-actions";
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

  const loaded = await getForm(formId);
  if (!loaded) notFound();

  return <FormBuilder form={loaded.form} initialFields={loaded.fields} />;
}
