"use server";

import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import { applyTagRules } from "@/lib/services/auto-tagger";
import type { TagRule, TagRuleField } from "@/types/taxonomy.types";

// tag_rules isn't in the generated Supabase types - same untyped boundary as
// event-taxonomy-actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (t: string) => (supabase as any).from(t);

export type TagRuleWithTag = TagRule & {
  tag_name: string;
  tag_slug: string;
};

export async function listTagRules(): Promise<TagRuleWithTag[]> {
  await requireStaff();
  const { data, error } = await tbl("tag_rules")
    .select("id,tag_id,field,pattern,is_active,created_at,updated_at,event_tags!inner(name,slug)")
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(
    (r: TagRule & { event_tags: { name: string; slug: string } }) => ({
      id: r.id,
      tag_id: r.tag_id,
      field: r.field,
      pattern: r.pattern,
      is_active: r.is_active,
      created_at: r.created_at,
      updated_at: r.updated_at,
      tag_name: r.event_tags.name,
      tag_slug: r.event_tags.slug,
    }),
  );
}

export async function createTagRule(input: {
  tag_id: number;
  field: TagRuleField;
  pattern: string;
}): Promise<void> {
  await requireStaff();
  if (!input.tag_id) throw new Error("Tag is required.");
  if (input.field !== "name" && input.field !== "city")
    throw new Error("Field must be name or city.");
  if (!input.pattern?.trim()) throw new Error("Pattern is required.");
  const { error } = await tbl("tag_rules").insert({
    tag_id: input.tag_id,
    field: input.field,
    pattern: input.pattern.trim(),
    is_active: true,
  });
  if (error) throw error;
}

export async function updateTagRule(
  id: number,
  patch: Partial<Pick<TagRule, "pattern" | "field" | "is_active">>,
): Promise<void> {
  await requireStaff();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.pattern !== undefined) {
    if (!patch.pattern.trim()) throw new Error("Pattern is required.");
    row.pattern = patch.pattern.trim();
  }
  if (patch.field !== undefined) row.field = patch.field;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  const { error } = await tbl("tag_rules").update(row).eq("id", id);
  if (error) throw error;
}

/** Hard delete - tag_rules is backoffice config, not customer data. */
export async function deleteTagRule(id: number): Promise<void> {
  await requireStaff();
  const { error } = await tbl("tag_rules").delete().eq("id", id);
  if (error) throw error;
}

export async function runTagRules(eventIds?: number[]): Promise<{
  eventsScanned: number;
  eventsMatched: number;
  linksAdded: number;
}> {
  await requireStaff();
  return applyTagRules(eventIds);
}
