"use client";

/**
 * The Seasons tab of a tour page (Alon, 04.10.2026): a season is more than a
 * word on a date. Each season of the tour holds the dates assigned to it and
 * what it says instead of the tour page - another itinerary variant,
 * description, attractions, included / not included, images - plus free tags
 * for landing pages built later. An empty field is "the tour's own".
 *
 * A date with no season is counted here (and marked in the dates sheet) so it
 * is assigned before it goes on the site. Promotions stay on the dates: "Add
 * Promotion" puts one on every upcoming date of the season at once.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, CopyPlus, Loader2, Plus, Tag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/confirm-provider";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { todayIso } from "@/lib/tours/format";
import { Field, LoadError, Notice, Section, selectClass } from "@/components/tours/ui";
import { ImageListEditor, SiteImage, StringListEditor } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import { DatesChecklist } from "@/components/tours/content/dates-checklist";
import { BulkOutcomeDialog, BulkPromotionDialog } from "@/components/tours/departures/board-dialogs";
import type { BoardRow, BulkOutcome } from "@/components/tours/departures/types";
import {
  deleteTourSeason,
  getTourSeasons,
  moveTourSeason,
  saveTourSeason,
  setSeasonDates,
} from "@/lib/actions/tours-season-actions";
import { saveTourItinerary } from "@/lib/actions/tours-content-actions";
import { ItineraryDaysEditor } from "@/components/tours/content/itinerary-days-editor";
import { NewVariantDialog } from "@/components/tours/content/itinerary-editor";
import {
  EMPTY_SEASON_FORM,
  SEASON_NAME_SUGGESTIONS,
  filledDays,
  withTourDays,
  type ItineraryDay,
  type ItineraryVariant,
  type PackageEditorData,
  type PackageForm,
  type TourSeasonForm,
  type TourSeasonRow,
  type TourSeasonsData,
} from "@/components/tours/content/shared";

const NEW = "new";

/** What a season can take from the tour page instead of being typed again (Alon, 07.10.2026). */
const COPY_FIELDS = ["descriptionHtml", "attractions", "included", "notIncluded", "gallery"] as const;
type CopyField = (typeof COPY_FIELDS)[number];
const isEmpty = (value: string | string[]): boolean =>
  typeof value === "string" ? !value.replace(/<[^>]*>|&nbsp;/g, "").trim() : value.length === 0;
const withTourField = (draft: TourSeasonForm, tour: PackageForm, key: CopyField): TourSeasonForm => {
  switch (key) {
    case "descriptionHtml":
      return { ...draft, descriptionHtml: tour.descriptionHtml };
    case "attractions":
      return { ...draft, attractions: [...tour.attractions] };
    case "included":
      return { ...draft, included: [...tour.included] };
    case "notIncluded":
      return { ...draft, notIncluded: [...tour.notIncluded] };
    case "gallery":
      return { ...draft, gallery: [...tour.gallery] };
  }
};

/** The ID offered for a season's own itinerary: the season in English when it is a known one. */
const SEASON_KEYS: Record<string, string> = {
  קיץ: "summer",
  חורף: "winter",
  סתיו: "autumn",
  אביב: "spring",
  פסח: "pesach",
  שבועות: "shavuot",
  "חגי תשרי": "tishrei",
  סוכות: "sukkot",
  חנוכה: "hanukkah",
  סילבסטר: "new-year",
};
const freeKey = (base: string, taken: string[]): string => {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
};

/** The days of an itinerary as they are saved - for telling an edit from what is stored. */
const daysKey = (days: ItineraryDay[]): string =>
  JSON.stringify(filledDays(days).map(({ image, ...day }) => (image ? { ...day, image } : day)));

const formOf = (season: TourSeasonRow | null): TourSeasonForm =>
  season
    ? {
        name: season.name,
        itineraryId: season.itineraryId,
        descriptionHtml: season.descriptionHtml,
        attractions: season.attractions,
        included: season.included,
        notIncluded: season.notIncluded,
        heroImage: season.heroImage,
        gallery: season.gallery,
        tags: season.tags,
      }
    : EMPTY_SEASON_FORM;

