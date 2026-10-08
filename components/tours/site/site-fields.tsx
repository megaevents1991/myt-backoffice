"use client";

/**
 * The small controls the site editors share (Homepage, Header & Footer): a link
 * with a picker of the site's own pages, a color with opacity, an ordered list of
 * anything, a tour picker and a nested menu.
 */
import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EmptyLine, Field, selectClass } from "@/components/tours/ui";
import { ImageUrlField, RowControls, moved } from "@/components/tours/content/fields";
import type { SiteEditorOptions } from "@/lib/actions/tours-site-actions";
import {
  FOOTER_TILE_MOBILE_LABELS,
  FOOTER_TILE_MOBILE_MODES,
  FOOTER_TILE_MODES,
  FOOTER_TILE_MODE_LABELS,
  PICTURE_TILES_MAX,
  type FooterTileMobileMode,
  type FooterTileMode,
  type FooterTiles,
  type PictureTile,
  type SiteFooter,
  type SiteLink,
} from "@/lib/tours/site-content";

/** The term kinds a link can point at, as the picker names them. */
const LINK_GROUPS: { kind: string; label: string }[] = [
  { kind: "audiences", label: "Worlds" },
  { kind: "tags", label: "Tags" },
  { kind: "destinations", label: "Destinations" },
  { kind: "categories", label: "Categories" },
  { kind: "artists", label: "Artists" },
];

