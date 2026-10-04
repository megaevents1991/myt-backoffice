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
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Tag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/confirm-provider";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { todayIso } from "@/lib/tours/format";
import { Field, LoadError, Notice, Section, selectClass } from "@/components/tours/ui";
import { ImageListEditor, StringListEditor } from "@/components/tours/content/fields";
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
import {
  EMPTY_SEASON_FORM,
  SEASON_NAME_SUGGESTIONS,
  type ItineraryVariant,
  type TourSeasonForm,
  type TourSeasonRow,
  type TourSeasonsData,
} from "@/components/tours/content/shared";

const NEW = "new";

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
  siteUrl,
  onChanged,
}: {
  packageId: string;
  /** The tour's dates; null while they load. */
  rows: BoardRow[] | null;
  variants: ItineraryVariant[];
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

  const formDirty = JSON.stringify(draft) !== JSON.stringify(base);
  const datesDirty = [...picked].sort().join(",") !== savedKey;
  const dirty = formDirty || datesDirty;
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
    const saved = await run(() => saveTourSeason(packageId, season?.id ?? null, draft), season ? "Season saved" : "Season created");
    if (saved.success && (datesDirty || (!season && picked.size > 0))) {
      await run(
        () => setSeasonDates(packageId, saved.data.id, [...picked]),
        (a) => `${a.data.assigned} date(s) joined the season, ${a.data.released} left it`,
      );
    }
    setBusy(false);
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
                : "The tour has only the main itinerary. Open another variant on the Itinerary tab to give a season its own route."
            }
          >
            <select className={`${selectClass} w-full`} value={draft.itineraryId} onChange={(e) => set("itineraryId", e.target.value)}>
              <option value="">Main itinerary</option>
              {usable.map((v) => (
                <option key={v.key} value={v.id ?? ""}>
                  {v.label || v.key} ({v.days.length} days)
                </option>
              ))}
            </select>
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

      <Section
        title="What this season says instead of the tour page"
        description={
          overrides.length
            ? `This season has its own ${overrides.join(", ")}. Every field left empty shows the tour's own.`
            : "Everything here is optional: a field left empty shows the tour's own. Fill only what is different in this season."
        }
      >
        <HtmlField
          label="Description (empty = the tour's description)"
          value={draft.descriptionHtml}
          onChange={(value) => set("descriptionHtml", value)}
          siteUrl={siteUrl}
          rows={8}
        />
        <StringListEditor
          label="Attractions (empty = the tour's)"
          value={draft.attractions}
          onChange={(value) => set("attractions", value)}
          addLabel="Add Attraction"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <StringListEditor label="Included (empty = the tour's)" value={draft.included} onChange={(value) => set("included", value)} />
          <StringListEditor
            label="Not included (empty = the tour's)"
            value={draft.notIncluded}
            onChange={(value) => set("notIncluded", value)}
          />
        </div>
        <ImageListEditor
          label="Images - the gallery of the season (empty = the tour's)"
          value={draft.gallery}
          onChange={(value) => set("gallery", value)}
          siteUrl={siteUrl}
          folder="packages"
        />
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
    </fieldset>
  );
}
