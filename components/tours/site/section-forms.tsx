"use client";

/**
 * The form of each section type of the home page and of a term page
 * (lib/tours/site-content.ts SECTION_KINDS). A form only edits its own section and
 * hands the whole section back; the board (sections-board.tsx) owns the list, the
 * order and the save.
 */
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field, Notice, selectClass } from "@/components/tours/ui";
import { ImageListEditor, ImageUrlField } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import type { SiteEditorOptions } from "@/lib/actions/tours-site-actions";
import {
  REVIEWS_MAX,
  SUMMARY_COLUMNS_MAX,
  SUMMARY_IMAGES_MAX,
  TAB_SHOWS,
  TAB_TERM_KIND,
  TERM_PICKS_MAX,
  TILE_SOURCES,
  TILE_SOURCE_LABELS,
  TOUR_SOURCES,
  TOUR_SOURCE_KIND,
  TOUR_SOURCE_LABELS,
  newId,
  type HomeSection,
  type TileSource,
  type TourSource,
} from "@/lib/tours/site-content";
import { FormReviewsPicker } from "@/components/tours/site/form-reviews-picker";
import { GoogleReviewsPanel } from "@/components/tours/site/google-reviews-panel";
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

/** A part of a long form that stays folded until it is needed: its name and what it holds stay in view. */
function Fold({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="rounded-md border bg-muted/30 open:bg-background">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        {title}
        <span className="ms-2 font-normal text-muted-foreground">{summary}</span>
      </summary>
      <div className="space-y-3 border-t p-3">{children}</div>
    </details>
  );
}

const clamp = (value: string, max: number): number => Math.min(max, Math.max(1, Math.trunc(Number(value)) || 1));

const selectOf = <T extends string>(value: T, options: readonly T[], labels: Record<T, string>, onChange: (value: T) => void) => (
  <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(selectClass, "w-full")}>
    {options.map((option) => (
      <option key={option} value={option}>
        {labels[option]}
      </option>
    ))}
  </select>
);

/** "The tours of a world" -> "World": the name of the list a rule picks its term from. */
const termLabel = (source: TourSource): string => TOUR_SOURCE_LABELS[source].replace("The tours of a ", "").replace(/^./, (c) => c.toUpperCase());

const FILL_LABELS = { manual: "I pick them", auto: "Automatic" } as const;

// ---------------------------------------------------------------- shared parts
interface TourRule {
  source: TourSource;
  term: string;
  tours: string[];
  limit: number;
}

/** Which tours a row, a slider or automatic banners show: the rule, its term, the picked tours, and how many. */
function TourRuleFields({
  rule,
  onChange,
  options,
  maxLimit = 24,
  pickLabel = "Tours in this row",
  hint,
}: {
  rule: TourRule;
  onChange: (change: Partial<TourRule>) => void;
  options: SiteEditorOptions;
  maxLimit?: number;
  pickLabel?: string;
  hint?: string;
}) {
  const kind = TOUR_SOURCE_KIND[rule.source];
  return (
    <>
      <Grid>
        <Field label="Which tours" hint={hint}>
          {selectOf(rule.source, TOUR_SOURCES, TOUR_SOURCE_LABELS, (source) => onChange({ source, term: "" }))}
        </Field>
        {kind && (
          <Field label={termLabel(rule.source)}>
            <TermSelect kind={kind} value={rule.term} onChange={(term) => onChange({ term })} options={options} />
          </Field>
        )}
        <Field label="How many at most">
          <Input type="number" min={1} max={maxLimit} dir="ltr" value={rule.limit} onChange={(e) => onChange({ limit: clamp(e.target.value, maxLimit) })} />
        </Field>
      </Grid>
      {rule.source === "manual" && <ToursPicker label={pickLabel} value={rule.tours} onChange={(tours) => onChange({ tours })} options={options} />}
    </>
  );
}

interface BannerValue {
  titleBold: string;
  titleRest: string;
  text: string;
  slides: { image: string; alt: string; href: string }[];
}

