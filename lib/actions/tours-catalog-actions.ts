"use server";

/**
 * New catalog rows of a tours company (Mega Family): categories and tags
 * (tours.terms), catalog hotels (tours.hotels) and group leaders
 * (tours.instructors).
 *
 * Imported rows are edited in tours-content-actions.ts. These create a new row
 * with what it needs to exist - a name, a unique slug, the next position and,
 * for a hotel, a unique code - and the operator finishes it in the same
 * editors. A name that already exists answers with the existing row instead of
 * a duplicate (with a `warning`), so a picker can send whatever was typed.
 *
 * A new row has no legacy_id (the WordPress id of an imported row) and an
 * empty `data`; the site's content sync fills what its pages need.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCompany } from "@/lib/company";
import { logAudit } from "@/lib/audit";
import { toursDb } from "@/lib/tours/db";
import { actionFail, actionOk, fetchAll, plainFail, type ActionResult } from "@/lib/tours/action-kit";
import { companyAudit, invalidInput } from "@/lib/tours/company-kit";
import { catalogSlug, hotelCode, nameKey, nextPosition, uniqueSlug } from "@/lib/tours/catalog";
import {
  PACKAGE_TERM_KINDS,
  TERM_KIND_LABELS,
  type TermKind,
  type TourHotelPick,
} from "@/components/tours/content/shared";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-catalog-actions", fallback);

/** Postgres unique_violation: another create took the slug or code first. */
const UNIQUE_VIOLATION = "23505";
/** A lost race reads the rows again: the same name returns that row, a taken slug takes the next suffix. */
const INSERT_ATTEMPTS = 3;
const RACE_LOST = "Someone else added a row with the same address at the same moment. Try again.";

const nameField = z
  .string({ invalid_type_error: "Name is required" })
  .trim()
  .min(1, "Name is required")
  .max(300, "The name is too long (300 characters at most)");

// ================================================================ categories & tags
const termInput = z.object({ kind: z.string(), name: nameField });

type TermRow = { id: string; kind: string; slug: string; name: string; position: number; is_active: boolean };
const termOf = (row: Pick<TermRow, "id" | "kind" | "name" | "is_active">) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  isActive: row.is_active,
});

/**
 * A category or tag of a kind a tour can be attached to. Same name in the same
 * kind (any case) -> the existing one.
 */
export async function createTourTerm(input: {
  kind: string;
  name: string;
}): Promise<ActionResult<{ id: string; kind: string; name: string; isActive: boolean }>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = termInput.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const { name } = parsed.data;
    const kind = parsed.data.kind as TermKind;
    if (!PACKAGE_TERM_KINDS.includes(kind)) {
      return plainFail(
        kind === "packages"
          ? "A tour's own term is created with the tour. Choose another kind."
          : "Choose the kind: destination, audience, tag, category, artist or holiday village.",
      );
    }
    const label = TERM_KIND_LABELS[kind];
    const db = toursDb();

    for (let attempt = 1; ; attempt++) {
      const rows: TermRow[] = await fetchAll((from, to) =>
        db
          .from("terms")
          .select("id, kind, slug, name, position, is_active")
          .eq("company_id", company.id)
          .eq("kind", kind)
          .order("id")
          .range(from, to),
      );
      const existing = rows.find((r) => nameKey(r.name) === nameKey(name));
      if (existing) {
        return actionOk(termOf(existing), `"${existing.name}" is already in ${label} - it was not added twice.`);
      }

      const slug = uniqueSlug(catalogSlug(name) || "term", rows.map((r) => r.slug));
      const { data: inserted, error } = await db
        .from("terms")
        .insert({
          company_id: company.id,
          kind,
          slug,
          name,
          position: nextPosition(rows),
          is_active: true,
          legacy_id: null,
          data: {},
        })
        .select("id, kind, name, is_active")
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        if (attempt < INSERT_ATTEMPTS) continue;
        return plainFail(RACE_LOST);
      }
      if (error) throw error;

      await logAudit({
        action: "create",
        entityType: "tours_term",
        entityId: inserted.id,
        changes: { kind, name, slug },
        metadata: { ...companyAudit(company), kind, slug },
      });
      revalidatePath("/tours/terms");
      return actionOk(termOf(inserted));
    }
  } catch (e) {
    return failure(e, "Failed to add the category or tag");
  }
}

// ================================================================ hotels
const hotelInput = z.object({
  name: nameField,
  city: z.string().trim().max(300, "The city is too long").optional(),
  stars: z
    .number()
    .int("Star rating is between 1 and 5")
    .min(1, "Star rating is between 1 and 5")
    .max(5, "Star rating is between 1 and 5")
    .nullable()
    .optional(),
});

