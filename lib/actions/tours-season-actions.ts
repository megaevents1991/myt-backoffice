"use server";

/**
 * The seasons of a tour (Alon, 04.10.2026 - mega-family
 * docs/plans/TOUR-UPLOAD-ROUND9-PLAN.md): a season is a row of its own under
 * the tour (tours.package_seasons). It holds the dates assigned to it and what
 * it says instead of the tour page - another itinerary variant, description,
 * attractions, included / not included, images, tags. Empty = the tour's own.
 *
 * The names of a tour's seasons, in order, are also tours.packages.seasons -
 * the list the site's cards and season filter read - so every change here
 * writes that list too (syncPackageSeasons). The season word on a date
 * (tours.departures.season) follows its season through the database trigger
 * departures_season_sync.
 *
 * Also here: which dates run an itinerary variant (setItineraryDates) - a date
 * that is given none runs its season's variant, else the main itinerary.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { requireCompany, type Company } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, chunk, must, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit, invalidInput, type JsonObject } from "@/lib/tours/company-kit";
import type { Json } from "@/types/database.types";
import type { TourSeasonForm, TourSeasonRow, TourSeasonsData } from "@/components/tours/content/shared";

const fail = (e: unknown) => actionFail(e, "tours-season-actions");
const ID_CHUNK = 150;
const MAX_SEASONS = 30;

const list = (max: number, each: number) => z.array(z.string().max(each)).max(max);
const seasonSchema = z.object({
  name: z.string().trim().min(1, "The season needs a name").max(60, "A season name is up to 60 characters"),
  itineraryId: z.string().max(40),
  descriptionHtml: z.string().max(200_000),
  attractions: list(100, 300),
  included: list(100, 500),
  notIncluded: list(100, 500),
  heroImage: z.string().max(1000),
  gallery: list(60, 1000),
  tags: list(30, 60),
});

const clean = (items: string[]): string[] => items.map((s) => s.trim()).filter(Boolean);
/** An empty list or text is "the tour's own" - stored as null. */
const listOrNull = (items: string[]): string[] | null => {
  const out = clean(items);
  return out.length ? out : null;
};
const hasText = (html: string): boolean => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;

const SEASON_SELECT =
  "id, name, position, itinerary_id, description_html, attractions, included, not_included, hero_image, gallery, tags";
type SeasonDb = {
  id: string;
  name: string;
  position: number;
  itinerary_id: string | null;
  description_html: string | null;
  attractions: string[] | null;
  included: string[] | null;
  not_included: string[] | null;
  hero_image: string | null;
  gallery: string[] | null;
  tags: string[];
};

const toRow = (s: SeasonDb): TourSeasonRow => ({
  id: s.id,
  position: s.position,
  name: s.name,
  itineraryId: s.itinerary_id ?? "",
  descriptionHtml: s.description_html ?? "",
  attractions: s.attractions ?? [],
  included: s.included ?? [],
  notIncluded: s.not_included ?? [],
  heroImage: s.hero_image ?? "",
  gallery: s.gallery ?? [],
  tags: s.tags ?? [],
});

async function requireTour(company: Company, packageId: string) {
  if (typeof packageId !== "string" || !UUID.test(packageId)) throw new UserError("Tour not found");
  const pkg = must(
    await toursDb()
      .from("packages")
      .select("id, seasons, data")
      .eq("company_id", company.id)
      .eq("id", packageId)
      .is("is_deleted", null)
      .maybeSingle(),
  );
  if (!pkg) throw new UserError("Tour not found in the active company");
  return pkg;
}

async function loadSeasons(company: Company, packageId: string): Promise<TourSeasonRow[]> {
  const rows =
    must(
      await toursDb()
        .from("package_seasons")
        .select(SEASON_SELECT)
        .eq("company_id", company.id)
        .eq("package_id", packageId)
        .order("position")
        .order("name"),
    ) ?? [];
  return (rows as SeasonDb[]).map(toRow);
}

