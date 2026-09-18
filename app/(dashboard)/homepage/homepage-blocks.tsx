"use client";

/**
 * The pieces of the /homepage board that belong to staff-added blocks: the
 * "+ Add block" control between sections and the editor of each block type.
 * State lives in the board; these only draw it and report changes. The rules
 * (how many banners, what a link may be) are lib/homepage/blocks.ts - the
 * server enforces the same ones on Save.
 */

import { useState } from "react";
import { GalleryHorizontal, ImageIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeroImageField } from "@/components/templates/HeroImageField";
import { MAX_BANNERS, TITLE_MAX } from "@/lib/homepage/blocks";
import {
  BLOCK_META,
  HOMEPAGE_BLOCK_TYPES,
  type BannerConfig,
  type BannerItem,
  type EventSliderConfig,
  type HomepageBlockType,
  type HomepageCategoryOption,
} from "@/types/homepage.types";

const BLOCK_ICON: Record<HomepageBlockType, typeof ImageIcon> = {
  event_slider: GalleryHorizontal,
  banner: ImageIcon,
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
        <PopoverContent className="w-72 p-1" align="center">
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
