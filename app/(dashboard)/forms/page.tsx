import { getForms, listFormSeries, otherCompaniesWithForms } from "@/lib/actions/form-actions";
import { FormsInOtherCompanies } from "@/components/forms/forms-elsewhere";
import { getSession } from "@/lib/auth/guards";
import { FormsClient } from "./forms-client";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const session = await getSession();
  const isOperator = session?.role === "forms_operator";
  const [forms, seriesOptions, elsewhere] = await Promise.all([
    getForms(),
    // Staff and forms operators make series forms; a failed tours read only hides the button.
    listFormSeries().catch(() => []),
    // The viewer's OTHER companies that have forms, shown whatever this list holds: most
    // superadmins work in Mega Events by default, where one draft sits while Mega Family's
    // forms (with every answer) live in Mega Family - a short list there reads like lost data.
    otherCompaniesWithForms(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Forms (טפסים)</h1>
        <p className="text-muted-foreground">
          Build a bilingual questionnaire, publish it, and send it to clients as a
          shared link or a personal emailed link. Answers land straight in the
          dashboard.
        </p>
      </div>

      <FormsInOtherCompanies companies={elsewhere} />

      <FormsClient initialForms={forms} isOperator={isOperator} seriesOptions={seriesOptions} />
    </div>
  );
}
