# Event Taxonomy (Category Tree + Feed Tags) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give events a hierarchical category tree + a curated flat tag pool, assignable per-event and in bulk, with a Shopify-style inline-create multi-select, and expose them to the main app.

**Architecture:** Approach A — four new additive Supabase tables (`event_categories` self-referencing tree, `event_category_links`, `event_tags`, `event_tag_links`). Backoffice writes via server actions; main app reads and builds the tree in memory. Legacy `events.tags` badge and existing `categories` marketing cards are untouched.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service-role server client), shadcn/ui (Command/Popover), Tailwind.

## Global Constraints

- **No test suite** in this repo. Verification gate per task: `npx tsc --noEmit` passes for changed files + browser-preview check for UI. Never claim done without running the gate.
- **No auto-commit** (Dor's rule). Each task ends by staging + reporting; Dor reviews and runs `/commit-push`. Commit-message lines shown are for Dor.
- **No AI co-author line** in any commit.
- **Soft-delete only** — `is_deleted boolean` on taxonomy tables (these are NEW tables, not `events`; boolean is fine here, matching `categories`). Never hard-delete.
- **Supabase:** import shared `@/lib/supabase-server`; check `{ data, error }`; map columns explicitly; no `.select('*')` on hot paths (fine for small admin lists).
- **Auth:** every server action starts with `await requireStaff()` (`@/lib/auth/guards`).
- **FK type:** `events.id` is `bigint` → `event_id bigint`.
- **No RLS** on the new tables (match `categories`; main reads via anon).
- **EventType / pricing / skip-flight untouched.**

---

## Phase 1 — Backoffice (shippable alone)

### Task 1: Migration + regenerated DB types

**Files:**
- Create: `supabase/migrations/<timestamp>_event_taxonomy.sql` (via `npm run db:new event_taxonomy`)
- Modify (generated): `types/database.types.ts`

**Interfaces:**
- Produces tables: `event_categories`, `event_category_links`, `event_tags`, `event_tag_links`.

- [ ] **Step 1: Create migration file**

Run: `npm run db:new event_taxonomy`

- [ ] **Step 2: Write the SQL**

```sql
-- Event taxonomy: hierarchical category tree + curated flat tag pool.
-- Additive. Does NOT touch legacy events.tags badge or the categories cards.

create table if not exists event_categories (
  id             bigint generated always as identity primary key,
  parent_id      bigint references event_categories(id) on delete restrict,
  slug           text not null unique,
  name           text not null,
  name_english   text,
  image_url      text,
  description    text,
  display_order  integer not null default 0,
  is_active      boolean not null default true,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_event_categories_parent on event_categories(parent_id);
create index if not exists idx_event_categories_slug on event_categories(slug);
create index if not exists idx_event_categories_active on event_categories(is_active) where is_deleted = false;
create index if not exists idx_event_categories_order on event_categories(display_order);

create table if not exists event_category_links (
  event_id     bigint not null references events(id) on delete cascade,
  category_id  bigint not null references event_categories(id) on delete cascade,
  primary key (event_id, category_id)
);
create index if not exists idx_ecl_category on event_category_links(category_id);

create table if not exists event_tags (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  name           text not null,
  name_english   text,
  is_active      boolean not null default true,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_event_tags_slug on event_tags(slug);
create index if not exists idx_event_tags_active on event_tags(is_active) where is_deleted = false;

create table if not exists event_tag_links (
  event_id  bigint not null references events(id) on delete cascade,
  tag_id    bigint not null references event_tags(id) on delete cascade,
  primary key (event_id, tag_id)
);
create index if not exists idx_etl_tag on event_tag_links(tag_id);
```

- [ ] **Step 3: Apply the migration**

Run: `npm run db:push`
Expected: applies cleanly (4 tables created).

- [ ] **Step 4: Regenerate DB types**

Run: `npm run db:types`
Expected: `types/database.types.ts` now contains the 4 tables.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Stage + report to Dor** (commit msg: `feat(taxonomy): add event category tree + tag tables`)

---

### Task 2: Domain types + slug helper

**Files:**
- Create: `types/taxonomy.types.ts`
- Create: `lib/slug.ts`

**Interfaces:**
- Produces: `EventCategory`, `EventCategoryNode` (with `children`), `EventTag`, `AssignMode`.
- Produces: `slugify(input: string): string`.

- [ ] **Step 1: Write `lib/slug.ts`**

```ts
// URL slug from a display name. Latin → kebab-ascii; non-latin (Hebrew) with no
// ascii left → "cat" fallback (caller appends a uniqueness suffix). Keep simple.
export function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "item";
}
```

- [ ] **Step 2: Write `types/taxonomy.types.ts`**

```ts
export type EventCategory = {
  id: number;
  parent_id: number | null;
  slug: string;
  name: string;
  name_english: string | null;
  image_url: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

// Built in memory from a flat EventCategory[] for tree UI + traversal.
export type EventCategoryNode = EventCategory & { children: EventCategoryNode[] };

export type EventTag = {
  id: number;
  slug: string;
  name: string;
  name_english: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type AssignMode = "add" | "replace";
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Stage + report** (commit msg: `feat(taxonomy): domain types + slug helper`)

---

### Task 3: Server actions

**Files:**
- Create: `lib/actions/event-taxonomy-actions.ts`

**Interfaces:**
- Consumes: `slugify` (Task 2), `EventCategory`/`EventTag`/`AssignMode` (Task 2), `requireStaff` (`@/lib/auth/guards`), `supabase` (`@/lib/supabase-server`).
- Produces:
  - `listCategories(): Promise<EventCategory[]>`
  - `createCategory(input: { name: string; name_english?: string; parent_id?: number | null; image_url?: string; description?: string }): Promise<EventCategory>`
  - `updateCategory(id: number, patch: Partial<Pick<EventCategory,"name"|"name_english"|"parent_id"|"image_url"|"description"|"display_order"|"is_active">>): Promise<void>`
  - `softDeleteCategory(id: number): Promise<void>`
  - `listTags(): Promise<EventTag[]>`
  - `createTag(input: { name: string; name_english?: string }): Promise<EventTag>`
  - `updateTag(id: number, patch: Partial<Pick<EventTag,"name"|"name_english"|"is_active">>): Promise<void>`
  - `softDeleteTag(id: number): Promise<void>`
  - `getEventCategoryIds(eventId: number): Promise<number[]>`
  - `getEventTagIds(eventId: number): Promise<number[]>`
  - `setEventCategories(eventId: number, categoryIds: number[]): Promise<void>`
  - `setEventTags(eventId: number, tagIds: number[]): Promise<void>`
  - `bulkAssignCategories(eventIds: number[], categoryIds: number[], mode: AssignMode): Promise<void>`
  - `bulkAssignTags(eventIds: number[], tagIds: number[], mode: AssignMode): Promise<void>`

- [ ] **Step 1: Write the actions file**

```ts
"use server";

import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import { slugify } from "@/lib/slug";
import type { EventCategory, EventTag, AssignMode } from "@/types/taxonomy.types";

// New tables aren't in generated types yet in some flows — cast the builder.
const tbl = (t: string) => (supabase as any).from(t);

async function uniqueSlug(table: string, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data, error } = await tbl(table).select("id").eq("slug", slug).maybeSingle();
    if (error) throw error;
    if (!data) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

// Reject parent that is self or a descendant (cycle guard).
async function assertNoCycle(id: number, parentId: number | null): Promise<void> {
  if (parentId == null) return;
  if (parentId === id) throw new Error("A category cannot be its own parent.");
  const { data, error } = await tbl("event_categories").select("id,parent_id").eq("is_deleted", false);
  if (error) throw error;
  const byId = new Map<number, number | null>((data ?? []).map((r: any) => [r.id, r.parent_id]));
  let cur: number | null = parentId;
  while (cur != null) {
    if (cur === id) throw new Error("Cannot move a category under its own descendant.");
    cur = byId.get(cur) ?? null;
  }
}

/* ---------- categories ---------- */

export async function listCategories(): Promise<EventCategory[]> {
  await requireStaff();
  const { data, error } = await tbl("event_categories")
    .select("*")
    .eq("is_deleted", false)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventCategory[];
}

export async function createCategory(input: {
  name: string; name_english?: string; parent_id?: number | null;
  image_url?: string; description?: string;
}): Promise<EventCategory> {
  await requireStaff();
  if (!input.name?.trim()) throw new Error("Category name is required.");
  const slug = await uniqueSlug("event_categories", slugify(input.name_english || input.name));
  const { data, error } = await tbl("event_categories")
    .insert({
      name: input.name.trim(),
      name_english: input.name_english ?? null,
      parent_id: input.parent_id ?? null,
      image_url: input.image_url ?? null,
      description: input.description ?? null,
      slug,
      is_active: true,
      is_deleted: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as EventCategory;
}

export async function updateCategory(
  id: number,
  patch: Partial<Pick<EventCategory,
    "name" | "name_english" | "parent_id" | "image_url" | "description" | "display_order" | "is_active">>
): Promise<void> {
  await requireStaff();
  if ("parent_id" in patch) await assertNoCycle(id, patch.parent_id ?? null);
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.name_english !== undefined) row.name_english = patch.name_english;
  if (patch.parent_id !== undefined) row.parent_id = patch.parent_id;
  if (patch.image_url !== undefined) row.image_url = patch.image_url;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.display_order !== undefined) row.display_order = patch.display_order;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  const { error } = await tbl("event_categories").update(row).eq("id", id);
  if (error) throw error;
}

export async function softDeleteCategory(id: number): Promise<void> {
  await requireStaff();
  // Block if it has active children — force the user to move/delete them first.
  const { data: kids, error: kErr } = await tbl("event_categories")
    .select("id").eq("parent_id", id).eq("is_deleted", false).limit(1);
  if (kErr) throw kErr;
  if (kids && kids.length) throw new Error("Move or delete child categories first.");
  const { error } = await tbl("event_categories")
    .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/* ---------- tags ---------- */

export async function listTags(): Promise<EventTag[]> {
  await requireStaff();
  const { data, error } = await tbl("event_tags")
    .select("*").eq("is_deleted", false).order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventTag[];
}

export async function createTag(input: { name: string; name_english?: string }): Promise<EventTag> {
  await requireStaff();
  if (!input.name?.trim()) throw new Error("Tag name is required.");
  const slug = await uniqueSlug("event_tags", slugify(input.name_english || input.name));
  const { data, error } = await tbl("event_tags")
    .insert({
      name: input.name.trim(),
      name_english: input.name_english ?? null,
      slug, is_active: true, is_deleted: false,
    })
    .select().single();
  if (error) throw error;
  return data as EventTag;
}

export async function updateTag(
  id: number,
  patch: Partial<Pick<EventTag, "name" | "name_english" | "is_active">>
): Promise<void> {
  await requireStaff();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.name_english !== undefined) row.name_english = patch.name_english;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  const { error } = await tbl("event_tags").update(row).eq("id", id);
  if (error) throw error;
}

export async function softDeleteTag(id: number): Promise<void> {
  await requireStaff();
  const { error } = await tbl("event_tags")
    .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/* ---------- links (single event) ---------- */

export async function getEventCategoryIds(eventId: number): Promise<number[]> {
  await requireStaff();
  const { data, error } = await tbl("event_category_links")
    .select("category_id").eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.category_id as number);
}

export async function getEventTagIds(eventId: number): Promise<number[]> {
  await requireStaff();
  const { data, error } = await tbl("event_tag_links").select("tag_id").eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.tag_id as number);
}

