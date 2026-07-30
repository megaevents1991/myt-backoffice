"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "react-hot-toast";
import { useConfirm } from "@/components/confirm-provider";
import { CornerDownLeft, Edit, Plus, Search, Trash2 } from "lucide-react";
import type { Category } from "@/types/category.types";
import {
  getCategories,
  softDeleteCategory,
} from "@/lib/actions/category-actions";

export function CategoriesTable() {
  const [rows, setRows] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const confirm = useConfirm();

  /**
   * Depth-first order so a sub-category sits under its parent, indented — the
   * flat list gave no clue that /c/sport/football is nested. Searching flattens
   * back to a plain list: matches would otherwise vanish with their parent.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: Category) =>
      [c.name, c.slug, c.sport]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));

    if (q) return rows.filter(matches).map((c) => ({ ...c, depth: 0 }));

    const byParent = new Map<number | null, Category[]>();
    rows.forEach((c) => {
      const key = c.parent_id ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), c]);
    });
    const sortRows = (list: Category[]) =>
      [...list].sort(
        (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)
      );

    const out: (Category & { depth: number })[] = [];
    const walk = (parentId: number | null, depth: number, seen: Set<number>) => {
      for (const c of sortRows(byParent.get(parentId) ?? [])) {
        if (seen.has(c.id)) continue; // survive a corrupt cycle
        seen.add(c.id);
        out.push({ ...c, depth });
        walk(c.id, depth + 1, seen);
      }
    };
    const seen = new Set<number>();
    walk(null, 0, seen);
    // Orphans (parent hidden or deleted) still belong on screen.
    rows.forEach((c) => {
      if (!seen.has(c.id)) out.push({ ...c, depth: 0 });
    });
    return out;
  }, [rows, query]);

  useEffect(() => {
    setIsLoading(true);
    getCategories()
      .then(setRows)
      .catch(() => toast.error("Could not load categories."))
      .finally(() => setIsLoading(false));
  }, []);

  const handleDelete = async (id: number) => {
    if (
      !(await confirm({
        title: "Delete category?",
        description: "The category is removed from the templates list.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      try {
        await softDeleteCategory(id);
        setRows((prev) => prev.filter((c) => c.id !== id));
        toast.success("Category deleted.");
      } catch (error) {
        console.error("Failed to delete category:", error);
        toast.error("Failed to delete category.");
      }
    });
  };

  if (isLoading) return <div>Loading categories...</div>;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, slug, or sport…"
          className="pl-8"
        />
      </div>
      <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Image</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Sport</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length > 0 ? (
            filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  {c.image_url ? (
                    <Image
                      src={c.image_url}
                      alt={c.name}
                      width={64}
                      height={40}
                      className="h-10 w-16 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-16 rounded bg-muted" />
                  )}
                </TableCell>
                <TableCell className="font-medium">{c.id}</TableCell>
                <TableCell>
                  <span
                    className="flex items-center gap-1.5"
                    style={{ paddingInlineStart: c.depth * 18 }}
                  >
                    {c.depth > 0 && (
                      <CornerDownLeft
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    {c.name}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                <TableCell>{c.sport ?? "—"}</TableCell>
                <TableCell>{c.member_ids?.length ?? 0}</TableCell>
                <TableCell>{c.display_order}</TableCell>
                <TableCell>
                  <Badge variant={c.is_active ? "outline" : "destructive"}>
                    {c.is_active ? "Active" : "Hidden"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/templates/categories/new?parent=${c.id}`}
                      title="Add sub-category"
                    >
                      <Button variant="ghost" size="icon">
                        <Plus className="h-4 w-4" />
                        <span className="sr-only">Add sub-category</span>
                      </Button>
                    </Link>
                    <Link href={`/templates/categories/${c.id}/edit`} title="Edit">
                      <Button variant="ghost" size="icon">
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => handleDelete(c.id)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={9} className="h-24 text-center">
                {query ? "No matches." : "No categories yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
