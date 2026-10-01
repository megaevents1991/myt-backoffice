"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/search-input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { useSessionState } from "@/hooks/use-view-state";
import { matchesSearch } from "@/lib/search";
import { saveTourCmsPage } from "@/lib/actions/tours-content-actions";
import { Field, Pill, Section } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, ContentSaveBar, EmptyRows } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import {
  cmsPageKindLabel,
  siteAssetUrl,
  type CmsPageEditorData,
  type CmsPageForm,
  type CmsPageListRow,
} from "@/components/tours/content/shared";

/** The free content pages of the site (about, FAQ, legal, contact) and its posts. */
export function CmsPagesTable({ rows }: { rows: CmsPageListRow[] }) {
  const [query, setQuery] = useSessionState("q", "");
  const shown = useMemo(() => rows.filter((r) => matchesSearch(query, r.title, r.path)), [rows, query]);

  return (
    <div className="space-y-3">
      <SearchInput value={query} onValueChange={setQuery} placeholder="Search by title or path" />
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Content</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/tours/pages/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <span dir="ltr" className="inline-block">
                    {row.path}
                  </span>
                </TableCell>
                <TableCell>{cmsPageKindLabel(row.kind)}</TableCell>
                <TableCell>
                  {row.hasContent ? <Badge variant="outline">Has content</Badge> : <Badge variant="secondary">Empty</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "outline" : "destructive"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/pages/${row.id}`} aria-label={`Edit ${row.title}`} title="Edit">
                      <Pencil />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {shown.length === 0 && (
          <EmptyRows
            title={rows.length === 0 ? "No content pages yet" : "No pages match the search"}
            description={rows.length === 0 ? "Content pages are created when the site's data is imported." : "Try a different search."}
          />
        )}
      </div>
    </div>
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
        description={
          <Pill tone={saved.form.isActive ? "on" : "off"}>{saved.form.isActive ? "Active on site" : "Inactive"}</Pill>
        }
        actions={
          <>
            {liveUrl && (
              <Button asChild variant="ghost">
                <a href={liveUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  View on Site
                </a>
              </Button>
            )}
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

      <ContentSaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => void submit()}
        onDiscard={discard}
        disabledReason={problem}
      />
    </div>
  );
}
