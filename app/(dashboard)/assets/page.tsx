import { getFootballLogos } from "@/lib/actions/football-logo-actions";
import { LogoLibrary } from "./logo-library";

// Shared design-asset library. Currently football logos for the creative
// generator; future sections (backgrounds, blob art, brand assets) slot in
// here as more tabs/sections instead of new one-off pages.
export default async function AssetsPage() {
  const logos = await getFootballLogos();

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-1">Assets</h1>
      <p className="text-muted-foreground mb-6">
        Shared media library for creatives and marketing.
      </p>
      <section>
        <h2 className="text-xl font-semibold mb-4">
          Football Logos ({logos.length})
        </h2>
        <LogoLibrary initialLogos={logos} />
      </section>
    </div>
  );
}
