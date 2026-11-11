// scripts/forms-company-selftest.ts - `npx tsx scripts/forms-company-selftest.ts`
// Pure rules of the forms per company (lib/forms/company-access.ts) and of the role kinds on a
// company's users screen (lib/auth/company-roles.ts) - no DB, no session. Spec
// docs/superpowers/specs/2026-11-11-forms-to-mega-family-design.md.
import {
  formCompanyElsewhere,
  formOpensFor,
  formsOperatorCompanyIds,
  pickOperatorCompanyId,
  type FormAccessRow,
} from "../lib/forms/company-access";
import { companyRoleKind, crossesRoleLine } from "../lib/auth/company-roles";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const EVENTS = "events-id";
const FAMILY = "family-id";

const familyLive: FormAccessRow = { company_id: FAMILY, operator_visible: true, is_deleted: null };
const familyStaffOnly: FormAccessRow = { company_id: FAMILY, operator_visible: false, is_deleted: null };
const familyDeleted: FormAccessRow = { company_id: FAMILY, operator_visible: true, is_deleted: "08-20-2026" };
const eventsDraft: FormAccessRow = { company_id: EVENTS, operator_visible: false, is_deleted: null };

const familyStaff = { companyId: FAMILY, operator: false };
const familyOperator = { companyId: FAMILY, operator: true };
const eventsStaff = { companyId: EVENTS, operator: false };
const eventsOperator = { companyId: EVENTS, operator: true };

// ---- formOpensFor
check("Family staff opens a Family form", formOpensFor(familyLive, familyStaff), true);
check("Family staff opens a Family form closed to operators", formOpensFor(familyStaffOnly, familyStaff), true);
check("Family operator opens a Family form opened to operators", formOpensFor(familyLive, familyOperator), true);
check("Family operator does not open a form closed to operators", formOpensFor(familyStaffOnly, familyOperator), false);
check("Mega Events staff does not open a Family form", formOpensFor(familyLive, eventsStaff), false);
check("Mega Events operator does not open a Family form", formOpensFor(familyLive, eventsOperator), false);
check("Family staff does not open a Mega Events form", formOpensFor(eventsDraft, familyStaff), false);
check("Mega Events staff opens its own draft", formOpensFor(eventsDraft, eventsStaff), true);
check("a deleted form opens for nobody", formOpensFor(familyDeleted, familyStaff), false);
check("a missing form opens for nobody", formOpensFor(null, familyStaff), false);
check(
  "a form with no company opens for nobody",
  formOpensFor({ company_id: null, operator_visible: true, is_deleted: null }, familyStaff),
  false,
);
check(
  "operator_visible null is not opened to operators",
  formOpensFor({ company_id: FAMILY, operator_visible: null, is_deleted: null }, familyOperator),
  false,
);

// ---- formCompanyElsewhere
check(
  "a superadmin in Mega Events is told the form is in Family",
  formCompanyElsewhere(familyLive, eventsStaff, [EVENTS, FAMILY]),
  FAMILY,
);
check("a Mega Events-only viewer is told nothing", formCompanyElsewhere(familyLive, eventsStaff, [EVENTS]), null);
check("the active company is not 'elsewhere'", formCompanyElsewhere(familyLive, familyStaff, [EVENTS, FAMILY]), null);
check("a deleted form is nowhere", formCompanyElsewhere(familyDeleted, eventsStaff, [EVENTS, FAMILY]), null);
check(
  "an operator is not told about a form closed to operators",
  formCompanyElsewhere(familyStaffOnly, eventsOperator, [EVENTS, FAMILY]),
  null,
);
check("a missing form is nowhere", formCompanyElsewhere(null, eventsStaff, [EVENTS, FAMILY]), null);

// ---- formsOperatorCompanyIds
check("unreadable memberships = refused", formsOperatorCompanyIds(null, EVENTS), null);
check("no membership = Mega Events", formsOperatorCompanyIds([], EVENTS), [EVENTS]);
check(
  "a Family membership = Family",
  formsOperatorCompanyIds([{ company_id: FAMILY, is_active: true }], EVENTS),
  [FAMILY],
);
check(
  "an inactive company gives nothing (refused, not Mega Events)",
  formsOperatorCompanyIds([{ company_id: FAMILY, is_active: false }], EVENTS),
  [],
);
check(
  "two memberships = both",
  formsOperatorCompanyIds(
    [
      { company_id: EVENTS, is_active: true },
      { company_id: FAMILY, is_active: true },
    ],
    EVENTS,
  ),
  [EVENTS, FAMILY],
);

// ---- pickOperatorCompanyId
check("Daniel (Family only) works in Family", pickOperatorCompanyId([FAMILY], null, EVENTS), FAMILY);
check("a stale Mega Events cookie does not pull him back", pickOperatorCompanyId([FAMILY], EVENTS, EVENTS), FAMILY);
check("two companies: the browser's pick wins", pickOperatorCompanyId([EVENTS, FAMILY], FAMILY, EVENTS), FAMILY);
check("two companies, no pick: Mega Events", pickOperatorCompanyId([FAMILY, EVENTS], null, EVENTS), EVENTS);
check("no company: nowhere", pickOperatorCompanyId([], FAMILY, EVENTS), null);

// ---- role kinds on a company's users screen
check("editor is staff", companyRoleKind("editor"), "staff");
check("admin is staff", companyRoleKind("admin"), "staff");
check("tours_agent is its own kind", companyRoleKind("tours_agent"), "tours_agent");
check("forms_operator is its own kind", companyRoleKind("forms_operator"), "forms_operator");
check("editor -> admin stays inside staff", crossesRoleLine("editor", "admin"), false);
check("forms_operator -> editor crosses the line", crossesRoleLine("forms_operator", "editor"), true);
check("editor -> forms_operator crosses the line", crossesRoleLine("editor", "forms_operator"), true);
check("forms_operator -> tours_agent crosses the line", crossesRoleLine("forms_operator", "tours_agent"), true);
check("forms_operator -> forms_operator does not", crossesRoleLine("forms_operator", "forms_operator"), false);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nforms-company-selftest: all checks passed");
