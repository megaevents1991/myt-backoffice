/**
 * Plumbing the company-level tours actions share: the site content
 * (tours-content-actions.ts), the leads inbox (tours-leads-actions.ts), the
 * company settings (tours-settings-actions.ts) and "Publish to site"
 * (lib/tours/site-publish.ts). The company's people are managed on the Users
 * screen (lib/actions/user-actions.ts), which uses companyAudit from here.
 *
 * Not a "use server" module: it exports constants and takes a Company, so
 * nothing here may become an action a browser can call. Server code only.
 */
import type { z } from "zod";

import type { Company } from "@/lib/company";
import type { Json } from "@/types/database.types";
import type { SitePublishRecord } from "@/components/tours/content/shared";

export type JsonObject = { [key: string]: Json | undefined };

/** A jsonb value as an object - anything else (null, an array, a scalar) reads as {}. */
export const asObject = (value: Json | null | undefined): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

/**
 * The company tag of an audit row. Every tours entry carries `company_id`;
 * `company` (the slug) is kept so older readers of the trail still find it.
 */
export const companyAudit = (company: Company): { company_id: string; company: string } => ({
  company_id: company.id,
  company: company.slug,
});

/** A form the schema refused: its first message, as the action's failure. */
export const invalidInput = (error: z.ZodError): { success: false; error: string } => ({
  success: false,
  error: error.issues[0]?.message ?? "The data entered is invalid",
});

// ---------------------------------------------------------------- publish to site
/** companies.features key of the deploy hook URL - a secret, never sent to the browser. */
export const SITE_DEPLOY_HOOK_KEY = "site_deploy_hook";
/** companies.features key of the last publish attempt. */
export const LAST_SITE_PUBLISH_KEY = "last_site_publish";

/** The deploy hook stored in companies.features, when it is a usable http(s) URL. */
export function siteDeployHookOf(features: JsonObject): string | null {
  const value = features[SITE_DEPLOY_HOOK_KEY];
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * POSTs a deploy hook: the customer site rebuilds from the database. Never throws, and the
 * problem it reports never quotes the error itself - a fetch error can carry the hook URL.
 * Shared by "Publish to site" (lib/tours/site-publish.ts) and the Mega Events feed cron.
 */
export async function postSiteDeployHook(
  hook: string,
  timeoutMs = 20_000,
): Promise<{ status: number | null; problem?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(hook, { method: "POST", cache: "no-store", signal: controller.signal });
    return response.ok
      ? { status: response.status }
      : { status: response.status, problem: `The site server returned ${response.status}` };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    return {
      status: null,
      problem: timedOut ? "The site server did not respond in time" : "Could not reach the site server",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The stored record of a publish attempt, or null when there is none. */
export function publishRecordOf(value: Json | undefined): SitePublishRecord | null {
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
