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
import { companyAudit, invalidInput } from "@/lib/tours/company-kit";
import { siteEditorOptions, type SiteEditorOptions } from "@/lib/tours/site-options";
import {
  SITE_DOC_KEYS,
  SITE_DOC_SCHEMAS,
  readSiteDoc,
  type SiteDocKey,
  type SiteDocs,
} from "@/lib/tours/site-content";
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
    const [general, header, footer, options] = await Promise.all([
      editorData(company, "general"),
      editorData(company, "header"),
      editorData(company, "footer"),
      siteEditorOptions(company),
    ]);
    return { success: true, data: { general, header, footer, options } };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the header and footer");
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
): Promise<ActionResult<SiteDocEditorData>> {
  try {
    const { company, session } = await requireCompany("tours");
    if (!SITE_DOC_KEYS.includes(key as SiteDocKey)) return plainFail("Unknown document");
    const docKey = key as SiteDocKey;
    const parsed = SITE_DOC_SCHEMAS[docKey].safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const data = parsed.data as unknown as Json;

    const db = toursDb();
    const before = await docRow(company, docKey);
    if ((before?.updated_at ?? null) !== expectedUpdatedAt) return plainFail(SAVED_BY_OTHER);

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
      if (!written) return plainFail(SAVED_BY_OTHER);
    } else {
      const { error } = await db.from("site_content").insert({ company_id: company.id, key: docKey, ...stamp });
      if (error) {
        if (error.code === "23505") return plainFail(SAVED_BY_OTHER);
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
    return { success: true, data: await editorData(company, docKey) };
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save");
  }
}
