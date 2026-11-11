import "server-only";
/**
 * The guards of the forms area, per company (2026-11-11, spec
 * docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md). Every form belongs to a
 * company (forms.company_id); its fields, invites and answers follow it through form_id.
 *
 *  - requireFormsCompany(): who may work in the forms area, and in which company -
 *    staff exactly as requireCompany() (their memberships; no product gate, both kinds of
 *    company have forms), a forms_operator by its OWN memberships, failing closed.
 *    `{ staffOnly: true }` refuses operators (a blank new form, delete, personal invites).
 *  - requireFormInCompany(ctx, formId): the form is of that company (and, for an operator,
 *    opened to operators). Any other form answers exactly like one that does not exist.
 *
 * The rules are pure in lib/forms/company-access.ts.
 */
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase-server";
import { requireActiveFormsOperator } from "@/lib/auth/guards";
import {
  ACTIVE_COMPANY_COOKIE,
  MEGA_EVENTS_COMPANY_ID,
  listCompaniesFor,
  listFormsOperatorCompanies,
  requireCompany,
  type Company,
} from "@/lib/company";
import { getSession } from "@/lib/auth/guards";
import {
  formCompanyElsewhere,
  formOpensFor,
  pickOperatorCompanyId,
  type FormAccessRow,
} from "@/lib/forms/company-access";
import type { SessionPayload } from "@/lib/auth/session";
import { STAFF_ROLES } from "@/types/auth.types";

/** The forms context of a request: who, in which company, and whether an operator. */
export type FormsContext = {
  actor: SessionPayload;
  company: Company;
  operator: boolean;
};

/** One answer for "not yours" and "not there" - it tells nothing about another company. */
export const FORM_NOT_FOUND = "Form not found";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const formsTable = () => (supabase as any).from("forms");

async function operatorContext(): Promise<FormsContext> {
  const actor = await requireActiveFormsOperator();
  const companies = await listFormsOperatorCompanies(actor.sub);
  if (!companies) throw new Error("Unauthorized");
  const store = await cookies();
  const wantedSlug = store.get(ACTIVE_COMPANY_COOKIE)?.value ?? null;
  const wantedId = companies.find((c) => c.slug === wantedSlug)?.id ?? null;
  const companyId = pickOperatorCompanyId(
    companies.map((c) => c.id),
    wantedId,
    MEGA_EVENTS_COMPANY_ID,
  );
  const company = companies.find((c) => c.id === companyId);
  if (!company) throw new Error("Unauthorized");
  return { actor, company, operator: true };
}

/**
 * Staff or a forms_operator, with the company they work in now. A forms_operator with no
 * readable membership, or none in an active company, is refused.
 */
export async function requireFormsCompany(
  opts: { staffOnly?: boolean } = {},
): Promise<FormsContext> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  if (session.role === "forms_operator") {
    if (opts.staffOnly) throw new Error("Unauthorized");
    return operatorContext();
  }
  // Staff only from here - partners, sales agents and anyone else are refused. (requireCompany
  // checks the same roles; this keeps the allowlist visible in the forms guard itself.)
  if (!STAFF_ROLES.includes(session.role)) throw new Error("Unauthorized");
  const { session: actor, company } = await requireCompany();
  if (!STAFF_ROLES.includes(actor.role)) throw new Error("Unauthorized");
  return { actor, company, operator: false };
}

const ACCESS_COLUMNS = "id,company_id,operator_visible,is_deleted";

async function readAccessRow(formId: number): Promise<FormAccessRow | null> {
  if (!Number.isInteger(formId) || formId <= 0) return null;
  const { data, error } = await formsTable()
    .select(ACCESS_COLUMNS)
    .eq("id", formId)
    .maybeSingle();
  if (error) {
    console.error("forms access read failed:", JSON.stringify(error));
    // Fail closed: a form we cannot read is not opened.
    throw new Error("Unauthorized");
  }
  return (data as FormAccessRow | null) ?? null;
}

/** Throws FORM_NOT_FOUND unless the form opens for this context (pure rule: formOpensFor). */
export async function requireFormInCompany(ctx: FormsContext, formId: number): Promise<void> {
  const row = await readAccessRow(Number(formId));
  if (!formOpensFor(row, { companyId: ctx.company.id, operator: ctx.operator })) {
    throw new Error(FORM_NOT_FOUND);
  }
}

/** The same check, as a yes / no (for a read that answers null rather than throws). */
export async function formOpensIn(ctx: FormsContext, formId: number): Promise<boolean> {
  const row = await readAccessRow(Number(formId));
  return formOpensFor(row, { companyId: ctx.company.id, operator: ctx.operator });
}

/**
 * The other company of the viewer a form lives in, for a page that could not open it - so
 * a bookmarked link says "this form is in Mega Family" instead of "not found". Null when the
 * viewer could not open it there either (they are never told a form exists elsewhere).
 * Never throws.
 */
export async function formCompanyForViewer(
  ctx: FormsContext,
  formId: number,
): Promise<Company | null> {
  try {
    const row = await readAccessRow(Number(formId));
    const companies = ctx.operator
      ? ((await listFormsOperatorCompanies(ctx.actor.sub)) ?? [])
      : await listCompaniesFor(ctx.actor);
    const id = formCompanyElsewhere(
      row,
      { companyId: ctx.company.id, operator: ctx.operator },
      companies.map((c) => c.id),
    );
    return id ? (companies.find((c) => c.id === id) ?? null) : null;
  } catch (e) {
    console.error("formCompanyForViewer:", e);
    return null;
  }
}
