import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getForm } from "@/lib/actions/form-actions";
import { getFormTripReport } from "@/lib/actions/form-report-actions";
import { getFormResponses } from "@/lib/actions/form-response-actions";
import { adminLabel } from "@/lib/forms/i18n";
import { ReportClient } from "./report-client";

export const dynamic = "force-dynamic";

export default async function FormReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const formId = Number(id);
  if (!Number.isFinite(formId)) notFound();

  const loaded = await getForm(formId);
  if (!loaded) notFound();

  const [{ report, ratingFields }, responses] = await Promise.all([
    getFormTripReport(formId),
    getFormResponses(formId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
          <Link href="/forms">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All forms
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">
          Trips report - {adminLabel(loaded.form.title_en, loaded.form.title_he)}
        </h1>
        <p className="text-muted-foreground">
          Every trip link of this form, its responses and averages. One form,
          one dashboard - filter by trip code, escort or departure date.
        </p>
      </div>

      <ReportClient
        report={report}
        ratingFields={ratingFields}
        fields={loaded.fields.filter(
          (field) => !field.staff_only && field.type !== "section",
        )}
        responses={responses}
      />
    </div>
  );
}