/**
 * tours.packages.seasons = the names of the tour's seasons, in order. The labels
 * the page derived from its first season (the season select's label, the hero
 * badge "חנוכה CBP") follow a change of the first season where they still say
 * what the old one produced - the same rule saveTourPackage applies
 * (syncDerivedLabels in tours-content-actions.ts).
 */
async function syncPackageSeasons(company: Company, packageId: string): Promise<TourSeasonsData> {
  const db = toursDb();
  const seasons = await loadSeasons(company, packageId);
  const names = seasons.map((s) => s.name);
  const pkg = await requireTour(company, packageId);
  const before = pkg.seasons ?? [];
  if (JSON.stringify(before) !== JSON.stringify(names)) {
    const data = asObject(pkg.data);
    const next: JsonObject = { ...data, seasons: names };
    const oldFirst = before[0];
    const newFirst = names[0];
    if (newFirst && oldFirst !== newFirst) {
      if (!data.seasonLabel || data.seasonLabel === oldFirst) next.seasonLabel = newFirst;
      if (oldFirst && Array.isArray(data.badges)) {
        const badges = (data.badges as { icon?: string; label?: string }[]).map((b) => ({ ...b }));
        const badge = badges.find((b) => b.icon === "season" && typeof b.label === "string" && b.label.startsWith(`${oldFirst} `));
        if (badge?.label) {
          badge.label = newFirst + badge.label.slice(oldFirst.length);
          next.badges = badges as Json;
        }
      }
    }
    must(await db.from("packages").update({ seasons: names, data: next as Json }).eq("company_id", company.id).eq("id", packageId));
  }
  revalidatePath(`/tours/packages/${packageId}`);
  revalidatePath("/tours/departures");
  return { seasons, seasonNames: names };
}

export async function getTourSeasons(packageId: string): Promise<ActionResult<TourSeasonsData>> {
  try {
    const { company } = await requireCompany("tours");
    const pkg = await requireTour(company, packageId);
    return actionOk({ seasons: await loadSeasons(company, packageId), seasonNames: pkg.seasons ?? [] });
  } catch (e) {
    return fail(e);
  }
}

