/**
 * Who a task of a company may be given to, reviewed by or mention (server only).
 *
 * The assignee, reviewer and @mention pickers all draw from here, and so does
 * the validation of the ids a form sends back - one rule, per company:
 *
 *   - Mega Events: every active staff profile (superadmin / admin / editor) -
 *     the list the board always offered - minus an admin or editor who was
 *     added to other companies only. That person cannot open the Mega Events
 *     board (worksInMegaEvents in lib/auth/guards.ts), so a task handed to
 *     them would be invisible to them. An account with no membership at all is
 *     a Mega Events account, the same floor the guards use.
 *   - Any other company: its members (public.company_members) that are active
 *     staff, plus every active superadmin (a superadmin works in every company).
 *
 * `pickTaskPeople` is the rule itself, pure, so the self-test can run it on
 * made-up rows (scripts/tasks-company-scope-selftest.ts).
 */
import { supabaseTyped } from "@/lib/supabase-server";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { STAFF_ROLES } from "@/types/auth.types";

export interface TaskPerson {
  id: string;
  display_name: string | null;
  email: string;
}

type StaffRow = TaskPerson & { role: string };
type MembershipRow = { user_id: string; company_id: string };

/**
 * The people of `companyId` among `staff` (already active, already staff roles),
 * in the order `staff` came in. `memberships` = null means the memberships could
 * not be read: Mega Events then keeps its whole list (the board must not lose
 * its people over a failed read), any other company keeps superadmins only.
 */
export function pickTaskPeople(
  staff: StaffRow[],
  memberships: MembershipRow[] | null,
  companyId: string,
): TaskPerson[] {
  const companiesOf = new Map<string, Set<string>>();
  for (const row of memberships ?? []) {
    const set = companiesOf.get(row.user_id) ?? new Set<string>();
    set.add(row.company_id);
    companiesOf.set(row.user_id, set);
  }
  const megaEvents = companyId === MEGA_EVENTS_COMPANY_ID;
  return staff
    .filter((person) => {
      if (person.role === "superadmin") return true;
      if (memberships === null) return megaEvents;
      const companies = companiesOf.get(person.id);
      if (megaEvents) return !companies || companies.has(MEGA_EVENTS_COMPANY_ID);
      return !!companies && companies.has(companyId);
    })
    .map((person) => ({ id: person.id, display_name: person.display_name, email: person.email }));
}

/**
 * The people of a company. `order`: "name" for the reviewer and @mention
 * pickers, "newest" for the assignee picker (the order each always had).
 * Returns null when the staff list itself cannot be read.
 */
export async function taskPeopleOf(
  company: { id: string },
  order: "name" | "newest" = "name",
): Promise<TaskPerson[] | null> {
  const { data: staff, error } = await supabaseTyped
    .from("user_profiles")
    .select("id,display_name,email,role")
    .in("role", STAFF_ROLES)
    .eq("is_active", true)
    .order(order === "name" ? "display_name" : "created_at", { ascending: order === "name" });
  if (error) {
    console.error("task-people: staff list failed", JSON.stringify(error));
    return null;
  }
  const rows = (staff ?? []) as StaffRow[];
  const others = rows.filter((person) => person.role !== "superadmin").map((person) => person.id);
  let memberships: MembershipRow[] | null = [];
  if (others.length > 0) {
    const { data, error: membersError } = await supabaseTyped
      .from("company_members")
      .select("user_id,company_id")
      .in("user_id", others);
    if (membersError) {
      console.error("task-people: memberships read failed", JSON.stringify(membersError));
      memberships = null;
    } else {
      memberships = (data ?? []) as MembershipRow[];
    }
  }
  return pickTaskPeople(rows, memberships, company.id);
}

/** The same people as a set of ids - for checking ids a form sent. null = could not be read. */
export async function taskPeopleIds(company: { id: string }): Promise<Set<string> | null> {
  const people = await taskPeopleOf(company);
  return people ? new Set(people.map((person) => person.id)) : null;
}
