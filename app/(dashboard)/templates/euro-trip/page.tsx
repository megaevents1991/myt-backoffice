import { redirect } from "next/navigation";

// /templates/euro-trip has no page of its own yet - the breadcrumb ("Templates / Euro Trip / Settings") links
// here, so it lands on the one screen under it. When the routes screens arrive this becomes their hub.
export default function EuroTripIndexPage() {
  redirect("/templates/euro-trip/settings");
}
