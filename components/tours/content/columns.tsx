"use client";

/**
 * The columns every site-content list repeats (trip pages, content pages,
 * categories, hotels, group leaders): the picture, the content and status
 * chips, and the edit pencil at the end of the row. One copy each.
 */
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActiveChip } from "@/components/tours/ui";
import { SiteImage } from "@/components/tours/content/fields";

/** The row's picture as the site serves it. `className` sizes it: a card picture by default. */
export function imageColumn<T>(
  siteUrl: string | null,
  path: (row: T) => string | null | undefined,
  alt: (row: T) => string,
  className = "h-10 w-14",
): ColumnDef<T> {
  return {
    id: "image",
    header: "Image",
    enableSorting: false,
    cell: ({ row }) => (
      <SiteImage siteUrl={siteUrl} path={path(row.original)} className={className} alt={alt(row.original)} />
    ),
  };
}

/** Whether the page has content yet - a page the import created only as a home for a series has none. */
export function contentColumn<T extends { hasContent: boolean }>(): ColumnDef<T> {
  return {
    id: "content",
    accessorFn: (row) => row.hasContent,
    header: "Content",
    cell: ({ row }) =>
      row.original.hasContent ? <Badge variant="outline">Has content</Badge> : <Badge variant="secondary">No content</Badge>,
  };
}

/** Active / Inactive on the site. */
export function activeColumn<T extends { isActive: boolean }>(): ColumnDef<T> {
  return {
    id: "status",
    accessorFn: (row) => row.isActive,
    header: "Status",
    cell: ({ row }) => <ActiveChip active={row.original.isActive} />,
  };
}

/** The pencil at the end of a row, to the row's editor. */
export function editColumn<T>(href: (row: T) => string, name: (row: T) => string): ColumnDef<T> {
  return {
    id: "actions",
    header: "",
    enableHiding: false,
    cell: ({ row }) => (
      <Button asChild variant="ghost" size="icon" className="h-8 w-8">
        <Link href={href(row.original)} aria-label={`Edit ${name(row.original)}`} title="Edit">
          <Pencil />
        </Link>
      </Button>
    ),
  };
}
