"use server";

/**
 * Homepage layout (עמוד הבית) - the /homepage board's read + save.
 *
 * Reads the two layout tables plus everything the board can place on them
 * (future live events, active artists, active teams) and writes the whole
 * layout back in one go: sections upserted, every section's item list replaced.
 * myt-main reads the same tables in app/page.tsx (lib/homepageLayout.ts); the
 * rules for what happens AFTER the listed items live there, not here.
 */

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";
import { revalidatePath } from "next/cache";
import {
  HOMEPAGE_SECTION_KEYS,
  SECTION_ITEM_KINDS,
  type HomepageCandidate,
  type HomepageItemRow,
  type HomepageLayout,
  type HomepageSectionKey,
  type HomepageSectionRow,
  type SaveHomepageLayoutInput,
} from "@/types/homepage.types";

// homepage_* tables + the people tables predate the generated DB types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const isKey = (k: string): k is HomepageSectionKey =>
  (HOMEPAGE_SECTION_KEYS as readonly string[]).includes(k);

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

const todayISO = () => new Date().toISOString().slice(0, 10);

// PostgREST "relation does not exist" (PGRST205 via the schema cache, 42P01 raw).
const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" ||
  e.code === "42P01" ||
  /does not exist|schema cache/i.test(e.message ?? "");

export async function getHomepageLayout(): Promise<HomepageLayout> {
  await requireStaff();

  const [sectionsRes, itemsRes, eventsRes, artistsRes, teamsRes] =
    await Promise.all([
      db.from("homepage_sections").select("key,position,is_visible"),
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
    ]);

  for (const r of [eventsRes, artistsRes, teamsRes]) {
    if (r.error) {
      console.error("getHomepageLayout:", JSON.stringify(r.error));
      throw r.error;
    }
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

  // Sections: stored order, then any key the table lacks appended in the
  // default order (same rule main applies, so the board shows what main shows).
  const stored = new Map<string, HomepageSectionRow>(
    ((sectionsRes.data ?? []) as HomepageSectionRow[])
      .filter((s) => isKey(s.key))
      .map((s) => [s.key, s]),
  );
  const sections: HomepageSectionRow[] = [...stored.values()].sort(
    (a, b) => a.position - b.position,
  );
  for (const key of HOMEPAGE_SECTION_KEYS) {
    if (!stored.has(key)) {
      sections.push({ key, position: sections.length, is_visible: true });
    }
  }
  sections.forEach((s, i) => (s.position = i));

  const items = ((itemsRes.data ?? []) as HomepageItemRow[])
    .filter((it) => isKey(it.section))
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

  return { sections, items, candidates };
}

/**
 * Replace the whole layout. Validates keys/kinds against the declared
 * sections (an item of a kind its section does not accept is dropped), keeps
 * `hero` first whatever the client sent, renumbers positions 0..n, and swaps
 * every section's item list in one pass. One audit row carries the payload.
 */
export async function saveHomepageLayout(
  input: SaveHomepageLayoutInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();

  const seen = new Set<string>();
  const sections: HomepageSectionRow[] = [];
  for (const s of input.sections ?? []) {
    if (!isKey(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    sections.push({ key: s.key, position: 0, is_visible: s.is_visible !== false });
  }
  for (const key of HOMEPAGE_SECTION_KEYS) {
    if (!seen.has(key)) sections.push({ key, position: 0, is_visible: true });
  }
  // Hero to the front, everything else keeps the order the board sent.
  const ordered = [
    ...sections.filter((s) => s.key === "hero"),
    ...sections.filter((s) => s.key !== "hero"),
  ];
  ordered.forEach((s, i) => (s.position = i));

  const itemKey = (it: HomepageItemRow) => `${it.section}|${it.kind}|${it.ref_id}`;
  const seenItems = new Set<string>();
  const perSection = new Map<HomepageSectionKey, HomepageItemRow[]>();
  for (const it of input.items ?? []) {
    if (!isKey(it.section)) continue;
    if (!SECTION_ITEM_KINDS[it.section].includes(it.kind)) continue;
    const ref = String(it.ref_id ?? "").trim();
    if (!ref) continue;
    const row: HomepageItemRow = { section: it.section, kind: it.kind, ref_id: ref, position: 0 };
    const k = itemKey(row);
    if (seenItems.has(k)) continue;
    seenItems.add(k);
    const list = perSection.get(it.section) ?? [];
    list.push(row);
    perSection.set(it.section, list);
  }
  const items: HomepageItemRow[] = [];
  for (const [, list] of perSection) {
    list.forEach((it, i) => {
      it.position = i;
      items.push(it);
    });
  }

  const stamp = new Date().toISOString();
  const up = await db
    .from("homepage_sections")
    .upsert(
      ordered.map((s) => ({ ...s, updated_at: stamp })),
      { onConflict: "key" },
    );
  if (up.error) {
    console.error("saveHomepageLayout sections:", JSON.stringify(up.error));
    return { ok: false, error: up.error.message };
  }

  // Replace every section's list (sections with no items get emptied too -
  // that is how "remove the last item" reaches the DB).
  const del = await db
    .from("homepage_items")
    .delete()
    .in("section", [...HOMEPAGE_SECTION_KEYS]);
  if (del.error) {
    console.error("saveHomepageLayout delete:", JSON.stringify(del.error));
    return { ok: false, error: del.error.message };
  }
  if (items.length) {
    const ins = await db
      .from("homepage_items")
      .insert(items.map((it) => ({ ...it, updated_at: stamp })));
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
      sections: ordered.map((s) => `${s.key}${s.is_visible ? "" : " (hidden)"}`),
      items: Object.fromEntries(
        [...perSection].map(([k, list]) => [k, list.map((it) => `${it.kind}:${it.ref_id}`)]),
      ),
    },
  });
  await revalidateMain();
  return { ok: true };
}
