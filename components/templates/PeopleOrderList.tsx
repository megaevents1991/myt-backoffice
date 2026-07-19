"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "react-hot-toast";
import { GripVertical, ArrowUp, ArrowDown, Save } from "lucide-react";
import type { Person, PersonKind } from "@/types/person.types";
import * as artist from "@/lib/actions/artist-actions";
import * as football from "@/lib/actions/football-actions";

const api = (kind: PersonKind) =>
  kind === "artists"
    ? { list: artist.getArtists, saveOrder: artist.saveArtistsOrder }
    : { list: football.getFootballTeams, saveOrder: football.saveFootballTeamsOrder };

/**
 * Visual drag-and-drop ordering for the homepage section carousels
 * (אמנים מובילים / כדורגל on myt-main). Position in this list = position in
 * the carousel; on the site, people with an available event still float to the
 * front, keeping this relative order.
 */
export function PeopleOrderList({ kind }: { kind: PersonKind }) {
  const a = api(kind);
  const [rows, setRows] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    setIsLoading(true);
    a.list()
      .then((all) => {
        const active = all.filter((r) => r.is_active);
        active.sort((x, y) => {
          const xo = x.display_order ?? Number.MAX_SAFE_INTEGER;
          const yo = y.display_order ?? Number.MAX_SAFE_INTEGER;
          if (xo !== yo) return xo - yo;
          return x.name.localeCompare(y.name, "he");
        });
        setRows(active);
      })
      .catch(() => toast.error("Could not load."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    setRows((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDirty(true);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        await a.saveOrder(rows.map((r) => r.id));
        setDirty(false);
        toast.success("Order saved. Revalidate the site to apply.");
      } catch {
        toast.error("Failed to save order.");
      }
    });
  };

  if (isLoading) return <div>Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Drag rows (or use the arrows) — top of the list shows first in the
          homepage carousel. People with an available event always jump ahead,
          keeping this relative order.
        </p>
        <Button onClick={handleSave} disabled={!dirty || isPending}>
          <Save className="mr-2 h-4 w-4" />
          {isPending ? "Saving…" : "Save order"}
        </Button>
      </div>
      <ol className="rounded-md border divide-y">
        {rows.map((r, i) => (
          <li
            key={r.id}
            draggable
            onDragStart={() => (dragIndex.current = i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex.current === null || dragIndex.current === i) return;
              move(dragIndex.current, i);
              dragIndex.current = i;
            }}
            onDragEnd={() => (dragIndex.current = null)}
            className="flex items-center gap-3 bg-background p-2 cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="w-8 shrink-0 text-center text-sm font-mono text-muted-foreground">
              {i + 1}
            </span>
            {r.image_url ? (
              <Image
                src={r.image_url}
                alt={r.name}
                width={56}
                height={36}
                className="h-9 w-14 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="h-9 w-14 shrink-0 rounded bg-muted" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
            {r.featured_order != null && (
              <Badge variant="outline" title="Also in the hero carousel">
                Hero #{r.featured_order}
              </Badge>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label="Move down">
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="p-8 text-center text-muted-foreground">Nothing yet.</li>
        )}
      </ol>
    </div>
  );
}