/** A link: typed by hand (a path, https://, tel:, mailto:) or picked from the site's pages, terms and tours. */
export function LinkInput({
  value,
  onChange,
  options,
  placeholder = "/contact/ or https://...",
  ariaLabel = "Link",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SiteEditorOptions;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Input
        dir="ltr"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 font-mono text-xs"
      />
      <select
        aria-label="Pick a page of the site"
        title="Pick a page of the site"
        value=""
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className={cn(selectClass, "w-[92px] shrink-0 text-xs")}
      >
        <option value="">Pick…</option>
        <optgroup label="Pages">
          <option value="/">Home</option>
          {options.pages.map((page) => (
            <option key={page.path} value={page.path}>
              {page.title}
            </option>
          ))}
        </optgroup>
        {LINK_GROUPS.map((group) => {
          const terms = options.terms.filter((term) => term.kind === group.kind);
          if (terms.length === 0) return null;
          return (
            <optgroup key={group.kind} label={group.label}>
              {terms.map((term) => (
                <option key={term.kind + term.slug} value={term.path}>
                  {term.name}
                </option>
              ))}
            </optgroup>
          );
        })}
        <optgroup label="Tours">
          {options.tours.map((tour) => (
            <option key={tour.slug} value={`/package/${tour.slug}/`}>
              {tour.name}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- color
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

/** "#rrggbb" + opacity (0-1) of a stored color: #rgb, #rrggbb, #rrggbbaa, rgb() or rgba(). */
function parseColor(value: string): { hex: string; alpha: number } | null {
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return { hex: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase(), alpha: 1 };
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (long) return { hex: `#${long[1]}`.toLowerCase(), alpha: long[2] ? parseInt(long[2], 16) / 255 : 1 };
  const rgba = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (rgba) return { hex: `#${hex2(+rgba[1])}${hex2(+rgba[2])}${hex2(+rgba[3])}`, alpha: rgba[4] === undefined ? 1 : clamp(parseFloat(rgba[4]) || 0, 0, 1) };
  return null;
}

function formatColor(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
}

/** A color swatch with an optional opacity; empty = the site's default for that place. */
export function ColorInput({
  label,
  value,
  onChange,
  withOpacity = false,
  fallback = "#60356c",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  withOpacity?: boolean;
  /** The swatch shown while nothing is set. */
  fallback?: string;
}) {
  const id = useId();
  const parsed = parseColor(value);
  const hex = parsed?.hex ?? fallback;
  const alpha = parsed?.alpha ?? 1;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={hex}
          onChange={(event) => onChange(formatColor(event.target.value, alpha))}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
        />
        {withOpacity && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Opacity
            <Input
              type="number"
              min={0}
              max={100}
              step={5}
              dir="ltr"
              className="h-9 w-[72px]"
              value={Math.round(alpha * 100)}
              onChange={(event) => onChange(formatColor(hex, clamp(Number(event.target.value) || 0, 0, 100) / 100))}
            />
            %
          </label>
        )}
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} title="Back to the site's default color">
            <X />
            Default
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Site default</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lists
/** An ordered list of items, each drawn by `render`, with move / remove on every row and one Add button. */
export function ItemList<T>({
  label,
  items,
  onChange,
  render,
  create,
  addLabel,
  empty = "Nothing here yet",
  max,
}: {
  label?: ReactNode;
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, patch: (change: Partial<T>) => void, index: number) => ReactNode;
  create: () => T;
  addLabel: string;
  empty?: string;
  max?: number;
}) {
  const full = max !== undefined && items.length >= max;
  return (
    <div className="space-y-2">
      {label && (
        <Label>
          {label} <span className="font-normal text-muted-foreground">({items.length})</span>
        </Label>
      )}
      {items.length === 0 && <EmptyLine>{empty}</EmptyLine>}
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 rounded-md border bg-background p-2">
            <span className="mt-2 w-5 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
            <div className="min-w-0 flex-1">
              {render(item, (change) => onChange(items.map((current, i) => (i === index ? { ...current, ...change } : current))), index)}
            </div>
            <RowControls
              index={index}
              count={items.length}
              onMove={(delta) => onChange(moved(items, index, delta))}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={full}
        title={full ? `Up to ${max}` : undefined}
        onClick={() => onChange([...items, create()])}
      >
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

/** One term of a kind, by slug. */
export function TermSelect({
  kind,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  ariaLabel,
  className,
}: {
  kind: string;
  value: string;
  onChange: (slug: string) => void;
  options: SiteEditorOptions;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const terms = options.terms.filter((term) => term.kind === kind);
  const missing = value !== "" && !terms.some((term) => term.slug === value);
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(selectClass, "w-full", className)}
    >
      <option value="">{placeholder}</option>
      {missing && <option value={value}>{value} (not on the site)</option>}
      {terms.map((term) => (
        <option key={term.slug} value={term.slug}>
          {term.name}
        </option>
      ))}
    </select>
  );
}

/** An ordered list of tours, picked from the company's tours. */
export function ToursPicker({
  label,
  value,
  onChange,
  options,
  max = 24,
}: {
  label: string;
  value: string[];
  onChange: (slugs: string[]) => void;
  options: SiteEditorOptions;
  max?: number;
}) {
  const nameOf = (slug: string) => options.tours.find((tour) => tour.slug === slug)?.name;
  const free = options.tours.filter((tour) => !value.includes(tour.slug));
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      {value.length === 0 && <EmptyLine>No tours picked</EmptyLine>}
      <ul className="space-y-1.5">
        {value.map((slug, index) => (
          <li key={slug} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
            <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
            <span dir="auto" className={cn("min-w-0 flex-1 truncate text-sm", !nameOf(slug) && "text-amber-700 dark:text-amber-400")}>
              {nameOf(slug) ?? `${slug} (not on the site - it will be skipped)`}
            </span>
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <select
        aria-label={`Add a tour to ${label}`}
        value=""
        disabled={value.length >= max || free.length === 0}
        onChange={(event) => {
          if (event.target.value) onChange([...value, event.target.value]);
        }}
        className={cn(selectClass, "w-full max-w-sm")}
      >
        <option value="">Add a tour…</option>
        {free.map((tour) => (
          <option key={tour.slug} value={tour.slug}>
            {tour.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- menus
/**
 * A menu as a nested list: every entry has a label and a link; an entry may hold
 * sub-entries down to `depth` levels. A link of "#" (or empty) means the entry
 * only opens its sub-menu.
 */
export function LinkTree({
  items,
  onChange,
  options,
  depth = 1,
  addLabel = "Add Link",
  empty = "No links yet",
}: {
  items: SiteLink[];
  onChange: (items: SiteLink[]) => void;
  options: SiteEditorOptions;
  /** How many levels below this one may hold sub-entries (0 = a flat list). */
  depth?: number;
  addLabel?: string;
  empty?: string;
}) {
  const patch = (index: number, change: Partial<SiteLink>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  return (
    <div className="space-y-2">
      {items.length === 0 && <EmptyLine>{empty}</EmptyLine>}
      <ul className="space-y-2">
        {items.map((item, index) => {
          const children = item.children ?? [];
          return (
            <li key={index} className="rounded-md border bg-background p-2">
              <div className="flex items-center gap-2">
                <Input
                  dir="auto"
                  aria-label="Label"
                  placeholder="Label"
                  value={item.label}
                  onChange={(event) => patch(index, { label: event.target.value })}
                  className="min-w-0 flex-1"
                />
                <div className="min-w-0 flex-1">
                  <LinkInput value={item.href === "#" ? "" : item.href} onChange={(href) => patch(index, { href })} options={options} placeholder="Link (empty = opens its sub-menu)" />
                </div>
                <RowControls
                  index={index}
                  count={items.length}
                  onMove={(delta) => onChange(moved(items, index, delta))}
                  onRemove={() => onChange(items.filter((_, i) => i !== index))}
                />
              </div>
              {depth > 0 && (
                <div className="ms-6 mt-2 border-s ps-3">
                  {children.length > 0 ? (
                    <LinkTree
                      items={children}
                      onChange={(next) => patch(index, { children: next.length ? next : undefined })}
                      options={options}
                      depth={depth - 1}
                      addLabel="Add Sub-link"
                    />
                  ) : (
                    <Button type="button" variant="ghost" size="sm" onClick={() => patch(index, { children: [{ label: "", href: "" }] })}>
                      <Plus />
                      Add Sub-link
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { label: "", href: "" }])}>
        <Plus />
        {addLabel}
      </Button>
    </div>
  );
}

/** Drops the entries nobody filled in (no label and no link), at every level, before a save. */
export function pruneLinks(items: SiteLink[]): SiteLink[] {
  return items
    .filter((item) => item.label.trim() !== "" || (item.href.trim() !== "" && item.href.trim() !== "#"))
    .map((item) => {
      const children = item.children ? pruneLinks(item.children) : [];
      return { label: item.label, href: item.href, ...(children.length ? { children } : {}) };
    });
}

// ---------------------------------------------------------------- footer
type FooterTile = FooterTiles["items"][number];

/** The purple tiles above the footer: a name, where it leads, an icon. */
export function TileList({
  items,
  onChange,
  options,
  siteUrl,
}: {
  items: FooterTile[];
  onChange: (items: FooterTile[]) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
}) {
  return (
    <ItemList
      items={items}
      onChange={onChange}
      create={() => ({ label: "", href: "", icon: "" })}
      addLabel="Add Tile"
      max={8}
      render={(tile, patch) => (
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <Input dir="auto" aria-label="Tile name" placeholder="Tile name" value={tile.label} onChange={(e) => patch({ label: e.target.value })} />
            <LinkInput value={tile.href === "#" ? "" : tile.href} onChange={(href) => patch({ href })} options={options} />
          </div>
          <ImageUrlField label="Icon" value={tile.icon} onChange={(icon) => patch({ icon })} siteUrl={siteUrl} hint="A dark icon on a transparent background; the site paints it white." />
        </div>
      )}
    />
  );
}

/** Drops the tiles nobody filled in, before a save. */
export const pruneTiles = (items: FooterTile[]): FooterTile[] =>
  items.filter((tile) => tile.label.trim() !== "" || (tile.href.trim() !== "" && tile.href.trim() !== "#") || tile.icon.trim() !== "");

/** The picture tiles under the about, FAQ, blog and leaders pages: a name on a cover picture, and where it leads. */
export function PictureTileList({
  items,
  onChange,
  options,
  siteUrl,
}: {
  items: PictureTile[];
  onChange: (items: PictureTile[]) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
}) {
  return (
    <ItemList
      items={items}
      onChange={onChange}
      create={() => ({ label: "", href: "", image: "" })}
      addLabel="Add Picture Tile"
      max={PICTURE_TILES_MAX}
      render={(tile, patch) => (
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <Input dir="auto" aria-label="Tile name" placeholder="Tile name" value={tile.label} onChange={(e) => patch({ label: e.target.value })} />
            <LinkInput value={tile.href === "#" ? "" : tile.href} onChange={(href) => patch({ href })} options={options} />
          </div>
          <ImageUrlField label="Picture" value={tile.image} onChange={(image) => patch({ image })} siteUrl={siteUrl} folder="pages" hint="A wide picture; the name is written on it in white." />
        </div>
      )}
    />
  );
}

/** Drops the picture tiles nobody filled in, before a save. */
export const prunePictureTiles = (items: PictureTile[]): PictureTile[] =>
  items.filter((tile) => tile.label.trim() !== "" || (tile.href.trim() !== "" && tile.href.trim() !== "#") || tile.image.trim() !== "");

/**
 * What one page does with the tiles above the footer: follow the rule set in
 * Header & Footer, always show the main tiles, hide them, or show its own.
 */
export function FooterTilesField({
  value,
  onChange,
  options,
  siteUrl,
}: {
  value: FooterTiles;
  onChange: (value: FooterTiles) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="On this page"
          hint="The purple tiles and the newsletter box above the footer. The main tiles, and the kinds of page they show on, are set in Header & Footer > Footer."
        >
          <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as FooterTileMode })} className={cn(selectClass, "w-full")}>
            {FOOTER_TILE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {FOOTER_TILE_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>
        {value.mode !== "hide" && (
          <Field label="On phones" hint="Whether a phone shows the tiles of this page. Header & Footer says it for every page; this page can say otherwise.">
            <select value={value.mobile} onChange={(e) => onChange({ ...value, mobile: e.target.value as FooterTileMobileMode })} className={cn(selectClass, "w-full")}>
              {FOOTER_TILE_MOBILE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {FOOTER_TILE_MOBILE_LABELS[mode]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {value.mode === "custom" && (
        <>
          <Field label="Title above the tiles" hint="Empty = the title of the main tiles." className="md:max-w-md">
            <Input dir="auto" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
          </Field>
          <TileList items={value.items} onChange={(items) => onChange({ ...value, items })} options={options} siteUrl={siteUrl} />
          {pruneTiles(value.items).length === 0 && <EmptyLine>No tiles yet: until there is one, this page follows the rule of Header & Footer.</EmptyLine>}
        </>
      )}
    </div>
  );
}

type FooterColumns = SiteFooter["columns"];

/** The link columns of the dark footer: a heading and its links, in order. */
export function ColumnsEditor({
  columns,
  onChange,
  options,
  empty,
}: {
  columns: FooterColumns;
  onChange: (columns: FooterColumns) => void;
  options: SiteEditorOptions;
  empty?: string;
}) {
  const patch = (index: number, change: Partial<FooterColumns[number]>) => onChange(columns.map((column, i) => (i === index ? { ...column, ...change } : column)));
  return (
    <div className="space-y-3">
      {columns.length === 0 && empty && <EmptyLine>{empty}</EmptyLine>}
      {columns.map((column, index) => (
        <div key={index} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input
              dir="auto"
              aria-label={`Heading of column ${index + 1}`}
              placeholder="Column heading"
              value={column.heading}
              onChange={(e) => patch(index, { heading: e.target.value })}
              className="font-medium"
            />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === 0} onClick={() => onChange(moved(columns, index, -1))} aria-label="Move column up" title="Move up">
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === columns.length - 1} onClick={() => onChange(moved(columns, index, 1))} aria-label="Move column down" title="Move down">
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={() => onChange(columns.filter((_, i) => i !== index))} aria-label="Remove column" title="Remove column">
              <Trash2 />
            </Button>
          </div>
          <LinkTree items={column.links as SiteLink[]} onChange={(links) => patch(index, { links })} options={options} depth={0} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={columns.length >= 10} onClick={() => onChange([...columns, { heading: "", links: [] }])}>
        <Plus />
        Add Column
      </Button>
    </div>
  );
}
