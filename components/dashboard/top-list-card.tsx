import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type TopItem = { label: string; count: number };

/** A short ranked list of a dashboard: "Top Events (30d)", "Top Sources (30d)". */
export function TopListCard({ title, items, loading }: { title: string; items: TopItem[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          <ul className="text-xs space-y-1">
            {items.map((it) => (
              <li key={it.label} className="flex justify-between">
                <span className="truncate max-w-[70%]" title={it.label}>{it.label}</span>
                <span className="font-medium">{it.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
