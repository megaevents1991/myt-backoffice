import { getForms, listFormSeries } from "@/lib/actions/form-actions";
import { getSession } from "@/lib/auth/guards";
import { FormsClient } from "./forms-client";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const session = await getSession();
  const isOperator = session?.role === "forms_operator";
  const [forms, seriesOptions] = await Promise.all([
    getForms(),
    // Only staff make series forms; a failed tours read only hides the button.
    isOperator ? Promise.resolve([]) : listFormSeries().catch(() => []),
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

      <FormsClient initialForms={forms} isOperator={isOperator} seriesOptions={seriesOptions} />
    </div>
  );
}
