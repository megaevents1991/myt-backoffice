"use client";

import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { saveTourTerm } from "@/lib/actions/tours-content-actions";
import { ActiveChip, Field, Section } from "@/components/tours/ui";
import { ImageListEditor, NO_UPLOAD_NOTE } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_UNSAVED_NOTE } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import { termKindLabel, type TermEditorData, type TermForm } from "@/components/tours/content/shared";

/** Editor of one taxonomy term (a destination, an audience, a tag...). */
export function TermFormEditor({ initial }: { initial: TermEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<TermForm, TermEditorData>(
    initial,
    (values) => saveTourTerm(initial.id, values),
  );
  const problem = !form.name.trim() ? "Name is required" : null;

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/terms">Back to Categories & Tags</BackLink>
      <PageHeader
        eyebrow={termKindLabel(saved.kind)}
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
            <Switch id="term-active" checked={form.isActive} onCheckedChange={(on) => set("isActive", on)} />
            <label htmlFor="term-active" className="text-sm font-medium">
              Active on site
            </label>
          </div>
        </div>
      </Section>

      <Section>
        <HtmlField
          label="Description"
          value={form.descriptionHtml}
          onChange={(value) => set("descriptionHtml", value)}
          siteUrl={saved.siteUrl}
          hint="Shown at the top of the category page on the site. The text without formatting is also used as the search engine description."
        />
      </Section>

      <Section description={NO_UPLOAD_NOTE}>
        <ImageListEditor
          label="Hero images"
          value={form.heroImages}
          onChange={(value) => set("heroImages", value)}
          siteUrl={saved.siteUrl}
        />
      </Section>

      <Section title={`Tour pages in this category (${saved.pages.length})`} description="Assignments are edited in the Categories & Tags tab of the tour page.">
        {saved.pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tour pages are assigned to this category.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {saved.pages.map((page) => (
              <li key={page.id}>
                <Link
                  href={`/tours/packages/${page.id}?tab=terms`}
                  className="rounded-md border px-2.5 py-1 text-sm hover:bg-muted"
                >
                  {page.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
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
