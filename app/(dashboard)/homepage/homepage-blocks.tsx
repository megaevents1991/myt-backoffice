"use client";

/**
 * The pieces of the /homepage board that belong to staff-added blocks: the
 * "+ Add block" control between sections and the editor of each block type.
 * State lives in the board; these only draw it and report changes. The rules
 * (how many banners, what a link may be) are lib/homepage/blocks.ts - the
 * server enforces the same ones on Save.
 */

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  GalleryHorizontal,
  ImageIcon,
  Images,
  MapPin,
  Plus,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeroImageField } from "@/components/templates/HeroImageField";
import {
  MAX_BANNERS,
  MAX_DESTINATIONS,
  MAX_GALLERY,
  TEXT_MAX,
  TITLE_MAX,
} from "@/lib/homepage/blocks";
import {
  BLOCK_META,
  HOMEPAGE_BLOCK_TYPES,
  type BannerConfig,
  type BannerItem,
  type DestinationsConfig,
  type EventSliderConfig,
  type GalleryConfig,
  type GalleryImage,
  type HomepageBlockType,
  type HomepageCategoryOption,
  type TextConfig,
} from "@/types/homepage.types";

const BLOCK_ICON: Record<HomepageBlockType, typeof ImageIcon> = {
  event_slider: GalleryHorizontal,
  banner: ImageIcon,
  text: Type,
  destinations: MapPin,
  gallery: Images,
};

