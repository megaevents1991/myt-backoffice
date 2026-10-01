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

type View = "content" | "stubs" | "all";
const VIEWS: View[] = ["content", "stubs", "all"];
const isView = (value: unknown): value is View => VIEWS.includes(value as View);
const VIEW_LABELS: Record<View, string> = { content: "With content", stubs: "No content", all: "All" };

/**
 * The trip pages of the site, on the shared DataTable. Pages the import created
 * only so a series has a home ("stubs") carry no content - they are hidden by
 * default.
 */
export function PackagesTable({ rows, siteUrl }: { rows: PackageListRow[]; siteUrl: string | null }) {
  const router = useRouter();
  const [view, setView] = useSessionState<View>("view", "content", isView);

  const byView = useMemo(
    () => ({
      content: rows.filter((r) => r.hasContent),
      stubs: rows.filter((r) => !r.hasContent),
      all: rows,
    }),
    [rows],
  );

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
        header: ({ column }) => <SortableHeader label="Page Name" column={column} />,
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
      {
        id: "type",
        accessorFn: (row) => packageKindLabel(row.kind),
        header: ({ column }) => <SortableHeader label="Type" column={column} />,
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue<string>()}</span>,
      },
      {
        id: "series",
        accessorFn: (row) => row.seriesCodes.join(" "),
        header: "Series",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.seriesCodes.length ? (
            <div className="flex flex-wrap gap-1" dir="ltr">
              {row.original.seriesCodes.map((code) => (
                <Badge key={code} variant="secondary" className="font-mono text-[11px]">
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
        header: ({ column }) => <SortableHeader label="Upcoming Departures on Site" column={column} />,
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
    [siteUrl],
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
      views={VIEWS.map((id) => ({ id, label: VIEW_LABELS[id], count: byView[id].length }))}
      activeView={view}
      onViewChange={(id) => setView(id as View)}
      onRowClick={(row) => router.push(`/tours/packages/${row.id}`)}
      stateKey="tours-packages"
      emptyState={{
        title: rows.length === 0 ? "No tour pages yet" : "No pages match the filter",
        description:
          rows.length === 0
            ? "Tour pages are created when the company's data is imported."
            : view === "content" && stubs > 0
              ? `${stubs} pages have no content yet. They are listed under the "No content" tab.`
              : "Try a different search or tab.",
      }}
    />
  );
}
