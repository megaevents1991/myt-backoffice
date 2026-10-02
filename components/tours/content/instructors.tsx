"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, SortableHeader } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { useSessionState } from "@/hooks/use-view-state";
import { saveTourInstructor } from "@/lib/actions/tours-content-actions";
import { ActiveChip, Field, Section } from "@/components/tours/ui";
import { activeColumn, editColumn, imageColumn } from "@/components/tours/content/columns";
import { GalleryItemsEditor, IMAGE_FIELDS_NOTE, ImageUrlField } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_UNSAVED_NOTE } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import type { InstructorEditorData, InstructorForm, InstructorListRow } from "@/components/tours/content/shared";

type View = "all" | "active";
const isView = (value: unknown): value is View => value === "all" || value === "active";

/** The group instructors shown on the site, in site order, on the shared DataTable. */
export function InstructorsTable({ rows, siteUrl }: { rows: InstructorListRow[]; siteUrl: string | null }) {
  const router = useRouter();
  const [view, setView] = useSessionState<View>("view", "all", isView);
  const active = useMemo(() => rows.filter((r) => r.isActive), [rows]);

  const columns = useMemo<ColumnDef<InstructorListRow>[]>(
    () => [
      {
        accessorKey: "position",
        header: ({ column }) => <SortableHeader label="Position" column={column} />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.position}</span>,
      },
      imageColumn<InstructorListRow>(
        siteUrl,
        (row) => row.image,
        (row) => row.name,
        "h-10 w-10 rounded-full",
      ),
      {
        // The search reads the slug too; the sort is by name only.
        id: "name",
        accessorFn: (row) => `${row.name} ${row.slug}`,
        sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
        header: ({ column }) => <SortableHeader label="Name" column={column} />,
        cell: ({ row }) => (
          <Link href={`/tours/instructors/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "regions",
        header: "Destinations",
        cell: ({ row }) => (
          <div className="max-w-[420px] truncate text-muted-foreground" title={row.original.regions ?? undefined}>
            {row.original.regions}
          </div>
        ),
      },
      activeColumn(),
      editColumn(
        (row) => `/tours/instructors/${row.id}`,
        (row) => row.name,
      ),
    ],
    [siteUrl],
  );

  return (
    <DataTable
      columns={columns}
      data={view === "active" ? active : rows}
      searchColumns={["name", "regions"]}
      searchPlaceholder="Search by name or destinations"
      defaultPageSize={50}
      getRowId={(row) => row.id}
      views={[
        { id: "all", label: "All", count: rows.length },
        { id: "active", label: "Active", count: active.length },
      ]}
      activeView={view}
      onViewChange={(id) => setView(id as View)}
      onRowClick={(row) => router.push(`/tours/instructors/${row.id}`)}
      stateKey="tours-instructors"
      emptyState={{
        title: rows.length === 0 ? "No group leaders yet" : "No group leaders match the filter",
        description: rows.length === 0 ? "Group leaders are created when the site's data is imported." : "Try a different search.",
      }}
    />
  );
}

/** Editor of one instructor. */
export function InstructorFormEditor({ initial }: { initial: InstructorEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<InstructorForm, InstructorEditorData>(
    initial,
    (values) => saveTourInstructor(initial.id, values),
  );
  const problem = !form.name.trim() ? "Name is required" : null;

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/instructors">Back to Group Leaders</BackLink>
      <PageHeader
        eyebrow="Group leader"
        title={saved.form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ActiveChip active={saved.form.isActive} />
            <span>Slug: {saved.slug}</span>
          </span>
        }
        actions={<PublishSiteButton />}
      />

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Name" className="md:col-span-2">
            <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Position in list" hint="Lower numbers come first">
            <Input
              type="number"
              min={0}
              dir="ltr"
              value={form.position}
              onChange={(e) => set("position", Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
            />
          </Field>
          <div className="flex items-center gap-3 self-end rounded-md border p-3">
            <Switch id="instructor-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            <label htmlFor="instructor-active" className="text-sm font-medium">
              Active on site
            </label>
          </div>
          <Field label="Destinations" className="md:col-span-4">
            <Input dir="auto" value={form.regions} onChange={(e) => set("regions", e.target.value)} />
          </Field>
          <Field label="Excerpt" hint="The short text on the group leader's card" className="md:col-span-4">
            <Textarea dir="auto" rows={4} value={form.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section description={IMAGE_FIELDS_NOTE}>
        <ImageUrlField label="Image" value={form.image} onChange={(value) => set("image", value)} siteUrl={saved.siteUrl} folder="instructors" />
      </Section>

      <Section>
        <HtmlField
          label="Page content"
          value={form.contentHtml}
          onChange={(value) => set("contentHtml", value)}
          siteUrl={saved.siteUrl}
          rows={12}
        />
      </Section>

      <Section>
        <GalleryItemsEditor
          label="Gallery (thank-you letters, photos)"
          value={form.gallery}
          onChange={(value) => set("gallery", value)}
          siteUrl={saved.siteUrl}
          folder="instructors"
        />
      </Section>

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => void submit()}
        onDiscard={discard}
        disabled={!!problem}
        disabledReason={problem ?? undefined}
        showDisabledReason
        message={CONTENT_UNSAVED_NOTE}
      />
    </div>
  );
}
