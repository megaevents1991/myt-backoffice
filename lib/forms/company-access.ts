/**
 * Which forms a viewer may open, now that every form belongs to a company (2026-11-11,
 * spec docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md). Pure - the
 * guards in lib/forms/access.ts read the rows and ask these. Selftest:
 * scripts/forms-company-selftest.ts.
 */

/** The columns of a form that decide who may open it. */
export type FormAccessRow = {
  company_id: string | null;
  operator_visible: boolean | null;
  is_deleted: string | null;
};

/** Who is looking: the company they work in now, and whether they are a forms operator. */
export type FormsViewer = {
  companyId: string;
  operator: boolean;
};

/**
 * A form opens for the viewer when it is not deleted, belongs to the company the viewer
 * works in now, and - for a forms operator - was opened to operators. Anything else reads
 * exactly like a form that does not exist.
 */
export function formOpensFor(row: FormAccessRow | null, viewer: FormsViewer): boolean {
  if (!row || row.is_deleted) return false;
  if (!row.company_id || row.company_id !== viewer.companyId) return false;
  if (viewer.operator && row.operator_visible !== true) return false;
  return true;
}

/**
 * The OTHER company a form lives in, when the viewer could open it there: not deleted, of a
 * company that is not the active one but is among the viewer's own companies, and opened to
 * operators for an operator. Null in every other case - so a page never tells a viewer that
 * a form exists in a company they cannot work in.
 */
export function formCompanyElsewhere(
  row: FormAccessRow | null,
  viewer: FormsViewer,
  viewerCompanyIds: readonly string[],
): string | null {
  if (!row || row.is_deleted || !row.company_id) return null;
  if (row.company_id === viewer.companyId) return null;
  if (!viewerCompanyIds.includes(row.company_id)) return null;
  if (viewer.operator && row.operator_visible !== true) return null;
  return row.company_id;
}

/**
 * The companies a forms operator works in, from its memberships:
 *  - null (the memberships could not be read) -> null: refused. Never guessed - the generic
 *    company read answers Mega Events on a failure, which would hand a Mega Family operator
 *    Mega Events' forms;
 *  - no membership at all -> Mega Events: the users screen of Mega Events creates operators
 *    with no membership row, exactly as it creates Mega Events staff;
 *  - otherwise the ACTIVE companies it is a member of (possibly none: refused).
 */
export function formsOperatorCompanyIds(
  memberships: readonly { company_id: string; is_active: boolean }[] | null,
  megaEventsId: string,
): string[] | null {
  if (memberships === null) return null;
  if (memberships.length === 0) return [megaEventsId];
  return memberships.filter((m) => m.is_active).map((m) => m.company_id);
}

/**
 * The company a forms operator works in now: the one its browser picked, else Mega Events
 * when it is one of them, else the first. Null when it works nowhere.
 */
export function pickOperatorCompanyId(
  companyIds: readonly string[],
  wantedId: string | null,
  megaEventsId: string,
): string | null {
  if (companyIds.length === 0) return null;
  if (wantedId && companyIds.includes(wantedId)) return wantedId;
  if (companyIds.includes(megaEventsId)) return megaEventsId;
  return companyIds[0];
}
