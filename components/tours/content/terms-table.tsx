"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, SortableHeader } from "@/components/data-table";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { viewStateKey } from "@/lib/view-state";
import { createTourTerm } from "@/lib/actions/tours-catalog-actions";
import { Field, Notice } from "@/components/tours/ui";
import { activeColumn, editColumn } from "@/components/tours/content/columns";
import {
  PACKAGE_TERM_KINDS,
  TERM_KINDS,
  TERM_KIND_LABELS,
  type TermKind,
  type TermListRow,
} from "@/components/tours/content/shared";

const isKind = (value: unknown): value is TermKind => TERM_KINDS.includes(value as TermKind);

/** The table's view (a kind) is kept per tab under this name; Add reads it to start on the same kind. */
const KIND_STATE = "kind";
const DEFAULT_KIND: TermKind = "destinations";

/** The taxonomies of the site on the shared DataTable, one kind (a view) at a time. */
export function TermsTable({ rows }: { rows: TermListRow[] }) {
  const router = useRouter();
  const [kind, setKind] = useSessionState<TermKind>(KIND_STATE, DEFAULT_KIND, isKind);

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
        description: PACKAGE_TERM_KINDS.includes(kind)
          ? "Add one with Add Category or Tag at the top of the page."
          : "A tour's own term comes with the site's data and is not added here.",
      }}
    />
  );
}

/** The last kind the table showed in this tab, when a tour can be attached to it. */
function lastViewedKind(pathname: string): TermKind {
  try {
    const raw = window.sessionStorage.getItem(viewStateKey(pathname, KIND_STATE));
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (isKind(stored) && PACKAGE_TERM_KINDS.includes(stored)) return stored;
  } catch {
    // blocked storage or an old value - start on the default
  }
  return DEFAULT_KIND;
}

/** "Add Category or Tag" in the page header: kind + name, then the new term's page to finish it. */
export function AddTermButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusCircle className="me-2 h-4 w-4" />
        Add Category or Tag
      </Button>
      {open && <AddTermDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AddTermDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/tours/terms";
  const [kind, setKind] = useState<TermKind>(() => lastViewedKind(pathname));
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const run = useActionToast();
  const problem = !name.trim() ? "Enter a name" : null;

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (problem || isPending) return;
    startTransition(async () => {
      const result = await run(
        () => createTourTerm({ kind, name: name.trim() }),
        (answer) => (answer.warning ? "Already in the list" : `Added to ${TERM_KIND_LABELS[kind]}`),
      );
      if (!result.success) return;
      try {
        // back on the list, the table opens on the kind just added to
        window.sessionStorage.setItem(viewStateKey(pathname, KIND_STATE), JSON.stringify(result.data.kind));
      } catch {
        // not worth failing over
      }
      router.push(`/tours/terms/${result.data.id}`);
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader className="pt-4 text-start sm:text-start">
            <DialogTitle>Add Category or Tag</DialogTitle>
            <DialogDescription>
              It opens on its own page next, where you add a description and hero images.
            </DialogDescription>
          </DialogHeader>
          <Field label="Kind" htmlFor="new-term-kind">
            <Select value={kind} onValueChange={(value) => setKind(value as TermKind)} disabled={isPending}>
              <SelectTrigger id="new-term-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PACKAGE_TERM_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TERM_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Name" htmlFor="new-term-name" hint="As the site shows it. The slug is made from the name.">
            <Input
              id="new-term-name"
              dir="auto"
              autoFocus
              maxLength={300}
              value={name}
              disabled={isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Notice tone="info">It is created active. The site shows it after you publish.</Notice>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || isPending} title={problem ?? undefined}>
              {isPending && <Loader2 className="animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
