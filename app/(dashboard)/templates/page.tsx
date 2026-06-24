import Link from "next/link";

// The Templates hub — one entry per content type. New types are added here as
// we migrate them off Contentful (artists, football teams, blog, carousel...).
const TEMPLATE_TYPES: {
  segment: string;
  title: string;
  description: string;
  enabled: boolean;
}[] = [
  {
    segment: "categories",
    title: "Categories",
    description: "Category cards & category pages (e.g. Champions League, F1).",
    enabled: true,
  },
  { segment: "artists", title: "Artists", description: "Artist pages.", enabled: true },
  { segment: "football", title: "Football Teams", description: "Team pages.", enabled: true },
  { segment: "blog", title: "Blog", description: "Blog posts.", enabled: true },
];

export default function TemplatesHubPage() {
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-2">Templates</h1>
      <p className="text-muted-foreground mb-6">
        Backoffice CMS — replacing Contentful. Pick a content type to manage.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATE_TYPES.map((t) =>
          t.enabled ? (
            <Link
              key={t.segment}
              href={`/templates/${t.segment}`}
              className="rounded-lg border p-5 transition-colors hover:bg-muted"
            >
              <h2 className="text-lg font-semibold">{t.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
            </Link>
          ) : (
            <div
              key={t.segment}
              className="rounded-lg border p-5 opacity-50 cursor-not-allowed"
            >
              <h2 className="text-lg font-semibold">{t.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
              <span className="mt-2 inline-block text-xs font-medium text-muted-foreground">
                Coming soon
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
