import { notFound, redirect } from "next/navigation";
import { getForm } from "@/lib/actions/form-actions";
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

  // The builder edits and publishes - staff only. An operator landing here
  // (old link, the copy-redirect) goes to the form's invites page instead.
  const session = await getSession();
  if (session?.role === "forms_operator") {
    redirect(`/forms/${formId}/invites`);
  }

  const loaded = await getForm(formId);
  if (!loaded) notFound();

  return <FormBuilder form={loaded.form} initialFields={loaded.fields} />;
}