export function TourSeasons({
  packageId,
  rows,
  variants,
  dirtyKeys,
  tour,
  onItinerariesChanged,
  siteUrl,
  onChanged,
}: {
  packageId: string;
  /** The tour's dates; null while they load. */
  rows: BoardRow[] | null;
  /** The tour's itineraries as they are saved. */
  variants: ItineraryVariant[];
  /** Keys of the itineraries with unsaved edits on the Itinerary tab - a season does not edit those. */
  dirtyKeys: string[];
  /** The tour page as it is in the editor: what "Copy from the tour page" takes. */
  tour: PackageForm;
  /** A season opened an itinerary of its own, or saved its days: the page takes the server's state. */
  onItinerariesChanged: (data: PackageEditorData, change: { created?: string; saved?: string }) => void;
  siteUrl: string | null;
  /** Seasons or their dates changed: the page reloads its dates; with names, it keeps the tour's season list in step. */
  onChanged: (seasonNames: string[] | null) => void;
}) {
  const seasons = useActionData(() => getTourSeasons(packageId), [packageId]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const today = useMemo(() => todayIso(), []);
  const list = seasons.data?.seasons ?? [];

  useEffect(() => {
    if (!seasons.data) return;
    setActiveId((current) => {
      if (current === NEW || (current && seasons.data?.seasons.some((s) => s.id === current))) return current;
      return seasons.data?.seasons[0]?.id ?? NEW;
    });
  }, [seasons.data]);

  if (seasons.error && !seasons.data) return <LoadError message={seasons.error} onRetry={() => void seasons.reload()} />;
  if (!seasons.data) return <Skeleton className="h-64 w-full" />;

  const active = list.find((s) => s.id === activeId) ?? null;
  const index = active ? list.indexOf(active) : -1;
  const live = (rows ?? []).filter((r) => !r.is_deleted);
  const unassigned = live.filter((r) => !r.season_id && r.end_date >= today);
  const countOf = (id: string) => live.filter((r) => r.season_id === id).length;
  const apply = (data: TourSeasonsData, nextActive?: string) => {
    seasons.setData(data);
    if (nextActive) setActiveId(nextActive);
    onChanged(data.seasonNames);
  };

  return (
    <div className="space-y-4">
      <Section
        title="Seasons"
        description="A season groups the dates that run the same way. It can have its own itinerary variant, description, attractions, included / not included and images - the site shows them on the season's dates instead of the tour's. The first season labels the tour's card."
      >
        <div className="flex flex-wrap items-center gap-2">
          {list.map((season) => (
            <button
              key={season.id}
              type="button"
              onClick={() => setActiveId(season.id)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                season.id === activeId ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/60",
              )}
            >
              <span dir="auto">{season.name}</span>
              <span className="text-xs text-muted-foreground">{countOf(season.id)} dates</span>
            </button>
          ))}
          <Button type="button" variant={activeId === NEW ? "secondary" : "outline"} size="sm" onClick={() => setActiveId(NEW)}>
            <Plus />
            New Season
          </Button>
        </div>
        {unassigned.length > 0 && (
          <Notice tone="warning">
            <span className="font-medium">{unassigned.length} upcoming date(s) with no season:</span>{" "}
            <span dir="ltr" className="font-mono text-xs">
              {unassigned
                .slice(0, 12)
                .map((r) => r.code)
                .join(", ")}
              {unassigned.length > 12 ? "…" : ""}
            </span>
            . Tick them under the season they belong to (Dates of this season) before they go on the site
            {unassigned.some((r) => r.is_published) ? ` - ${unassigned.filter((r) => r.is_published).length} of them are already on it` : ""}.
          </Notice>
        )}
      </Section>

      {activeId !== null && (
        <SeasonEditor
          key={activeId}
          packageId={packageId}
          season={active}
          seasonNames={list.map((s) => s.name)}
          seasonNameById={new Map(list.map((s) => [s.id, s.name]))}
          rows={live}
          datesLoading={rows === null}
          variants={variants}
          dirtyKeys={dirtyKeys}
          tour={tour}
          onItinerariesChanged={onItinerariesChanged}
          siteUrl={siteUrl}
          canMoveUp={index > 0}
          canMoveDown={index >= 0 && index < list.length - 1}
          onSaved={apply}
          onDatesChanged={() => onChanged(null)}
        />
      )}
    </div>
  );
}

