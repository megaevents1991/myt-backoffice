"use client";

/**
 * An ordered list of page sections: move, hide, open to edit, add and remove.
 * The home page editor and the world editor share it; each owns its own save.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, CopyPlus, Eye, EyeOff, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Chip, Notice } from "@/components/tours/ui";
import { moved } from "@/components/tours/content/fields";
import { useUrlState } from "@/hooks/use-view-state";
import type { SiteEditorOptions } from "@/lib/tours/site-options";
import {
  SECTION_KINDS,
  SHOWN_FOR_EVERY_TILE,
  copyForTile,
  copyTargets,
  homeSectionSchema,
  moveInView,
  newSection,
  sectionKind,
  sectionProblem,
  sectionSummary,
  shownForTile,
  type HomeSection,
  type HomeSectionType,
} from "@/lib/tours/site-content";
import { SectionForm } from "@/components/tours/site/section-forms";

/** A category tile of the page's Tour finder, as a section can be tied to it. */
export interface SectionTile {
  key: string;
  label: string;
}

/**
 * Which category tiles a section belongs to. None ticked = it always shows; with tiles ticked the site
 * shows it only while a customer has one of them chosen - so each world brings its own banners and reasons.
 */
function TileScope({ id, value, tiles, onChange }: { id: string; value: string[]; tiles: SectionTile[]; onChange: (keys: string[] | undefined) => void }) {
  const known = value.filter((key) => tiles.some((tile) => tile.key === key));
  // every tile it was tied to has since left the Tour finder: the site shows it to no one
  const orphaned = value.length > 0 && known.length === 0;
  const toggle = (key: string, on: boolean) => {
    const next = tiles.map((tile) => tile.key).filter((k) => (k === key ? on : known.includes(k)));
    onChange(next.length ? next : undefined);
  };
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Show for tiles</p>
      <p className="text-xs text-muted-foreground">
        None ticked = the section always shows. Tick tiles and the site shows it only while a customer has one of them chosen in the Tour finder, so each
        world can bring its own banners and its own reasons.
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {tiles.map((tile) => (
          <label key={tile.key} htmlFor={`${id}-tile-${tile.key}`} className="flex items-center gap-2 text-sm">
            <input
              id={`${id}-tile-${tile.key}`}
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={known.includes(tile.key)}
              onChange={(event) => toggle(tile.key, event.target.checked)}
            />
            <span dir="auto">{tile.label}</span>
          </label>
        ))}
      </div>
      {orphaned && (
        <Notice tone="warning">
          This section was set for a tile that is no longer in the Tour finder, so the site shows it to no one. Tick a tile above, or{" "}
          <button type="button" className="underline" onClick={() => onChange(undefined)}>
            show it always
          </button>
          .
        </Notice>
      )}
    </div>
  );
}

/**
 * The page as one tile shows it (Liz, 06.11: each world its own card, slider and reasons): a chip per tile of the
 * Tour finder; picking one lists only what a customer with that tile chosen sees, and what is added there is
 * added for that tile only. "All sections" = the whole list.
 */
function TileView({ tiles, sections, value, onChange }: { tiles: SectionTile[]; sections: HomeSection[]; value: string; onChange: (key: string) => void }) {
  const chip = (key: string, label: string, count: number) => (
    <button
      key={key || "all"}
      type="button"
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        value === key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/60",
      )}
    >
      <span dir="auto">{label}</span>
      <span className={cn("ms-1.5 text-xs", value === key ? "opacity-80" : "text-muted-foreground")}>{count}</span>
    </button>
  );
  const picked = tiles.find((tile) => tile.key === value);
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-medium">The page as a tile shows it</p>
      <div className="flex flex-wrap gap-2">
        {chip("", "All sections", sections.length)}
        {tiles.map((tile) => chip(tile.key, tile.label, sections.filter((s) => s.visible && shownForTile(s, tile.key)).length))}
      </div>
      <p className="text-xs text-muted-foreground">
        {picked ? (
          <>
            What a customer sees while <span dir="auto">&quot;{picked.label}&quot;</span> is chosen, top to bottom. A section added here shows for this tile
            only; &quot;Its own copy&quot; (the copy icon of a section) gives this tile a copy to change, and the section stops showing here.
          </>
        ) : (
          "Pick a tile to see the page as a customer with that tile chosen sees it - and to give that world its own banners, slider or reasons."
        )}
      </p>
    </div>
  );
}

