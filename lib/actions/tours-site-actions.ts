"use server";

/**
 * The site chrome and the home page of a tours company (Mega Family): the
 * documents of tours.site_content - general, header, footer, home.
 *
 * A document is saved whole, the way the editor shows it. Two people on the same
 * document do not overwrite each other: a save names the version it started
 * from, and is refused when someone else saved in between.
 *
 * Nothing reaches the site until it is rebuilt - see lib/tours/site-publish.ts.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { actionFail, plainFail, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit, invalidInput } from "@/lib/tours/company-kit";
import { siteEditorOptions, type SiteEditorOptions } from "@/lib/tours/site-options";
import {
  PICTURE_TILES_MAX,
  SITE_DOC_KEYS,
  SITE_DOC_SCHEMAS,
  footerTilesSchema,
  readFooterTiles,
  readSiteDoc,
  type FooterTiles,
  type PictureTile,
  type SiteDocKey,
  type SiteDocs,
  type SiteFooter,
  type SiteHeader,
} from "@/lib/tours/site-content";
import { aboutMenuFromHtml, hotTilesFromExtras } from "@/lib/tours/wp-html";
import type { Json } from "@/types/database.types";

const SCOPE = "tours-site-actions";

export type { SiteEditorOptions };

/** One document as an editor holds it. `updatedAt` is the version a save must name. */
export interface SiteDocEditorData<K extends SiteDocKey = SiteDocKey> {
  key: K;
  form: SiteDocs[K];
  updatedAt: string | null;
  updatedBy: string | null;
  siteUrl: string | null;
}

const SAVED_BY_OTHER =
  "Someone else saved this screen while you were editing. Copy what you changed, reload the page, and apply it again.";

/**
 * A save refused because someone else saved first carries the document as it is saved now
 * (`latest`), so an editor can merge its copy onto it without a second call (the home page does,
 * lib/tours/home-merge.ts). Other editors read only `error`.
 */
export type SaveSiteDocResult = ActionResult<SiteDocEditorData> | { success: false; error: string; latest: SiteDocEditorData };

/** Who saved a document last, and when - what an open editor compares with the version it holds. */
export interface SiteDocVersion {
  updatedAt: string | null;
  updatedBy: string | null;
}

