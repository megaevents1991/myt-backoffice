import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * The forms belong to a company (2026-11-11): a viewer who works in more than one
 * company may land on a form - or the forms list - of the company they are NOT in now.
 * These say where the forms are and switch there through the company deep link
 * (`?company=<slug>`, contexts/company-context.tsx). They are only shown for a company
 * the viewer works in (findFormElsewhere / otherCompaniesWithForms decide).
 *
 * The switch is a plain <a>, never next/link: the deep link is followed on a page LOAD
 * (the company provider re-reads the URL when the pathname changes), and these links keep
 * the pathname - a client navigation changed the address and stayed in the old company.
 */

/** A form page whose form lives in another company of the viewer. */
export function FormInOtherCompany({
  company,
  path,
}: {
  company: { slug: string; name: string };
  path: string;
}) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-8 text-center" dir="rtl">
      <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h1 className="text-lg font-bold">הטופס הזה נמצא בחברה {company.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        הטפסים מנוהלים בתוך החברה שהם שייכים לה. עוברים לחברה ופותחים אותו שם.
      </p>
      <Button asChild className="mt-5">
        <a href={`${path}?company=${encodeURIComponent(company.slug)}`}>
          מעבר ל{company.name}
        </a>
      </Button>
    </div>
  );
}

/** One line per other company of the viewer that has forms, over the forms list (empty or not). */
export function FormsInOtherCompanies({
  companies,
}: {
  companies: { slug: string; name: string; count: number }[];
}) {
  if (companies.length === 0) return null;
  return (
    <div className="space-y-2" dir="rtl">
      {companies.map((company) => (
        <div
          key={company.slug}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm"
        >
          <span>
            {company.count === 1
              ? `טופס אחד נוסף נמצא בחברה ${company.name}.`
              : `${company.count} טפסים נוספים נמצאים בחברה ${company.name}.`}
          </span>
          <Button asChild size="sm" variant="outline">
            <a href={`/forms?company=${encodeURIComponent(company.slug)}`}>החלף חברה</a>
          </Button>
        </div>
      ))}
    </div>
  );
}
