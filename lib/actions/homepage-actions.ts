"use server";

/**
 * Homepage layout (עמוד הבית) - the /homepage board's read + save.
 *
 * Reads the two layout tables plus everything the board can place on them
 * (future live events, active artists, active teams, the categories a slider
 * can fill itself from) and writes the whole layout back in one go: sections
 * upserted (staff titles and block configs included), removed blocks deleted,
 * every section's item list replaced. myt-main reads the same tables in
 * app/page.tsx (lib/homepageLayout.ts); the rules for what happens AFTER the
 * listed items live there, not here. What a saved row may contain is decided by
 * the pure lib/homepage/blocks.ts.
 */

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";
import { revalidatePath } from "next/cache";
import {
  isBlockType,
  isBuiltinKey,
  itemKindsFor,
  normalizeItemSlots,
  normalizeSections,
  parseBuiltinConfig,
} from "@/lib/homepage/blocks";
import { buildArtIndex, personArtFor } from "@/lib/homepage/event-art";
import { flattenWithPath } from "@/lib/taxonomy-tree";
import {
  HOMEPAGE_PAGE,
  HOMEPAGE_SECTION_KEYS,
  type HomepageCandidate,
  type HomepageCategoryOption,
  type HomepageItemRow,
  type HomepageLayout,
  type HomepagePools,
  type HomepagePoolsResult,
  type HomepageSectionConfig,
  type HomepageSectionRow,
  type SaveHomepageLayoutInput,
} from "@/types/homepage.types";

// homepage_* tables + the people tables predate the generated DB types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type EventPick = {
  id: number;
  name: string;
  name_english: string | null;
  date: string;
  card_image_url: string | null;
  art_image_url: string | null;
  is_prioritized: boolean | null;
  created_at: string | null;
};

type PersonPick = {
  slug: string;
  name: string;
  name_english: string | null;
  image_url: string | null;
  art_image_url: string | null;
};

type CategoryPick = { id: number; name: string; parent_id: number | null };

/** A homepage_sections row as stored; the last four columns arrive with the blocks migration. */
type StoredSection = {
  key: string;
  position: number;
  is_visible: boolean;
  page?: string | null;
  type?: string | null;
  title?: string | null;
  config?: unknown;
};

type DbError = { code?: string; message?: string };

const SECTION_COLUMNS = "key,position,is_visible,page,type,title,config";
const SECTION_COLUMNS_LEGACY = "key,position,is_visible";

const todayISO = () => new Date().toISOString().slice(0, 10);

// PostgREST "relation does not exist" (PGRST205 via the schema cache, 42P01 raw).
const isMissingTable = (e: DbError) =>
  e.code === "PGRST205" ||
  e.code === "42P01" ||
  /relation .* does not exist|schema cache/i.test(e.message ?? "");

// "column does not exist" (42703 raw, PGRST204 when the schema cache lacks it).
const isMissingColumn = (e: DbError) =>
  e.code === "42703" || e.code === "PGRST204" || /column .* does not exist/i.test(e.message ?? "");

