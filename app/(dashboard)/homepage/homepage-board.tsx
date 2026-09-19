"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
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
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Star,
  StarOff,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  saveHomepageLayout,
  setEventPrioritized,
} from "@/lib/actions/homepage-actions";
import {
  MAX_BLOCKS,
  MAX_HIDDEN_EVENTS,
  TITLE_MAX,
  hiddenEventIds,
  isBuiltinKey,
  itemKindsFor,
  newBlockKey,
} from "@/lib/homepage/blocks";
import {
  BLOCK_META,
  SECTION_META,
  type BannerConfig,
  type DestinationsConfig,
  type EventSliderConfig,
  type GalleryConfig,
  type HomepageBlockType,
  type HomepageCandidate,
  type HomepageItemKind,
  type HomepageItemRow,
  type HomepageLayout,
  type HomepageSectionConfig,
  type HomepageSectionRow,
  type TextConfig,
} from "@/types/homepage.types";
import {
  AddBlockButton,
  BannerEditor,
  DestinationsEditor,
  GalleryEditor,
  SliderSettings,
  TextEditor,
} from "./homepage-blocks";

const KIND_LABEL: Record<HomepageItemKind, string> = {
  event: "Event",
  artist: "Artist",
  team: "Team",
};

const candidateKey = (kind: HomepageItemKind, ref: string) => `${kind}:${ref}`;

/** One scroll row on the site - mirrors ROW_MAX in myt-main ClientSideHomepage. */
const ROW_MAX = 12;
/** "ADD" on החדשים ביותר offers only the most recently uploaded events. */
const NEWEST_PICK_MAX = 100;

const createdAtMs = (c: HomepageCandidate) =>
  c.created_at ? Date.parse(c.created_at) || 0 : 0;

type ItemsBySection = Record<string, HomepageItemRow[]>;

