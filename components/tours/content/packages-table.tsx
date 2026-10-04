"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { DataTable, SortableHeader } from "@/components/data-table";
import { useSessionState } from "@/hooks/use-view-state";
import { activeColumn, contentColumn, editColumn, imageColumn } from "@/components/tours/content/columns";
import {
  PACKAGE_BRAND_COLORS,
  packageKindLabel,
  type PackageBrand,
  type PackageListRow,
} from "@/components/tours/content/shared";

type View = "content" | "stubs" | "all" | "packages";
const VIEWS: View[] = ["content", "stubs", "all", "packages"];
const isView = (value: unknown): value is View => VIEWS.includes(value as View);
const VIEW_LABELS: Record<View, string> = {
  content: "With content",
  stubs: "No content",
  all: "All tours",
  packages: "Vacation packages",
};

/**
 * The organized tours of the site, on the shared DataTable. Pages the import
 * created only so a series has a home ("stubs") carry no content - they are
 * hidden by default. Vacation packages are no longer managed here (Alon,
 * 04.10.2026): the ones that still exist sit apart, under their own tab, so
 * they can be switched off - the tab is gone once there are none.
 */
export function PackagesTable({ rows, siteUrl }: { rows: PackageListRow[]; siteUrl: string | null }) {
  const router = useRouter();
  const [stored, setView] = useSessionState<View>("view", "content", isView);

  const byView = useMemo(() => {
    const organized = rows.filter((r) => r.kind === "organized");
    return {
      content: organized.filter((r) => r.hasContent),
      stubs: organized.filter((r) => !r.hasContent),
      all: organized,
      packages: rows.filter((r) => r.kind !== "organized"),
    };
  }, [rows]);
  const views = VIEWS.filter((id) => id !== "packages" || byView.packages.length > 0);
  const view: View = views.includes(stored) ? stored : "content";

  const columns = useMemo<ColumnDef<PackageListRow>[]>(
    () => [
      imageColumn<PackageListRow>(
        siteUrl,
        (row) => row.cardImage,
        (row) => row.name,
      ),
      {
        // The search reads the subtitle and the slug too; the sort is by name only.
        id: "name",
        accessorFn: (row) => [row.name, row.subtitle, row.slug].filter(Boolean).join(" "),
        sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
        header: ({ column }) => <SortableHeader label="Tour" column={column} />,
        cell: ({ row }) => (
          <>
            <Link href={`/tours/packages/${row.original.id}`} className="font-medium hover:underline">
              <span
                aria-hidden
                className="me-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: PACKAGE_BRAND_COLORS[row.original.brand as PackageBrand] ?? "#9ca3af" }}
              />
              {row.original.name}
            </Link>
            {row.original.subtitle && <div className="text-xs text-muted-foreground">{row.original.subtitle}</div>}
          </>
        ),
      },
      // every row of the tours tabs is an organized tour - the type says something only among the packages
      ...(view === "packages"
        ? [
            {
              id: "type",
              accessorFn: (row) => packageKindLabel(row.kind),
              header: ({ column }) => <SortableHeader label="Type" column={column} />,
              cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue<string>()}</span>,
            } satisfies ColumnDef<PackageListRow>,
          ]
        : []),
      {
        id: "series",
        accessorFn: (row) => row.seriesCodes.join(" "),
        header: "Series",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.seriesCodes.length ? (
            <div className="flex flex-wrap gap-1" dir="ltr">
              {row.original.seriesCodes.map((code) => (
                <Badge key={code} variant="secondary" className="font-mono text-xs font-semibold">
                  {code}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">None</span>
          ),
      },
      {
        accessorKey: "futurePublished",
        header: ({ column }) => <SortableHeader label="Upcoming Dates on Site" column={column} />,
        cell: ({ row }) =>
          row.original.futurePublished > 0 ? (
            <span className="font-medium">{row.original.futurePublished}</span>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
      },
      contentColumn(),
      activeColumn(),
      editColumn(
        (row) => `/tours/packages/${row.id}`,
        (row) => row.name,
      ),
    ],
    [siteUrl, view],
  );

  const stubs = byView.stubs.length;

  return (
    <DataTable
      columns={columns}
      data={byView[view]}
      searchColumns={["name", "series"]}
      searchPlaceholder="Search by name, slug or series code"
      defaultPageSize={50}
      getRowId={(row) => row.id}
      views={views.map((id) => ({ id, label: VIEW_LABELS[id], count: byView[id].length }))}
      activeView={view}
      onViewChange={(id) => setView(id as View)}
      onRowClick={(row) => router.push(`/tours/packages/${row.id}`)}
      stateKey="tours-packages"
      emptyState={{
        title: rows.length === 0 ? "No tours yet" : "No tours match the filter",
        description:
          rows.length === 0
            ? "Click Add Tour to create the first one."
            : view === "content" && stubs > 0
              ? `${stubs} tours have no content yet. They are listed under the "No content" tab.`
              : "Try a different search or tab.",
      }}
    />
  );
}
