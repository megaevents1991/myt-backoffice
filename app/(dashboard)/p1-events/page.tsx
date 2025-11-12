// app/(dashboard)/p1-events/page.tsx

import { P1EventsContent } from "./p1-events-content";

export default function P1EventsPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">P1 Tickets Events</h1>
        <p className="text-muted-foreground mt-2">
          Browse and manage P1 Tickets events from XML feeds
        </p>
      </div>
      <P1EventsContent />
    </div>
  );
}
