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
  SITE_DEPLOY_HOOK_KEY,
  asObject,
  companyAudit,
  publishRecordOf,
  type JsonObject,
} from "@/lib/tours/company-kit";
import type { ActionResult, SitePublishRecord, SitePublishStatus } from "@/components/tours/content/shared";

const TIMEOUT_MS = 20_000;

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

function hookOf(features: JsonObject): string | null {
  const value = features[SITE_DEPLOY_HOOK_KEY];
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Whether a deploy hook is configured for the active company, and how the last publish went. */
export async function getSitePublishStatus(): Promise<ActionResult<SitePublishStatus>> {
  try {
    const { company } = await requireCompany("tours");
    const features = await featuresOf(company.id);
    return { success: true, data: { configured: hookOf(features) !== null, last: publishRecordOf(features[LAST_SITE_PUBLISH_KEY]) } };
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
    const hook = hookOf(await featuresOf(company.id));
    if (!hook) {
      return {
        success: false,
        error: "Site connection not set up (deploy hook). A company admin sets it up in Settings.",
      };
    }

    let status: number | null = null;
    let problem: string | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(hook, { method: "POST", cache: "no-store", signal: controller.signal });
      status = response.status;
      if (!response.ok) problem = `The site server returned ${response.status}`;
    } catch (e) {
      // never log or return the error text itself - it can carry the hook URL
      problem =
        e instanceof Error && e.name === "AbortError" ? "The site server did not respond in time" : "Could not reach the site server";
    } finally {
      clearTimeout(timer);
    }

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
