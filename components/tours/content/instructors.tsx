"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";

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
import { saveTourInstructor } from "@/lib/actions/tours-content-actions";
import {
  Field,
  GalleryItemsEditor,
  ImageUrlField,
  NO_UPLOAD_NOTE,
  Pill,
  Section,
  SiteImage,
} from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, ContentSaveBar, EmptyRows } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import type { InstructorEditorData, InstructorForm, InstructorListRow } from "@/components/tours/content/shared";

/** The group instructors shown on the site, in site order. */
export function InstructorsTable({ rows, siteUrl }: { rows: InstructorListRow[]; siteUrl: string | null }) {
  const [query, setQuery] = useSessionState("q", "");
  const [onlyActive, setOnlyActive] = useSessionState("active", false);
  const shown = useMemo(
    () => rows.filter((r) => (onlyActive ? r.isActive : true)).filter((r) => matchesSearch(query, r.name, r.regions, r.slug)),
    [rows, query, onlyActive],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Search by name or destinations" />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} />
          Active only
        </label>
        <span className="text-sm text-muted-foreground">
          {shown.length} of {rows.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">Position</TableHead>
              <TableHead className="w-[64px]">Image</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Destinations</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">{row.position}</TableCell>
                <TableCell>
                  <SiteImage siteUrl={siteUrl} path={row.image} className="h-10 w-10 rounded-full" alt={row.name} />
                </TableCell>
                <TableCell>
                  <Link href={`/tours/instructors/${row.id}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[420px] truncate text-muted-foreground" title={row.regions ?? undefined}>
                  {row.regions}
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "outline" : "destructive"}>{row.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/tours/instructors/${row.id}`} aria-label={`Edit ${row.name}`} title="Edit">
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
            title={rows.length === 0 ? "No group leaders yet" : "No group leaders match the filter"}
            description={rows.length === 0 ? "Group leaders are created when the site's data is imported." : "Try a different search."}
          />
        )}
      </div>
    </div>
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
            <Pill tone={saved.form.isActive ? "on" : "off"}>{saved.form.isActive ? "Active" : "Inactive"}</Pill>
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

      <Section description={NO_UPLOAD_NOTE}>
        <ImageUrlField label="Image" value={form.image} onChange={(value) => set("image", value)} siteUrl={saved.siteUrl} />
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
        />
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
