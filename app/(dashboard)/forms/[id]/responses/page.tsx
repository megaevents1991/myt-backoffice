import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getForm } from "@/lib/actions/form-actions";
import { getFormResponses } from "@/lib/actions/form-response-actions";
import { adminLabel } from "@/lib/forms/i18n";
import { ResponsesClient } from "./responses-client";

export const dynamic = "force-dynamic";

export default async function FormResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const formId = Number(id);
  if (!Number.isFinite(formId)) notFound();

  const loaded = await getForm(formId);
  if (!loaded) notFound();

  const responses = await getFormResponses(formId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
            <Link href={`/forms/${formId}/edit`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to the form
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {adminLabel(loaded.form.title_en, loaded.form.title_he)}
          </h1>
          <p className="text-muted-foreground">
            {responses.length} response{responses.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <ResponsesClient
        formId={formId}
        fields={loaded.fields}
        initialResponses={responses}
      />
    </div>
  );
}