/** The thin "+" row between two sections. */
export function AddBlockButton({
  onAdd,
  disabled,
  disabledReason,
}: {
  onAdd: (type: HomepageBlockType) => void;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" aria-hidden />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
            disabled={disabled}
            title={disabled ? disabledReason : "Add a block here"}
          >
            <Plus className="h-3 w-3" />
            Add block
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-[70vh] w-80 overflow-y-auto p-1" align="center">
          {HOMEPAGE_BLOCK_TYPES.map((type) => {
            const Icon = BLOCK_ICON[type];
            const meta = BLOCK_META[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onAdd(type);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-right hover:bg-accent"
                dir="rtl"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{meta.label}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {meta.rule}
                  </span>
                </span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      <div className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

const NO_CATEGORY = "none";

/** Event slider: the category that fills the row after the pinned events. */
export function SliderSettings({
  config,
  categories,
  onChange,
}: {
  config: EventSliderConfig;
  categories: HomepageCategoryOption[];
  onChange: (config: EventSliderConfig) => void;
}) {
  const value = config.category_id ? String(config.category_id) : NO_CATEGORY;
  // A category that was deactivated after it was picked is still the saved
  // value - show it rather than silently reading as "none".
  const missing =
    config.category_id !== null && !categories.some((c) => c.id === config.category_id);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2" dir="rtl">
      <Label className="text-xs text-muted-foreground">מילוי אוטומטי אחרי הפריטים המוצמדים</Label>
      <Select
        value={value}
        onValueChange={(v) => onChange({ category_id: v === NO_CATEGORY ? null : Number(v) })}
      >
        <SelectTrigger className="h-8 w-72 text-xs" dir="rtl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value={NO_CATEGORY}>בלי - רק הפריטים המוצמדים</SelectItem>
          {missing && config.category_id !== null && (
            <SelectItem value={String(config.category_id)}>
              קטגוריה #{config.category_id} (לא פעילה)
            </SelectItem>
          )}
          {categories.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const EMPTY_BANNER: BannerItem = { image_url: "", link_url: null, title: null };

/** Banner block: 1-3 rows of image + link + title. */
export function BannerEditor({
  config,
  onChange,
}: {
  config: BannerConfig;
  onChange: (config: BannerConfig) => void;
}) {
  const banners = config.banners.length ? config.banners : [EMPTY_BANNER];
  const patch = (i: number, next: Partial<BannerItem>) =>
    onChange({ banners: banners.map((b, j) => (j === i ? { ...b, ...next } : b)) });

  return (
    <div className="space-y-3 px-3 py-3" dir="rtl">
      {banners.map((b, i) => (
        <div key={i} className="rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">באנר {i + 1}</span>
            {banners.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => onChange({ banners: banners.filter((_, j) => j !== i) })}
                aria-label={`Remove banner ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div dir="ltr">
            <HeroImageField
              label="Banner image"
              value={b.image_url}
              onChange={(url) => patch(i, { image_url: url })}
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">קישור (לא חובה)</Label>
              <Input
                dir="ltr"
                className="h-8 text-xs"
                placeholder="/c/music  or  https://…"
                value={b.link_url ?? ""}
                onChange={(e) => patch(i, { link_url: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">כותרת על התמונה (לא חובה)</Label>
              <Input
                className="h-8 text-xs"
                maxLength={TITLE_MAX}
                value={b.title ?? ""}
                onChange={(e) => patch(i, { title: e.target.value || null })}
              />
            </div>
          </div>
        </div>
      ))}
      {banners.length < MAX_BANNERS && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onChange({ banners: [...banners, EMPTY_BANNER] })}
        >
          <Plus className="h-3.5 w-3.5" />
          באנר נוסף
        </Button>
      )}
    </div>
  );
}

/** Text block: plain paragraphs under the block's title. */
export function TextEditor({
  config,
  onChange,
}: {
  config: TextConfig;
  onChange: (config: TextConfig) => void;
}) {
  const body = config.body ?? "";
  return (
    <div className="space-y-1 px-3 py-3" dir="rtl">
      <Textarea
        dir="rtl"
        rows={5}
        maxLength={TEXT_MAX}
        className="text-sm"
        placeholder="הטקסט שיוצג באתר. שורה ריקה = פסקה חדשה."
        value={body}
        onChange={(e) => onChange({ body: e.target.value })}
        aria-label="Block text"
      />
      <div className="flex justify-between gap-3 text-[11px] text-muted-foreground">
        <span>טקסט פשוט בלבד - בלי HTML ובלי קישורים. כותרת הבלוק (העיפרון למעלה) מוצגת מעליו.</span>
        <span dir="ltr">
          {body.length}/{TEXT_MAX}
        </span>
      </div>
    </div>
  );
}

/**
 * Destinations slider: the category tiles staff placed, then - when a parent
 * is picked - that parent's active children. Every tile links to its /c/ page.
 */
export function DestinationsEditor({
  config,
  categories,
  onChange,
}: {
  config: DestinationsConfig;
  categories: HomepageCategoryOption[];
  onChange: (config: DestinationsConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const ids = config.category_ids ?? [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pickable = categories.filter((c) => !ids.includes(c.id));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ ...config, category_ids: next });
  };
  const parentValue = config.parent_id ? String(config.parent_id) : NO_CATEGORY;
  const parentMissing = config.parent_id !== null && !byId.has(config.parent_id);

  return (
    <div className="space-y-3 px-3 py-3" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        {ids.map((id, i) => {
          const c = byId.get(id);
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border bg-background py-0.5 pl-1 pr-2.5 text-xs"
            >
              <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className={c ? "" : "text-destructive"} title={c?.path}>
                {c?.name ?? `#${id} (לא פעילה)`}
              </span>
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move earlier"
              >
                <ArrowRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === ids.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move later"
              >
                <ArrowLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...config, category_ids: ids.filter((x) => x !== id) })}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${c?.name ?? id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {ids.length < MAX_DESTINATIONS && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1 rounded-full text-xs">
                <Plus className="h-3.5 w-3.5" />
                קטגוריה
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <Command>
                <CommandInput placeholder="חיפוש קטגוריה…" dir="rtl" />
                <CommandList>
                  <CommandEmpty>אין קטגוריות להוספה.</CommandEmpty>
                  <CommandGroup>
                    {pickable.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.path} ${c.id}`}
                        onSelect={() => {
                          onChange({ ...config, category_ids: [...ids, c.id] });
                          setOpen(false);
                        }}
                      >
                        <span className="truncate text-sm" dir="rtl">
                          {c.path}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Label className="text-xs text-muted-foreground">מילוי אוטומטי אחרי הקטגוריות שנבחרו</Label>
        <Select
          value={parentValue}
          onValueChange={(v) =>
            onChange({ ...config, parent_id: v === NO_CATEGORY ? null : Number(v) })
          }
        >
          <SelectTrigger className="h-8 w-72 text-xs" dir="rtl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value={NO_CATEGORY}>בלי - רק הקטגוריות שנבחרו</SelectItem>
            {parentMissing && config.parent_id !== null && (
              <SelectItem value={String(config.parent_id)}>
                קטגוריה #{config.parent_id} (לא פעילה)
              </SelectItem>
            )}
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                כל הילדים של: {c.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {ids.length === 0 && config.parent_id === null && (
        <p className="text-xs text-muted-foreground">
          צריך קטגוריה אחת לפחות או קטגוריית אב - בלי זה הבלוק לא נשמר.
        </p>
      )}
    </div>
  );
}

const EMPTY_IMAGE: GalleryImage = { image_url: "", alt: null };

/** Gallery block: 1-12 images, each with an optional caption that doubles as alt text. */
export function GalleryEditor({
  config,
  onChange,
}: {
  config: GalleryConfig;
  onChange: (config: GalleryConfig) => void;
}) {
  const images = config.images.length ? config.images : [EMPTY_IMAGE];
  const patch = (i: number, next: Partial<GalleryImage>) =>
    onChange({ images: images.map((g, j) => (j === i ? { ...g, ...next } : g)) });

  return (
    <div className="space-y-3 px-3 py-3" dir="rtl">
      <div className="grid gap-3 sm:grid-cols-2">
        {images.map((g, i) => (
          <div key={i} className="rounded-lg border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">תמונה {i + 1}</span>
              {images.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => onChange({ images: images.filter((_, j) => j !== i) })}
                  aria-label={`Remove image ${i + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div dir="ltr">
              <HeroImageField
                label="Gallery image"
                value={g.image_url}
                onChange={(url) => patch(i, { image_url: url })}
              />
            </div>
            <div className="mt-2 space-y-1">
              <Label className="text-xs text-muted-foreground">תיאור (לא חובה)</Label>
              <Input
                className="h-8 text-xs"
                maxLength={TITLE_MAX}
                value={g.alt ?? ""}
                onChange={(e) => patch(i, { alt: e.target.value || null })}
              />
            </div>
          </div>
        ))}
      </div>
      {images.length < MAX_GALLERY && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onChange({ images: [...images, EMPTY_IMAGE] })}
        >
          <Plus className="h-3.5 w-3.5" />
          תמונה נוספת
        </Button>
      )}
    </div>
  );
}