function SeasonEditor({
  packageId,
  season,
  seasonNames,
  seasonNameById,
  rows,
  datesLoading,
  variants,
  dirtyKeys,
  tour,
  onItinerariesChanged,
  siteUrl,
  canMoveUp,
  canMoveDown,
  onSaved,
  onDatesChanged,
}: {
  packageId: string;
  /** null = a new season. */
  season: TourSeasonRow | null;
  seasonNames: string[];
  seasonNameById: Map<string, string>;
  rows: BoardRow[];
  datesLoading: boolean;
  variants: ItineraryVariant[];
  dirtyKeys: string[];
  tour: PackageForm;
  onItinerariesChanged: (data: PackageEditorData, change: { created?: string; saved?: string }) => void;
  siteUrl: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSaved: (data: TourSeasonsData, activeId?: string) => void;
  onDatesChanged: () => void;
}) {
  const run = useActionToast();
  const confirm = useConfirm();
  const today = useMemo(() => todayIso(), []);
  const base = useMemo(() => formOf(season), [season]);
  const [draft, setDraft] = useState<TourSeasonForm>(base);
  const [busy, setBusy] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const set = <K extends keyof TourSeasonForm>(key: K, value: TourSeasonForm[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // the dates of the season as saved; the tick list starts from them and follows a reload
  const savedIds = useMemo(() => (season ? rows.filter((r) => r.season_id === season.id).map((r) => r.id).sort() : []), [rows, season]);
  const savedKey = savedIds.join(",");
  const [picked, setPicked] = useState<Set<string>>(new Set(savedIds));
  useEffect(() => {
    setPicked(new Set(savedKey ? savedKey.split(",") : []));
  }, [savedKey]);

  // The season's own itinerary, edited here (Alon, 07.10.2026): its days are saved with the season.
  const variant = variants.find((v) => v.id !== null && v.id === draft.itineraryId && v.key !== "main") ?? null;
  const variantBusyElsewhere = !!variant && dirtyKeys.includes(variant.key);
  const variantDays = useMemo(() => (variant ? withTourDays(variant.days, tour.days) : []), [variant, tour.days]);
  const [days, setDays] = useState<ItineraryDay[]>(variantDays);
  useEffect(() => {
    setDays(variantDays);
  }, [variantDays]);
  const daysDirty = !!variant && !variantBusyElsewhere && daysKey(days) !== daysKey(variant.days);
  const [variantDialog, setVariantDialog] = useState(false);
  const copySources = variants.filter((v) => v.id !== null);

  const copyable = COPY_FIELDS.filter((key) => isEmpty(draft[key]) && !isEmpty(tour[key]));
  const copyFromTour = (keys: readonly CopyField[]) =>
    setDraft((d) => keys.reduce((next, key) => (isEmpty(next[key]) && !isEmpty(tour[key]) ? withTourField(next, tour, key) : next), d));
  /**
   * An empty season field shows what the tour page says, as the site will show
   * it on the season's dates (Alon, 08.10.2026: "what we put on the main should
   * appear, and we edit it"). "Edit for this season" copies it in; the editor of
   * the field then takes its place.
   */
  const inherited = (key: CopyField, label: string, body: ReactNode) =>
    copyable.includes(key) ? (
      <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3" data-inherited={key}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {label} <span className="font-normal text-muted-foreground">- the tour&apos;s, shown on this season&apos;s dates</span>
          </span>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => copyFromTour([key])}>
            <Copy />
            Edit for this season
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    ) : null;
  const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const listBody = (items: string[]) => (
    <ul className="list-disc space-y-0.5 ps-5" dir="auto">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );

  const formDirty = JSON.stringify(draft) !== JSON.stringify(base);
  const datesDirty = [...picked].sort().join(",") !== savedKey;
  const dirty = formDirty || datesDirty || daysDirty;
  const name = draft.name.trim();
  const problem = !name
    ? "Give the season a name"
    : seasonNames.some((n) => n === name && n !== season?.name)
      ? "This tour already has a season with this name"
      : null;
  const usable = variants.filter((v) => v.id !== null && v.key !== "main");
  const seasonDates = season ? rows.filter((r) => r.season_id === season.id && r.end_date >= today) : [];
  const overrides = [
    draft.descriptionHtml.replace(/<[^>]*>/g, "").trim() && "description",
    draft.attractions.length && "attractions",
    draft.included.length && "included",
    draft.notIncluded.length && "not included",
    draft.gallery.length && "images",
  ].filter(Boolean);

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    // the days of the season's own itinerary first: a failure there leaves the season as it was
    let itinerary: { data: PackageEditorData; key: string } | null = null;
    if (variant?.id && daysDirty) {
      const { id, key, label, arrivalCity, returnCity } = variant;
      const res = await run(() => saveTourItinerary(packageId, id, { label, arrivalCity, returnCity, days: filledDays(days) }));
      if (!res.success) {
        setBusy(false);
        return;
      }
      itinerary = { data: res.data, key };
    }
    const saved = await run(() => saveTourSeason(packageId, season?.id ?? null, draft), season ? "Season saved" : "Season created");
    if (saved.success && (datesDirty || (!season && picked.size > 0))) {
      await run(
        () => setSeasonDates(packageId, saved.data.id, [...picked]),
        (a) => `${a.data.assigned} date(s) joined the season, ${a.data.released} left it`,
      );
    }
    setBusy(false);
    if (itinerary) onItinerariesChanged(itinerary.data, { saved: itinerary.key });
    if (saved.success) onSaved(saved.data, saved.data.id);
  };

  const remove = async () => {
    if (!season) return;
    const ok = await confirm({
      title: `Delete the season "${season.name}"?`,
      description: `${savedIds.length} date(s) belong to it. They stay, with no season, and show the tour's own content until you assign them again.`,
      confirmLabel: "Delete Season",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await run(() => deleteTourSeason(packageId, season.id), "Season deleted");
    setBusy(false);
    if (res.success) onSaved(res.data);
  };

  const move = async (delta: -1 | 1) => {
    if (!season) return;
    setBusy(true);
    const res = await run(() => moveTourSeason(packageId, season.id, delta));
    setBusy(false);
    if (res.success) onSaved(res.data);
  };

  return (
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <Section title={season ? `Season: ${season.name}` : "New Season"}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Season name" hint="As the site shows it in the season list of the tour, e.g. קיץ, פסח">
            <Input dir="auto" list="tour-season-names" value={draft.name} onChange={(e) => set("name", e.target.value)} />
            <datalist id="tour-season-names">
              {SEASON_NAME_SUGGESTIONS.filter((n) => !seasonNames.includes(n)).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field
            label="Itinerary of this season"
            hint={
              usable.length
                ? "The day-by-day plan the season's dates run. A date can still be given its own variant."
                : "The tour has only the main itinerary. \"New itinerary for this season\" opens a copy of it to change - here, without the Itinerary tab."
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${selectClass} min-w-0 flex-1`}
                value={draft.itineraryId}
                onChange={(e) => set("itineraryId", e.target.value)}
              >
                <option value="">Main itinerary</option>
                {usable.map((v) => (
                  <option key={v.key} value={v.id ?? ""}>
                    {v.label || v.key} ({v.days.length} days)
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dirtyKeys.length > 0 || copySources.length === 0}
                title={
                  dirtyKeys.length > 0
                    ? "The Itinerary tab has unsaved changes - save the page first (the new itinerary is a copy of what is saved)"
                    : copySources.length === 0
                      ? "The tour has no saved itinerary to copy yet - write the main itinerary on the Itinerary tab and save"
                      : "Opens a copy of an existing itinerary for this season; its days are then edited below"
                }
                onClick={() => setVariantDialog(true)}
              >
                <CopyPlus />
                New itinerary for this season
              </Button>
            </div>
          </Field>
        </div>
        {season && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!canMoveUp} onClick={() => void move(-1)}>
              <ArrowUp />
              Move up
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={!canMoveDown} onClick={() => void move(1)}>
              <ArrowDown />
              Move down
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={seasonDates.length === 0 || dirty}
              title={
                dirty
                  ? "Save the season first"
                  : seasonDates.length === 0
                    ? "The season has no upcoming dates"
                    : "A discount or a gift on every upcoming date of the season"
              }
              onClick={() => setPromotionOpen(true)}
            >
              <Tag />
              Add Promotion to its {seasonDates.length} date(s)
            </Button>
            <Button type="button" variant="ghost" size="sm" className="ms-auto text-destructive hover:text-destructive" onClick={() => void remove()}>
              <Trash2 />
              Delete Season
            </Button>
          </div>
        )}
      </Section>

      <Section
        title="Dates of this season"
        description="Tick the dates that belong to the season. A date belongs to one season - ticking a date of another season moves it here. A date left with no season is marked until it is assigned."
      >
        {datesLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <DatesChecklist
            rows={rows}
            value={picked}
            onChange={setPicked}
            noteOf={(row) =>
              row.season_id && row.season_id !== season?.id ? (
                <span dir="auto">now: {seasonNameById.get(row.season_id) ?? row.season}</span>
              ) : !row.season_id ? (
                <span className="text-amber-700 dark:text-amber-400">no season</span>
              ) : null
            }
          />
        )}
      </Section>

      {variant && (
        <Section
          title={`The days of this season's itinerary: ${variant.label || variant.key}`}
          description="The season's own day-by-day plan. Change, add, remove or drag the days here - they are saved with the season. The same itinerary is also on the Itinerary tab."
        >
          {variantBusyElsewhere ? (
            <Notice tone="warning">
              This itinerary has unsaved changes on the Itinerary tab. Save the page (the bar at the bottom) or discard them, then
              edit its days here.
            </Notice>
          ) : (
            <ItineraryDaysEditor
              key={variant.id}
              days={days}
              onChange={setDays}
              siteUrl={siteUrl}
              tourDays={tour.days}
              removeNote="The day will be removed from this season's itinerary. The change is kept only when you save the season."
            />
          )}
        </Section>
      )}

      <Section
        title="What this season says instead of the tour page"
        description={
          overrides.length
            ? `This season has its own ${overrides.join(", ")}. Every field left empty shows the tour's own.`
            : "Everything here is optional: a field left empty shows the tour's own. Fill only what is different in this season."
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={copyable.length === 0}
            title={
              copyable.length === 0
                ? "Nothing to copy: every field here is filled, or the tour page has nothing in it"
                : "Fills the fields that are empty here with what the tour page says, so you change it instead of typing it again"
            }
            onClick={() => copyFromTour(copyable)}
          >
            <Copy />
            Copy from the tour page
          </Button>
        }
      >
        {copyable.length > 0 && (
          <p className="text-xs text-muted-foreground">
            A field the season does not fill shows the tour page&apos;s own here, as the site shows it on the season&apos;s dates.
            &ldquo;Edit for this season&rdquo; on one field, or &ldquo;Copy from the tour page&rdquo; for all of them, copies the text in
            to change. A copied field is then the season&apos;s own - a later change on the tour page does not reach it.
          </p>
        )}
        {inherited("descriptionHtml", "Description", <p dir="auto" className="line-clamp-4 whitespace-pre-line">{textOf(tour.descriptionHtml)}</p>) ?? (
          <HtmlField
            label="Description (empty = the tour's description)"
            value={draft.descriptionHtml}
            onChange={(value) => set("descriptionHtml", value)}
            siteUrl={siteUrl}
            rows={8}
          />
        )}
        {inherited("attractions", `Attractions (${tour.attractions.length})`, listBody(tour.attractions)) ?? (
          <StringListEditor
            label="Attractions (empty = the tour's)"
            value={draft.attractions}
            onChange={(value) => set("attractions", value)}
            addLabel="Add Attraction"
          />
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          {inherited("included", `Included (${tour.included.length})`, listBody(tour.included)) ?? (
            <StringListEditor label="Included (empty = the tour's)" value={draft.included} onChange={(value) => set("included", value)} />
          )}
          {inherited("notIncluded", `Not included (${tour.notIncluded.length})`, listBody(tour.notIncluded)) ?? (
            <StringListEditor
              label="Not included (empty = the tour's)"
              value={draft.notIncluded}
              onChange={(value) => set("notIncluded", value)}
            />
          )}
        </div>
        {inherited(
          "gallery",
          `Images (${tour.gallery.length})`,
          <div className="flex flex-wrap gap-1.5">
            {tour.gallery.slice(0, 8).map((src, i) => (
              <SiteImage key={i} siteUrl={siteUrl} path={src} className="h-12 w-16" />
            ))}
            {tour.gallery.length > 8 && <span className="self-center text-xs">+{tour.gallery.length - 8}</span>}
          </div>,
        ) ?? (
          <ImageListEditor
            label="Images - the gallery of the season (empty = the tour's)"
            value={draft.gallery}
            onChange={(value) => set("gallery", value)}
            siteUrl={siteUrl}
            folder="packages"
          />
        )}
        <StringListEditor
          label="Tags"
          value={draft.tags}
          onChange={(value) => set("tags", value)}
          addLabel="Add Tag"
          placeholder="חגים, משפחות..."
          hint="Free tags of the season, kept for landing pages built later (for example a general holidays page). The site does not show them yet."
        />
      </Section>

      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
        <span className="text-sm text-muted-foreground">
          {problem ?? (dirty ? "Unsaved changes in this season" : season ? "No changes" : "Name the season, tick its dates and save")}
        </span>
        <div className="ms-auto flex gap-2">
          {dirty && season && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(base);
                setPicked(new Set(savedIds));
              }}
            >
              Discard
            </Button>
          )}
          <Button type="button" onClick={() => void save()} disabled={!!problem || busy || (!dirty && !!season)}>
            {busy && <Loader2 className="animate-spin" />}
            {season ? "Save Season" : "Create Season"}
          </Button>
        </div>
      </div>

      <BulkPromotionDialog
        open={promotionOpen}
        onOpenChange={setPromotionOpen}
        targets={seasonDates}
        onApplied={(result) => {
          if (result.skipped.length || result.warnings.length) setOutcome(result);
          onDatesChanged();
        }}
      />
      <BulkOutcomeDialog title="Add Promotion" outcome={outcome} onClose={() => setOutcome(null)} />
      {variantDialog && (
        <NewVariantDialog
          packageId={packageId}
          sources={copySources}
          takenKeys={variants.map((v) => v.key)}
          suggest={{
            key: freeKey(SEASON_KEYS[name] ?? "season", variants.map((v) => v.key)),
            label: name ? `מסלול ${name}` : "מסלול העונה",
          }}
          onClose={() => setVariantDialog(false)}
          onCreated={(data, key) => {
            setVariantDialog(false);
            onItinerariesChanged(data, { created: key });
            const created = data.itineraries.find((v) => v.key === key);
            if (created?.id) set("itineraryId", created.id);
          }}
        />
      )}
    </fieldset>
  );
}