const HOTEL_COLUMNS = "id, code, slug, name, city, stars, image, excerpt, content_html, amenities, position";
type HotelRow = {
  id: string;
  code: string;
  slug: string;
  name: string;
  city: string | null;
  stars: number | null;
  image: string | null;
  excerpt: string | null;
  content_html: string | null;
  amenities: string[] | null;
  position: number;
};
const hotelPickOf = (row: HotelRow): TourHotelPick => ({
  id: row.id,
  code: row.code,
  name: row.name,
  city: row.city,
  stars: row.stars,
  image: row.image,
  excerpt: row.excerpt,
  contentHtml: row.content_html,
  amenities: row.amenities ?? [],
});

/** A catalog hotel. Same name (any case) -> the existing one. */
export async function createTourHotel(input: {
  name: string;
  city?: string;
  stars?: number | null;
}): Promise<
  ActionResult<{
    id: string;
    code: string;
    name: string;
    city: string | null;
    stars: number | null;
    image: string | null;
    excerpt: string | null;
    contentHtml: string | null;
    amenities: string[];
  }>
> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = hotelInput.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const { name } = parsed.data;
    const city = parsed.data.city || null;
    const stars = parsed.data.stars ?? null;
    const db = toursDb();

    for (let attempt = 1; ; attempt++) {
      const rows: HotelRow[] = await fetchAll((from, to) =>
        db.from("hotels").select(HOTEL_COLUMNS).eq("company_id", company.id).order("id").range(from, to),
      );
      const existing = rows.find((r) => nameKey(r.name) === nameKey(name));
      if (existing) {
        return actionOk(hotelPickOf(existing), `"${existing.name}" is already in the hotels - it was not added twice.`);
      }

      const slug = uniqueSlug(catalogSlug(name) || "hotel", rows.map((r) => r.slug));
      const code = hotelCode(slug, rows.map((r) => r.code));
      const { data: inserted, error } = await db
        .from("hotels")
        .insert({
          company_id: company.id,
          code,
          slug,
          name,
          city,
          stars,
          position: nextPosition(rows),
          legacy_id: null,
          data: {},
        })
        .select(HOTEL_COLUMNS)
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        if (attempt < INSERT_ATTEMPTS) continue;
        return plainFail(RACE_LOST);
      }
      if (error) throw error;

      await logAudit({
        action: "create",
        entityType: "tours_hotel",
        entityId: inserted.id,
        changes: { name, code, slug, city, stars },
        metadata: { ...companyAudit(company), code },
      });
      revalidatePath("/tours/hotels");
      return actionOk(hotelPickOf(inserted));
    }
  } catch (e) {
    return failure(e, "Failed to add the hotel");
  }
}

// ================================================================ group leaders
const instructorInput = z.object({ name: nameField });

type InstructorRow = { id: string; slug: string; name: string; image: string | null; is_active: boolean; position: number };
const instructorOf = (row: InstructorRow) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  image: row.image,
  isActive: row.is_active,
});

/** A group leader. Same name (any case) -> the existing one. */
export async function createTourInstructor(input: {
  name: string;
}): Promise<ActionResult<{ id: string; name: string; slug: string; image: string | null; isActive: boolean }>> {
  try {
    const { company } = await requireCompany("tours");
    const parsed = instructorInput.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const { name } = parsed.data;
    const db = toursDb();

    for (let attempt = 1; ; attempt++) {
      const rows: InstructorRow[] = await fetchAll((from, to) =>
        db
          .from("instructors")
          .select("id, slug, name, image, is_active, position")
          .eq("company_id", company.id)
          .order("id")
          .range(from, to),
      );
      const existing = rows.find((r) => nameKey(r.name) === nameKey(name));
      if (existing) {
        return actionOk(instructorOf(existing), `"${existing.name}" is already a group leader - it was not added twice.`);
      }

      const slug = uniqueSlug(catalogSlug(name) || "leader", rows.map((r) => r.slug));
      const { data: inserted, error } = await db
        .from("instructors")
        .insert({
          company_id: company.id,
          slug,
          name,
          position: nextPosition(rows),
          is_active: true,
          legacy_id: null,
          data: {},
        })
        .select("id, slug, name, image, is_active, position")
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        if (attempt < INSERT_ATTEMPTS) continue;
        return plainFail(RACE_LOST);
      }
      if (error) throw error;

      await logAudit({
        action: "create",
        entityType: "tours_instructor",
        entityId: inserted.id,
        changes: { name, slug },
        metadata: { ...companyAudit(company), slug },
      });
      revalidatePath("/tours/instructors");
      return actionOk(instructorOf(inserted));
    }
  } catch (e) {
    return failure(e, "Failed to add the group leader");
  }
}
