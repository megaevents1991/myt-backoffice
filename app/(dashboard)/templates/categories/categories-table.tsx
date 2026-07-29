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
import { Edit, Trash2, Search } from "lucide-react";
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) =>
      [c.name, c.slug, c.sport]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
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
                <TableCell>{c.name}</TableCell>
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
