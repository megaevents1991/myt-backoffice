import Link from "next/link";
import { getFootballTeams } from "@/lib/actions/football-actions";
import { getFootballLogos } from "@/lib/actions/football-logo-actions";
import { getLocations } from "@/lib/actions/location-actions";
import { getActiveEvents } from "@/lib/actions/event-actions";
import { Button } from "@/components/ui/button";
import { Images } from "lucide-react";
import { CreativeForm } from "./creative-form";

export default async function CreativeGeneratorPage() {
  const [teams, logos, locations, events] = await Promise.all([
    getFootballTeams(),
    getFootballLogos(),
    getLocations(),
    getActiveEvents(),
  ]);

  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");

  // One merged picker list: logo library first (the curated source), then
  // football_teams CMS rows that actually have an image.
  const subjects = [
    ...logos.map((l) => ({
      ref: `logo:${l.id}`,
      label: l.name_hebrew ?? l.name_english,
      searchText: `${l.name_english} ${l.name_hebrew ?? ""}`.trim(),
    })),
    ...teams
      .filter((t) => t.logo_url || t.art_image_url || t.image_url)
      .map((t) => ({
        ref: `team:${t.id}`,
        label: t.name,
        searchText: `${t.name} ${t.name_english ?? ""}`.trim(),
      })),
  ].sort((a, b) => a.label.localeCompare(b.label, "he"));

  return (
    <div className="container mx-auto py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Creative Generator</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/assets">
            <Images className="mr-2 h-4 w-4" />
            Manage logos ({logos.length})
          </Link>
        </Button>
      </div>
      <CreativeForm
        subjects={subjects}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        events={events
          .filter((e) => new Date(e.date).getTime() >= now)
          .map((e) => {
            const d = new Date(e.date);
            return {
              id: e.id,
              name: e.name,
              dateText: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
              location: e.location?.name ?? "",
            };
          })}
      />
    </div>
  );
}
