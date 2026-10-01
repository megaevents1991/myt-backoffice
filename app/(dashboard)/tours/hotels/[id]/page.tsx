import { getTourHotel } from "@/lib/actions/tours-content-actions";
import { HotelFormEditor } from "@/components/tours/content/hotels";
import { LoadError } from "@/components/tours/content/save-bar";

export const dynamic = "force-dynamic";

export default async function TourHotelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTourHotel(id);
  if (!result.success) {
    return <LoadError message={result.error} backHref="/tours/hotels" backLabel="Back to Hotels" />;
  }
  return <HotelFormEditor key={result.data.id} initial={result.data} />;
}
