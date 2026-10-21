/**
 * Smart departure/return dates for an event date.
 * Departure: 2 days before, moved to Thursday if it lands on Fri/Sat.
 * Return: 1 day after, moved to Sunday if it lands on Saturday.
 * (Extracted verbatim from the single-create flow so both paths match.)
 *
 * Lives in lib/ (moved from app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts, which
 * re-exports it) so a service - the tour uploader - can use it without importing from a page folder.
 * Pure - no DB, no network.
 */
export function calculateSmartDates(eventDate: string): {
  departure: string;
  return: string;
} {
  const event = new Date(eventDate);

  const departure = new Date(event);
  departure.setDate(event.getDate() - 2);
  const departureDay = departure.getDay();
  if (departureDay === 5) {
    departure.setDate(departure.getDate() - 1); // Friday -> Thursday
  } else if (departureDay === 6) {
    departure.setDate(departure.getDate() - 2); // Saturday -> Thursday
  }

  const returnDate = new Date(event);
  returnDate.setDate(event.getDate() + 1);
  if (returnDate.getDay() === 6) {
    returnDate.setDate(returnDate.getDate() + 1); // Saturday -> Sunday
  }

  return {
    departure: departure.toISOString().split("T")[0],
    return: returnDate.toISOString().split("T")[0],
  };
}
