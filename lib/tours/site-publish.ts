"use server";

/**
 * "Publish to site" for a tours company.
 *
 * The customer site is static: it reads the database when it is BUILT. Saving
 * in the backoffice therefore changes nothing a visitor sees until the site is
 * rebuilt. publishSite() triggers that rebuild by POSTing to the company's
 * deploy hook (companies.features.site_deploy_hook - a Vercel deploy hook URL).
 *
 * The hook URL is a secret: anyone who has it can trigger builds. It is read
 * and called on the server only and never returned to the browser - the client
 * learns just whether one is configured and how the last publish went
 * (companies.features.last_site_publish).
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { actionFail } from "@/lib/tours/action-kit";
import {
  LAST_SITE_PUBLISH_KEY,
  asObject,
  companyAudit,
  postSiteDeployHook,
  publishRecordOf,
  siteDeployHookOf,
  type JsonObject,
} from "@/lib/tours/company-kit";
import type { ActionResult, SitePublishRecord, SitePublishStatus } from "@/components/tours/content/shared";

/**
 * Only the error's message reaches the log: a database error's details can
 * quote the companies row, and with it the deploy hook URL.
 */
const failure = (e: unknown, fallback: string) => {
  const message =
    e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e);
  return actionFail(new Error(message), "site-publish", fallback);
};

async function featuresOf(companyId: string): Promise<JsonObject> {
  const { data, error } = await supabaseTyped.from("companies").select("features").eq("id", companyId).single();
  if (error) throw error;
  return asObject(data.features);
}

/** Whether a deploy hook is configured for the active company, and how the last publish went. */
export async function getSitePublishStatus(): Promise<ActionResult<SitePublishStatus>> {
  try {
    const { company } = await requireCompany("tours");
    const features = await featuresOf(company.id);
    const last = publishRecordOf(features[LAST_SITE_PUBLISH_KEY]);
    return { success: true, data: { configured: siteDeployHookOf(features) !== null, last } };
  } catch (e) {
    return failure(e, "Failed to load the publish status");
  }
}

/**
 * Rebuild the customer site of the active company. Records who published, when
 * and what the hook answered - also when the call failed.
 */
export async function publishSite(): Promise<ActionResult<SitePublishRecord>> {
  try {
    const { session, company } = await requireCompany("tours");
    const hook = siteDeployHookOf(await featuresOf(company.id));
    if (!hook) {
      return {
        success: false,
        error: "Site connection not set up (deploy hook). A company admin sets it up in Settings.",
      };
    }

    // never log or return the fetch error itself - it can carry the hook URL (postSiteDeployHook words it)
    const { status, problem } = await postSiteDeployHook(hook);

    const record: SitePublishRecord = {
      at: new Date().toISOString(),
      by: session.email,
      status,
      ok: !problem,
      ...(problem ? { error: problem } : {}),
    };
    // read again right before the write so a settings save in between is not lost
    const features = await featuresOf(company.id);
    const { error } = await supabaseTyped
      .from("companies")
      .update({ features: { ...features, [LAST_SITE_PUBLISH_KEY]: { ...record, by_id: session.sub } } })
      .eq("id", company.id);
    if (error) throw error;

    await logAudit({
      action: "publish",
      entityType: "company_site",
      entityId: company.id,
      metadata: { ...companyAudit(company), status, ok: record.ok },
    });

    if (problem) return { success: false, error: `The site build did not start: ${problem}` };
    return { success: true, data: record };
  } catch (e) {
    return failure(e, "Failed to revalidate the site");
  }
}

/**
 * When the build that now serves the company's site was made - the site's own `/api/build/` (mega-family
 * app/api/build/route.ts) - or null when the company has no site address or the site does not say. "Revalidate
 * Pages" asks it after a press until the answer is newer than the press, and then says the site is updated (Liz,
 * 09.11.2026: "שהאתר יתעדכן יותר מהר" - a build takes about 30 s, and nobody could tell when it was live).
 */
export async function getSiteBuiltAt(): Promise<ActionResult<{ builtAt: string | null }>> {
  try {
    const { company } = await requireCompany("tours");
    if (!company.siteUrl) return { success: true, data: { builtAt: null } };
    const res = await fetch(`${company.siteUrl.replace(/\/$/, "")}/api/build/`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { success: true, data: { builtAt: null } };
    const body = (await res.json()) as { builtAt?: unknown };
    const builtAt = typeof body.builtAt === "string" && !Number.isNaN(Date.parse(body.builtAt)) ? body.builtAt : null;
    return { success: true, data: { builtAt } };
  } catch (e) {
    return failure(e, "Failed to read the site's build");
  }
}
