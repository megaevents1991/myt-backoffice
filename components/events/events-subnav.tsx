import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "events", href: "/events", label: "אירועים (Events)" },
  { key: "trips", href: "/events/trips", label: "טריפים (Euro Trip)" },
  { key: "requests", href: "/events/trips/requests", label: "בקשות טריפים" },
] as const;

/**
 * The tabs at the top of Events: the events table, the staff-built Euro Trips and the trips customers offered
 * (their requests). Plain links styled like the shadcn TabsList / TabsTrigger (those need a Radix Tabs root;
 * these are pages). The strip is fixed `ltr` so it sits in the same place, in the same order, on /events (an
 * LTR screen) and the trips screens (RTL): switching tabs never moves them.
 */
export function EventsSubnav({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Events sections" dir="ltr">
      <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
        {TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              data-state={current ? "active" : "inactive"}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
                !current && "hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
