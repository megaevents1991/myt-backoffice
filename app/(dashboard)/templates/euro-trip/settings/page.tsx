import Link from "next/link";

import { readItinerarySettings } from "@/lib/actions/itinerary-settings-actions";
import { ITINERARY_ADMIN_ONLY_TEXT } from "@/lib/itinerary/settings";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EuroTripSettingsForm } from "./settings-form";

// Any staff member can read this page (requireStaff); only an admin can save (requireAdmin in the action).
// An editor sees the same form, read-only.
export const dynamic = "force-dynamic";

export default async function EuroTripSettingsPage() {
  const read = await readItinerarySettings();

  return (
    <div className="container mx-auto max-w-4xl py-10" dir="rtl">
      <Link href="/templates" className="text-sm text-muted-foreground hover:underline">
        → חזרה לתבניות
      </Link>
      <PageHeader
        className="mt-2"
        title="Euro Trip - הגדרות"
        description="המתג הראשי, התשלום, ההנחות על דמי השירות וכללי בניית המסלול של Build Your Euro Trip. נשמר בטבלת itinerary_settings, והאתר מתרענן מיד אחרי השמירה."
      />

      {read.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>לא ניתן לקרוא את ההגדרות</AlertTitle>
          <AlertDescription>
            {read.message}. לא מוצגות ברירות מחדל כדי לא להתבלבל עם מה ששמור בפועל - רעננו את הדף.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          {read.status === "table_missing" && (
            <Alert>
              <AlertTitle>הטבלה עדיין לא קיימת - נשמרת אחרי פריסת המיגרציה</AlertTitle>
              <AlertDescription>
                מוצגות ברירות המחדל. אפשר למלא את הטופס, אבל השמירה תיכשל עד שהמיגרציה itinerary_core תיפרס למסד הנתונים.
              </AlertDescription>
            </Alert>
          )}
          {!read.canEdit && (
            <Alert>
              <AlertTitle>תצוגה בלבד</AlertTitle>
              <AlertDescription>{ITINERARY_ADMIN_ONLY_TEXT}. אפשר לעיין בהגדרות, אבל לא לשמור.</AlertDescription>
            </Alert>
          )}
          <EuroTripSettingsForm
            initial={read.settings}
            saved={read.status !== "ok" || read.saved}
            canEdit={read.canEdit}
          />
        </div>
      )}
    </div>
  );
}
