"use server";

/**
 * The Content tab of a departure card: what this date says instead of its season and its tour page (Alon 10.11 - see
 * lib/tours/departure-content.ts). Kept in tours.departures.data.ownContent, so a published date takes it as it is: it
 * changes nothing a date needs to be published. The site reads it on its next build (Revalidate Pages) and live, with
 * the date's sales data (/api/departures).
 */
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { requireCompany } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, must, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit, invalidInput } from "@/lib/tours/company-kit";
import {
  CONTENT_FIELDS,
  EMPTY_DEPARTURE_CONTENT,
  readOwnContent,
  storedOwnContent,
  type DepartureContentData,
  type DepartureContentForm,
} from "@/lib/tours/departure-content";
import type { Json } from "@/types/database.types";

const fail = (e: unknown) => actionFail(e, "tours-departure-content-actions");

const list = (max: number, each: number) => z.array(z.string().max(each)).max(max);
// the limits of a season's own fields (tours-season-actions.ts)
const contentSchema = z.object({
  descriptionHtml: z.string().max(200_000),
  attractions: list(100, 300),
  included: list(100, 500),
  notIncluded: list(100, 500),
  heroImage: z.string().max(1000),
  gallery: list(60, 1000),
});

type Row = { id: string; code: string; package_id: string; season_id: string | null; data: unknown };

async function loadContent(companyId: string, siteUrl: string | null, row: Row): Promise<DepartureContentData> {
  const db = toursDb();
  const [pkg, season] = await Promise.all([
    db
      .from("packages")
      .select("description_html, attractions, included, not_included, hero_image, gallery")
      .eq("company_id", companyId)
      .eq("id", row.package_id)
      .maybeSingle(),
    row.season_id
      ? db
          .from("package_seasons")
          .select("name, description_html, attractions, included, not_included, hero_image, gallery")
          .eq("company_id", companyId)
          .eq("id", row.season_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const p = must(pkg);
  const s = must(season) as {
    name: string;
    description_html: string | null;
    attractions: string[] | null;
    included: string[] | null;
    not_included: string[] | null;
    hero_image: string | null;
    gallery: string[] | null;
  } | null;
  const formOf = (r: typeof s): DepartureContentForm =>
    r
      ? {
          descriptionHtml: r.description_html ?? "",
          attractions: r.attractions ?? [],
          included: r.included ?? [],
          notIncluded: r.not_included ?? [],
          heroImage: r.hero_image ?? "",
          gallery: r.gallery ?? [],
        }
      : EMPTY_DEPARTURE_CONTENT;
  return {
    departureId: row.id,
    code: row.code,
    own: readOwnContent(asObject(row.data as never).ownContent),
    season: s ? { name: s.name, content: formOf(s) } : null,
    tour: formOf(p ? { name: "", ...p } : null),
    siteUrl,
  };
}

async function departureRow(companyId: string, id: string): Promise<Row> {
  if (!UUID.test(id)) throw new UserError("Departure not found");
  const row = must(
    await toursDb().from("departures").select("id, code, package_id, season_id, data").eq("company_id", companyId).eq("id", id).maybeSingle(),
  ) as Row | null;
  if (!row) throw new UserError("Departure not found in the active company");
  return row;
}

/** The date's own content, and what each empty field shows instead (its season's, else the tour's). */
export async function getDepartureContent(id: string): Promise<ActionResult<DepartureContentData>> {
  try {
    const { company } = await requireCompany("tours");
    return actionOk(await loadContent(company.id, company.siteUrl, await departureRow(company.id, id)));
  } catch (e) {
    return fail(e);
  }
}

/** Saves what the date says of its own; an empty field goes back to its season's / the tour's. */
export async function saveDepartureContent(id: string, form: DepartureContentForm): Promise<ActionResult<DepartureContentData>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = contentSchema.safeParse(form);
    if (!parsed.success) return invalidInput(parsed.error);
    const row = await departureRow(company.id, id);
    const before = readOwnContent(asObject(row.data as never).ownContent);
    const own = storedOwnContent(parsed.data);
    const data = { ...asObject(row.data as never) };
    if (own) data.ownContent = own;
    else delete data.ownContent;
    must(await toursDb().from("departures").update({ data: data as Json }).eq("company_id", company.id).eq("id", id));
    const after = readOwnContent(own);
    await logAudit({
      action: "update",
      entityType: "tours_departure",
      entityId: id,
      // the trail names the fields that changed, not the texts
      changes: { ownContent: CONTENT_FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) },
      metadata: { ...companyAudit(company), code: row.code },
    });
    return actionOk(await loadContent(company.id, company.siteUrl, { ...row, data }), "Saved - Revalidate Pages updates the site");
  } catch (e) {
    return fail(e);
  }
}
