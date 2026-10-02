"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, SortableHeader } from "@/components/data-table";
import { useSessionState } from "@/hooks/use-view-state";
import { activeColumn, editColumn } from "@/components/tours/content/columns";
import { TERM_KINDS, TERM_KIND_LABELS, type TermKind, type TermListRow } from "@/components/tours/content/shared";

const isKind = (value: unknown): value is TermKind => TERM_KINDS.includes(value as TermKind);

/** The taxonomies of the site on the shared DataTable, one kind (a view) at a time. */
export function TermsTable({ rows }: { rows: TermListRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useSessionState<TermKind>("kind", "destinations", isKind);

  const byKind = useMemo(() => {
    const map = new Map<string, TermListRow[]>();
    for (const row of rows) map.set(row.kind, [...(map.get(row.kind) ?? []), row]);
    return map;
  }, [rows]);

  const columns = useMemo<ColumnDef<TermListRow>[]>(
    () => [
      {
        accessorKey: "position",
        header: ({ column }) => <SortableHeader label="Position" column={column} />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.position}</span>,
      },
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader label="Name" column={column} />,
        cell: ({ row }) => (
          <Link href={`/tours/terms/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.slug}</span>,
      },
      {
        accessorKey: "pages",
        header: ({ column }) => <SortableHeader label="Tours" column={column} />,
        cell: ({ row }) => (row.original.pages > 0 ? row.original.pages : <span className="text-muted-foreground">0</span>),
      },
      {
        accessorKey: "heroImages",
        header: ({ column }) => <SortableHeader label="Hero Images" column={column} />,
        cell: ({ row }) =>
          row.original.heroImages > 0 ? row.original.heroImages : <span className="text-muted-foreground">0</span>,
      },
      activeColumn(),
      editColumn(
        (row) => `/tours/terms/${row.id}`,
        (row) => row.name,
      ),
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={byKind.get(kind) ?? []}
      searchColumns={["name", "slug"]}
      searchPlaceholder="Search by name or slug"
      defaultPageSize={50}
      getRowId={(row) => row.id}
      views={TERM_KINDS.map((k) => ({ id: k, label: TERM_KIND_LABELS[k], count: byKind.get(k)?.length ?? 0 }))}
      activeView={kind}
      onViewChange={(id) => setKind(id as TermKind)}
      onRowClick={(row) => router.push(`/tours/terms/${row.id}`)}
      stateKey="tours-terms"
      emptyState={{
        title: `No ${TERM_KIND_LABELS[kind].toLowerCase()} in this company yet`,
        description: "Categories and tags are created when the site's data is imported.",
      }}
    />
  );
}