/** The top banner: the title card's three texts and the rotating pictures. */
function BannerFields({
  value,
  onChange,
  options,
  siteUrl,
  textHint,
  empty,
}: {
  value: BannerValue;
  onChange: (change: Partial<BannerValue>) => void;
  options: SiteEditorOptions;
  siteUrl: string | null;
  textHint: string;
  empty: string;
}) {
  return (
    <div className="space-y-4">
      <Grid>
        <Field label="Title, bold part">
          <Input dir="auto" value={value.titleBold} onChange={(e) => onChange({ titleBold: e.target.value })} />
        </Field>
        <Field label="Title, the rest">
          <Input dir="auto" value={value.titleRest} onChange={(e) => onChange({ titleRest: e.target.value })} />
        </Field>
      </Grid>
      <Field label="Text under the title" hint={textHint}>
        <Textarea dir="auto" rows={2} value={value.text} onChange={(e) => onChange({ text: e.target.value })} />
      </Field>
      <ItemList
        label="Banners"
        items={value.slides}
        onChange={(slides) => onChange({ slides })}
        create={() => ({ image: "", alt: "", href: "" })}
        addLabel="Add Banner"
        empty={empty}
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

// ---------------------------------------------------------------- hero
function HeroForm({ section, onChange, options, siteUrl }: FormProps<"hero">) {
  return (
    <div className="space-y-4">
      <Notice tone="info">
        These are the general banners of the page. A category tile of the Tour finder can carry banners of its own (open the tile, &quot;Banner of this
        tile&quot;): while a customer has that tile chosen, its banners show here instead.
      </Notice>
      <BannerFields
        value={section}
        onChange={(change) => onChange({ ...section, ...change })}
        options={options}
        siteUrl={siteUrl}
        textHint="The three fields empty = banners only, without the title card."
        empty="No banners yet. They rotate every 5 seconds."
      />
    </div>
  );
}

// ---------------------------------------------------------------- tour finder
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
          term: "",
          tours: [],
          allLabel: "הכל",
          color: "",
          search: "filters" as const,
          pillTags: [],
          banner: { titleBold: "", titleRest: "", text: "", slides: [] },
          rows: [],
        })}
        addLabel="Add Category Tile"
        empty="No category tiles: the grid shows every tour."
        max={8}
        render={(tab, patch) => {
          const termKind = TAB_TERM_KIND[tab.show];
          return (
            <div className="space-y-3">
              <Grid>
                <Field label="Name on the tile">
                  <Input dir="auto" value={tab.label} onChange={(e) => patch({ label: e.target.value })} />
                </Field>
                <Field label="What the tile shows" hint="The tile fills itself: a tour that joins the world, the tag or the sale shows after the next Revalidate Pages.">
                  {selectOf(tab.show, TAB_SHOWS, TOUR_SOURCE_LABELS, (show) => patch({ show, term: "" }))}
                </Field>
                {tab.show === "world" && (
                  <Field label="World" hint="The tours whose Categories & Tags include this world.">
                    <TermSelect kind="audiences" value={tab.world} onChange={(world) => patch({ world })} options={options} />
                  </Field>
                )}
                {termKind && (
                  <Field label={termLabel(tab.show)}>
                    <TermSelect kind={termKind} value={tab.term} onChange={(term) => patch({ term })} options={options} />
                  </Field>
                )}
                <Field label={'Name of the "all" pill'} hint="The first trip-type pill of this tile.">
                  <Input dir="auto" value={tab.allLabel} onChange={(e) => patch({ allLabel: e.target.value })} />
                </Field>
                <Field label="Search under the pills">
                  <select value={tab.search} onChange={(e) => patch({ search: e.target.value as typeof tab.search })} className={cn(selectClass, "w-full")}>
                    <option value="filters">Destination and season lists</option>
                    <option value="text">Free text search</option>
                  </select>
                </Field>
                <ColorInput label="Search button color" value={tab.color} onChange={(color) => patch({ color })} />
              </Grid>
              {tab.show === "manual" && (
                <ToursPicker label="Tours of this tile" value={tab.tours} onChange={(tours) => patch({ tours })} options={options} max={48} />
              )}
              <ImageUrlField label="Icon" value={tab.icon} onChange={(icon) => patch({ icon })} siteUrl={siteUrl} hint="Square icon, shown at 86 x 86." />

              <Fold title="Banner of this tile" summary={tab.banner.slides.length ? `${tab.banner.slides.length} banners of its own` : "The page's general banners"}>
                <p className="text-sm text-muted-foreground">
                  While a customer has this tile chosen, these banners replace the banners at the top of the page. No banners here = the general ones stay.
                </p>
                <BannerFields
                  value={tab.banner}
                  onChange={(change) => patch({ banner: { ...tab.banner, ...change } })}
                  options={options}
                  siteUrl={siteUrl}
                  textHint="The three fields empty = the title card of the general banners stays."
                  empty="No banners of its own: the general banners stay."
                />
              </Fold>

              <Fold title="Trip-type pills" summary={tab.pillTags.length ? `${tab.pillTags.length} picked` : "Automatic"}>
                <p className="text-sm text-muted-foreground">
                  Empty = the tile builds its pills by itself, from the tags of its tours. Pick tags to show only those, in this order.
                </p>
                <ItemList
                  items={tab.pillTags.map((slug) => ({ slug }))}
                  onChange={(items) => patch({ pillTags: items.map((item) => item.slug) })}
                  create={() => ({ slug: "" })}
                  addLabel="Add Pill"
                  empty="Automatic: the tags of the tile's tours."
                  max={24}
                  render={(item, patchItem) => <TermSelect kind="tags" value={item.slug} onChange={(slug) => patchItem({ slug })} options={options} ariaLabel="Tag" />}
                />
              </Fold>

              <Fold title="Rows of this tile" summary={tab.rows.length ? `${tab.rows.length} ${tab.rows.length === 1 ? "row" : "rows"}` : "None"}>
                <p className="text-sm text-muted-foreground">
                  Rows of tours of this tile only, under its search and above the tour grid: best sellers, a holiday, tours you pick. They step aside as soon as
                  the customer searches or picks a trip type, so the results come first.
                </p>
                <ItemList
                  items={tab.rows}
                  onChange={(rows) => patch({ rows })}
                  create={() => ({ id: newId("row"), title: "", source: "manual" as const, term: "", tours: [], limit: 8 })}
                  addLabel="Add Row"
                  empty="No rows: the tile goes straight to the tour grid."
                  max={6}
                  render={(row, patchRow) => (
                    <div className="space-y-3">
                      <Field label="Row title">
                        <Input dir="auto" value={row.title} onChange={(e) => patchRow({ title: e.target.value })} />
                      </Field>
                      <TourRuleFields rule={row} onChange={patchRow} options={options} hint="Up to 4 tours show as one line; more than 4 slide." />
                    </div>
                  )}
                />
              </Fold>
            </div>
          );
        }}
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
    <Field label="Title of the form" hint="Empty = the lead form title set in Header & Footer > Contact details.">
      <Input dir="auto" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
    </Field>
  );
}