/** Create (seasonId = null) or edit a season. Renaming it renames the season word on its dates. */
export async function saveTourSeason(
  packageId: string,
  seasonId: string | null,
  form: TourSeasonForm,
): Promise<ActionResult<TourSeasonsData & { id: string }>> {
  try {
    const { company } = await requireCompany("tours");
    await requireTour(company, packageId);
    const parsed = seasonSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const db = toursDb();
    if (seasonId !== null && !UUID.test(seasonId)) throw new UserError("Season not found");

    let itineraryId: string | null = null;
    if (input.itineraryId) {
      const found = UUID.test(input.itineraryId)
        ? must(
            await db
              .from("package_itineraries")
              .select("id, key")
              .eq("company_id", company.id)
              .eq("package_id", packageId)
              .eq("id", input.itineraryId)
              .maybeSingle(),
          )
        : null;
      if (!found) throw new UserError("The itinerary variant doesn't belong to this tour");
      // the main itinerary is what a season with no variant runs
      itineraryId = found.key === "main" ? null : found.id;
    }

    const existing = await loadSeasons(company, packageId);
    if (existing.some((s) => s.name === input.name && s.id !== seasonId)) {
      throw new UserError(`This tour already has a season named "${input.name}"`);
    }
    const row = {
      name: input.name,
      itinerary_id: itineraryId,
      description_html: hasText(input.descriptionHtml) ? input.descriptionHtml : null,
      attractions: listOrNull(input.attractions),
      included: listOrNull(input.included),
      not_included: listOrNull(input.notIncluded),
      hero_image: input.heroImage.trim() || null,
      gallery: listOrNull(input.gallery),
      tags: [...new Set(clean(input.tags))],
    };

    let id = seasonId;
    if (seasonId) {
      const current = existing.find((s) => s.id === seasonId);
      if (!current) throw new UserError("Season not found on this tour");
      must(await db.from("package_seasons").update(row).eq("company_id", company.id).eq("package_id", packageId).eq("id", seasonId));
      if (current.name !== input.name) {
        // the word on its dates follows the new name (the trigger finds this same season by it)
        must(await db.from("departures").update({ season: input.name }).eq("company_id", company.id).eq("season_id", seasonId));
      }
    } else {
      if (existing.length >= MAX_SEASONS) throw new UserError(`A tour holds up to ${MAX_SEASONS} seasons`);
      const { data: inserted, error } = await db
        .from("package_seasons")
        .insert({
          ...row,
          company_id: company.id,
          package_id: packageId,
          position: existing.reduce((max, s) => Math.max(max, s.position), -1) + 1,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new UserError(`This tour already has a season named "${input.name}"`);
        throw new Error(error.message);
      }
      id = inserted.id;
      // dates that already carry this word (typed before the season existed) join it
      must(
        await db
          .from("departures")
          .update({ season_id: id })
          .eq("company_id", company.id)
          .eq("package_id", packageId)
          .eq("season", input.name)
          .is("season_id", null),
      );
    }
    await logAudit({
      action: seasonId ? "update" : "create",
      entityType: "tours_season",
      entityId: id,
      changes: { name: row.name, itinerary_id: row.itinerary_id, tags: row.tags },
      metadata: { ...companyAudit(company), package_id: packageId },
    });
    return actionOk({ ...(await syncPackageSeasons(company, packageId)), id: id as string });
  } catch (e) {
    return fail(e);
  }
}

/** Delete a season. Its dates stay, with no season (the database clears their season word). */
export async function deleteTourSeason(packageId: string, seasonId: string): Promise<ActionResult<TourSeasonsData>> {
  try {
    const { company } = await requireCompany("tours");
    await requireTour(company, packageId);
    if (!UUID.test(String(seasonId))) throw new UserError("Season not found");
    const removed = must(
      await toursDb()
        .from("package_seasons")
        .delete()
        .eq("company_id", company.id)
        .eq("package_id", packageId)
        .eq("id", seasonId)
        .select("id, name"),
    );
    if (!removed || removed.length === 0) throw new UserError("Season not found on this tour");
    await logAudit({
      action: "delete",
      entityType: "tours_season",
      entityId: seasonId,
      changes: { name: removed[0].name },
      metadata: { ...companyAudit(company), package_id: packageId },
    });
    return actionOk(await syncPackageSeasons(company, packageId));
  } catch (e) {
    return fail(e);
  }
}

/** Move a season one place up (-1) or down (+1). The first season labels the tour's card. */
export async function moveTourSeason(packageId: string, seasonId: string, delta: -1 | 1): Promise<ActionResult<TourSeasonsData>> {
  try {
    const { company } = await requireCompany("tours");
    await requireTour(company, packageId);
    const seasons = await loadSeasons(company, packageId);
    const from = seasons.findIndex((s) => s.id === seasonId);
    const to = from + (delta === -1 ? -1 : 1);
    if (from < 0) throw new UserError("Season not found on this tour");
    if (to < 0 || to >= seasons.length) return actionOk({ seasons, seasonNames: seasons.map((s) => s.name) });
    const order = [...seasons];
    [order[from], order[to]] = [order[to], order[from]];
    for (const [position, s] of order.entries()) {
      if (s.position !== position) {
        must(await toursDb().from("package_seasons").update({ position }).eq("company_id", company.id).eq("id", s.id));
      }
    }
    return actionOk(await syncPackageSeasons(company, packageId));
  } catch (e) {
    return fail(e);
  }
}

/** The dates of one tour, by id, that are not deleted. */
async function tourDates(company: Company, packageId: string): Promise<{ id: string; season_id: string | null; itinerary_id: string | null }[]> {
  return (
    must(
      await toursDb()
        .from("departures")
        .select("id, season_id, itinerary_id")
        .eq("company_id", company.id)
        .eq("package_id", packageId)
        .is("is_deleted", null)
        .limit(5000),
    ) ?? []
  );
}

/**
 * The dates of a season: every id given joins it, and a date of the season that
 * is not in the list leaves it (and shows as "no season"). A date of another
 * season that is ticked moves here.
 */
export async function setSeasonDates(
  packageId: string,
  seasonId: string,
  departureIds: string[],
): Promise<ActionResult<{ assigned: number; released: number }>> {
  try {
    const { company } = await requireCompany("tours");
    await requireTour(company, packageId);
    if (!UUID.test(String(seasonId))) throw new UserError("Season not found");
    const db = toursDb();
    const season = must(
      await db.from("package_seasons").select("id, name").eq("company_id", company.id).eq("package_id", packageId).eq("id", seasonId).maybeSingle(),
    );
    if (!season) throw new UserError("Season not found on this tour");
    const dates = await tourDates(company, packageId);
    const known = new Set(dates.map((d) => d.id));
    const wanted = new Set((Array.isArray(departureIds) ? departureIds : []).filter((id) => known.has(id)));
    const join = dates.filter((d) => wanted.has(d.id) && d.season_id !== seasonId).map((d) => d.id);
    const leave = dates.filter((d) => !wanted.has(d.id) && d.season_id === seasonId).map((d) => d.id);
    for (const part of chunk(join, ID_CHUNK)) {
      must(await db.from("departures").update({ season_id: seasonId }).eq("company_id", company.id).in("id", part));
    }
    for (const part of chunk(leave, ID_CHUNK)) {
      must(await db.from("departures").update({ season_id: null }).eq("company_id", company.id).in("id", part));
    }
    if (join.length || leave.length) {
      await logAudit({
        action: "update",
        entityType: "tours_season",
        entityId: seasonId,
        changes: { assigned: join.length, released: leave.length },
        metadata: { ...companyAudit(company), package_id: packageId, name: season.name, joined: join, left: leave },
      });
      revalidatePath(`/tours/packages/${packageId}`);
      revalidatePath("/tours/departures");
    }
    return actionOk({ assigned: join.length, released: leave.length });
  } catch (e) {
    return fail(e);
  }
}

/**
 * The dates that run an itinerary variant: every id given runs it, and a date on
 * the variant that is not in the list goes back to the default (its season's
 * variant, else the main itinerary).
 */
export async function setItineraryDates(
  packageId: string,
  itineraryId: string,
  departureIds: string[],
): Promise<ActionResult<{ assigned: number; released: number }>> {
  try {
    const { company } = await requireCompany("tours");
    await requireTour(company, packageId);
    if (!UUID.test(String(itineraryId))) throw new UserError("Itinerary variant not found");
    const db = toursDb();
    const variant = must(
      await db
        .from("package_itineraries")
        .select("id, key, label")
        .eq("company_id", company.id)
        .eq("package_id", packageId)
        .eq("id", itineraryId)
        .maybeSingle(),
    );
    if (!variant) throw new UserError("Itinerary variant not found on this tour");
    if (variant.key === "main") throw new UserError("Every date with no other variant runs the main itinerary - there is nothing to assign");
    const dates = await tourDates(company, packageId);
    const known = new Set(dates.map((d) => d.id));
    const wanted = new Set((Array.isArray(departureIds) ? departureIds : []).filter((id) => known.has(id)));
    const join = dates.filter((d) => wanted.has(d.id) && d.itinerary_id !== itineraryId).map((d) => d.id);
    const leave = dates.filter((d) => !wanted.has(d.id) && d.itinerary_id === itineraryId).map((d) => d.id);
    for (const part of chunk(join, ID_CHUNK)) {
      must(await db.from("departures").update({ itinerary_id: itineraryId }).eq("company_id", company.id).in("id", part));
    }
    for (const part of chunk(leave, ID_CHUNK)) {
      must(await db.from("departures").update({ itinerary_id: null }).eq("company_id", company.id).in("id", part));
    }
    if (join.length || leave.length) {
      await logAudit({
        action: "update",
        entityType: "tours_itinerary",
        entityId: itineraryId,
        changes: { assigned: join.length, released: leave.length },
        metadata: { ...companyAudit(company), package_id: packageId, key: variant.key, joined: join, left: leave },
      });
      revalidatePath(`/tours/packages/${packageId}`);
      revalidatePath("/tours/departures");
    }
    return actionOk({ assigned: join.length, released: leave.length });
  } catch (e) {
    return fail(e);
  }
}
