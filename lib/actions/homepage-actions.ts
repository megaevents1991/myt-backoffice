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
import { isBlockType, isBuiltinKey, itemKindsFor, normalizeSections } from "@/lib/homepage/blocks";
import { flattenWithPath } from "@/lib/taxonomy-tree";
import {
  HOMEPAGE_PAGE,
  HOMEPAGE_SECTION_KEYS,
  type HomepageCandidate,
  type HomepageCategoryOption,
  type HomepageItemRow,
  type HomepageLayout,
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

export async function getHomepageLayout(): Promise<HomepageLayout> {
  await requireStaff();

  const [sectionsFull, itemsRes, eventsRes, artistsRes, teamsRes, categoriesRes] =
    await Promise.all([
      db.from("homepage_sections").select(SECTION_COLUMNS),
      db.from("homepage_items").select("section,kind,ref_id,position"),
      supabase
        .from("events")
        .select(
          "id,name,name_english,date,card_image_url,art_image_url,is_prioritized,created_at",
        )
        .is("is_deleted", null)
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
        config: {},
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
  const candidates: HomepageCandidate[] = [
    ...events.map<HomepageCandidate>((e) => ({
      kind: "event",
      ref_id: String(e.id),
      name: e.name,
      subtitle: `${e.date.slice(8, 10)}/${e.date.slice(5, 7)}/${e.date.slice(2, 4)}${
        e.name_english ? ` · ${e.name_english}` : ""
      }`,
      image_url: e.art_image_url || e.card_image_url || null,
      prioritized: e.is_prioritized === true,
      created_at: e.created_at,
    })),
    ...((artistsRes.data ?? []) as PersonPick[]).map<HomepageCandidate>((p) => ({
      kind: "artist",
      ref_id: p.slug,
      name: p.name,
      subtitle: p.name_english,
      image_url: p.art_image_url || p.image_url || null,
    })),
    ...((teamsRes.data ?? []) as PersonPick[]).map<HomepageCandidate>((p) => ({
      kind: "team",
      ref_id: p.slug,
      name: p.name,
      subtitle: p.name_english,
      image_url: p.art_image_url || p.image_url || null,
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

  return { sections, items, candidates, categories, blocksReady };
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

  const itemKey = (it: HomepageItemRow) => `${it.section}|${it.kind}|${it.ref_id}`;
  const seenItems = new Set<string>();
  const perSection = new Map<string, HomepageItemRow[]>();
  for (const it of input.items ?? []) {
    const section = sectionByKey.get(it.section);
    if (!section) continue;
    if (!itemKindsFor(section).includes(it.kind)) continue;
    const ref = String(it.ref_id ?? "").trim();
    if (!ref) continue;
    const row: HomepageItemRow = { section: section.key, kind: it.kind, ref_id: ref, position: 0 };
    const k = itemKey(row);
    if (seenItems.has(k)) continue;
    seenItems.add(k);
    const list = perSection.get(section.key) ?? [];
    list.push(row);
    perSection.set(section.key, list);
  }
  const items: HomepageItemRow[] = [];
  for (const [, list] of perSection) {
    list.forEach((it, i) => {
      it.position = i;
      items.push(it);
    });
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
        [...perSection].map(([k, list]) => [k, list.map((it) => `${it.kind}:${it.ref_id}`)]),
      ),
      ...(removedKeys.length ? { removed_blocks: removedKeys } : {}),
    },
  });
  await revalidateMain();
  return { ok: true };
}
