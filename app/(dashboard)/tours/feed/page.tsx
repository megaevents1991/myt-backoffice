import { getFeedScreen } from "@/lib/actions/tours-feed-actions";
import { PageLoadError } from "@/components/tours/content/save-bar";
import { FeedScreen } from "@/components/tours/site/feed-screen";

export const dynamic = "force-dynamic";
// "Sync now" draws the missing pictures (up to ~3 minutes) before it publishes
export const maxDuration = 300;
export const metadata = { title: "Product Feed" };

/** Website > Product Feed: the company's Meta catalog feed (mega-family docs/plans/PRODUCT-FEED-PLAN.md, 08.11.2026). */
export default async function ToursFeedPage() {
  const result = await getFeedScreen();
  if (!result.success) return <PageLoadError message={result.error} />;
  return <FeedScreen initial={result.data} />;
}
