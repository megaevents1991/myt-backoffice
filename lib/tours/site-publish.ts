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
import type { Json } from "@/types/database.types";
import type { ActionResult, SitePublishRecord, SitePublishStatus } from "@/components/tours/content/shared";

type JsonObject = { [key: string]: Json | undefined };

const HOOK_KEY = "site_deploy_hook";
const LAST_KEY = "last_site_publish";
const TIMEOUT_MS = 20_000;

const asObject = (value: Json | null | undefined): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

function failure(e: unknown, fallback: string): { success: false; error: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith("Forbidden: the active company")) {
    return { success: false, error: "Publish Site is available only in a company that sells tours. Switch companies in the top bar." };
  }
  if (message === "Unauthorized") return { success: false, error: "You don't have permission to do this" };
  console.error(`${fallback}:`, message);
  return { success: false, error: fallback };
}

async function featuresOf(companyId: string): Promise<JsonObject> {
  const { data, error } = await supabaseTyped.from("companies").select("features").eq("id", companyId).single();
  if (error) throw error;
  return asObject(data.features);
}

function toRecord(value: Json | undefined): SitePublishRecord | null {
  const o = asObject(value);
  if (typeof o.at !== "string") return null;
  return {
    at: o.at,
    by: typeof o.by === "string" ? o.by : "",
    status: typeof o.status === "number" ? o.status : null,
    ok: o.ok === true,
    ...(typeof o.error === "string" ? { error: o.error } : {}),
  };
}

function hookOf(features: JsonObject): string | null {
  const value = features[HOOK_KEY];
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
    return { success: true, data: { configured: hookOf(features) !== null, last: toRecord(features[LAST_KEY]) } };
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
      .update({ features: { ...features, [LAST_KEY]: { ...record, by_id: session.sub } } })
      .eq("id", company.id);
    if (error) throw error;

    await logAudit({
      action: "publish",
      entityType: "company_site",
      entityId: company.id,
      metadata: { company: company.slug, status, ok: record.ok },
    });

    if (problem) return { success: false, error: `The site build did not start: ${problem}` };
    return { success: true, data: record };
  } catch (e) {
    return failure(e, "Failed to publish the site");
  }
}
