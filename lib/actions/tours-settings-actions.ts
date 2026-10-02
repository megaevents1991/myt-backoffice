"use server";

/**
 * Settings of the active tours company: its row in public.companies (name,
 * site, contact, brand, email, analytics) and the deploy hook that "Publish to
 * site" calls. Company admins and superadmins only.
 *
 * The jsonb columns are merged, never replaced: a key this screen does not
 * edit (a font, a payment setting, the last publish record) stays as it is.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCompany, type Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import type { Database, Json } from "@/types/database.types";
import type {
  ActionResult,
  CompanySettingsData,
  CompanySettingsForm,
  DeployHookChange,
} from "@/components/tours/content/shared";
import { isManagerRole } from "@/components/tours/flights/block-rules";
import { actionFail } from "@/lib/tours/action-kit";
import { ALL_CURRENCIES } from "@/lib/tours/format";
import {
  LAST_SITE_PUBLISH_KEY,
  SITE_DEPLOY_HOOK_KEY,
  asObject,
  companyAudit,
  invalidInput,
  publishRecordOf,
  type JsonObject,
} from "@/lib/tours/company-kit";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-settings-actions", fallback);

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];

const text = (value: Json | undefined): string => (typeof value === "string" ? value : "");

const NOT_ADMIN = { success: false as const, error: "Settings are open to company admins only" };

const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email address");
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "A site URL starts with https://");
const short = z.string().trim().max(500);

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  legalName: short,
  siteUrl: optionalUrl,
  defaultCurrency: z.enum(ALL_CURRENCIES, { errorMap: () => ({ message: "Unknown currency" }) }),
  contact: z.object({
    phone: short,
    whatsapp: short,
    email: optionalEmail,
    address: short,
    hours: z.string().max(2000),
  }),
  brand: z.object({
    logo: z
      .string()
      .trim()
      .max(700)
      .refine((v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v), "A logo URL starts with /media/ or https://"),
    primaryColor: z
      .string()
      .trim()
      .refine((v) => v === "" || /^#[0-9a-fA-F]{6}$/.test(v), "Color must be in #RRGGBB format"),
  }),
  email: z.object({ from: short, replyTo: optionalEmail, leadsInbox: optionalEmail }),
  analytics: z.object({ gtm: short, pixel: short }),
});

/** A deploy hook is https. Plain http is accepted only for a hook on this machine (local testing). */
function validHook(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

/** Set the keys that have a value, remove the ones that were emptied, keep every other key. */
function merged(current: JsonObject, values: Record<string, Json | undefined>): JsonObject {
  const next: JsonObject = { ...current };
  for (const [key, value] of Object.entries(values)) {
    const empty = value === "" || value === undefined || (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
    else next[key] = value;
  }
  return next;
}

async function load(company: Company): Promise<{ row: CompanyRow; settings: CompanySettingsData }> {
  const { data: row, error } = await supabaseTyped.from("companies").select("*").eq("id", company.id).single();
  if (error) throw error;
  const contact = asObject(row.contact);
  const brand = asObject(row.brand);
  const email = asObject(row.email_config);
  const analytics = asObject(row.analytics);
  const features = asObject(row.features);
  const hours = contact.hours;
  return {
    row,
    settings: {
      slug: row.slug,
      form: {
        name: row.name,
        legalName: row.legal_name ?? "",
        siteUrl: row.site_url ?? "",
        defaultCurrency: row.default_currency,
        contact: {
          phone: text(contact.phone),
          whatsapp: text(contact.whatsapp),
          email: text(contact.email),
          address: text(contact.address),
          hours: Array.isArray(hours) ? hours.filter((h) => typeof h === "string").join("\n") : text(hours),
        },
        brand: { logo: text(brand.logo), primaryColor: text(asObject(brand.colors).primary) },
        email: { from: text(email.from), replyTo: text(email.replyTo), leadsInbox: text(email.leadsInbox) },
        analytics: { gtm: text(analytics.gtm), pixel: text(analytics.pixel) },
      },
      // only whether one is stored - the URL itself is a secret and stays on the server
      deployHookSet: typeof features[SITE_DEPLOY_HOOK_KEY] === "string" && features[SITE_DEPLOY_HOOK_KEY] !== "",
      lastPublish: publishRecordOf(features[LAST_SITE_PUBLISH_KEY]),
    },
  };
}

export async function getCompanySettings(): Promise<ActionResult<CompanySettingsData>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isManagerRole(session.role)) return NOT_ADMIN;
    return { success: true, data: (await load(company)).settings };
  } catch (e) {
    return failure(e, "Failed to load settings");
  }
}

export async function saveCompanySettings(
  form: CompanySettingsForm,
  hook: DeployHookChange = { action: "keep" },
): Promise<ActionResult<CompanySettingsData>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isManagerRole(session.role)) return NOT_ADMIN;
    const parsed = settingsSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const input = parsed.data;
    const { row: before } = await load(company);

    const hours = input.contact.hours
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const brandBefore = asObject(before.brand);
    const colors = merged(asObject(brandBefore.colors), { primary: input.brand.primaryColor });
    const features = asObject(before.features);
    let nextFeatures = features;
    let hookChange: string | null = null;
    if (hook.action === "set") {
      const url = validHook(hook.url);
      if (!url) return { success: false, error: "The deploy hook must be a full https URL" };
      nextFeatures = { ...features, [SITE_DEPLOY_HOOK_KEY]: url };
      hookChange = features[SITE_DEPLOY_HOOK_KEY] ? "replaced" : "set";
    } else if (hook.action === "clear" && features[SITE_DEPLOY_HOOK_KEY] !== undefined) {
      nextFeatures = { ...features };
      delete nextFeatures[SITE_DEPLOY_HOOK_KEY];
      hookChange = "cleared";
    }

    const next = {
      name: input.name,
      legal_name: input.legalName || null,
      site_url: input.siteUrl ? input.siteUrl.replace(/\/+$/, "") : null,
      default_currency: input.defaultCurrency,
      contact: merged(asObject(before.contact), {
        phone: input.contact.phone,
        whatsapp: input.contact.whatsapp,
        email: input.contact.email,
        address: input.contact.address,
        hours,
      }),
      brand: merged(brandBefore, { logo: input.brand.logo, colors: Object.keys(colors).length ? colors : undefined }),
      email_config: merged(asObject(before.email_config), {
        from: input.email.from,
        replyTo: input.email.replyTo,
        leadsInbox: input.email.leadsInbox,
      }),
      analytics: merged(asObject(before.analytics), { gtm: input.analytics.gtm, pixel: input.analytics.pixel }),
      features: nextFeatures,
    };

    const update: Record<string, unknown> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (JSON.stringify(before[key]) === JSON.stringify(next[key])) continue;
      update[key] = next[key];
      // the hook URL never reaches the audit trail
      if (key === "features") changes.site_deploy_hook = { from: features[SITE_DEPLOY_HOOK_KEY] ? "set" : "unset", to: hookChange };
      else changes[key] = { from: before[key], to: next[key] };
    }

    if (Object.keys(update).length) {
      const { error } = await supabaseTyped
        .from("companies")
        .update(update as Database["public"]["Tables"]["companies"]["Update"])
        .eq("id", company.id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entityType: "company",
        entityId: company.id,
        changes,
        metadata: companyAudit(company),
      });
      // the company name and site address show in the top bar and in every tours screen
      revalidatePath("/", "layout");
    }
    return { success: true, data: (await load(company)).settings };
  } catch (e) {
    return failure(e, "Failed to save settings");
  }
}
