"use client";

/**
 * The home page of the company's site as a list of sections: reorder, hide,
 * edit, add and remove. One Save for the whole page; the site shows it after
 * Revalidate Pages.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { cn } from "@/lib/utils";
import { Chip, Notice } from "@/components/tours/ui";
import { moved } from "@/components/tours/content/fields";
import { PublishSiteButton } from "@/components/tours/content/publish-site-button";
import { CONTENT_UNSAVED_NOTE, ViewOnSiteButton } from "@/components/tours/content/save-bar";
import { useContentForm } from "@/components/tours/content/use-content-form";
import { saveSiteDoc, type SiteDocEditorData, type SiteEditorOptions } from "@/lib/actions/tours-site-actions";
import {
  SECTION_KINDS,
  homeSchema,
  newSection,
  sectionKind,
  sectionSummary,
  type HomeDoc,
  type HomeSection,
  type HomeSectionType,
} from "@/lib/tours/site-content";
import { SectionForm } from "@/components/tours/site/section-forms";
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
  const [open, setOpen] = useState<string | null>(null);

  const sections = form.sections;
  const setSections = (next: HomeSection[]) => set("sections", next);
  const patch = (id: string, section: HomeSection) => setSections(sections.map((s) => (s.id === id ? section : s)));

  // what the server would refuse, said before the click
  const problem = useMemo(() => {
    const parsed = homeSchema.safeParse(form);
    if (parsed.success) return null;
    const issue = parsed.error.issues[0];
    const index = typeof issue.path[1] === "number" ? issue.path[1] : null;
    const where = index !== null && sections[index] ? `${sectionKind(sections[index].type)?.label ?? "Section"} (#${index + 1}): ` : "";
    return where + issue.message;
  }, [form, sections]);

  const add = (type: HomeSectionType) => {
    const section = newSection(type);
    setSections([...sections, section]);
    setOpen(section.id);
  };

  const hidden = sections.filter((s) => !s.visible).length;

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

      <ol className="space-y-2">
        {sections.map((section, index) => {
          const kind = sectionKind(section.type);
          const isOpen = open === section.id;
          return (
            <li key={section.id} className={cn("rounded-lg border bg-card", !section.visible && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <span className="w-6 shrink-0 text-center text-sm text-muted-foreground">{index + 1}</span>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : section.id)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                >
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  <span className="shrink-0 font-medium">{kind?.label ?? section.type}</span>
                  <span dir="auto" className="min-w-0 truncate text-sm text-muted-foreground">
                    {sectionSummary(section)}
                  </span>
                </button>
                {!section.visible && <Chip tone="muted">Hidden</Chip>}
                <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground" title="Show this section on the site">
                  {section.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  <Switch
                    checked={section.visible}
                    onCheckedChange={(visible) => patch(section.id, { ...section, visible })}
                    aria-label={`Show ${kind?.label ?? "section"} on the site`}
                  />
                </label>
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={index === 0}
                    onClick={() => setSections(moved(sections, index, -1))}
                    aria-label="Move up"
                    title="Move up"
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={index === sections.length - 1}
                    onClick={() => setSections(moved(sections, index, 1))}
                    aria-label="Move down"
                    title="Move down"
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setSections(sections.filter((s) => s.id !== section.id))}
                    aria-label="Remove section"
                    title="Remove section (Discard brings it back until you save)"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {isOpen && (
                <div className="space-y-3 border-t p-4">
                  {kind && <p className="text-sm text-muted-foreground">{kind.description}</p>}
                  <SectionForm section={section} onChange={(next) => patch(section.id, next)} options={options} siteUrl={saved.siteUrl} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <Plus />
              Add Section
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[360px] max-w-[90vw]">
            {SECTION_KINDS.map((kind) => {
              const taken = kind.single === true && sections.some((s) => s.type === kind.type);
              return (
                <DropdownMenuItem key={kind.type} disabled={taken} onSelect={() => add(kind.type)} className="flex-col items-start gap-0.5">
                  <span className="font-medium">
                    {kind.label}
                    {taken && <span className="ms-2 text-xs font-normal text-muted-foreground">already on the page</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{kind.description}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-sm text-muted-foreground">
          {sections.length} sections{hidden > 0 ? `, ${hidden} hidden` : ""}
          {saved.updatedBy ? ` · last saved by ${saved.updatedBy}` : ""}
        </span>
      </div>

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
