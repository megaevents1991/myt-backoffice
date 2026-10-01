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
import { saveTourCmsPage } from "@/lib/actions/tours-content-actions";
import { ActiveChip, Field, Section } from "@/components/tours/ui";
import { activeColumn, contentColumn, editColumn } from "@/components/tours/content/columns";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import {
  cmsPageKindLabel,
  siteAssetUrl,
  type CmsPageEditorData,
  type CmsPageForm,
  type CmsPageListRow,
} from "@/components/tours/content/shared";

/** The free content pages of the site (about, FAQ, legal, contact) and its posts, on the shared DataTable. */
export function CmsPagesTable({ rows }: { rows: CmsPageListRow[] }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<CmsPageListRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <SortableHeader label="Title" column={column} />,
        cell: ({ row }) => (
          <Link href={`/tours/pages/${row.original.id}`} className="font-medium hover:underline">
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "path",
        header: ({ column }) => <SortableHeader label="Path" column={column} />,
        cell: ({ row }) => (
          <span dir="ltr" className="inline-block text-xs text-muted-foreground">
            {row.original.path}
          </span>
        ),
      },
      {
        id: "type",
        accessorFn: (row) => cmsPageKindLabel(row.kind),
        header: ({ column }) => <SortableHeader label="Type" column={column} />,
      },
      contentColumn(),
      activeColumn(),
      editColumn(
        (row) => `/tours/pages/${row.id}`,
        (row) => row.title,
      ),
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchColumns={["title", "path"]}
      searchPlaceholder="Search by title or path"
      defaultPageSize={50}
      getRowId={(row) => row.id}
      onRowClick={(row) => router.push(`/tours/pages/${row.id}`)}
      stateKey="tours-cms-pages"
      emptyState={{
        title: "No content pages yet",
        description: "Content pages are created when the site's data is imported.",
      }}
    />
  );
}

/** Editor of one content page. The address is fixed: other pages and the menus link to it. */
export function CmsPageFormEditor({ initial }: { initial: CmsPageEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<CmsPageForm, CmsPageEditorData>(
    initial,
    (values) => saveTourCmsPage(initial.id, values),
  );
  const problem = !form.title.trim() ? "Title is required" : null;
  const liveUrl = saved.form.isActive ? siteAssetUrl(saved.siteUrl, saved.path) : null;

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/pages">Back to Content Pages</BackLink>
      <PageHeader
        eyebrow={cmsPageKindLabel(saved.kind)}
        title={saved.form.title}
        description={<ActiveChip active={saved.form.isActive} />}
        actions={
          <>
            <ViewOnSiteButton href={liveUrl} />
            <PublishSiteButton />
          </>
        }
      />

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Title" className="md:col-span-2">
            <Input dir="auto" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Path" hint="Fixed: menus and other pages link to it.">
            <Input dir="ltr" value={saved.path} readOnly disabled />
          </Field>
          <div className="flex items-center gap-3 self-start rounded-md border p-3 md:mt-6">
            <Switch id="page-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            <label htmlFor="page-active" className="text-sm font-medium">
              Active on site
            </label>
          </div>
        </div>
      </Section>

      <Section>
        <HtmlField
          label="Page content"
          value={form.contentHtml}
          onChange={(value) => set("contentHtml", value)}
          siteUrl={saved.siteUrl}
          rows={22}
          hint="The preview shows the content without the site's styling, so a page imported from WordPress looks plainer here than on the site."
        />
      </Section>

      <Section title="SEO" description="What search engines and social networks show for this page.">
        <Field label="Title" hint={`${form.seoTitle.length} characters. Up to 60 recommended.`}>
          <Input dir="auto" value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
        </Field>
        <Field label="Description" hint={`${form.seoDescription.length} characters. Up to 160 recommended.`}>
          <Textarea dir="auto" rows={3} value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
        </Field>
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
