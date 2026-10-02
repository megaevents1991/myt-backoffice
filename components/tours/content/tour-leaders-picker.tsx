"use client";

/**
 * The group leaders of a tour (packages.instructor_ids), in the order the site
 * lists them under "the leaders of this tour". Picked from the company's group
 * leaders, or created here by name and finished later on the Group Leaders
 * screen. One copy for the tour page and for Create Tour.
 */
import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/hooks/use-action-toast";
import { Chip, EmptyLine, selectClass } from "@/components/tours/ui";
import { RowControls, SiteImage, moved } from "@/components/tours/content/fields";
import { createTourInstructor } from "@/lib/actions/tours-catalog-actions";
import type { LeaderOption } from "@/components/tours/content/shared";

export function TourLeadersPicker({
  value,
  onChange,
  options,
  onOptionCreated,
  siteUrl,
}: {
  value: string[];
  onChange: (leaderIds: string[]) => void;
  options: LeaderOption[];
  /** A leader was created here: the parent adds it to its options. */
  onOptionCreated: (leader: LeaderOption) => void;
  siteUrl: string | null;
}) {
  const run = useActionToast();
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const byId = new Map(options.map((o) => [o.id, o]));
  const available = options.filter((o) => o.isActive && !value.includes(o.id));

  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const res = await run(() => createTourInstructor({ name }), (a) => `Group leader ${a.data.name} added`);
    setCreating(false);
    if (!res.success) return;
    const leader: LeaderOption = { id: res.data.id, name: res.data.name, image: res.data.image, isActive: res.data.isActive };
    if (!byId.has(leader.id)) onOptionCreated(leader);
    if (!value.includes(leader.id)) onChange([...value, leader.id]);
    setNewName("");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${selectClass} min-w-56`}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Group leader"
        >
          <option value="">{available.length ? "Choose a group leader…" : "No other group leaders yet"}</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!pick}
          onClick={() => {
            onChange([...value, pick]);
            setPick("");
          }}
        >
          <Plus />
          Add
        </Button>
        <span className="mx-1 text-xs text-muted-foreground">or</span>
        <Input
          dir="auto"
          className="h-9 w-56"
          placeholder="New group leader's name"
          aria-label="New group leader's name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <Button type="button" variant="ghost" size="sm" disabled={!newName.trim() || creating} onClick={() => void create()}>
          {creating ? <Loader2 className="animate-spin" /> : <UserPlus />}
          New Group Leader
        </Button>
      </div>

      {value.length === 0 ? (
        <EmptyLine>No group leaders on this tour yet.</EmptyLine>
      ) : (
        <ul className="space-y-1.5">
          {value.map((id, index) => {
            const leader = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-3 rounded-md border bg-card p-2">
                <SiteImage siteUrl={siteUrl} path={leader?.image ?? ""} className="h-10 w-10 shrink-0 rounded-full" alt={leader?.name ?? ""} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {leader ? (
                    <Link href={`/tours/instructors/${id}`} className="hover:underline">
                      {leader.name}
                    </Link>
                  ) : (
                    "Unknown group leader"
                  )}
                </span>
                {leader && !leader.isActive && <Chip tone="warning">Inactive - not shown on the site</Chip>}
                <RowControls
                  index={index}
                  count={value.length}
                  onMove={(delta) => onChange(moved(value, index, delta))}
                  onRemove={() => onChange(value.filter((v) => v !== id))}
                  removeLabel="Remove Group Leader"
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        The site lists them on the tour page with their picture and a link to their page. A new group leader gets a page of
        their own: add a picture and a few words on the Group Leaders screen. The leader of each date is set in the date&apos;s
        card.
      </p>
    </div>
  );
}
