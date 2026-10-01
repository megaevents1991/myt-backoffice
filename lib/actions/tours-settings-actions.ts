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
import type { SessionPayload } from "@/lib/auth/session";
import type { Database, Json } from "@/types/database.types";
import type {
  ActionResult,
  CompanyMemberRow,
  CompanySettingsData,
  CompanySettingsForm,
  DeployHookChange,
  SitePublishRecord,
} from "@/components/tours/content/shared";
import { actionFail } from "@/lib/tours/action-kit";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-settings-actions", fallback);

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type JsonObject = { [key: string]: Json | undefined };

const HOOK_KEY = "site_deploy_hook";
const LAST_KEY = "last_site_publish";
const SETTINGS_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;

const asObject = (value: Json | null | undefined): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value: Json | undefined): string => (typeof value === "string" ? value : "");

const NOT_ADMIN = { success: false as const, error: "Settings are open to company admins only" };
const isAdmin = (session: SessionPayload): boolean => session.role === "superadmin" || session.role === "admin";

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
  defaultCurrency: z.enum(SETTINGS_CURRENCIES, { errorMap: () => ({ message: "Unknown currency" }) }),
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

function toRecord(value: Json | undefined): SitePublishRecord | null {
  const o = asObject(value);
  if (typeof o.at !== "string") return null;
  return {
    at: o.at,
    by: text(o.by),
    status: typeof o.status === "number" ? o.status : null,
    ok: o.ok === true,
    ...(typeof o.error === "string" ? { error: o.error } : {}),
  };
}

async function membersOf(company: Company): Promise<CompanyMemberRow[]> {
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

async function load(company: Company): Promise<{ row: CompanyRow; settings: CompanySettingsData }> {
  const [{ data: row, error }, members] = await Promise.all([
    supabaseTyped.from("companies").select("*").eq("id", company.id).single(),
    membersOf(company),
  ]);
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
      deployHookSet: typeof features[HOOK_KEY] === "string" && features[HOOK_KEY] !== "",
      lastPublish: toRecord(features[LAST_KEY]),
      members,
    },
  };
}

export async function getCompanySettings(): Promise<ActionResult<CompanySettingsData>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isAdmin(session)) return NOT_ADMIN;
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
    if (!isAdmin(session)) return NOT_ADMIN;
    const parsed = settingsSchema.safeParse(form);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "The data entered is invalid" };
    }
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
      nextFeatures = { ...features, [HOOK_KEY]: url };
      hookChange = features[HOOK_KEY] ? "replaced" : "set";
    } else if (hook.action === "clear" && features[HOOK_KEY] !== undefined) {
      nextFeatures = { ...features };
      delete nextFeatures[HOOK_KEY];
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
      if (key === "features") changes.site_deploy_hook = { from: features[HOOK_KEY] ? "set" : "unset", to: hookChange };
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
        metadata: { company: company.slug },
      });
      // the company name and site address show in the top bar and in every tours screen
      revalidatePath("/", "layout");
    }
    return { success: true, data: (await load(company)).settings };
  } catch (e) {
    return failure(e, "Failed to save settings");
  }
}
