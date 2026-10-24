import { listRouteRequests } from "@/lib/actions/itinerary-routes-actions";
import { EventsSubnav } from "@/components/events/events-subnav";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RequestsClient } from "./requests-client";

// Any staff member reads and handles requests (requireStaff in the actions). Always fresh: customers add them
// with every held trip, and each group's status line follows its events.
export const dynamic = "force-dynamic";

export default async function TripRequestsPage() {
  const read = await listRouteRequests();

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="בקשות טריפים - Euro Trip"
        description="טיולים שלקוחות בנו בעצמם והציעו לאחרים, עם השם שנתנו. הופכים בקשה לטריפ מוכן בלחיצה, או דוחים."
      />

      <EventsSubnav active="requests" />

      {read.status === "table_missing" ? (
        <Alert>
          <AlertTitle>הטבלה עוד לא קיימת - המיגרציה תעלה עם הדחיפה הבאה</AlertTitle>
          <AlertDescription>הבקשות נשמרות בטבלת itinerary_route_requests. אחרי שהמיגרציה תעלה הן יופיעו כאן.</AlertDescription>
        </Alert>
      ) : read.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>לא ניתן לקרוא את הבקשות</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>
              <bdi>{read.message}</bdi>
            </p>
            {!read.message.includes("ונסו שוב") && <p>רעננו את הדף ונסו שוב.</p>}
          </AlertDescription>
        </Alert>
      ) : (
        <RequestsClient groups={read.groups} nextSortOrder={read.nextSortOrder} />
      )}
    </div>
  );
}
