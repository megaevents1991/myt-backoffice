"use client";

/**
 * An ordered list of page sections: move, hide, open to edit, add and remove.
 * The home page editor and the world editor share it; each owns its own save.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/tours/ui";
import { moved } from "@/components/tours/content/fields";
import type { SiteEditorOptions } from "@/lib/tours/site-options";
import {
  SECTION_KINDS,
  homeSectionSchema,
  newSection,
  sectionKind,
  sectionProblem,
  sectionSummary,
  type HomeSection,
  type HomeSectionType,
} from "@/lib/tours/site-content";
import { SectionForm } from "@/components/tours/site/section-forms";

/** What a save of these sections would be refused for, in the words of the section it is in; null = fine. */
export function sectionsProblem(sections: HomeSection[]): string | null {
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const where = `${sectionKind(section.type)?.label ?? "Section"} (#${index + 1}): `;
    const parsed = homeSectionSchema.safeParse(section);
    if (!parsed.success) return where + parsed.error.issues[0].message;
    const missing = sectionProblem(section);
    if (missing) return where + missing;
  }
  return null;
}

export function SectionsBoard({
  sections,
  onChange,
  options,
  siteUrl,
  kinds,
}: {
  sections: HomeSection[];
  onChange: (sections: HomeSection[]) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
  /** The section types this page offers (default: all of them). */
  kinds?: HomeSectionType[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  // a built-in part of a term page is always in the list: it is never added, and never removed
  const offered = SECTION_KINDS.filter((kind) => !kind.builtIn && (!kinds || kinds.includes(kind.type)));
  const patch = (id: string, section: HomeSection) => onChange(sections.map((s) => (s.id === id ? section : s)));
  const add = (type: HomeSectionType) => {
    const section = newSection(type);
    onChange([...sections, section]);
    setOpen(section.id);
  };
  const hidden = sections.filter((s) => !s.visible).length;

  return (
    <div className="space-y-3">
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
                  {kind?.builtIn && <Chip tone="muted">Built in</Chip>}
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
                    onClick={() => onChange(moved(sections, index, -1))}
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
                    onClick={() => onChange(moved(sections, index, 1))}
                    aria-label="Move down"
                    title="Move down"
                  >
                    <ArrowDown />
                  </Button>
                  {kind?.builtIn ? (
                    // keeps the row buttons aligned; the part is hidden with its switch instead
                    <span className="h-8 w-8" title="A built-in part of the page: switch it off to hide it" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => onChange(sections.filter((s) => s.id !== section.id))}
                      aria-label="Remove section"
                      title="Remove section (Discard brings it back until you save)"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="space-y-3 border-t p-4">
                  {kind && <p className="text-sm text-muted-foreground">{kind.description}</p>}
                  <SectionForm section={section} onChange={(next) => patch(section.id, next)} options={options} siteUrl={siteUrl} />
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
            {offered.map((kind) => {
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
          {sections.length} {sections.length === 1 ? "section" : "sections"}
          {hidden > 0 ? `, ${hidden} hidden` : ""}
        </span>
      </div>
    </div>
  );
}
