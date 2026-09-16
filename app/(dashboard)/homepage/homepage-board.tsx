"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  Info,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { saveHomepageLayout } from "@/lib/actions/homepage-actions";
import {
  SECTION_ITEM_KINDS,
  SECTION_META,
  type HomepageCandidate,
  type HomepageItemKind,
  type HomepageItemRow,
  type HomepageLayout,
  type HomepageSectionKey,
  type HomepageSectionRow,
} from "@/types/homepage.types";

const KIND_LABEL: Record<HomepageItemKind, string> = {
  event: "Event",
  artist: "Artist",
  team: "Team",
};

const candidateKey = (kind: HomepageItemKind, ref: string) => `${kind}:${ref}`;

type ItemsBySection = Record<HomepageSectionKey, HomepageItemRow[]>;

const groupItems = (items: HomepageItemRow[], sections: HomepageSectionRow[]) => {
  const out = {} as ItemsBySection;
  for (const s of sections) out[s.key] = [];
  for (const it of items) (out[it.section] ??= []).push(it);
  return out;
};

const moveIn = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

/**
 * The dummy homepage: every section as a block in site order, each carousel
 * section with its items as a horizontal strip. Drag (or arrows) reorders both
 * levels; one Save writes the whole layout. Native HTML5 drag, same as the old
 * PeopleOrderList this replaces - no library.
 */
