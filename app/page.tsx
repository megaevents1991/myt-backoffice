import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/guards"

const PARTNER_ROLES = ["agent", "affiliate"]

export default async function RootPage() {
  const session = await getSession()
  if (session && PARTNER_ROLES.includes(session.role)) {
    redirect("/portal")
  }
  redirect("/dashboard")
}
