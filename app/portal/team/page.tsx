import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";
import { listOfficeUsers } from "@/lib/actions/portal-team-actions";
import { TeamClient } from "./team-client";

export default async function PortalTeamPage() {
  const session = await getSession();
  // Manager-only page; agents/affiliates land back on the dashboard. Staff
  // debugging the portal (no partner session) see nothing rather than a crash.
  if (!session || session.role !== "office_manager") redirect("/portal");

  const users = await listOfficeUsers();
  return <TeamClient initialUsers={users} myId={session.sub} />;
}
