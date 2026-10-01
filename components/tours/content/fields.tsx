"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ImageOff, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { siteAssetUrl, type GalleryItem } from "@/components/tours/content/shared";

/** Label + control + hint, the one layout every content form uses. */
export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A section card of an editor tab. */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4 rounded-lg border bg-card p-4", className)}>
      {(title || description) && (
        <div>
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A status pill that is a <span> - the stock Badge is a <div>, which may not sit
 * inside the <p> that PageHeader wraps a description in.
 */
export function Pill({ tone = "neutral", children }: { tone?: "on" | "off" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        tone === "on" && "text-foreground",
        tone === "off" && "border-transparent bg-destructive text-destructive-foreground",
        tone === "neutral" && "border-transparent bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Move an item of a list one place up or down. */
export function moved<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Up / down / remove - the controls on every row of an ordered list. */
export function RowControls({
  index,
  count,
  onMove,
  onRemove,
  removeLabel = "הסרה",
}: {
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label="העברה למעלה"
        title="העברה למעלה"
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label="העברה למטה"
        title="העברה למטה"
      >
        <ArrowDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** A picture served by the company's site (`/media/...`), or a placeholder when it cannot load. */
export function SiteImage({
  siteUrl,
  path,
  className,
  alt = "",
}: {
  siteUrl: string | null | undefined;
  path: string | null | undefined;
  className?: string;
  alt?: string;
}) {
  const src = siteAssetUrl(siteUrl, path);
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div
        className={cn("flex items-center justify-center rounded bg-muted text-muted-foreground", className)}
        title={src ? "התמונה לא נטענה מהאתר" : "אין תמונה"}
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the customer site, not by this app
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("rounded bg-muted object-cover", className)}
    />
  );
}

/** One image address with its thumbnail. */
export function ImageUrlField({
  label,
  value,
  onChange,
  siteUrl,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  siteUrl: string | null | undefined;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex items-start gap-3">
        <SiteImage siteUrl={siteUrl} path={value} className="h-20 w-32 shrink-0" alt={label} />
        <Input
          id={id}
          dir="ltr"
          placeholder="/media/2026/07/picture.jpg"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-xs"
        />
      </div>
    </Field>
  );
}

/** An ordered list of image addresses with thumbnails: reorder, remove, add by address. */
export function ImageListEditor({
  label,
  value,
  onChange,
  siteUrl,
  hint,
  addLabel = "הוספת תמונה",
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  siteUrl: string | null | undefined;
  hint?: ReactNode;
  addLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      {value.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">אין תמונות</p>
      )}
      <ul className="space-y-2">
        {value.map((path, index) => (
          <li key={index} className="flex items-center gap-3 rounded-md border bg-background p-2">
            <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
            <SiteImage siteUrl={siteUrl} path={path} className="h-12 w-20 shrink-0" />
            <Input
              dir="ltr"
              aria-label={`${label} ${index + 1}`}
              placeholder="/media/2026/07/picture.jpg"
              value={path}
              onChange={(event) => onChange(value.map((v, i) => (i === index ? event.target.value : v)))}
              className="font-mono text-xs"
            />
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
        <Plus />
        {addLabel}
      </Button>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** An instructor gallery: address, title and caption per picture. */
export function GalleryItemsEditor({
  label,
  value,
  onChange,
  siteUrl,
}: {
  label: string;
  value: GalleryItem[];
  onChange: (value: GalleryItem[]) => void;
  siteUrl: string | null | undefined;
}) {
  const patch = (index: number, change: Partial<GalleryItem>) =>
    onChange(value.map((item, i) => (i === index ? { ...item, ...change } : item)));
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      {value.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">אין תמונות</p>
      )}
      <ul className="space-y-2">
        {value.map((item, index) => (
          <li key={index} className="flex items-start gap-3 rounded-md border bg-background p-2">
            <SiteImage siteUrl={siteUrl} path={item.src} className="h-16 w-24 shrink-0" alt={item.title} />
            <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
              <Input
                dir="ltr"
                aria-label="כתובת התמונה"
                placeholder="/media/2026/01/picture.webp"
                value={item.src}
                onChange={(event) => patch(index, { src: event.target.value })}
                className="font-mono text-xs md:col-span-2"
              />
              <Input
                aria-label="כותרת"
                placeholder="כותרת"
                value={item.title}
                onChange={(event) => patch(index, { title: event.target.value })}
              />
              <Input
                aria-label="כיתוב"
                placeholder="כיתוב"
                value={item.caption}
                onChange={(event) => patch(index, { caption: event.target.value })}
              />
            </div>
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { src: "", title: "", caption: "" }])}
      >
        <Plus />
        הוספת תמונה
      </Button>
    </div>
  );
}

/** An ordered list of short texts (attractions, what is included, amenities). */
export function StringListEditor({
  label,
  value,
  onChange,
  placeholder,
  addLabel = "הוספת שורה",
  hint,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      <ul className="space-y-1.5">
        {value.map((item, index) => (
          <li key={index} className="flex items-center gap-2">
            <Input
              aria-label={`${label} ${index + 1}`}
              placeholder={placeholder}
              value={item}
              onChange={(event) => onChange(value.map((v, i) => (i === index ? event.target.value : v)))}
            />
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
        <Plus />
        {addLabel}
      </Button>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The note every image editor carries in this version. */
export const NO_UPLOAD_NOTE =
  "בגרסה הזו אין העלאת קבצים: מזינים את כתובת התמונה כפי שהיא באתר (‎/media/...‎), והתמונה נטענת מהאתר.";