/** "Its own copy for…": the tiles a section can be copied for, each copy tied to its tile. */
function CopyForTile({ targets, tiles, onCopy }: { targets: string[]; tiles: SectionTile[]; onCopy: (key: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Its own copy for a tile" title="Its own copy for a tile">
          <CopyPlus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px] max-w-[90vw]">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          A copy shown for that tile only, right under this one, to change as that world needs. This section stops showing for that tile.
        </p>
        {targets.map((key) => (
          <DropdownMenuItem key={key} onSelect={() => onCopy(key)}>
            <span dir="auto">Its own copy for &quot;{tiles.find((tile) => tile.key === key)?.label ?? key}&quot;</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  tiles,
}: {
  sections: HomeSection[];
  onChange: (sections: HomeSection[]) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
  /** The section types this page offers (default: every type of the home page). */
  kinds?: HomeSectionType[];
  /** The category tiles of this page's Tour finder: with them, a section can be shown for some tiles only (the home page). */
  tiles?: SectionTile[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  // the tile the list is narrowed to ("" = every section); in the address, so a refresh keeps it
  const [tileParam, setTileView] = useUrlState<string>("tile", "");
  const tileKeys = (tiles ?? []).map((tile) => tile.key);
  const tileView = tiles && tiles.length > 1 && tileKeys.includes(tileParam) ? tileParam : "";
  const inView = (section: HomeSection) => !tileView || shownForTile(section, tileView);
  // a built-in part of a term page is always in the list: it is never added, and never removed;
  // a part that only a term page holds is not offered on the home page
  const offered = SECTION_KINDS.filter((kind) => !kind.builtIn && (kinds ? kinds.includes(kind.type) : !kind.termOnly));
  const patch = (id: string, section: HomeSection) => onChange(sections.map((s) => (s.id === id ? section : s)));
  const add = (type: HomeSectionType) => {
    const made = newSection(type);
    // added while one tile's page is on screen: it belongs to that tile
    const section = tileView && !SHOWN_FOR_EVERY_TILE.includes(type) ? ({ ...made, onlyTabs: [tileView] } as HomeSection) : made;
    onChange([...sections, section]);
    setOpen(section.id);
  };
  const copyFor = (id: string, key: string) => {
    const result = copyForTile(sections, id, key, tileKeys);
    if (!result.copyId) return;
    onChange(result.sections);
    setOpen(result.copyId);
    // the copy belongs to that tile: its page is where it can be seen
    if (tileView && tileView !== key) setTileView(key);
  };
  const move = (index: number, id: string, delta: -1 | 1) => onChange(tileView ? moveInView(sections, id, delta, inView) : moved(sections, index, delta));
  const viewed = sections.filter(inView);
  const hidden = sections.filter((s) => !s.visible).length;

  return (
    <div className="space-y-3">
      {tiles && tiles.length > 1 && <TileView tiles={tiles} sections={sections} value={tileView} onChange={setTileView} />}
      <ol className="space-y-2">
        {sections.map((section, index) => {
          if (!inView(section)) return null;
          const kind = sectionKind(section.type);
          const isOpen = open === section.id;
          const place = viewed.indexOf(section);
          const targets = tiles ? copyTargets(section, tileKeys) : [];
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
                {tiles && (section.onlyTabs?.length ?? 0) > 0 && (
                  <Chip tone="muted">
                    <span dir="auto">
                      Only:{" "}
                      {(section.onlyTabs ?? [])
                        .map((key) => tiles.find((tile) => tile.key === key)?.label)
                        .filter(Boolean)
                        .join(", ") || "a removed tile"}
                    </span>
                  </Chip>
                )}
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
                    disabled={place === 0}
                    onClick={() => move(index, section.id, -1)}
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
                    disabled={place === viewed.length - 1}
                    onClick={() => move(index, section.id, 1)}
                    aria-label="Move down"
                    title="Move down"
                  >
                    <ArrowDown />
                  </Button>
                  {targets.length > 0 && tiles && <CopyForTile targets={targets} tiles={tiles} onCopy={(key) => copyFor(section.id, key)} />}
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
                  {tiles && tiles.length > 1 && !SHOWN_FOR_EVERY_TILE.includes(section.type) && (
                    <TileScope id={section.id} value={section.onlyTabs ?? []} tiles={tiles} onChange={(onlyTabs) => patch(section.id, { ...section, onlyTabs })} />
                  )}
                  <SectionForm section={section} onChange={(next) => patch(section.id, next)} options={options} siteUrl={siteUrl} onHome={Boolean(tiles)} />
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
          {tileView ? `${viewed.length} of ` : ""}
          {sections.length} {sections.length === 1 ? "section" : "sections"}
          {hidden > 0 ? `, ${hidden} hidden` : ""}
          {tileView ? ` · a new section shows for "${tiles?.find((tile) => tile.key === tileView)?.label ?? ""}" only` : ""}
        </span>
      </div>
    </div>
  );
}
