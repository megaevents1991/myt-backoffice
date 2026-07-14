import { getFootballTeams } from "@/lib/actions/football-actions";
import { getLocations } from "@/lib/actions/location-actions";
import { getActiveEvents } from "@/lib/actions/event-actions";
import { CreativeForm } from "./creative-form";

export default async function CreativeGeneratorPage() {
  const [teams, locations, events] = await Promise.all([
    getFootballTeams(),
    getLocations(),
    getActiveEvents(),
  ]);

  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-6">Creative Generator</h1>
      <CreativeForm
        teams={teams
          .filter((t) => t.logo_url || t.art_image_url || t.image_url)
          .map((t) => ({ id: t.id, name: t.name }))}
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
