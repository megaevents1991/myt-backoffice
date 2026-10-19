import { getEventsScreen } from "@/lib/actions/tours-events-actions";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { EventsControlScreen } from "@/components/tours/site/events-control-screen";

export const dynamic = "force-dynamic";
// Save and "Sync now" run the Mega Events packages sync for this company (the cron allows it 300 s too).
export const maxDuration = 300;
export const metadata = { title: "Mega Events Packages" };

/** What the company's site shows of Mega Events' packages (Website > Mega Events Packages, 19.10.2026). */
export default async function ToursEventsPage() {
  const result = await getEventsScreen();
  if (!result.success) return <PageLoadError message={result.error} />;
  return <EventsControlScreen initial={result.data} />;
}
