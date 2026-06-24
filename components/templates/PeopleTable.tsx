"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
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
import { Edit, Trash2 } from "lucide-react";
import type { Person, PersonKind } from "@/types/person.types";
import * as artist from "@/lib/actions/artist-actions";
import * as football from "@/lib/actions/football-actions";

const api = (kind: PersonKind) =>
  kind === "artists"
    ? { list: artist.getArtists, del: artist.softDeleteArtist, base: "/templates/artists" }
    : { list: football.getFootballTeams, del: football.softDeleteFootballTeam, base: "/templates/football" };

export function PeopleTable({ kind }: { kind: PersonKind }) {
  const a = api(kind);
  const [rows, setRows] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setIsLoading(true);
    a.list()
      .then(setRows)
      .catch(() => toast.error("Could not load."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const handleDelete = (id: number) => {
    if (!confirm("Delete this entry?")) return;
    startTransition(async () => {
      try {
        await a.del(id);
        setRows((prev) => prev.filter((r) => r.id !== id));
        toast.success("Deleted.");
      } catch {
        toast.error("Failed to delete.");
      }
    });
  };

  if (isLoading) return <div>Loading…</div>;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Image</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>English</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Featured</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.image_url ? (
                    <Image src={r.image_url} alt={r.name} width={56} height={36} className="h-9 w-14 rounded object-cover" />
                  ) : (
                    <div className="h-9 w-14 rounded bg-muted" />
                  )}
                </TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{r.name_english ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.slug}</TableCell>
                <TableCell>{r.featured_order ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "outline" : "destructive"}>
                    {r.is_active ? "Active" : "Hidden"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`${a.base}/${r.id}/edit`} title="Edit">
                      <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(r.id)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow><TableCell colSpan={7} className="h-24 text-center">Nothing yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