const groupItems = (items: HomepageItemRow[], sections: HomepageSectionRow[]) => {
  const out: ItemsBySection = {};
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

/** What the board calls a section, how it is filled, and the title the site shows by default. */
const describe = (s: HomepageSectionRow) => {
  if (s.type !== "builtin") {
    const meta = BLOCK_META[s.type];
    return { label: meta.label, labelEn: meta.labelEn, rule: meta.rule, siteTitle: null };
  }
  // Rows reach the board through getHomepageLayout, which keeps only known keys.
  const meta = isBuiltinKey(s.key) ? SECTION_META[s.key] : null;
  return {
    label: meta?.title ?? s.key,
    labelEn: meta?.titleEn ?? s.key,
    rule: meta?.rule ?? "",
    siteTitle: meta?.siteTitle ?? null,
  };
};

const emptyConfig = (type: HomepageBlockType): HomepageSectionConfig => {
  switch (type) {
    case "event_slider":
      return { category_id: null };
    case "banner":
      return { banners: [] };
    case "text":
      return { body: "" };
    case "destinations":
      return { category_ids: [], parent_id: null };
    case "gallery":
      return { images: [] };
  }
};

/**
 * The dummy homepage: every section as a block in site order, each carousel
 * section with its items as a horizontal strip. Drag (or arrows) reorders both
 * levels; one Save writes the whole layout. Native HTML5 drag, same as the old
 * PeopleOrderList this replaces - no library. Staff can also rename a section
 * (pencil) and add their own blocks between sections (homepage-blocks.tsx).
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

  const setVisible = (key: string, v: boolean) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, is_visible: v } : s)));
    setDirty(true);
  };

  const setTitle = (key: string, title: string) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, title: title || null } : s)));
    setDirty(true);
  };
  const setConfig = (key: string, config: HomepageSectionConfig) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, config } : s)));
    setDirty(true);
  };
  const blockCount = sections.filter((s) => s.type !== "builtin").length;
  /** A new block lands right after section `afterIndex` (never above the hero). */
  const addBlock = (afterIndex: number, type: HomepageBlockType) => {
    const block: HomepageSectionRow = {
      key: newBlockKey(),
      type,
      title: null,
      config: emptyConfig(type),
      position: 0,
      is_visible: true,
    };
    setSections((prev) => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, block);
      return next;
    });
    setEditingTitle(block.key);
    setDirty(true);
  };
  /** Blocks only - a builtin section can be hidden, never removed. Takes effect on Save. */
  const removeBlock = (key: string) => {
    setSections((prev) => prev.filter((s) => s.key !== key || s.type === "builtin"));
    setItems((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setEditingTitle((prev) => (prev === key ? null : prev));
    setDirty(true);
  };
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  const moveItem = (key: string, from: number, to: number) => {
    setItems((prev) => ({ ...prev, [key]: moveIn(prev[key] ?? [], from, to) }));
    setDirty(true);
  };
  const removeItem = (key: string, idx: number) => {
    setItems((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== idx) }));
    setDirty(true);
  };
  // "החדשים ביותר" only: events staff removed from the AUTOMATIC part of the
  // row. Lives in the section's config, so it is part of Save / Discard.
  const newestHidden = useMemo(
    () => hiddenEventIds(sections.find((s) => s.key === "newest")?.config),
    [sections],
  );
  const setNewestHidden = (ids: number[]) =>
    setConfig("newest", ids.length ? { hidden_event_ids: ids.slice(-MAX_HIDDEN_EVENTS) } : {});
  const hideFromNewest = (c: HomepageCandidate) => {
    const id = Number(c.ref_id);
    if (!Number.isInteger(id) || newestHidden.includes(id)) return;
    setNewestHidden([...newestHidden, id]);
  };
  const restoreToNewest = (id: number) => setNewestHidden(newestHidden.filter((x) => x !== id));

  const addItem = (key: string, c: HomepageCandidate) => {
    // Pinning wins over hiding - a pinned event is shown whatever the hidden list says.
    if (key === "newest" && newestHidden.includes(Number(c.ref_id))) {
      restoreToNewest(Number(c.ref_id));
    }
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

  // Events un-prioritized from the board this visit. The write is immediate
  // (setEventPrioritized), so this only keeps the screen in step with it.
  const [unprioritized, setUnprioritized] = useState<Set<string>>(new Set());
  const unprioritize = (c: HomepageCandidate) => {
    startTransition(async () => {
      const res = await setEventPrioritized(Number(c.ref_id), false);
      if (res.ok) {
        setUnprioritized((prev) => new Set(prev).add(c.ref_id));
        toast({
          title: "Prioritize removed",
          description: `${c.name} no longer fills "המבוקשים ביותר" on its own.`,
        });
      } else {
        toast({ variant: "destructive", title: "Could not update", description: res.error });
      }
    });
  };

  // What the site shows AFTER the pinned items, so a strip is never an empty
  // box: "המבוקשים ביותר" = the Prioritized events, "החדשים ביותר" = the latest
  // uploads that the row above does not already show. An approximation of
  // myt-main's rule (it also collapses several dates of one artist into a
  // card) - good enough to see what is live and act on it.
  const autoBySection = useMemo(() => {
    const events = initial.candidates.filter((c) => c.kind === "event");
    const pinnedIn = (key: string) =>
      new Set((items[key] ?? []).map((it) => it.ref_id));
    const wantedPinned = pinnedIn("most_wanted");
    const prioritized = events.filter(
      (c) => c.prioritized && !unprioritized.has(c.ref_id) && !wantedPinned.has(c.ref_id),
    );
    const wantedShown = new Set([
      ...wantedPinned,
      ...prioritized.slice(0, Math.max(0, ROW_MAX - wantedPinned.size)).map((c) => c.ref_id),
    ]);
    const newestPinned = pinnedIn("newest");
    const hidden = new Set(newestHidden.map(String));
    const newest = events
      .filter(
        (c) => !newestPinned.has(c.ref_id) && !wantedShown.has(c.ref_id) && !hidden.has(c.ref_id),
      )
      .sort((a, b) => createdAtMs(b) - createdAtMs(a))
      .slice(0, Math.max(0, ROW_MAX - newestPinned.size));
    const auto: Record<string, HomepageCandidate[]> = { most_wanted: prioritized, newest };
    return auto;
  }, [initial.candidates, items, unprioritized, newestHidden]);

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
              const isBlock = s.type !== "builtin";
              const meta = describe(s);
              const kinds = itemKindsFor(s);
              const list = items[s.key] ?? [];
              // What the site prints above the section: the staff title, else the coded one.
              const shownTitle = s.title ?? meta.siteTitle;
              const canRename = initial.blocksReady && !pinned;
              const renaming = editingTitle === s.key;
              return (
                <Fragment key={s.key}>
                <li
                  draggable={!pinned && !renaming}
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
                        {renaming ? (
                          <Input
                            autoFocus
                            dir="rtl"
                            className="h-7 max-w-xs text-sm font-bold"
                            maxLength={TITLE_MAX}
                            value={s.title ?? ""}
                            placeholder={meta.siteTitle ?? "כותרת (לא חובה)"}
                            onChange={(e) => setTitle(s.key, e.target.value)}
                            onBlur={() => setEditingTitle(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") setEditingTitle(null);
                            }}
                            aria-label={`Title of "${meta.labelEn}" on the site`}
                          />
                        ) : (
                          <span
                            className={cn(
                              "truncate font-display text-base font-bold",
                              isBlock && !shownTitle && "font-normal text-muted-foreground",
                            )}
                            dir="rtl"
                          >
                            {pinned ? meta.label : (shownTitle ?? "בלי כותרת")}
                          </span>
                        )}
                        {canRename && !renaming && (
                          <button
                            type="button"
                            onClick={() => setEditingTitle(s.key)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Rename "${meta.labelEn}"`}
                            title={
                              meta.siteTitle
                                ? `Rename - leave empty for the default "${meta.siteTitle}"`
                                : "Set a title - leave empty for none"
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`How "${meta.labelEn}" is filled`}
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
                        {isBlock && (
                          <Badge variant="outline" className="text-[10px]">
                            block
                          </Badge>
                        )}
                        {!isBlock && s.title && (
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            title={`Default: ${meta.siteTitle ?? "-"}`}
                          >
                            renamed
                          </Badge>
                        )}
                        {!s.is_visible && (
                          <Badge variant="secondary" className="text-[10px]">
                            hidden
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {meta.labelEn}
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
                        aria-label={`Show "${meta.labelEn}" on the homepage`}
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
                        {isBlock && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeBlock(s.key)}
                            aria-label={`Delete block "${shownTitle ?? meta.labelEn}"`}
                            title="Delete this block (takes effect on Save)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {s.type === "banner" ? (
                    <BannerEditor
                      config={s.config as BannerConfig}
                      onChange={(config) => setConfig(s.key, config)}
                    />
                  ) : s.type === "text" ? (
                    <TextEditor
                      config={s.config as TextConfig}
                      onChange={(config) => setConfig(s.key, config)}
                    />
                  ) : s.type === "destinations" ? (
                    <DestinationsEditor
                      config={s.config as DestinationsConfig}
                      categories={initial.categories}
                      onChange={(config) => setConfig(s.key, config)}
                    />
                  ) : s.type === "gallery" ? (
                    <GalleryEditor
                      config={s.config as GalleryConfig}
                      onChange={(config) => setConfig(s.key, config)}
                    />
                  ) : kinds.length > 0 ? (
                    <ItemStrip
                      sectionKey={s.key}
                      label={meta.labelEn}
                      emptyHint={
                        s.type === "event_slider"
                          ? (s.config as EventSliderConfig).category_id
                            ? "אין פריטים מוצמדים - השורה מתמלאת מהקטגוריה שנבחרה למטה."
                            : "אין פריטים מוצמדים ואין קטגוריה - הבלוק לא יוצג באתר עד שיהיה אחד מהם."
                          : undefined
                      }
                      kinds={kinds}
                      list={list}
                      candidates={candidates}
                      allCandidates={initial.candidates}
                      autoItems={autoBySection[s.key] ?? []}
                      unprioritized={unprioritized}
                      busy={isPending}
                      onMove={(from, to) => moveItem(s.key, from, to)}
                      onRemove={(idx) => removeItem(s.key, idx)}
                      onAdd={(c) => addItem(s.key, c)}
                      onUnprioritize={s.key === "most_wanted" ? unprioritize : undefined}
                      onHide={s.key === "newest" ? hideFromNewest : undefined}
                      hiddenIds={s.key === "newest" ? newestHidden : undefined}
                      onRestore={s.key === "newest" ? restoreToNewest : undefined}
                    />
                  ) : (
                    <div className="px-3 py-3 text-xs text-muted-foreground" dir="rtl">
                      {meta.rule}
                    </div>
                  )}
                  {s.type === "event_slider" && (
                    <SliderSettings
                      config={s.config as EventSliderConfig}
                      categories={initial.categories}
                      onChange={(config) => setConfig(s.key, config)}
                    />
                  )}
                </li>
                {/* Blocks go between sections - so after every one of them, the hero included. */}
                {initial.blocksReady && (
                  <li>
                    <AddBlockButton
                      onAdd={(type) => addBlock(i, type)}
                      disabled={blockCount >= MAX_BLOCKS}
                      disabledReason={`Up to ${MAX_BLOCKS} blocks on the page`}
                    />
                  </li>
                )}
                </Fragment>
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
  label,
  emptyHint,
  kinds,
  list,
  candidates,
  allCandidates,
  autoItems,
  unprioritized,
  busy,
  onMove,
  onRemove,
  onAdd,
  onUnprioritize,
  onHide,
  hiddenIds,
  onRestore,
}: {
  sectionKey: string;
  /** English name of the section, for the Add button's accessible label. */
  label: string;
  /** Replaces the builtin "fills by its automatic rule" line under an empty strip. */
  emptyHint?: string;
  kinds: HomepageItemKind[];
  list: HomepageItemRow[];
  candidates: Map<string, HomepageCandidate>;
  allCandidates: HomepageCandidate[];
  /** What the site shows after the pinned items - drawn as dashed "auto" cards. */
  autoItems: HomepageCandidate[];
  unprioritized: Set<string>;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (idx: number) => void;
  onAdd: (c: HomepageCandidate) => void;
  /** Only the section whose auto rule IS the Prioritized flag passes this. */
  onUnprioritize?: (c: HomepageCandidate) => void;
  /** Only "החדשים ביותר": drop an event from the automatic part of the row (part of Save). */
  onHide?: (c: HomepageCandidate) => void;
  hiddenIds?: number[];
  onRestore?: (eventId: number) => void;
}) {
  const drag = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const listed = useMemo(
    () => new Set(list.map((it) => candidateKey(it.kind, it.ref_id))),
    [list],
  );
  const pickable = useMemo(() => {
    const rows = allCandidates.filter(
      (c) => kinds.includes(c.kind) && !listed.has(candidateKey(c.kind, c.ref_id)),
    );
    // "החדשים ביותר": the picker is the last NEWEST_PICK_MAX packages uploaded
    // to the site, in upload order - not every future event by date.
    if (sectionKey !== "newest") return rows;
    return [...rows]
      .sort((a, b) => createdAtMs(b) - createdAtMs(a))
      .slice(0, NEWEST_PICK_MAX);
  }, [allCandidates, kinds, listed, sectionKey]);
  // Auto cards past this index do not fit the site's single row.
  const autoRoom = Math.max(0, ROW_MAX - list.length);

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

        {/* What the site adds on its own after the pinned items. Dashed and
            not draggable: pin one to place it, or drop its Prioritized flag. */}
        {autoItems.map((c, i) => {
          const fits = i < autoRoom;
          return (
            <div
              key={`auto:${candidateKey(c.kind, c.ref_id)}`}
              className={cn(
                "group relative w-36 shrink-0 overflow-hidden rounded-lg border border-dashed bg-background",
                !fits && "opacity-50",
              )}
              title={
                fits
                  ? "Shown on the site by the automatic rule"
                  : `Does not fit the row (first ${ROW_MAX} are shown)`
              }
            >
              <div className="relative aspect-[4/3] w-full bg-muted">
                {c.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.image_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : null}
                <span className="absolute right-1 top-1 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {fits ? list.length + i + 1 : "-"}
                </span>
                <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-background/90 px-1 py-0.5 text-[10px] text-muted-foreground">
                  {c.prioritized && !unprioritized.has(c.ref_id) && (
                    <Star className="h-3 w-3 fill-current text-amber-500" />
                  )}
                  auto
                </span>
              </div>
              <div className="p-2 text-right">
                <div className="truncate text-xs font-semibold" title={c.name}>
                  {c.name}
                </div>
                <div className="truncate text-[10px] text-muted-foreground" dir="ltr">
                  {c.subtitle ?? KIND_LABEL[c.kind]}
                </div>
              </div>
              <div className="flex items-center justify-between border-t px-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[10px]"
                  onClick={() => onAdd(c)}
                  aria-label={`Pin ${c.name}`}
                  title="Pin = מצמיד את הכרטיס לתחילת השורה, במקום קבוע שאתם קובעים. בלי Pin הוא מוצג רק כל עוד החוקיות האוטומטית בוחרת בו."
                >
                  <Pin className="h-3 w-3" />
                  Pin
                </Button>
                {onUnprioritize && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => onUnprioritize(c)}
                    disabled={busy}
                    aria-label={`Remove prioritize from ${c.name}`}
                    title="Removes the Prioritized flag now (not part of Save)"
                  >
                    <StarOff className="h-3 w-3" />
                    Remove
                  </Button>
                )}
                {onHide && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => onHide(c)}
                    aria-label={`Remove ${c.name} from this row`}
                    title="מוריד את האירוע מהשורה הזו בלבד (נכנס לתוקף ב-Save). האירוע נשאר באתר בכל מקום אחר."
                  >
                    <EyeOff className="h-3 w-3" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-[168px] w-36 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-foreground"
              aria-label={`Add to ${label}`}
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
                    <CommandGroup
                      key={kind}
                      heading={
                        sectionKey === "newest"
                          ? `Last ${NEWEST_PICK_MAX} uploaded - newest first`
                          : `${KIND_LABEL[kind]}s`
                      }
                    >
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
      {autoItems.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground" dir="rtl">
          מקווקו = האתר מציג לבד לפי החוקיות האוטומטית ·{" "}
          <Pin className="inline h-3 w-3" aria-hidden /> Pin = מצמיד לתחילת השורה במקום קבוע
          {onUnprioritize && " · Remove = מוריד את הסימון Prioritized מהאירוע (מיידי, לא חלק מ-Save)"}
          {onHide && " · Remove = מוריד מהשורה הזו בלבד (ב-Save)"}
        </p>
      )}
      {onRestore && hiddenIds && hiddenIds.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" dir="rtl">
          <span className="text-[11px] text-muted-foreground">הוסרו מהשורה ({hiddenIds.length}):</span>
          {hiddenIds.map((id) => {
            const c = candidates.get(candidateKey("event", String(id)));
            return (
              <button
                key={id}
                type="button"
                onClick={() => onRestore(id)}
                className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                title="החזר לשורה האוטומטית"
                aria-label={`Restore ${c?.name ?? id}`}
              >
                {c?.name ?? `#${id} (לא באוויר)`}
                <RotateCcw className="h-3 w-3" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
      {list.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground" dir="rtl">
          {emptyHint
            ? emptyHint
            : autoItems.length > 0
            ? "אין פריטים מוצמדים - הכרטיסים המקווקווים הם מה שהאתר מציג עכשיו לפי החוקיות האוטומטית. Pin מצמיד למקום."
            : "אין פריטים מוצמדים - הסקשן מתמלא לפי החוקיות האוטומטית בלבד."}
        </p>
      )}
    </div>
  );
}
