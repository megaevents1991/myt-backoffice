"use client";

/**
 * The home page of the company's site as a list of sections: reorder, hide,
 * edit, add and remove. One Save for the whole page; the site shows it after
 * Revalidate Pages.
 */
import { useCallback, useMemo, useRef } from "react";

import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Notice } from "@/components/tours/ui";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import { saveSiteDoc, type SiteDocEditorData, type SiteEditorOptions } from "@/lib/actions/tours-site-actions";
import { homeSchema, type HomeDoc } from "@/lib/tours/site-content";
import { SectionsBoard, sectionsProblem } from "@/components/tours/site/sections-board";
import type { ActionResult } from "@/components/tours/content/shared";

type HomeData = SiteDocEditorData<"home">;

export function HomepageEditor({ initial, options }: { initial: HomeData; options: SiteEditorOptions }) {
  // the version the next save must name; it moves with every successful save
  const version = useRef(initial.updatedAt);
  const save = useCallback(async (form: HomeDoc): Promise<ActionResult<HomeData>> => {
    const result = await saveSiteDoc("home", form, version.current);
    if (result.success) version.current = result.data.updatedAt;
    return result as ActionResult<HomeData>;
  }, []);
  const { saved, form, set, isDirty, isSaving, submit, discard } = useContentForm<HomeDoc, HomeData>(initial, save);
  const sections = form.sections;

  // what the server would refuse, said before the click
  const problem = useMemo(() => {
    const inSection = sectionsProblem(sections);
    if (inSection) return inSection;
    const parsed = homeSchema.safeParse(form);
    return parsed.success ? null : parsed.error.issues[0].message;
  }, [form, sections]);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title="Homepage"
        description="The sections of the site's home page, top to bottom. Move a section, hide it, open it to edit, or add a new one. Save, then Revalidate Pages to show the change on the site."
        actions={
          <>
            <ViewOnSiteButton href={saved.siteUrl} />
            <PublishSiteButton />
          </>
        }
      />

      {sections.length === 0 && (
        <Notice tone="warning">The home page has no sections. Add the first one below; until then the site shows its built-in home page.</Notice>
      )}

      <SectionsBoard sections={sections} onChange={(next) => set("sections", next)} options={options} siteUrl={saved.siteUrl} />
      {saved.updatedBy && <p className="text-sm text-muted-foreground">Last saved by {saved.updatedBy}</p>}

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
