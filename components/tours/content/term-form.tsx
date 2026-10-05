"use client";

import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { saveTourTerm } from "@/lib/actions/tours-content-actions";
import { ActiveChip, Field, Notice, Section, selectClass } from "@/components/tours/ui";
import { IMAGE_FIELDS_NOTE, ImageListEditor, ImageUrlField } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { BackLink, CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import { siteAssetUrl, termKindLabel, type TermEditorData, type TermForm } from "@/components/tours/content/shared";
import { ColorInput } from "@/components/tours/site/site-fields";
import { cn } from "@/lib/utils";

/** What the page of each kind is, in one line under the title. */
const KIND_NOTES: Record<string, string> = {
  destinations: "A destination page lists every tour that goes there, by itself.",
  audiences: "A world is a top category of the site: its page lists its tours and its sub-categories (the tags attached to it), by itself.",
  tags: "A tag page lists every tour that carries the tag, by itself. Attach the tag to a world to make it one of the world's sub-categories.",
  categories: "A category page lists every tour of the category, by itself.",
};

/** Editor of one taxonomy term (a destination, a world, a tag, a category). */
export function TermFormEditor({ initial }: { initial: TermEditorData }) {
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<TermForm, TermEditorData>(
    initial,
    (values) => saveTourTerm(initial.id, values),
  );
  const problem = !form.name.trim() ? "Name is required" : null;
  const isWorld = saved.kind === "audiences";
  const isTag = saved.kind === "tags";
  const liveUrl = saved.form.isActive ? siteAssetUrl(saved.siteUrl, saved.path) : null;

  return (
    <div className="space-y-4 pb-24">
      <BackLink href="/tours/terms">Back to Categories & Tags</BackLink>
      <PageHeader
        eyebrow={termKindLabel(saved.kind).replace(/s$/, "")}
        title={saved.form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ActiveChip active={saved.form.isActive} />
            <span>Slug: {saved.slug}</span>
          </span>
        }
        actions={
          <>
            <ViewOnSiteButton href={liveUrl} />
            <PublishSiteButton />
          </>
        }
      />

      {KIND_NOTES[saved.kind] && <Notice tone="info">{KIND_NOTES[saved.kind]}</Notice>}

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
          <Field label="Line under the title" hint="Optional. Shown under the title at the top of the page." className="md:col-span-2">
            <Input dir="auto" value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
          </Field>
          {isTag && (
            <Field label="World" hint="The world this tag is a sub-category of. The world's page links to it, and the tag's page takes the world's color." className="md:col-span-2">
              <select value={form.worldSlug} onChange={(e) => set("worldSlug", e.target.value)} className={cn(selectClass, "w-full")}>
                <option value="">No world</option>
                {form.worldSlug && !saved.worlds.some((w) => w.slug === form.worldSlug) && <option value={form.worldSlug}>{form.worldSlug} (not active)</option>}
                {saved.worlds.map((world) => (
                  <option key={world.slug} value={world.slug}>
                    {world.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Section>

      {isWorld && (
        <Section
          title="World"
          description="A world with a brand name gets a tile in the Worlds section of the home page, and its color paints its page, its sub-categories and the cards of its tours."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Brand name" hint='As the group names the world, e.g. "מגה פמילי". Empty = a plain audience, with no tile.'>
              <Input dir="auto" value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
            </Field>
            <ColorInput label="World color" value={form.color} onChange={(color) => set("color", color)} />
            <Field label="Link to another site" hint="For a world that lives on its own site (Mega Events): the tile opens that site. Empty = the world's page on this site.">
              <Input dir="ltr" placeholder="https://www.mega-events.co.il/" value={form.externalUrl} onChange={(e) => set("externalUrl", e.target.value)} />
            </Field>
          </div>
          <ImageUrlField
            label="Tile picture"
            value={form.icon}
            onChange={(icon) => set("icon", icon)}
            siteUrl={saved.siteUrl}
            folder="terms"
            hint="Shown faintly behind the name on the world's tile. Empty = the first hero image."
          />
        </Section>
      )}

      <Section>
        <HtmlField
          label="Description"
          value={form.descriptionHtml}
          onChange={(value) => set("descriptionHtml", value)}
          siteUrl={saved.siteUrl}
          hint="Shown on the page on the site. The text without formatting is also used as the search engine description."
        />
      </Section>

      <Section description={IMAGE_FIELDS_NOTE}>
        <ImageListEditor
          label="Hero images"
          value={form.heroImages}
          onChange={(value) => set("heroImages", value)}
          siteUrl={saved.siteUrl}
          folder="terms"
        />
      </Section>

      <Section title="SEO" description="What search engines and the browser tab show for this page.">
        <Field label="Title" hint={`${form.seoTitle.length} characters. Up to 60 recommended. Empty = the site's own wording.`}>
          <Input dir="auto" value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
        </Field>
      </Section>

      <Section
        title={`Tours on this page (${saved.pages.length})`}
        description="The page fills itself: every tour that carries this term is listed. Attach a tour in the Categories & Tags tab of the tour's page."
      >
        {saved.pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tour carries this term yet.</p>
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