/** Images a banner may point at: our own public Storage, nothing else. */
const storagePrefix = () => {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/storage/v1/object/public/` : "";
};

/** An event slider may name up to this many categories at once (main caps the same). */
const MAX_POOL_CATEGORIES = 30;

/**
 * What the site's rows are made of right now - myt-main `/api/homepage-pools`:
 * each row's automatic pool in the site's order, the pools of the categories
 * asked for, and a card (picture, flags) per thing the board may place. Never
 * throws: a site that cannot be reached gives `{ ok: false }` and the board
 * falls back to the pinned cards.
 */
async function fetchPools(categoryIds: number[]): Promise<HomepagePoolsResult> {
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!base || !secret) {
    return { ok: false, error: "The site's address or shared secret is not set on this server." };
  }
  const ids = [...new Set(categoryIds.filter((n) => Number.isInteger(n) && n > 0))].slice(
    0,
    MAX_POOL_CATEGORIES,
  );
  const url = `${base.replace(/\/+$/, "")}/api/homepage-pools${ids.length ? `?categories=${ids.join(",")}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: { "x-hotel-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 404) {
      return { ok: false, error: "The site does not serve its rows yet (myt-main without /api/homepage-pools)." };
    }
    if (!res.ok) return { ok: false, error: `The site answered ${res.status}.` };
    const data = (await res.json()) as HomepagePools;
    if (!data || typeof data !== "object" || !data.pools || !Array.isArray(data.cards)) {
      return { ok: false, error: "The site's answer was not understood." };
    }
    return { ok: true, data };
  } catch (error) {
    console.error("homepage pools:", error);
    return { ok: false, error: "The site could not be reached." };
  }
}

/**
 * The pools of the categories event sliders name - asked again when staff pick
 * a category the board has no pool for yet.
 */
export async function getSliderPools(
  categoryIds: number[],
): Promise<{ ok: true; pools: Record<string, string[]> } | { ok: false; error: string }> {
  await requireStaff();
  const res = await fetchPools(Array.isArray(categoryIds) ? categoryIds.map(Number) : []);
  return res.ok ? { ok: true, pools: res.data.sliderPools } : { ok: false, error: res.error };
}

export async function getHomepageLayout(): Promise<HomepageLayout> {
  await requireStaff();

  // The sliders' categories are needed before the site can be asked for their
  // pools, so the layout rows are read first - one small read - and the site is
  // asked while the rest of the board's reads run.
  const sliderCategories = await db
    .from("homepage_sections")
    .select("config")
    .eq("type", "event_slider")
    .then((r: { data: { config: unknown }[] | null }) =>
      (r.data ?? []).flatMap((row) => {
        const id = Number((row.config as { category_id?: unknown } | null)?.category_id);
        return Number.isInteger(id) && id > 0 ? [id] : [];
      }),
    )
    .catch(() => [] as number[]);

  const [sectionsFull, itemsRes, eventsRes, artistsRes, teamsRes, categoriesRes, pools] =
    await Promise.all([
      db.from("homepage_sections").select(SECTION_COLUMNS),
      db.from("homepage_items").select("section,kind,ref_id,position"),
      supabase
        .from("events")
        .select(
          "id,name,name_english,date,card_image_url,art_image_url,is_prioritized,created_at",
        )
        .is("is_deleted", null)
        // Hidden = uploader event nobody approved yet: not offered to pin on the homepage.
        .eq("is_hidden", false)
        .gte("date", todayISO())
        .order("date", { ascending: true })
        .limit(2000),
      db
        .from("artists")
        .select("slug,name,name_english,image_url,art_image_url")
        .eq("is_deleted", false)
        .eq("is_active", true)
        .order("name"),
      db
        .from("football_teams")
        .select("slug,name,name_english,image_url,art_image_url")
        .eq("is_deleted", false)
        .eq("is_active", true)
        .order("name"),
      db
        .from("categories")
        .select("id,name,parent_id")
        .eq("is_deleted", false)
        .eq("is_active", true),
      fetchPools(sliderCategories),
    ]);

  for (const r of [eventsRes, artistsRes, teamsRes]) {
    if (r.error) {
      console.error("getHomepageLayout:", JSON.stringify(r.error));
      throw r.error;
    }
  }

  // The title / block columns arrive with their own migration. Between the
  // Vercel deploy and the migration workflow they do not exist yet - read the
  // columns that do, show the board as it was, and switch titles + blocks off
  // (blocksReady) rather than offer a Save that cannot work.
  let sectionsRes = sectionsFull;
  let blocksReady = true;
  if (sectionsRes.error && isMissingColumn(sectionsRes.error)) {
    console.warn("getHomepageLayout: blocks migration not applied yet -", sectionsRes.error.message);
    blocksReady = false;
    sectionsRes = await db.from("homepage_sections").select(SECTION_COLUMNS_LEGACY);
  }

  // The two layout tables arrive with the migration that ships alongside this
  // screen. Between the Vercel deploy and the migration workflow (or on a
  // preview pointed at prod before the merge) they do not exist yet - show the
  // default layout with nothing pinned rather than a broken page; Save still
  // reports the real error.
  for (const r of [sectionsRes, itemsRes]) {
    if (r.error) {
      if (isMissingTable(r.error)) {
        console.warn("getHomepageLayout: layout tables not migrated yet -", r.error.message);
        r.data = [];
      } else {
        console.error("getHomepageLayout:", JSON.stringify(r.error));
        throw r.error;
      }
    }
  }

  // Sections: this page's rows in stored order - builtins by known key, blocks
  // by known type. A row of a type this build does not know is not shown (and
  // saveHomepageLayout never deletes it). Builtins the table lacks are appended
  // in the default order - the same rule main applies, so the board shows what
  // main shows.
  const stored = ((sectionsRes.data ?? []) as StoredSection[])
    .filter((s) => (s.page ?? HOMEPAGE_PAGE) === HOMEPAGE_PAGE)
    .sort((a, b) => a.position - b.position);
  const sections: HomepageSectionRow[] = [];
  const seen = new Set<string>();
  for (const s of stored) {
    const type = s.type ?? "builtin";
    if (seen.has(s.key)) continue;
    if (type === "builtin") {
      if (!isBuiltinKey(s.key)) continue;
      sections.push({
        key: s.key,
        type: "builtin",
        title: s.title ?? null,
        config: parseBuiltinConfig(s.key, s.config),
        position: 0,
        is_visible: s.is_visible !== false,
      });
    } else if (isBlockType(type)) {
      sections.push({
        key: s.key,
        type,
        title: s.title ?? null,
        // Written by normalizeSections, and validated again on the next save.
        config: (s.config ?? {}) as HomepageSectionConfig,
        position: 0,
        is_visible: s.is_visible !== false,
      });
    } else {
      continue;
    }
    seen.add(s.key);
  }
  for (const key of HOMEPAGE_SECTION_KEYS) {
    if (!seen.has(key)) {
      sections.push({ key, type: "builtin", title: null, config: {}, position: 0, is_visible: true });
      seen.add(key);
    }
  }
  sections.forEach((s, i) => (s.position = i));

  const items = ((itemsRes.data ?? []) as HomepageItemRow[])
    .filter((it) => seen.has(it.section))
    .sort((a, b) => a.position - b.position);

  const events = (eventsRes.data ?? []) as EventPick[];
  const artists = (artistsRes.data ?? []) as PersonPick[];
  const teams = (teamsRes.data ?? []) as PersonPick[];
  // Most events have no image of their own - the site shows their artist's /
  // team's, so the board does too (lib/homepage/event-art.ts).
  const personImage = (p: PersonPick) => p.art_image_url || p.image_url || null;
  const artIndex = buildArtIndex([
    ...artists.map((p) => ({ kind: "artist" as const, name_english: p.name_english, image_url: personImage(p) })),
    ...teams.map((p) => ({ kind: "team" as const, name_english: p.name_english, image_url: personImage(p) })),
  ]);
  const candidates: HomepageCandidate[] = [
    ...events.map<HomepageCandidate>((e) => ({
      kind: "event",
      ref_id: String(e.id),
      name: e.name,
      subtitle: `${e.date.slice(8, 10)}/${e.date.slice(5, 7)}/${e.date.slice(2, 4)}${
        e.name_english ? ` · ${e.name_english}` : ""
      }`,
      image_url:
        e.art_image_url || e.card_image_url || personArtFor(e.name_english, artIndex),
      prioritized: e.is_prioritized === true,
      created_at: e.created_at,
    })),
    ...artists.map<HomepageCandidate>((p) => ({
      kind: "artist",
      ref_id: p.slug,
      name: p.name,
      subtitle: p.name_english,
      image_url: personImage(p),
    })),
    ...teams.map<HomepageCandidate>((p) => ({
      kind: "team",
      ref_id: p.slug,
      name: p.name,
      subtitle: p.name_english,
      image_url: personImage(p),
    })),
  ];

  // The categories a slider can fill itself from. A failed read only empties
  // the picker - the rest of the board is unaffected.
  let categories: HomepageCategoryOption[] = [];
  if (categoriesRes.error) {
    console.error("getHomepageLayout categories:", JSON.stringify(categoriesRes.error));
  } else {
    const rows = (categoriesRes.data ?? []) as CategoryPick[];
    const nameOf = new Map(rows.map((c) => [c.id, c.name]));
    categories = flattenWithPath(rows)
      .map((c) => ({ id: c.id, name: nameOf.get(c.id) ?? c.path, path: c.path }))
      .sort((a, b) => a.path.localeCompare(b.path, "he"));
  }

  return { sections, items, candidates, categories, blocksReady, pools };
}

/**
 * Flip an event's Prioritized flag from the board. "המבוקשים ביותר" fills
 * itself with Prioritized events after the pinned ones, so the board lists
 * them and staff need a way to drop one without hunting for it in /events.
 *
 * Immediate, not part of Save: it writes `events`, not the layout, and the
 * board's Discard must not pretend to undo it.
 */
export async function setEventPrioritized(
  eventId: number,
  prioritized: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return { ok: false, error: "Invalid event" };
  }
  const { error } = await db
    .from("events")
    .update({ is_prioritized: prioritized })
    .eq("id", eventId)
    .is("is_deleted", null);
  if (error) {
    console.error("setEventPrioritized:", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  await logAudit({
    action: "update",
    entityType: "event",
    entityId: eventId,
    changes: { is_prioritized: prioritized },
    metadata: { source: "homepage_board" },
  });
  revalidatePath("/homepage");
  await revalidateMain();
  return { ok: true };
}

/**
 * Replace the whole layout of the homepage. The sections go through
 * `normalizeSections` first (keys, block types, titles, configs - one bad block
 * fails the save before anything is written); an item whose section is not
 * saved, or of a kind that section does not accept, is dropped. Then: upsert
 * every row, delete the blocks the board no longer has, swap every item list.
 * Builtin rows are never deleted. One audit row carries the payload.
 */
export async function saveHomepageLayout(
  input: SaveHomepageLayoutInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();

  const normalized = normalizeSections(input.sections ?? [], { storagePrefix: storagePrefix() });
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const sections = normalized.sections;
  const sectionByKey = new Map(sections.map((s) => [s.key, s]));

  // A pinned card's `position` is the place it holds in its row (2026-10-14):
  // kept as sent, made whole and unique per row by normalizeItemSlots.
  const itemKey = (it: HomepageItemRow) => `${it.section}|${it.kind}|${it.ref_id}`;
  const seenItems = new Set<string>();
  const accepted: HomepageItemRow[] = [];
  for (const it of input.items ?? []) {
    const section = sectionByKey.get(it.section);
    if (!section) continue;
    if (!itemKindsFor(section).includes(it.kind)) continue;
    const ref = String(it.ref_id ?? "").trim();
    if (!ref || ref.length > 200) continue;
    const row: HomepageItemRow = {
      section: section.key,
      kind: it.kind,
      ref_id: ref,
      position: Number(it.position),
    };
    const k = itemKey(row);
    if (seenItems.has(k)) continue;
    seenItems.add(k);
    accepted.push(row);
  }
  const items = normalizeItemSlots(accepted);
  const perSection = new Map<string, HomepageItemRow[]>();
  for (const it of items) {
    const list = perSection.get(it.section) ?? [];
    list.push(it);
    perSection.set(it.section, list);
  }

  // The blocks this page has NOW - the ones missing from the payload are the
  // ones staff deleted. Only known block types are ever loaded by the board, so
  // only those may be deleted: a row of a type a newer build wrote stays put.
  const before = await db
    .from("homepage_sections")
    .select("key,type")
    .eq("page", HOMEPAGE_PAGE)
    .neq("type", "builtin");
  if (before.error) {
    console.error("saveHomepageLayout read:", JSON.stringify(before.error));
    return {
      ok: false,
      error: isMissingColumn(before.error)
        ? "The homepage blocks migration has not been applied yet - titles and blocks cannot be saved."
        : before.error.message,
    };
  }
  const removedKeys = ((before.data ?? []) as { key: string; type: string }[])
    .filter((r) => isBlockType(r.type) && !sectionByKey.has(r.key))
    .map((r) => r.key);

  const stamp = new Date().toISOString();
  const up = await db.from("homepage_sections").upsert(
    sections.map((s) => ({
      key: s.key,
      page: HOMEPAGE_PAGE,
      type: s.type,
      title: s.title,
      config: s.config,
      position: s.position,
      is_visible: s.is_visible,
      updated_at: stamp,
    })),
    { onConflict: "key" },
  );
  if (up.error) {
    console.error("saveHomepageLayout sections:", JSON.stringify(up.error));
    return { ok: false, error: up.error.message };
  }

  if (removedKeys.length) {
    const gone = await db
      .from("homepage_sections")
      .delete()
      .eq("page", HOMEPAGE_PAGE)
      .neq("type", "builtin")
      .in("key", removedKeys);
    if (gone.error) {
      console.error("saveHomepageLayout remove blocks:", JSON.stringify(gone.error));
      return { ok: false, error: gone.error.message };
    }
  }

  // Replace every section's list (sections with no items get emptied too -
  // that is how "remove the last item" reaches the DB), and drop the pins of
  // the blocks that were just deleted.
  const del = await db
    .from("homepage_items")
    .delete()
    .in("section", [...sectionByKey.keys(), ...removedKeys]);
  if (del.error) {
    console.error("saveHomepageLayout delete:", JSON.stringify(del.error));
    return { ok: false, error: del.error.message };
  }
  if (items.length) {
    const ins = await db.from("homepage_items").insert(
      items.map((it) => ({
        section: it.section,
        kind: it.kind,
        ref_id: it.ref_id,
        position: it.position,
        updated_at: stamp,
      })),
    );
    if (ins.error) {
      console.error("saveHomepageLayout insert:", JSON.stringify(ins.error));
      return { ok: false, error: ins.error.message };
    }
  }

  revalidatePath("/homepage");
  await logAudit({
    action: "update",
    entityType: "homepage_layout",
    changes: {
      sections: sections.map(
        (s) =>
          `${s.key}${s.type === "builtin" ? "" : ` [${s.type}]`}${s.title ? ` "${s.title}"` : ""}${
            s.is_visible ? "" : " (hidden)"
          }`,
      ),
      items: Object.fromEntries(
        [...perSection].map(([k, list]) => [
          k,
          list.map((it) => `${it.kind}:${it.ref_id}@${it.position + 1}`),
        ]),
      ),
      ...(removedKeys.length ? { removed_blocks: removedKeys } : {}),
    },
  });
  await revalidateMain();
  return { ok: true };
}
