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
import type { BlogPost } from "@/types/blog.types";
import { getBlogPosts, softDeleteBlogPost } from "@/lib/actions/blog-actions";

export function BlogTable() {
  const [rows, setRows] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const confirm = useConfirm();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.title, r.name, r.by_who, r.slug]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [rows, query]);

  useEffect(() => {
    setIsLoading(true);
    getBlogPosts()
      .then(setRows)
      .catch(() => toast.error("Could not load."))
      .finally(() => setIsLoading(false));
  }, []);

  const handleDelete = async (id: number) => {
    if (
      !(await confirm({
        title: "Delete this post?",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      try {
        await softDeleteBlogPost(id);
        setRows((prev) => prev.filter((r) => r.id !== id));
        toast.success("Deleted.");
      } catch {
        toast.error("Failed to delete.");
      }
    });
  };

  if (isLoading) return <div>Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, author, or slug…"
          className="pl-8"
        />
      </div>
      <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Image</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length > 0 ? (
            filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.image_url ? (
                    <Image src={r.image_url} alt={r.title ?? r.name} width={56} height={36} className="h-9 w-14 rounded object-cover" />
                  ) : (
                    <div className="h-9 w-14 rounded bg-muted" />
                  )}
                </TableCell>
                <TableCell className="font-medium">{r.title ?? r.name}</TableCell>
                <TableCell className="text-muted-foreground">{r.by_who ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.slug}</TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "outline" : "destructive"}>
                    {r.is_active ? "Active" : "Hidden"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/templates/blog/${r.id}/edit`} title="Edit">
                      <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)} disabled={isPending} className="text-red-600 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow><TableCell colSpan={6} className="h-24 text-center">{query ? "No matches." : "Nothing yet."}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