export async function setEventCategories(eventId: number, categoryIds: number[]): Promise<void> {
  await requireStaff();
  const { error: delErr } = await tbl("event_category_links").delete().eq("event_id", eventId);
  if (delErr) throw delErr;
  if (categoryIds.length) {
    const rows = categoryIds.map((category_id) => ({ event_id: eventId, category_id }));
    const { error } = await tbl("event_category_links").insert(rows);
    if (error) throw error;
  }
}

export async function setEventTags(eventId: number, tagIds: number[]): Promise<void> {
  await requireStaff();
  const { error: delErr } = await tbl("event_tag_links").delete().eq("event_id", eventId);
  if (delErr) throw delErr;
  if (tagIds.length) {
    const rows = tagIds.map((tag_id) => ({ event_id: eventId, tag_id }));
    const { error } = await tbl("event_tag_links").insert(rows);
    if (error) throw error;
  }
}

/* ---------- bulk ---------- */

export async function bulkAssignCategories(
  eventIds: number[], categoryIds: number[], mode: AssignMode
): Promise<void> {
  await requireStaff();
  if (!eventIds.length) return;
  if (mode === "replace") {
    const { error } = await tbl("event_category_links").delete().in("event_id", eventIds);
    if (error) throw error;
  }
  if (!categoryIds.length) return;
  const rows = eventIds.flatMap((event_id) => categoryIds.map((category_id) => ({ event_id, category_id })));
  // upsert to ignore existing (event_id, category_id) pairs on "add".
  const { error } = await tbl("event_category_links").upsert(rows, { onConflict: "event_id,category_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function bulkAssignTags(
  eventIds: number[], tagIds: number[], mode: AssignMode
): Promise<void> {
  await requireStaff();
  if (!eventIds.length) return;
  if (mode === "replace") {
    const { error } = await tbl("event_tag_links").delete().in("event_id", eventIds);
    if (error) throw error;
  }
  if (!tagIds.length) return;
  const rows = eventIds.flatMap((event_id) => tagIds.map((tag_id) => ({ event_id, tag_id })));
  const { error } = await tbl("event_tag_links").upsert(rows, { onConflict: "event_id,tag_id", ignoreDuplicates: true });
  if (error) throw error;
}
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → no errors.
- [ ] **Step 3: Stage + report** (commit msg: `feat(taxonomy): server actions for categories, tags, links, bulk`)

---

### Task 4: `EventTaxonomySelect` combobox (Shopify-style, inline create)

**Files:**
- Create: `components/taxonomy/event-taxonomy-select.tsx`

**Interfaces:**
- Consumes: shadcn `Command`, `Popover`, `Badge`, `Button` (verify present in `components/ui/`); actions `createCategory`/`createTag` (Task 3); types from Task 2.
- Produces: `EventTaxonomySelect` (client component).

Props:
```ts
type Option = { id: number; label: string };
type EventTaxonomySelectProps = {
  kind: "category" | "tag";
  options: Option[];                 // pool (category options are path-labelled)
  value: number[];                   // selected ids
  onChange: (ids: number[]) => void;
  onOptionCreated?: (opt: Option) => void; // parent adds new opt to its pool
};
```

- [ ] **Step 1: Confirm shadcn primitives exist**

Run: `ls components/ui/command.tsx components/ui/popover.tsx components/ui/badge.tsx`
Expected: all exist. If `command.tsx` missing, run `npx shadcn@latest add command popover badge` before proceeding.

- [ ] **Step 2: Write the component**

```tsx
"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createCategory, createTag } from "@/lib/actions/event-taxonomy-actions";

type Option = { id: number; label: string };

export function EventTaxonomySelect({
  kind, options, value, onChange, onOptionCreated,
}: {
  kind: "category" | "tag";
  options: Option[];
  value: number[];
  onChange: (ids: number[]) => void;
  onOptionCreated?: (opt: Option) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const q = query.trim();
  const exists = options.some((o) => o.label.toLowerCase() === q.toLowerCase());

  const handleCreate = async () => {
    if (!q || creating) return;
    setCreating(true);
    try {
      const created = kind === "category"
        ? await createCategory({ name: q })
        : await createTag({ name: q });
      const opt: Option = { id: created.id, label: created.name };
      onOptionCreated?.(opt);
      onChange([...value, created.id]);
      setQuery("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {selected.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
        {selected.map((o) => (
          <Badge key={o.id} variant="secondary" className="gap-1">
            {o.label}
            <button type="button" onClick={() => toggle(o.id)} aria-label={`Remove ${o.label}`}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {kind === "category" ? "Select categories" : "Select tags"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
          <Command shouldFilter>
            <CommandInput placeholder={`Search ${kind}s...`} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>
                {q ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={handleCreate}
                    disabled={creating}
                  >
                    <Plus className="h-4 w-4" /> Create “{q}”
                  </button>
                ) : "No results."}
              </CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.id} value={o.label} onSelect={() => toggle(o.id)}>
                    <Check className={`mr-2 h-4 w-4 ${value.includes(o.id) ? "opacity-100" : "opacity-0"}`} />
                    {o.label}
                  </CommandItem>
                ))}
                {q && !exists && (
                  <CommandItem value={`__create_${q}`} onSelect={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" /> Create “{q}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` → no errors.
- [ ] **Step 4: Stage + report** (commit msg: `feat(taxonomy): shopify-style multi-select with inline create`)

---

### Task 5: Category-tree helper + Taxonomy manager page

**Files:**
- Create: `lib/taxonomy-tree.ts` (shared pure helpers — backoffice + main both use the same logic)
- Create: `app/(dashboard)/event-taxonomy/page.tsx` (server: loads categories)
- Create: `app/(dashboard)/event-taxonomy/taxonomy-manager.tsx` (client: tree CRUD)
- Modify: `components/Sidebar.tsx` (add nav link) — confirm actual sidebar filename first.

**Interfaces:**
- Consumes: `listCategories`, `createCategory`, `updateCategory`, `softDeleteCategory` (Task 3); `EventCategory`, `EventCategoryNode` (Task 2).
- Produces: `buildTree(cats: EventCategory[]): EventCategoryNode[]`, `flattenWithPath(cats: EventCategory[]): { id: number; path: string }[]`, `descendantIds(nodes, id)`.

- [ ] **Step 1: Write `lib/taxonomy-tree.ts`**

```ts
import type { EventCategory, EventCategoryNode } from "@/types/taxonomy.types";

export function buildTree(cats: EventCategory[]): EventCategoryNode[] {
  const byId = new Map<number, EventCategoryNode>();
  cats.forEach((c) => byId.set(c.id, { ...c, children: [] }));
  const roots: EventCategoryNode[] = [];
  byId.forEach((node) => {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sort = (ns: EventCategoryNode[]) => {
    ns.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// "כדורגל › ליגה אנגלית" path label per category, for the multi-select.
export function flattenWithPath(cats: EventCategory[]): { id: number; path: string }[] {
  const byId = new Map<number, EventCategory>(cats.map((c) => [c.id, c]));
  const pathOf = (c: EventCategory): string => {
    const parts: string[] = [c.name];
    let cur = c.parent_id;
    const seen = new Set<number>();
    while (cur != null && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur)!;
      parts.unshift(p.name);
      cur = p.parent_id;
    }
    return parts.join(" › ");
  };
  return cats.map((c) => ({ id: c.id, path: pathOf(c) }));
}
```

- [ ] **Step 2: Write the server page** `app/(dashboard)/event-taxonomy/page.tsx`

```tsx
import { listCategories } from "@/lib/actions/event-taxonomy-actions";
import { TaxonomyManager } from "./taxonomy-manager";

export const dynamic = "force-dynamic";

export default async function EventTaxonomyPage() {
  const categories = await listCategories();
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Event Categories</h1>
      <p className="text-sm text-muted-foreground">
        Hierarchical taxonomy the main app uses to build category pages.
      </p>
      <TaxonomyManager initial={categories} />
    </div>
  );
}
```

- [ ] **Step 3: Write the client manager** `app/(dashboard)/event-taxonomy/taxonomy-manager.tsx`

Renders the tree from `buildTree`. Each node: name, indent by depth, add-child / edit / delete buttons. A dialog form (name, name_english, parent select excluding self+descendants) calls `createCategory` / `updateCategory`; delete calls `softDeleteCategory`. After each mutation, refetch via `listCategories` and update local state. Full component:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  listCategories, createCategory, updateCategory, softDeleteCategory,
} from "@/lib/actions/event-taxonomy-actions";
import { buildTree } from "@/lib/taxonomy-tree";
import type { EventCategory, EventCategoryNode } from "@/types/taxonomy.types";

export function TaxonomyManager({ initial }: { initial: EventCategory[] }) {
  const { toast } = useToast();
  const [cats, setCats] = useState<EventCategory[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EventCategory | null>(null);
  const [form, setForm] = useState({ name: "", name_english: "", parent_id: "" as string });

  const tree = buildTree(cats);
  const refresh = async () => setCats(await listCategories());

  const openNew = (parentId: number | null) => {
    setEditing(null);
    setForm({ name: "", name_english: "", parent_id: parentId != null ? String(parentId) : "" });
    setOpen(true);
  };
  const openEdit = (c: EventCategory) => {
    setEditing(c);
    setForm({ name: c.name, name_english: c.name_english ?? "", parent_id: c.parent_id != null ? String(c.parent_id) : "" });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Name required" }); return; }
    const parent_id = form.parent_id ? Number(form.parent_id) : null;
    try {
      if (editing) {
        await updateCategory(editing.id, { name: form.name, name_english: form.name_english || null, parent_id });
      } else {
        await createCategory({ name: form.name, name_english: form.name_english || undefined, parent_id });
      }
      setOpen(false);
      await refresh();
      toast({ title: "Saved" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  };

  const remove = async (c: EventCategory) => {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      await softDeleteCategory(c.id);
      await refresh();
      toast({ title: "Deleted" });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  };

  const Row = ({ node, depth }: { node: EventCategoryNode; depth: number }) => (
    <>
      <div className="flex items-center gap-2 py-1 border-b" style={{ paddingInlineStart: depth * 20 }}>
        <span className="flex-1">{node.name}{node.name_english ? <span className="text-muted-foreground"> · {node.name_english}</span> : null}</span>
        <Button size="sm" variant="ghost" onClick={() => openNew(node.id)}>+ Sub</Button>
        <Button size="sm" variant="ghost" onClick={() => openEdit(node)}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => remove(node)}>Delete</Button>
      </div>
      {node.children.map((c) => <Row key={c.id} node={c} depth={depth + 1} />)}
    </>
  );

  return (
    <div className="space-y-3">
      <Button onClick={() => openNew(null)}>+ Root category</Button>
      <div className="rounded-md border">
        {tree.length === 0 && <div className="p-4 text-sm text-muted-foreground">No categories yet.</div>}
        {tree.map((n) => <Row key={n.id} node={n} depth={0} />)}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name (Hebrew)</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Name (English)</Label><Input value={form.name_english} onChange={(e) => setForm((f) => ({ ...f, name_english: e.target.value }))} /></div>
            <div>
              <Label>Parent</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.parent_id}
                onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
              >
                <option value="">— Root —</option>
                {cats.filter((c) => !editing || c.id !== editing.id).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Add sidebar nav link** — open the sidebar component (find with `ls components/ | grep -i sidebar`), add a link to `/event-taxonomy` labelled "Categories / קטגוריות" following the existing link pattern.

- [ ] **Step 5: Verify in browser**

Start dev server (preview_start `{name}` from `.claude/launch.json`, or create it). Navigate to `/event-taxonomy`. Create a root ("כדורגל"), a sub ("ליגה אנגלית"). Confirm nesting renders, edit + delete work. Check `read_console_messages` for errors.

- [ ] **Step 6: Type-check + stage + report** (commit msg: `feat(taxonomy): category tree manager page`)

---

### Task 6: Tags manager page

**Files:**
- Create: `app/(dashboard)/event-tags/page.tsx`
- Create: `app/(dashboard)/event-tags/tags-manager.tsx`
- Modify: sidebar (add link `/event-tags`)

**Interfaces:**
- Consumes: `listTags`, `createTag`, `updateTag`, `softDeleteTag` (Task 3); `EventTag` (Task 2).

- [ ] **Step 1: Server page** — mirror Task 5 Step 2 but load `listTags()` and render `<TagsManager initial={tags} />`.

- [ ] **Step 2: Client `tags-manager.tsx`** — a flat list: input + "Add" creates a tag (`createTag`), each row has inline rename (`updateTag`) + delete (`softDeleteTag`). Refetch via `listTags` after each mutation. (Structure parallels Task 5 without the tree/parent.)

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { listTags, createTag, softDeleteTag } from "@/lib/actions/event-taxonomy-actions";
import type { EventTag } from "@/types/taxonomy.types";

export function TagsManager({ initial }: { initial: EventTag[] }) {
  const { toast } = useToast();
  const [tags, setTags] = useState<EventTag[]>(initial);
  const [name, setName] = useState("");
  const refresh = async () => setTags(await listTags());

  const add = async () => {
    if (!name.trim()) return;
    try { await createTag({ name }); setName(""); await refresh(); toast({ title: "Added" }); }
    catch (e) { toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" }); }
  };
  const remove = async (t: EventTag) => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try { await softDeleteTag(t.id); await refresh(); } catch { toast({ variant: "destructive", title: "Error" }); }
  };

  return (
    <div className="space-y-3 max-w-md">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}>Add</Button>
      </div>
      <div className="rounded-md border">
        {tags.length === 0 && <div className="p-4 text-sm text-muted-foreground">No tags yet.</div>}
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1 px-2 border-b">
            <span className="flex-1">{t.name}</span>
            <Button size="sm" variant="ghost" onClick={() => remove(t)}>Delete</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar link + browser verify + type-check + stage** (commit msg: `feat(taxonomy): tag manager page`)

---

### Task 7: Event editor + new-event flow integration

**Files:**
- Modify: `app/(dashboard)/events/[id]/page.tsx` (edit + new share this page — confirm the `[id] === "new"` branch it already has at lines ~210–248)

**Interfaces:**
- Consumes: `EventTaxonomySelect` (Task 4); `listCategories`, `listTags`, `getEventCategoryIds`, `getEventTagIds`, `setEventCategories`, `setEventTags` (Task 3); `flattenWithPath` (Task 5).

- [ ] **Step 1: Load pools + current selections**

In the page's data-loading effect: fetch `listCategories()` + `listTags()` into state (`catOptions` = `flattenWithPath(...)` mapped to `{id,label:path}`, `tagOptions` = tags mapped to `{id,label:name}`). When editing an existing event, also fetch `getEventCategoryIds(id)` / `getEventTagIds(id)` into `selectedCatIds` / `selectedTagIds`. For the "new" branch, both start `[]`.

- [ ] **Step 2: Render the two selects** next to the existing Tag badge block (near line 1795):

```tsx
<div className="space-y-2">
  <Label>Categories</Label>
  <EventTaxonomySelect
    kind="category"
    options={catOptions}
    value={selectedCatIds}
    onChange={setSelectedCatIds}
    onOptionCreated={(o) => setCatOptions((p) => [...p, o])}
  />
</div>
<div className="space-y-2">
  <Label>Tags (feed / promo)</Label>
  <EventTaxonomySelect
    kind="tag"
    options={tagOptions}
    value={selectedTagIds}
    onChange={setSelectedTagIds}
    onOptionCreated={(o) => setTagOptions((p) => [...p, o])}
  />
</div>
```

- [ ] **Step 3: Persist links on save**

In the existing save handler, AFTER the event row is created/updated and its numeric id is known (`savedId`), call:
```tsx
await setEventCategories(savedId, selectedCatIds);
await setEventTags(savedId, selectedTagIds);
```
For the "new" flow this runs after the insert returns the id. Wrap in the existing try/catch; on error show the existing error toast.

- [ ] **Step 4: Browser verify** — edit an event: assign categories + tags, inline-create one of each, save, reload, confirm they persist (re-fetch shows them). Create a NEW event with categories/tags, save, confirm links written. Check console.

- [ ] **Step 5: Type-check + stage + report** (commit msg: `feat(taxonomy): categories + tags on event editor and create flow`)

---

### Task 8: Bulk assign on events table

**Files:**
- Modify: `app/(dashboard)/events/events-table.tsx`

**Interfaces:**
- Consumes: `bulkAssignCategories`, `bulkAssignTags` (Task 3); `EventTaxonomySelect` (Task 4); `listCategories`/`listTags` + `flattenWithPath`.

- [ ] **Step 1: Load pools** into table state on mount (same mapping as Task 7).

- [ ] **Step 2: Add two toolbar buttons** shown when `selectedIds.length > 0` (beside the existing bulk markup/delete controls near lines 447–465): "Assign categories" / "Assign tags" → open a dialog.

- [ ] **Step 3: Dialog** with an `EventTaxonomySelect` + a mode radio (`add` / `replace`) + Apply. Apply calls:
```tsx
await bulkAssignCategories(selectedIds, chosenIds, mode); // or bulkAssignTags
toast({ title: "Assigned", description: `${selectedIds.length} event(s).` });
```
`selectedIds` already exists (line ~660). No local Event mutation needed (links aren't Event columns) — just toast + close.

- [ ] **Step 4: Browser verify** — select several events, Assign categories (add), confirm no error; open one event editor and confirm the category is present. Test replace mode. Check console.

- [ ] **Step 5: Type-check + stage + report** (commit msg: `feat(taxonomy): bulk assign categories + tags on events table`)

---

### Task 9: Cross-project docs

**Files:**
- Modify: `CLAUDE.md` (shared-tables table + cross-project rule), `.claude/rules/cross-project.md`

- [ ] **Step 1** Add the 4 tables to the shared-tables list: backoffice writes `event_categories`, `event_category_links`, `event_tags`, `event_tag_links`; main reads them. Note the new `types/taxonomy.types.ts` ↔ main `lib/taxonomy.types.ts` sync pair.
- [ ] **Step 2** Stage + report (commit msg: `docs(taxonomy): document new shared taxonomy tables`)

---

## Phase 2 — Main app (`../myt-main`, separate session/PR)

Reads what Phase 1 writes. Own plan when Phase 1 is merged. Sketch:

- Copy `types/taxonomy.types.ts` → `lib/taxonomy.types.ts`; copy `lib/taxonomy-tree.ts` (pure, no server imports).
- `lib/taxonomy.ts`: `getCategoryTree()`, `getCategoryBySlug()`, `getAncestors()`, `getEventsInCategory(slug,{includeDescendants})` (resolve descendant ids via `buildTree`, then query `event_category_links`), `getEventsByTag(slug)`.
- Dynamic `app/c/[...slug]/page.tsx` catch-all rendering any node + its events.
- Feed: target events by tag/branch.

---

## Self-Review

**Spec coverage:**
- Tree table + junction → Task 1. ✓
- Tag pool + junction → Task 1. ✓
- Ancestor inference at query time → `buildTree`/`flattenWithPath` (Task 5), consumed by main (Phase 2). Backoffice stores direct links only (Task 3 `setEventCategories`). ✓
- In-memory traversal → Task 5. ✓
- Curated tag pool → Tasks 3/6. ✓
- `EventTaxonomySelect` inline-create, 3 usages → Tasks 4/7/8. ✓
- Event editor + new-event flow parity → Task 7. ✓
- Bulk assign add/replace → Tasks 3/8. ✓
- Managers → Tasks 5/6. ✓
- Types + cross-project docs → Tasks 2/9. ✓
- No RLS / no seed / legacy untouched → constraints + Task 1. ✓

**Placeholder scan:** No TBD/TODO. Task 5 Step 4 and Task 7 reference existing files by content (sidebar filename, `[id]==="new"` branch) — execution confirms exact lines with grep first. Acceptable (integration into unknown existing code).

**Type consistency:** action names, `EventTaxonomySelect` prop shape, `Option`, `AssignMode` consistent across Tasks 3/4/7/8. `flattenWithPath` return `{id,path}` mapped to `{id,label}` at call sites. ✓