export function HomepageBoard({ initial }: { initial: HomepageLayout }) {
  const { toast } = useToast();
  const [sections, setSections] = useState<HomepageSectionRow[]>(initial.sections);
  const [items, setItems] = useState<ItemsBySection>(() =>
    groupItems(initial.items, initial.sections),
  );
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const candidates = useMemo(() => {
    const m = new Map<string, HomepageCandidate>();
    for (const c of initial.candidates) m.set(candidateKey(c.kind, c.ref_id), c);
    return m;
  }, [initial.candidates]);

  // Section drag state (vertical).
  const sectionDrag = useRef<number | null>(null);
  const moveSection = (from: number, to: number) => {
    // Hero is pinned: index 0 never moves and nothing moves onto it.
    if (from === 0 || to === 0) return;
    setSections((prev) => moveIn(prev, from, to));
    setDirty(true);
  };

  const setVisible = (key: HomepageSectionKey, v: boolean) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, is_visible: v } : s)));
    setDirty(true);
  };

  const moveItem = (key: HomepageSectionKey, from: number, to: number) => {
    setItems((prev) => ({ ...prev, [key]: moveIn(prev[key] ?? [], from, to) }));
    setDirty(true);
  };
  const removeItem = (key: HomepageSectionKey, idx: number) => {
    setItems((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== idx) }));
    setDirty(true);
  };
  const addItem = (key: HomepageSectionKey, c: HomepageCandidate) => {
    setItems((prev) => {
      const list = prev[key] ?? [];
      if (list.some((it) => it.kind === c.kind && it.ref_id === c.ref_id)) return prev;
      return {
        ...prev,
        [key]: [...list, { section: key, kind: c.kind, ref_id: c.ref_id, position: list.length }],
      };
    });
    setDirty(true);
  };

  const reset = () => {
    setSections(initial.sections);
    setItems(groupItems(initial.items, initial.sections));
    setDirty(false);
  };

  const save = () => {
    startTransition(async () => {
      const flat: HomepageItemRow[] = [];
      for (const s of sections) {
        (items[s.key] ?? []).forEach((it, i) => flat.push({ ...it, position: i }));
      }
      const res = await saveHomepageLayout({
        sections: sections.map((s, i) => ({ ...s, position: i })),
        items: flat,
      });
      if (res.ok) {
        setDirty(false);
        toast({
          title: "Homepage saved",
          description: "The live site is refreshing - allow a minute for the new order.",
        });
      } else {
        toast({ variant: "destructive", title: "Save failed", description: res.error });
      }
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* The dummy site. Narrow like a real page so the strips read as rows. */}
        <div className="mx-auto w-full max-w-4xl rounded-2xl border bg-muted/30 p-3 sm:p-5">
          <ol className="space-y-3">
            {sections.map((s, i) => {
              const pinned = s.key === "hero";
              const meta = SECTION_META[s.key];
              const kinds = SECTION_ITEM_KINDS[s.key];
              const list = items[s.key] ?? [];
              return (
                <li
                  key={s.key}
                  draggable={!pinned}
                  onDragStart={(e) => {
                    if (pinned) return;
                    sectionDrag.current = i;
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (sectionDrag.current === null) return;
                    e.preventDefault();
                    if (sectionDrag.current === i || pinned) return;
                    moveSection(sectionDrag.current, i);
                    sectionDrag.current = i;
                  }}
                  onDragEnd={() => (sectionDrag.current = null)}
                  className={cn(
                    "rounded-xl border bg-card shadow-sm transition-opacity",
                    !s.is_visible && "opacity-60",
                  )}
                >
                  {/* Section header - the only drag handle for the section. */}
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    {pinned ? (
                      <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <GripVertical
                        className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
                        aria-hidden
                      />
                    )}
                    <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-display text-base font-bold" dir="rtl">
                          {meta.title}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`How "${meta.titleEn}" is filled`}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs text-right" dir="rtl">
                            {meta.rule}
                          </TooltipContent>
                        </Tooltip>
                        {pinned && (
                          <Badge variant="outline" className="text-[10px]">
                            always first
                          </Badge>
                        )}
                        {!s.is_visible && (
                          <Badge variant="secondary" className="text-[10px]">
                            hidden
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {meta.titleEn}
                        {kinds.length > 0 && (
                          <>
                            {" · "}
                            {list.length} pinned {list.length === 1 ? "item" : "items"}
                          </>
                        )}
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {s.is_visible ? (
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5" aria-hidden />
                      )}
                      <Switch
                        checked={s.is_visible}
                        onCheckedChange={(v) => setVisible(s.key, v)}
                        aria-label={`Show "${meta.titleEn}" on the homepage`}
                      />
                    </label>
                    {!pinned && (
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => moveSection(i, i - 1)}
                          disabled={i <= 1}
                          aria-label="Move section up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => moveSection(i, i + 1)}
                          disabled={i === sections.length - 1}
                          aria-label="Move section down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {kinds.length > 0 ? (
                    <ItemStrip
                      sectionKey={s.key}
                      kinds={kinds}
                      list={list}
                      candidates={candidates}
                      allCandidates={initial.candidates}
                      onMove={(from, to) => moveItem(s.key, from, to)}
                      onRemove={(idx) => removeItem(s.key, idx)}
                      onAdd={(c) => addItem(s.key, c)}
                    />
                  ) : (
                    <div className="px-3 py-3 text-xs text-muted-foreground" dir="rtl">
                      {meta.rule}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Below these the site always shows the trust section and the FAQ.
          </p>
        </div>

        {/* Save bar - sticks to the bottom while there is something to save. */}
        <div
          className={cn(
            "sticky bottom-3 z-10 mx-auto flex w-full max-w-4xl items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-2 shadow-lg backdrop-blur transition-all",
            dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
          )}
          aria-live="polite"
        >
          <span className="text-sm">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset} disabled={isPending}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={isPending}>
              <Save className="mr-1.5 h-4 w-4" />
              {isPending ? "Saving…" : "Save homepage"}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ItemStrip({
  sectionKey,
  kinds,
  list,
  candidates,
  allCandidates,
  onMove,
  onRemove,
  onAdd,
}: {
  sectionKey: HomepageSectionKey;
  kinds: HomepageItemKind[];
  list: HomepageItemRow[];
  candidates: Map<string, HomepageCandidate>;
  allCandidates: HomepageCandidate[];
  onMove: (from: number, to: number) => void;
  onRemove: (idx: number) => void;
  onAdd: (c: HomepageCandidate) => void;
}) {
  const drag = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const listed = useMemo(
    () => new Set(list.map((it) => candidateKey(it.kind, it.ref_id))),
    [list],
  );
  const pickable = useMemo(
    () =>
      allCandidates.filter(
        (c) => kinds.includes(c.kind) && !listed.has(candidateKey(c.kind, c.ref_id)),
      ),
    [allCandidates, kinds, listed],
  );

  return (
    <div className="px-3 py-3">
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]" dir="rtl">
        {list.map((it, i) => {
          const c = candidates.get(candidateKey(it.kind, it.ref_id));
          return (
            <div
              key={candidateKey(it.kind, it.ref_id)}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                drag.current = i;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (drag.current === null) return;
                e.preventDefault();
                e.stopPropagation();
                if (drag.current === i) return;
                onMove(drag.current, i);
                drag.current = i;
              }}
              onDragEnd={() => (drag.current = null)}
              className="group relative w-36 shrink-0 cursor-grab overflow-hidden rounded-lg border bg-background active:cursor-grabbing"
            >
              <div className="relative aspect-[4/3] w-full bg-muted">
                {c?.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.image_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : null}
                <span className="absolute right-1 top-1 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
                {c?.prioritized && (
                  <span
                    className="absolute left-1 top-1 rounded bg-background/90 p-0.5 text-amber-500"
                    title="Prioritized event"
                  >
                    <Star className="h-3 w-3 fill-current" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="absolute bottom-1 left-1 hidden rounded-full bg-background/90 p-1 text-muted-foreground hover:text-destructive group-hover:block focus-visible:block"
                  aria-label={`Remove ${c?.name ?? it.ref_id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-2 text-right">
                <div className="truncate text-xs font-semibold" title={c?.name ?? it.ref_id}>
                  {c?.name ?? (
                    <span className="text-destructive">{it.ref_id} (not live)</span>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground" dir="ltr">
                  {c?.subtitle ?? KIND_LABEL[it.kind]}
                </div>
              </div>
              <div className="flex items-center justify-between border-t px-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onMove(i, i - 1)}
                  disabled={i === 0}
                  aria-label="Move earlier"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onMove(i, i + 1)}
                  disabled={i === list.length - 1}
                  aria-label="Move later"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-[168px] w-36 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-foreground"
              aria-label={`Add to ${SECTION_META[sectionKey].titleEn}`}
            >
              <Plus className="h-5 w-5" />
              Add
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <Command>
              <CommandInput placeholder="Search…" />
              <CommandList>
                <CommandEmpty>Nothing left to add.</CommandEmpty>
                {kinds.map((kind) => {
                  const rows = pickable.filter((c) => c.kind === kind);
                  if (!rows.length) return null;
                  return (
                    <CommandGroup key={kind} heading={`${KIND_LABEL[kind]}s`}>
                      {rows.map((c) => (
                        <CommandItem
                          key={candidateKey(c.kind, c.ref_id)}
                          value={`${c.name} ${c.subtitle ?? ""} ${c.ref_id}`}
                          onSelect={() => {
                            onAdd(c);
                            setOpen(false);
                          }}
                          className="gap-2"
                        >
                          {c.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.image_url}
                              alt=""
                              className="h-7 w-10 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="h-7 w-10 shrink-0 rounded bg-muted" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{c.name}</span>
                            {c.subtitle && (
                              <span className="block truncate text-[11px] text-muted-foreground" dir="ltr">
                                {c.subtitle}
                              </span>
                            )}
                          </span>
                          {c.prioritized && (
                            <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {list.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground" dir="rtl">
          אין פריטים מוצמדים - הסקשן מתמלא לפי החוקיות האוטומטית בלבד.
        </p>
      )}
    </div>
  );
}