function TermTilesForm({ section, onChange, options, siteUrl }: FormProps<"artists"> | FormProps<"destinations">) {
  const kind = section.type;
  const noun = kind === "artists" ? "Artist" : "Destination";
  const plural = kind === "artists" ? "artists" : "destinations";
  const update = (change: Partial<typeof section>) => (onChange as (s: typeof section) => void)({ ...section, ...change });
  const termKind = TOUR_SOURCE_KIND[section.source as TourSource];
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => update({ title })} />
      <Grid>
        <Field
          label={`Which ${plural}`}
          hint={`"I pick them" = the ${plural} you list here, in this order. "Automatic" = the section fills itself with the ${plural} of the tours of a rule (a world, a tag, a category, a destination, on sale) or all of them; a ${noun.toLowerCase()} without a picture is skipped.`}
        >
          {selectOf(section.mode, ["manual", "auto"] as const, FILL_LABELS, (mode) => update({ mode }))}
        </Field>
        {section.mode === "auto" && (
          <>
            <Field label={`The ${plural} of which tours`} hint={`"All of them" lists every ${noun.toLowerCase()}, the ones with the most tours first. A rule lists the ${plural} its tours go to, the most used first.`}>
              {selectOf<TileSource>(section.source, TILE_SOURCES, TILE_SOURCE_LABELS, (source) => update({ source, term: "" }))}
            </Field>
            {termKind && (
              <Field label={termLabel(section.source as TourSource)}>
                <TermSelect kind={termKind} value={section.term} onChange={(term) => update({ term })} options={options} />
              </Field>
            )}
            <Field label="How many at most">
              <Input type="number" min={1} max={24} dir="ltr" value={section.limit} onChange={(e) => update({ limit: clamp(e.target.value, 24) })} />
            </Field>
          </>
        )}
      </Grid>
      {section.mode === "manual" && (
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
      )}
    </div>
  );
}

