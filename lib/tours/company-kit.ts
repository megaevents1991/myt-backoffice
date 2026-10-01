/**
 * Plumbing the company-level tours actions share: the site content
 * (tours-content-actions.ts), the leads inbox (tours-leads-actions.ts), the
 * company settings and members (tours-settings-actions.ts,
 * tours-members-actions.ts) and "Publish to site" (lib/tours/site-publish.ts).
 *
 * Not a "use server" module: it exports constants and takes a Company, so
 * nothing here may become an action a browser can call. Server code only.
 */
import type { z } from "zod";

import type { Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import type { Json } from "@/types/database.types";
import type { CompanyMemberRow, SitePublishRecord } from "@/components/tours/content/shared";

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

// ---------------------------------------------------------------- members
/** The accounts assigned to the company (public.company_members), by name. */
export async function companyMembersOf(company: Company): Promise<CompanyMemberRow[]> {
  const { data, error } = await supabaseTyped
    .from("company_members")
    .select("user_id, role, user_profiles!inner(email, display_name, is_active)")
    .eq("company_id", company.id);
  if (error) throw error;
  return (data ?? [])
    .map((m) => {
      const profile = m.user_profiles as unknown as { email: string; display_name: string | null; is_active: boolean };
      return {
        userId: m.user_id,
        name: profile.display_name || profile.email,
        email: profile.email,
        role: m.role,
        isActive: profile.is_active,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}
