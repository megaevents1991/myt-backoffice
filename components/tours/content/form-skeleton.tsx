import { Skeleton } from "@/components/ui/skeleton";

/**
 * The outline of a content editor while it loads - back link, page header and
 * a few section cards of fields - so the route does not flash a table
 * skeleton before a form. `loading.tsx` of every editor route renders it.
 */
export function FormSkeleton({
  label,
  sections = 3,
  backLink = true,
}: {
  /** Read out to screen readers - say what is loading. */
  label: string;
  sections?: number;
  /** The editor opens under a "Back to ..." link (the settings screen has none). */
  backLink?: boolean;
}) {
  return (
    <div className="space-y-4" role="status">
      <span className="sr-only">{label}…</span>
      {backLink && <Skeleton className="h-4 w-36" />}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      {Array.from({ length: sections }, (_, section) => (
        <div key={section} className="space-y-4 rounded-lg border bg-card p-4">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, field) => (
              <div key={field} className="grid gap-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