function BannersForm({ section, onChange, options, siteUrl }: FormProps<"banners">) {
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <Field
        label="Which banners"
        hint='"I pick them" = banners you write here, each with its own picture, text and link. "Automatic" = one banner per tour of a rule (the tours of a world, a tag, a destination, a category, on sale, or tours you pick): the tour&apos;s picture and name, and a button to its page.'
      >
        {selectOf(section.mode, ["manual", "auto"] as const, FILL_LABELS, (mode) => onChange({ ...section, mode }))}
      </Field>
      {section.mode === "auto" ? (
        <>
          <TourRuleFields rule={section} onChange={(change) => onChange({ ...section, ...change })} options={options} maxLimit={12} pickLabel="Tours of the banners" />
          <Field label="Button text" hint='Empty = "לפרטים". The button takes the color of the tour&apos;s world.'>
            <Input dir="auto" value={section.autoCta} onChange={(e) => onChange({ ...section, autoCta: e.target.value })} />
          </Field>
        </>
      ) : (
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
      )}
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

const REVIEW_SOURCE_LABELS = { manual: "The reviews listed here (typed, or picked from the feedback forms)", google: "The company's Google reviews" } as const;

function ReviewsForm({ section, onChange }: FormProps<"reviews">) {
  const google = section.source === "google";
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <Grid>
        <Field label="Where the reviews come from" hint="Google's reviews are read every night; the newest ones show by themselves.">
          {selectOf(section.source, ["manual", "google"] as const, REVIEW_SOURCE_LABELS, (source) => onChange({ ...section, source }))}
        </Field>
        {google && (
          <>
            <Field label="At least how many stars">
              <select value={section.minRating} onChange={(e) => onChange({ ...section, minRating: clamp(e.target.value, 5) })} className={cn(selectClass, "w-full")}>
                {[5, 4, 3, 2, 1].map((stars) => (
                  <option key={stars} value={stars}>
                    {stars === 5 ? "5 stars only" : `${stars} stars and up`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How many reviews at most">
              <Input type="number" min={1} max={24} dir="ltr" value={section.limit} onChange={(e) => onChange({ ...section, limit: clamp(e.target.value, 24) })} />
            </Field>
          </>
        )}
      </Grid>
      {google && <GoogleReviewsPanel minRating={section.minRating} limit={section.limit} />}
      <Notice tone="info">
        {google
          ? "The reviews typed below are kept: the site shows them while Google has no review to show."
          : "The world and tag pages of the site show the reviews of the home page, unless they carry reviews of their own."}
      </Notice>
      <div className="flex flex-wrap items-center gap-3">
        <FormReviewsPicker
          takenRefs={section.items.map((item) => item.ref).filter(Boolean)}
          room={REVIEWS_MAX - section.items.length}
          onAdd={(picked) => onChange({ ...section, items: [...section.items, ...picked].slice(0, REVIEWS_MAX) })}
        />
        <p className="text-sm text-muted-foreground">Answers customers left on the feedback forms. You choose which ones show; each is copied into the list below.</p>
      </div>
      <ItemList
        label={google ? "Typed and picked reviews (shown while Google has none)" : "Reviews"}
        items={section.items}
        onChange={(items) => onChange({ ...section, items })}
        create={() => ({ name: "", text: "", rating: 0, ref: "" })}
        addLabel="Add Review"
        max={REVIEWS_MAX}
        render={(review, patch) => (
          <div className="space-y-2">
            <Grid>
              <Field label="Who wrote it" hint={review.ref ? "Picked from a feedback form. Shorten the name if the customer should not be named in full." : undefined}>
                <Input dir="auto" value={review.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="Stars" hint="Drawn above the text on the site.">
                <select value={review.rating} onChange={(e) => patch({ rating: Math.min(5, Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })} className={cn(selectClass, "w-full")}>
                  <option value={0}>No stars</option>
                  {[5, 4, 3, 2, 1].map((stars) => (
                    <option key={stars} value={stars}>
                      {stars} {stars === 1 ? "star" : "stars"}
                    </option>
                  ))}
                </select>
              </Field>
            </Grid>
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
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} />
      <TourRuleFields
        rule={section}
        onChange={(change) => onChange({ ...section, ...change })}
        options={options}
        hint="The row fills itself: a tour that gets the tag shows up after the next Revalidate Pages."
      />
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

/** What a built-in part of a term page is, and how to use it. */
const BLOCK_NOTES: Record<"subcategories" | "term_tours" | "term_description", string> = {
  subcategories:
    "The tags attached to this world, as buttons in the world's color. Attach a tag on the tag's own screen (its World field). Nothing shows while the world has none.",
  term_tours: "Every tour that carries this term, with its search. It fills itself. Move it up or down among the other parts, or switch it off to hide it.",
  term_description: "The text of the Description field, further down this screen. Move it to where the page should say it, or switch it off.",
};

/** The tour list of a term page: which tours come first, and whether the rest follow. */
function TermToursForm({ section, onChange, options }: FormProps<"term_tours">) {
  return (
    <div className="space-y-4">
      <Notice tone="info">{BLOCK_NOTES.term_tours}</Notice>
      <ToursPicker
        label="Tours first"
        value={section.tours}
        onChange={(tours) => onChange({ ...section, tours })}
        options={options}
        max={TERM_PICKS_MAX}
      />
      <p className="text-xs text-muted-foreground">
        These come first, in this order; every other tour of the page follows them. With none picked, the page keeps its own order. A picked tour that does not carry this
        term is still shown here.
      </p>
      <div className="flex items-center gap-3 rounded-md border p-3 md:max-w-md">
        <Switch id={`${section.id}-only`} checked={section.onlyPicked} onCheckedChange={(onlyPicked) => onChange({ ...section, onlyPicked })} />
        <label htmlFor={`${section.id}-only`} className="text-sm">
          Show only the tours picked
          <span className="block text-xs text-muted-foreground">On = the other tours of the page are left out (with no tour picked, the page shows all of them).</span>
        </label>
      </div>
    </div>
  );
}

/** The sub-categories of a world page: which of its tags to show, in which order. */
function SubcategoriesForm({ section, onChange, options }: FormProps<"subcategories">) {
  return (
    <div className="space-y-4">
      <Notice tone="info">{BLOCK_NOTES.subcategories}</Notice>
      <ItemList
        label="Sub-categories to show"
        items={section.tags}
        onChange={(tags) => onChange({ ...section, tags })}
        create={() => ""}
        addLabel="Add Sub-category"
        empty="None picked: the page shows every tag attached to this world, in the order of the tags list."
        max={TERM_PICKS_MAX}
        render={(tag, _patch, index) => (
          <TermSelect kind="tags" value={tag} onChange={(slug) => onChange({ ...section, tags: section.tags.map((t, i) => (i === index ? slug : t)) })} options={options} ariaLabel="Tag" />
        )}
      />
      <p className="text-xs text-muted-foreground">With a list here, the page shows these tags only, in this order - also a tag that is not attached to this world.</p>
    </div>
  );
}

/** "<destination> on a fingertip": a heading, a row of pictures, a gray intro card and up to three text columns. */
function SummaryForm({ section, onChange, siteUrl }: FormProps<"summary">) {
  const setColumn = (index: number, html: string) => onChange({ ...section, columns: section.columns.map((c, i) => (i === index ? html : c)) });
  return (
    <div className="space-y-4">
      <TitleField value={section.title} onChange={(title) => onChange({ ...section, title })} hint='The heading of the block, e.g. "אוסטריה על קצה המזלג".' />
      <ImageListEditor
        label="Pictures"
        value={section.images}
        onChange={(images) => onChange({ ...section, images: images.slice(0, SUMMARY_IMAGES_MAX) })}
        siteUrl={siteUrl}
        folder="terms"
        hint={`A row of small pictures under the heading, five across on a computer. Up to ${SUMMARY_IMAGES_MAX}.`}
      />
      <HtmlField label="Intro (the gray card)" value={section.intro} onChange={(intro) => onChange({ ...section, intro })} siteUrl={siteUrl} rows={6} />
      <ItemList
        label="Text columns"
        items={section.columns}
        onChange={(columns) => onChange({ ...section, columns })}
        create={() => ""}
        addLabel="Add Column"
        empty="No text columns: the block shows the heading, the pictures and the intro."
        max={SUMMARY_COLUMNS_MAX}
        render={(html, _patch, index) => <HtmlField label={`Column ${index + 1}`} value={html} onChange={(next) => setColumn(index, next)} siteUrl={siteUrl} rows={8} />}
      />
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
    case "summary":
      return <SummaryForm section={section} {...shared} />;
    case "subcategories":
      return <SubcategoriesForm section={section} {...shared} />;
    case "term_tours":
      return <TermToursForm section={section} {...shared} />;
    case "term_description":
      return <Notice tone="info">{BLOCK_NOTES[section.type]}</Notice>;
  }
}
