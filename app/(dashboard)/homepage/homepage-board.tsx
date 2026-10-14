"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  Info,
  Lock,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getSliderPools,
  saveHomepageLayout,
  setEventPrioritized,
} from "@/lib/actions/homepage-actions";
import {
  MAX_BLOCKS,
  MAX_HIDDEN,
  TITLE_MAX,
  isBuiltinKey,
  itemKindsFor,
  newBlockKey,
  rowSettingsOf,
} from "@/lib/homepage/blocks";
import {
  defaultPinnable,
  defaultShowable,
  planHomepage,
  rowDefaultMax,
  toRef,
  type RowLayout,
  type RowPool,
  type RowRef,
} from "@/lib/homepage/merge";
import { PUBLIC_SITE_URL } from "@/lib/site";
import {
  BLOCK_META,
  SECTION_META,
  type BannerConfig,
  type DestinationsConfig,
  type EventSliderConfig,
  type GalleryConfig,
  type HomepageBlockType,
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
import { RowEditor, type BoardCard } from "./row-editor";

type ItemsBySection = Record<string, HomepageItemRow[]>;

/** A section's config with its row settings replaced (other keys - a slider's category - kept). */
const withRowSettings = (
  config: HomepageSectionConfig,
  hidden: RowRef[],
  max: number | null,
): HomepageSectionConfig => {
  const rest = { ...(config as Record<string, unknown>) };
  delete rest.hidden;
  delete rest.hidden_event_ids;
  delete rest.max_items;
  return {
    ...rest,
    ...(hidden.length ? { hidden: hidden.slice(-MAX_HIDDEN) } : {}),
    ...(max !== null ? { max_items: max } : {}),
  } as HomepageSectionConfig;
};

/** A row's saved state, for the "changed" tag. */
const rowFingerprint = (s: HomepageSectionRow | undefined, pins: HomepageItemRow[] | undefined) =>
  JSON.stringify([
    rowSettingsOf(s?.config),
    (s?.config as EventSliderConfig | undefined)?.category_id ?? null,
    [...(pins ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((p) => `${p.kind}:${p.ref_id}@${p.position}`),
  ]);

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
 * The dummy homepage: every section as a block in site order; every carousel
 * drawn exactly as the site will show it (myt-main's automatic pools from
 * /api/homepage-pools, merged with the draft through lib/homepage/merge.ts -
 * the same file the site renders with). Sections move by drag (native) or
 * arrows; cards move by drag (@dnd-kit - mouse, touch, keyboard), arrows or a
 * typed place, and stay where they are put (row-editor.tsx). One Save writes
 * the whole layout. Staff can also rename a section (pencil) and add their own
 * blocks between sections (homepage-blocks.tsx).
 */
export function HomepageBoard({ initial }: { initial: HomepageLayout }) {
  const { toast } = useToast();
  const [sections, setSections] = useState<HomepageSectionRow[]>(initial.sections);
  const [items, setItems] = useState<ItemsBySection>(() =>
    groupItems(initial.items, initial.sections),
  );
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();

  const poolsData = initial.pools.ok ? initial.pools.data : null;
  // The site's own cards: their picture and the flags that decide whether they show.
  const siteCards = useMemo(
    () => new Map<RowRef, BoardCard>((poolsData?.cards ?? []).map((c) => [c.ref, c])),
    [poolsData],
  );
  // Every card the board can draw or add: the site's, else the board's own list.
  const cards = useMemo(() => {
    const m = new Map<RowRef, BoardCard>();
    for (const c of initial.candidates) {
      const ref = toRef(c.kind, c.ref_id);
      m.set(ref, {
        ref,
        name: c.name,
        sub: c.subtitle,
        image: c.image_url,
        prioritized: c.prioritized,
        createdAt: c.created_at ?? null,
      });
    }
    for (const [ref, c] of siteCards) m.set(ref, c);
    return m;
  }, [initial.candidates, siteCards]);
  const cardOf = (ref: RowRef) => cards.get(ref);
  // What "הוסף" offers: newest uploads first, so "החדשים" finds them on top.
  const pickable = useMemo(
    () =>
      [...cards.values()].sort(
        (a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0),
      ),
    [cards],
  );

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

  // A row's pinned cards, each at the place it holds (row-editor.tsx writes them).
  const setPins = (key: string, pins: HomepageItemRow[]) => {
    setItems((prev) => ({ ...prev, [key]: pins }));
    setDirty(true);
  };
  // A row's hidden cards and length live in its section config - part of Save / Discard.
  const setRowSettings = (key: string, patch: { hidden?: RowRef[]; max?: number | null }) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s;
        const cur = rowSettingsOf(s.config);
        return {
          ...s,
          config: withRowSettings(
            s.config,
            patch.hidden ?? cur.hidden,
            patch.max !== undefined ? patch.max : cur.max,
          ),
        };
      }),
    );
    setDirty(true);
  };

  // Events un-prioritized from the board this visit. The write is immediate
  // (setEventPrioritized), so this only keeps the screen in step with it.
  const [unprioritized, setUnprioritized] = useState<Set<RowRef>>(new Set());
  const unprioritize = (card: BoardCard) => {
    startTransition(async () => {
      const res = await setEventPrioritized(Number(card.ref.slice("event:".length)), false);
      if (res.ok) {
        setUnprioritized((prev) => new Set(prev).add(card.ref));
        toast({
          title: "Prioritize removed",
          description: `${card.name} no longer fills "המבוקשים ביותר" on its own.`,
        });
      } else {
        toast({ variant: "destructive", title: "Could not update", description: res.error });
      }
    });
  };

  // The pool of every category an event slider names. A category picked on
  // the board that the site has not been asked about yet is fetched once.
  const [sliderPools, setSliderPools] = useState<Record<string, string[]>>(
    () => poolsData?.sliderPools ?? {},
  );
  const missingCategories = sections.flatMap((s) => {
    if (s.type !== "event_slider") return [];
    const id = (s.config as EventSliderConfig).category_id;
    return id && !(String(id) in sliderPools) ? [id] : [];
  });
  const missingKey = missingCategories.join(",");
  useEffect(() => {
    if (!poolsData || !missingKey) return;
    let gone = false;
    getSliderPools(missingKey.split(",").map(Number)).then((res) => {
      if (gone) return;
      if (res.ok) {
        setSliderPools((prev) => {
          const next = { ...prev, ...res.pools };
          // A category the site knows nothing about still counts as asked.
          for (const id of missingKey.split(",")) next[id] ??= [];
          return next;
        });
      } else {
        toast({ variant: "destructive", title: "Could not read the category's events", description: res.error });
      }
    });
    return () => {
      gone = true;
    };
  }, [missingKey, poolsData, toast]);

  // Every row exactly as the site will build it: the site's automatic pools,
  // merged with the draft (pins in their places, hidden cards, row lengths,
  // what the row above shows) by the very file the site renders with.
  const plan = useMemo(() => {
    if (!poolsData) return null;
    const pools: Record<string, RowPool> = { ...poolsData.pools };
    if (unprioritized.size && Array.isArray(pools.most_wanted)) {
      pools.most_wanted = (pools.most_wanted as RowRef[]).filter((r) => !unprioritized.has(r));
    }
    const rows: RowLayout[] = [];
    for (const s of sections) {
      if (s.type === "event_slider") {
        const id = (s.config as EventSliderConfig).category_id;
        pools[s.key] = id ? (sliderPools[String(id)] ?? []) : [];
      }
      if (!itemKindsFor(s).length) continue;
      const st = rowSettingsOf(s.config);
      rows.push({
        key: s.key,
        pins: (items[s.key] ?? []).map((p) => ({ ref: toRef(p.kind, p.ref_id), slot: p.position })),
        hidden: st.hidden,
        max: st.max,
      });
    }
    return planHomepage(
      rows,
      pools,
      (ref, key) => defaultShowable(siteCards.get(ref), key, ref),
      (ref, key) => defaultPinnable(siteCards.get(ref), key, ref),
    );
  }, [poolsData, sections, items, sliderPools, unprioritized, siteCards]);

  // The last saved state - Discard goes back to it, "changed" compares with it.
  const [saved, setSaved] = useState(() => ({
    sections: initial.sections,
    items: groupItems(initial.items, initial.sections),
  }));
  const savedRows = useMemo(
    () => new Map(saved.sections.map((s) => [s.key, rowFingerprint(s, saved.items[s.key])])),
    [saved],
  );
  const changedRows = sections.filter(
    (s) => itemKindsFor(s).length > 0 && savedRows.get(s.key) !== rowFingerprint(s, items[s.key]),
  ).length;

  const reset = () => {
    setSections(saved.sections);
    setItems(saved.items);
    setDirty(false);
  };

  const save = () => {
    startTransition(async () => {
      const flat: HomepageItemRow[] = [];
      for (const s of sections) for (const it of items[s.key] ?? []) flat.push(it);
      const res = await saveHomepageLayout({
        sections: sections.map((s, i) => ({ ...s, position: i })),
        items: flat,
      });
      if (res.ok) {
        setSaved({ sections, items });
        setDirty(false);
        toast({
          title: "עמוד הבית נשמר",
          description: "האתר מתעדכן עכשיו - רענון של עמוד הבית באתר יראה את הסדר החדש.",
        });
      } else {
        toast({ variant: "destructive", title: "Save failed", description: res.error });
      }
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {!initial.pools.ok && (
          <div
            className="mx-auto flex w-full max-w-4xl items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
            dir="rtl"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <div className="font-semibold">לא הצלחנו לקרוא מהאתר מה מוצג בו עכשיו</div>
              <div className="text-xs text-muted-foreground">
                השורות מציגות רק את הכרטיסים הנעוצים. אפשר לערוך ולשמור כרגיל. ({initial.pools.error})
              </div>
            </div>
          </div>
        )}
        {/* The dummy site. Narrow like a real page so the rows read as rows. */}
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
                            {list.length} pinned
                          </>
                        )}
                        {kinds.length > 0 &&
                          savedRows.get(s.key) !== rowFingerprint(s, items[s.key]) && (
                            <Badge className="ms-2 h-4 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
                              changed
                            </Badge>
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
                    <RowEditor
                      sectionKey={s.key}
                      label={meta.labelEn}
                      kinds={kinds}
                      row={plan?.[s.key] ?? null}
                      pins={list}
                      hidden={rowSettingsOf(s.config).hidden}
                      max={rowSettingsOf(s.config).max}
                      defaultMax={rowDefaultMax(s.key)}
                      cardOf={cardOf}
                      pickable={pickable}
                      onPinsChange={(pins) => setPins(s.key, pins)}
                      onHiddenChange={(hidden) => setRowSettings(s.key, { hidden })}
                      onMaxChange={(max) => setRowSettings(s.key, { max })}
                      onUnprioritize={s.key === "most_wanted" ? unprioritize : undefined}
                      busy={isPending}
                      emptyHint={
                        s.type === "event_slider"
                          ? (s.config as EventSliderConfig).category_id
                            ? "הקטגוריה שנבחרה ריקה כרגע - הוסיפו אירועים, או בחרו קטגוריה אחרת למטה."
                            : "אין אירועים ואין קטגוריה - הבלוק לא יוצג באתר עד שיהיה אחד מהם."
                          : undefined
                      }
                      note={
                        s.key === "more_events"
                          ? "באתר: גריד. בטלפון רואים את 5 הראשונים ובמחשב 20, ואז 'הצג עוד אירועים'."
                          : s.key === "hero"
                            ? "בהירו מוצגים רק אמנים וקבוצות עם אירוע זמין."
                            : undefined
                      }
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
          <span className="text-sm">
            Unsaved changes
            {changedRows > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {changedRows} {changedRows === 1 ? "row" : "rows"}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a href={PUBLIC_SITE_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Site
              </a>
            </Button>
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
