"use client";

/**
 * The form of each section type of the home page (lib/tours/site-content.ts
 * SECTION_KINDS). A form only edits its own section and hands the whole section
 * back; the board (homepage-editor.tsx) owns the list, the order and the save.
 */
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field, Notice, selectClass } from "@/components/tours/ui";
import { ImageUrlField } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import type { SiteEditorOptions } from "@/lib/actions/tours-site-actions";
import {
  TOUR_SOURCES,
  TOUR_SOURCE_KIND,
  TOUR_SOURCE_LABELS,
  newId,
  type HomeSection,
  type TourSource,
} from "@/lib/tours/site-content";
import { ColorInput, ItemList, LinkInput, TermSelect, ToursPicker } from "@/components/tours/site/site-fields";

type Of<T extends HomeSection["type"]> = Extract<HomeSection, { type: T }>;

interface FormProps<T extends HomeSection["type"]> {
  section: Of<T>;
  onChange: (section: Of<T>) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
}

const Grid = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("grid gap-3 md:grid-cols-2", className)}>{children}</div>
);

function TitleField({ value, onChange, hint }: { value: string; onChange: (value: string) => void; hint?: string }) {
  return (
    <Field label="Section title" hint={hint ?? "Shown above the section on the site. Empty = no title."}>
      <Input dir="auto" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function NewTabSwitch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 self-end pb-1.5">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="text-sm">
        Open in a new tab
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- hero
function HeroForm({ section, onChange, options, siteUrl }: FormProps<"hero">) {
  return (
    <div className="space-y-4">
      <Grid>
        <Field label="Title, bold part">
          <Input dir="auto" value={section.titleBold} onChange={(e) => onChange({ ...section, titleBold: e.target.value })} />
        </Field>
        <Field label="Title, the rest">
          <Input dir="auto" value={section.titleRest} onChange={(e) => onChange({ ...section, titleRest: e.target.value })} />
        </Field>
      </Grid>
      <Field label="Text under the title" hint="The three fields empty = banners only, without the title card.">
        <Textarea dir="auto" rows={2} value={section.text} onChange={(e) => onChange({ ...section, text: e.target.value })} />
      </Field>
      <ItemList
        label="Banners"
        items={section.slides}
        onChange={(slides) => onChange({ ...section, slides })}
        create={() => ({ image: "", alt: "", href: "" })}
        addLabel="Add Banner"
        empty="No banners yet. They rotate every 5 seconds."
        max={10}
        render={(slide, patch) => (
          <div className="space-y-2">
            <ImageUrlField label="Image" value={slide.image} onChange={(image) => patch({ image })} siteUrl={siteUrl} hint="Wide picture, about 1920 x 500." />
            <Grid>
              <Field label="Description for screen readers">
                <Input dir="auto" value={slide.alt} onChange={(e) => patch({ alt: e.target.value })} />
              </Field>
              <Field label="Link (optional)">
                <LinkInput value={slide.href} onChange={(href) => patch({ href })} options={options} />
              </Field>
            </Grid>
          </div>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------- tour finder
const SHOW_LABELS = { sale: "Tours on sale", all: "All tours", world: "The tours of a world" } as const;

function ToursForm({ section, onChange, options, siteUrl }: FormProps<"tours">) {
  return (
    <div className="space-y-4">
      <Field label="Title of the tour grid">
        <Input dir="auto" value={section.gridTitle} onChange={(e) => onChange({ ...section, gridTitle: e.target.value })} />
      </Field>
      <ItemList
        label="Category tiles"
        items={section.tabs}
        onChange={(tabs) => onChange({ ...section, tabs })}
        create={() => ({
          key: newId("tab"),
          label: "",
          icon: "",
          show: "world" as const,
          world: "",
          allLabel: "הכל",
          color: "",
          search: "filters" as const,
          featuredTitle: "",
          featured: [],
        })}
        addLabel="Add Category Tile"
        empty="No category tiles: the grid shows every tour."
        max={8}
        render={(tab, patch) => (
          <div className="space-y-3">
            <Grid>
              <Field label="Name on the tile">
                <Input dir="auto" value={tab.label} onChange={(e) => patch({ label: e.target.value })} />
              </Field>
              <Field label="What the tile shows">
                <select
                  value={tab.show}
                  onChange={(e) => patch({ show: e.target.value as typeof tab.show })}
                  className={cn(selectClass, "w-full")}
                >
                  {(Object.keys(SHOW_LABELS) as (keyof typeof SHOW_LABELS)[]).map((key) => (
                    <option key={key} value={key}>
                      {SHOW_LABELS[key]}
                    </option>
                  ))}
                </select>
              </Field>
              {tab.show === "world" && (
                <Field label="World" hint="The tours whose Categories & Tags include this world.">
                  <TermSelect kind="audiences" value={tab.world} onChange={(world) => patch({ world })} options={options} />
                </Field>
              )}
              <Field label={'Name of the "all" pill'} hint="The first trip-type pill of this tile.">
                <Input dir="auto" value={tab.allLabel} onChange={(e) => patch({ allLabel: e.target.value })} />
              </Field>
              <Field label="Search under the pills">
                <select
                  value={tab.search}
                  onChange={(e) => patch({ search: e.target.value as typeof tab.search })}
                  className={cn(selectClass, "w-full")}
                >
                  <option value="filters">Destination and season lists</option>
                  <option value="text">Free text search</option>
                </select>
              </Field>
              <ColorInput label="Search button color" value={tab.color} onChange={(color) => patch({ color })} />
            </Grid>
            <ImageUrlField label="Icon" value={tab.icon} onChange={(icon) => patch({ icon })} siteUrl={siteUrl} hint="Square icon, shown at 86 x 86." />
            <Field label="Featured row title" hint="A row of picked tours above the grid, on this tile only. Empty = no featured row.">
              <Input dir="auto" value={tab.featuredTitle} onChange={(e) => patch({ featuredTitle: e.target.value })} />
            </Field>
            {tab.featuredTitle.trim() !== "" && (
              <ToursPicker label="Featured tours" value={tab.featured} onChange={(featured) => patch({ featured })} options={options} max={12} />
            )}
          </div>
        )}
      />
      <ItemList
        label="Trip-type pills of a sale tile"
        items={section.salePills}
        onChange={(salePills) => onChange({ ...section, salePills })}
        create={() => ({ label: "", tag: "" })}
        addLabel="Add Pill"
        empty="No pills. The other tiles build their pills from the tags of their tours."
        max={16}
        render={(pill, patch) => (
          <Grid>
            <Input dir="auto" aria-label="Pill name" placeholder="Pill name" value={pill.label} onChange={(e) => patch({ label: e.target.value })} />
            <TermSelect kind="tags" value={pill.tag} onChange={(tag) => patch({ tag })} options={options} placeholder="All (no tag)" ariaLabel="Tag" />
          </Grid>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------- simple sections
function LeadForm({ section, onChange }: FormProps<"lead_form">) {
  return (
    <Field label="Title on the home page" hint="Empty = the lead form title set in Header & Footer > Contact details.">
      <Input dir="auto" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
    </Field>
  );
}

function TermTilesForm({ section, onChange, options, siteUrl }: FormProps<"artists"> | FormProps<"destinations">) {
  const kind = section.type;
  const noun = kind === "artists" ? "Artist" : "Destination";
  const update = (change: Partial<typeof section>) => (onChange as (s: typeof section) => void)({ ...section, ...change });
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => update({ title })} />
      <ItemList
        label={`${noun} tiles`}
        items={section.items}
        onChange={(items) => update({ items })}
        create={() => ({ slug: "", image: "" })}
        addLabel={`Add ${noun}`}
        max={24}
        render={(item, patch) => (
          <div className="space-y-2">
            <TermSelect kind={kind} value={item.slug} onChange={(slug) => patch({ slug })} options={options} ariaLabel={noun} />
            <ImageUrlField
              label="Tile picture"
              value={item.image}
              onChange={(image) => patch({ image })}
              siteUrl={siteUrl}
              hint={`Empty = the first hero image of the ${noun.toLowerCase()}.`}
            />
          </div>
        )}
      />
    </div>
  );
}

function BannersForm({ section, onChange, options, siteUrl }: FormProps<"banners">) {
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <ItemList
        label="Banners"
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        create={() => ({ title: "", subtitle: "", cta: "", href: "", newTab: false, image: "", overlayColor: "", buttonColor: "" })}
        addLabel="Add Banner"
        max={8}
        render={(banner, patch, index) => (
          <div className="space-y-2">
            <Grid>
              <Field label="Title">
                <Input dir="auto" value={banner.title} onChange={(e) => patch({ title: e.target.value })} />
              </Field>
              <Field label="Line under the title">
                <Input dir="auto" value={banner.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
              </Field>
              <Field label="Button text">
                <Input dir="auto" value={banner.cta} onChange={(e) => patch({ cta: e.target.value })} />
              </Field>
              <Field label="Button link" hint="Without a text and a link there is no button.">
                <LinkInput value={banner.href} onChange={(href) => patch({ href })} options={options} />
              </Field>
              <ColorInput label="Color of the text box" value={banner.overlayColor} onChange={(overlayColor) => patch({ overlayColor })} withOpacity />
              <ColorInput label="Button color" value={banner.buttonColor} onChange={(buttonColor) => patch({ buttonColor })} withOpacity />
              <NewTabSwitch id={`${section.id}-banner-${index}-tab`} checked={banner.newTab} onChange={(newTab) => patch({ newTab })} />
            </Grid>
            <ImageUrlField label="Picture" value={banner.image} onChange={(image) => patch({ image })} siteUrl={siteUrl} />
          </div>
        )}
      />
    </div>
  );
}

function ReasonsForm({ section, onChange, siteUrl }: FormProps<"reasons">) {
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <ItemList
        label="Reasons"
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        create={() => ({ icon: "", title: "", text: "" })}
        addLabel="Add Reason"
        max={8}
        render={(reason, patch) => (
          <div className="space-y-2">
            <Grid>
              <Field label="Title">
                <Input dir="auto" value={reason.title} onChange={(e) => patch({ title: e.target.value })} />
              </Field>
              <Field label="Text">
                <Input dir="auto" value={reason.text} onChange={(e) => patch({ text: e.target.value })} />
              </Field>
            </Grid>
            <ImageUrlField label="Icon" value={reason.icon} onChange={(icon) => patch({ icon })} siteUrl={siteUrl} hint="Square icon, shown at 96 x 96." />
          </div>
        )}
      />
    </div>
  );
}

function ReviewsForm({ section, onChange }: FormProps<"reviews">) {
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <Notice tone="info">The world and tag pages of the site show these same reviews.</Notice>
      <ItemList
        label="Reviews"
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        create={() => ({ name: "", text: "" })}
        addLabel="Add Review"
        max={24}
        render={(review, patch) => (
          <div className="space-y-2">
            <Field label="Who wrote it">
              <Input dir="auto" value={review.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="The review" hint="A new line starts a new paragraph. The site shows up to 9 lines.">
              <Textarea dir="auto" rows={4} value={review.text} onChange={(e) => patch({ text: e.target.value })} />
            </Field>
          </div>
        )}
      />
    </div>
  );
}

function SliderForm({ section, onChange, options }: FormProps<"slider">) {
  const kind = TOUR_SOURCE_KIND[section.source];
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <Grid>
        <Field label="Which tours" hint="The row fills itself: a tour that gets the tag shows up after the next Revalidate Pages.">
          <select
            value={section.source}
            onChange={(e) => onChange({ ...section, source: e.target.value as TourSource, term: "" })}
            className={cn(selectClass, "w-full")}
          >
            {TOUR_SOURCES.map((source) => (
              <option key={source} value={source}>
                {TOUR_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </Field>
        {kind && (
          <Field label={TOUR_SOURCE_LABELS[section.source].replace("The tours of a ", "").replace(/^./, (c) => c.toUpperCase())}>
            <TermSelect kind={kind} value={section.term} onChange={(term) => onChange({ ...section, term })} options={options} />
          </Field>
        )}
        <Field label="How many tours at most">
          <Input
            type="number"
            min={1}
            max={24}
            dir="ltr"
            value={section.limit}
            onChange={(e) => onChange({ ...section, limit: Math.min(24, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) })}
          />
        </Field>
      </Grid>
      {section.source === "manual" && (
        <ToursPicker label="Tours in this row" value={section.tours} onChange={(tours) => onChange({ ...section, tours })} options={options} />
      )}
      <Grid>
        <Field label={'"See more" button text'} hint="Empty = no button.">
          <Input dir="auto" value={section.moreLabel} onChange={(e) => onChange({ ...section, moreLabel: e.target.value })} />
        </Field>
        <Field label={'"See more" link'}>
          <LinkInput value={section.moreHref} onChange={(moreHref) => onChange({ ...section, moreHref })} options={options} />
        </Field>
      </Grid>
    </div>
  );
}

function WorldsForm({ section, onChange, options }: FormProps<"worlds">) {
  const worlds = options.terms.filter((term) => term.kind === "audiences");
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <Notice tone="info">
        One tile per world, in its own color. A world is an audience with a brand name: set the name, the color and the picture in
        Categories & Tags &gt; Worlds. This company has {worlds.length} {worlds.length === 1 ? "audience" : "audiences"}.
      </Notice>
    </div>
  );
}

function TextForm({ section, onChange, siteUrl }: FormProps<"text">) {
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <HtmlField label="Text" value={section.html} onChange={(html) => onChange({ ...section, html })} siteUrl={siteUrl} rows={8} />
    </div>
  );
}

function ImageForm({ section, onChange, options, siteUrl }: FormProps<"image">) {
  return (
    <div className="space-y-3">
      <ImageUrlField label="Picture" value={section.image} onChange={(image) => onChange({ ...section, image })} siteUrl={siteUrl} hint="Wide picture, about 1200 x 320." />
      <Grid>
        <Field label="Description for screen readers">
          <Input dir="auto" value={section.alt} onChange={(e) => onChange({ ...section, alt: e.target.value })} />
        </Field>
        <Field label="Link (optional)">
          <LinkInput value={section.href} onChange={(href) => onChange({ ...section, href })} options={options} />
        </Field>
        <NewTabSwitch id={`${section.id}-tab`} checked={section.newTab} onChange={(newTab) => onChange({ ...section, newTab })} />
      </Grid>
    </div>
  );
}

/** The form of one section, by its type. */
export function SectionForm({
  section,
  onChange,
  options,
  siteUrl,
}: {
  section: HomeSection;
  onChange: (section: HomeSection) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
}) {
  const shared = { onChange, options, siteUrl };
  switch (section.type) {
    case "hero":
      return <HeroForm section={section} {...shared} />;
    case "tours":
      return <ToursForm section={section} {...shared} />;
    case "lead_form":
      return <LeadForm section={section} {...shared} />;
    case "artists":
      return <TermTilesForm section={section} {...shared} />;
    case "destinations":
      return <TermTilesForm section={section} {...shared} />;
    case "banners":
      return <BannersForm section={section} {...shared} />;
    case "reasons":
      return <ReasonsForm section={section} {...shared} />;
    case "reviews":
      return <ReviewsForm section={section} {...shared} />;
    case "slider":
      return <SliderForm section={section} {...shared} />;
    case "worlds":
      return <WorldsForm section={section} {...shared} />;
    case "text":
      return <TextForm section={section} {...shared} />;
    case "image":
      return <ImageForm section={section} {...shared} />;
  }
}