async function docRow(company: Company, key: SiteDocKey) {
  const { data, error } = await toursDb()
    .from("site_content")
    .select("key, data, updated_at, updated_by")
    .eq("company_id", company.id)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function editorData<K extends SiteDocKey>(company: Company, key: K): Promise<SiteDocEditorData<K>> {
  const row = await docRow(company, key);
  return {
    key,
    form: readSiteDoc(key, row?.data ?? null),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
    siteUrl: company.siteUrl,
  };
}

/** What the site shows for a field of the header or footer document until staff save their own. */
interface ChromeDefaults {
  aboutMenu: SiteHeader["aboutMenu"];
  hotTitle: string;
  hot: PictureTile[];
}
const NO_DEFAULTS: ChromeDefaults = { aboutMenu: [], hotTitle: "", hot: [] };

/**
 * The links between the "about" pages and the picture tiles under them, as they came with
 * the site: read out of the import (the markup of /about/, the "extras" row). The editor
 * opens with them, so staff edit what the site shows today and the first save keeps it.
 * A company without those rows has none, and a failed read never blocks the editor.
 */
async function chromeDefaults(company: Company): Promise<ChromeDefaults> {
  try {
    const db = toursDb();
    const [about, extras] = await Promise.all([
      db.from("cms_pages").select("content_html").eq("company_id", company.id).eq("kind", "page").eq("path", "/about/").limit(1),
      db.from("cms_pages").select("data").eq("company_id", company.id).eq("kind", "extras").limit(1),
    ]);
    if (about.error) throw about.error;
    if (extras.error) throw extras.error;
    const hot = hotTilesFromExtras(extras.data?.[0]?.data);
    return {
      aboutMenu: aboutMenuFromHtml(about.data?.[0]?.content_html ?? "").slice(0, 12),
      hotTitle: hot.title,
      hot: hot.tiles.slice(0, PICTURE_TILES_MAX),
    };
  } catch (e) {
    console.error(`${SCOPE}: chrome defaults`, e);
    return NO_DEFAULTS;
  }
}

/** The document as its editor opens it: a list staff never filled shows what the site shows today. */
function withChromeDefaults<K extends SiteDocKey>(doc: SiteDocEditorData<K>, defaults: ChromeDefaults): SiteDocEditorData<K> {
  if (doc.key === "header") {
    const form = doc.form as SiteHeader;
    if (form.aboutMenu.length > 0 || defaults.aboutMenu.length === 0) return doc;
    return { ...doc, form: { ...form, aboutMenu: defaults.aboutMenu } as SiteDocs[K] };
  }
  if (doc.key === "footer") {
    const form = doc.form as SiteFooter;
    if (form.hot.length > 0 || defaults.hot.length === 0) return doc;
    return { ...doc, form: { ...form, hot: defaults.hot, hotTitle: form.hotTitle || defaults.hotTitle } as SiteDocs[K] };
  }
  return doc;
}

/** The document as its editor shows it: the header and footer keep showing what the site shows for a list that is still empty. */
async function shownDoc(company: Company, key: SiteDocKey): Promise<SiteDocEditorData> {
  const doc = await editorData(company, key);
  return key === "header" || key === "footer" ? withChromeDefaults(doc, await chromeDefaults(company)) : doc;
}

const isDocKey = (key: string): key is SiteDocKey => SITE_DOC_KEYS.includes(key as SiteDocKey);

/**
 * The version of one document, read only for its stamp: an open editor asks every half minute and
 * when its tab comes back, and says so as soon as someone else saved (Liz + Alon, 12.11).
 */
export async function getSiteDocVersion(key: string): Promise<ActionResult<SiteDocVersion>> {
  try {
    const { company } = await requireCompany("tours");
    if (!isDocKey(key)) return plainFail("Unknown document");
    const { data, error } = await toursDb()
      .from("site_content")
      .select("updated_at, updated_by")
      .eq("company_id", company.id)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return { success: true, data: { updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to check the page");
  }
}

/** One document as it is saved now - what an editor merges its copy onto. */
export async function getSiteDoc(key: string): Promise<ActionResult<SiteDocEditorData>> {
  try {
    const { company } = await requireCompany("tours");
    if (!isDocKey(key)) return plainFail("Unknown document");
    return { success: true, data: await shownDoc(company, key) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the page");
  }
}

/** The home page editor: the document and what its pickers choose from. */
export async function getHomepageEditor(): Promise<ActionResult<{ doc: SiteDocEditorData<"home">; options: SiteEditorOptions }>> {
  try {
    const { company } = await requireCompany("tours");
    const [doc, options] = await Promise.all([editorData(company, "home"), siteEditorOptions(company)]);
    return { success: true, data: { doc, options } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the home page");
  }
}

/** The header & footer editor: its three documents and what its pickers choose from. */
export async function getChromeEditor(): Promise<
  ActionResult<{
    general: SiteDocEditorData<"general">;
    header: SiteDocEditorData<"header">;
    footer: SiteDocEditorData<"footer">;
    options: SiteEditorOptions;
  }>
> {
  try {
    const { company } = await requireCompany("tours");
    const [general, header, footer, options, defaults] = await Promise.all([
      editorData(company, "general"),
      editorData(company, "header"),
      editorData(company, "footer"),
      siteEditorOptions(company),
      chromeDefaults(company),
    ]);
    return { success: true, data: { general, header: withChromeDefaults(header, defaults), footer: withChromeDefaults(footer, defaults), options } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the header and footer");
  }
}

// ---------------------------------------------------------------- one tour's page
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What a tour's page does with the tiles above the footer, as its card on the tour screen holds it. */
export interface TourFooterTilesData {
  form: FooterTiles;
  /** Whether tour pages show the main tiles when a tour says nothing of its own (Header & Footer > Footer). */
  shownOnTours: boolean;
  options: SiteEditorOptions;
  siteUrl: string | null;
}

async function tourRow(company: Company, id: string) {
  if (!UUID.test(id)) return null;
  const { data, error } = await toursDb().from("packages").select("id, name, data").eq("company_id", company.id).eq("id", id).is("is_deleted", null).maybeSingle();
  if (error) throw error;
  return data;
}

async function tourFooterTiles(company: Company, row: { data: Json }): Promise<TourFooterTilesData> {
  const [footer, options] = await Promise.all([docRow(company, "footer"), siteEditorOptions(company)]);
  return {
    form: readFooterTiles(asObject(row.data).footerTiles),
    shownOnTours: readSiteDoc("footer", footer?.data ?? null).discoverOn.tours,
    options,
    siteUrl: company.siteUrl,
  };
}

/** The tiles above the footer on one tour's page: follow the rule of tour pages, always show, hide, or its own tiles. */
export async function getTourFooterTiles(packageId: string): Promise<ActionResult<TourFooterTilesData>> {
  try {
    const { company } = await requireCompany("tours");
    const row = await tourRow(company, packageId);
    if (!row) return plainFail("Tour not found");
    return { success: true, data: await tourFooterTiles(company, row) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the tiles of this tour");
  }
}

/**
 * Saves one tour's choice. It lives in the tour's `data` (tours.packages.data.footerTiles),
 * next to what the import left there; only that key is written.
 */
export async function saveTourFooterTiles(packageId: string, form: unknown): Promise<ActionResult<TourFooterTilesData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = footerTilesSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const row = await tourRow(company, packageId);
    if (!row) return plainFail("Tour not found");
    const before = readFooterTiles(asObject(row.data).footerTiles);
    const next = parsed.data;
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      const data = { ...asObject(row.data), footerTiles: next } as unknown as Json;
      const { error } = await toursDb().from("packages").update({ data }).eq("company_id", company.id).eq("id", packageId);
      if (error) throw error;
      await logAudit({
        action: "update",
        entityType: "tours_package",
        entityId: packageId,
        changes: { footerTiles: { from: before.mode, to: next.mode } },
        metadata: { ...companyAudit(company), name: row.name, tiles: next.items.length },
      });
      revalidatePath(`/tours/packages/${packageId}`);
    }
    const fresh = await tourRow(company, packageId);
    if (!fresh) return plainFail("Tour not found");
    return { success: true, data: await tourFooterTiles(company, fresh) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save the tiles of this tour");
  }
}

/**
 * Saves one document. `expectedUpdatedAt` is the version the editor loaded
 * (null when the company had none yet); a save over a newer version is refused.
 */
export async function saveSiteDoc(
  key: string,
  form: unknown,
  expectedUpdatedAt: string | null,
): Promise<SaveSiteDocResult> {
  try {
    const { company, session } = await requireCompany("tours");
    if (!isDocKey(key)) return plainFail("Unknown document");
    const docKey = key;
    const parsed = SITE_DOC_SCHEMAS[docKey].safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const data = parsed.data as unknown as Json;
    // refused: the document as it is saved now goes back with the refusal
    const savedByOther = async (): Promise<SaveSiteDocResult> => ({ success: false, error: SAVED_BY_OTHER, latest: await shownDoc(company, docKey) });

    const db = toursDb();
    const before = await docRow(company, docKey);
    if ((before?.updated_at ?? null) !== expectedUpdatedAt) return savedByOther();

    const stamp = { data, updated_at: new Date().toISOString(), updated_by: session.email };
    if (before) {
      // the version is part of the condition, so two saves at the same moment cannot both win
      const { data: written, error } = await db
        .from("site_content")
        .update(stamp)
        .eq("company_id", company.id)
        .eq("key", docKey)
        .eq("updated_at", before.updated_at)
        .select("key")
        .maybeSingle();
      if (error) throw error;
      if (!written) return savedByOther();
    } else {
      const { error } = await db.from("site_content").insert({ company_id: company.id, key: docKey, ...stamp });
      if (error) {
        if (error.code === "23505") return savedByOther();
        throw error;
      }
    }

    await logAudit({
      action: before ? "update" : "create",
      entityType: "tours_site_content",
      entityId: docKey,
      metadata: { ...companyAudit(company), key: docKey, bytes: JSON.stringify(data).length },
    });
    revalidatePath("/tours/homepage");
    revalidatePath("/tours/site");
    return { success: true, data: await shownDoc(company, docKey) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save");
  }
}
