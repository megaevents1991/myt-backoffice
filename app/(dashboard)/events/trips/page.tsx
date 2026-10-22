import { listItineraryRoutes } from "@/lib/actions/itinerary-routes-actions";
import { EventsSubnav } from "@/components/events/events-subnav";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TripsClient } from "./trips-client";

// Any staff member reads and edits trips (requireStaff in the actions). Always fresh: the status line of every trip
// follows its events, which change all day.
export const dynamic = "force-dynamic";

export default async function EventTripsPage() {
  const read = await listItineraryRoutes();

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="טריפים - Euro Trip"
        description="טריפים מוכנים שמוצגים ראשונים בעמוד Build Your Euro Trip באתר. כל טריפ: 2-3 אירועים, כותרת וסדר."
      />

      <EventsSubnav active="trips" />

      {read.status === "table_missing" ? (
        <Alert>
          <AlertTitle>הטבלה עוד לא קיימת - המיגרציה תעלה עם הדחיפה הבאה</AlertTitle>
          <AlertDescription>
            הטריפים נשמרים בטבלת itinerary_routes. אחרי שהמיגרציה תעלה אפשר לבנות כאן את הטריפ הראשון.
          </AlertDescription>
        </Alert>
      ) : read.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>לא ניתן לקרוא את הטריפים</AlertTitle>
          <AlertDescription>{read.message}. רעננו את הדף ונסו שוב.</AlertDescription>
        </Alert>
      ) : (
        <TripsClient routes={read.routes} />
      )}
    </div>
  );
}
