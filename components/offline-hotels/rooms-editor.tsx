"use client";

import { useState } from "react";
import { Plus, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { NewOfflineHotelRoom } from "@/types/offline-hotel.types";

const ROOM_TYPES = [
  "Standard", "Double", "Twin", "Triple", "Deluxe",
  "Junior Suite", "Suite", "Family Room", "Studio",
] as const;

const MEAL_PLANS = [
  "Room Only", "Bed & Breakfast", "Half Board", "Full Board", "All Inclusive",
] as const;

export type RoomDraft = NewOfflineHotelRoom;

const blankRoom = (): RoomDraft => ({
  room_type: "Double",
  price: 100,
  meal_plan: null,
  last_cancellation_date: null,
  supplier: null,
});

export function RoomsEditor({
  rooms,
  onChange,
}: {
  rooms: RoomDraft[];
  onChange: (rooms: RoomDraft[]) => void;
}) {
  // Template row used to generate / bulk-apply rooms.
  const [template, setTemplate] = useState<RoomDraft>(blankRoom());
  const [genCount, setGenCount] = useState(1);

  const update = (i: number, patch: Partial<RoomDraft>) =>
    onChange(rooms.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const generate = () => {
    const n = Math.max(1, Math.floor(genCount));
    onChange(Array.from({ length: n }, () => ({ ...template })));
  };

  const applyTemplateToAll = () =>
    onChange(rooms.map(() => ({ ...template })));

  const addRoom = () => onChange([...rooms, { ...template }]);
  const removeRoom = (i: number) => onChange(rooms.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {/* Template block */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Room Template</h3>
          <p className="text-xs text-muted-foreground">
            Fill once, generate rooms, then tweak the ones that differ.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Room Type</label>
            <Select value={template.room_type}
              onValueChange={(v) => setTemplate({ ...template, room_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Price (USD)</label>
            <Input type="number" step="1" className="tabular-nums"
              value={template.price}
              onChange={(e) => setTemplate({ ...template, price: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Meal</label>
            <Select value={template.meal_plan ?? "__none__"}
              onValueChange={(v) => setTemplate({ ...template, meal_plan: v === "__none__" ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {MEAL_PLANS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Cancel by</label>
            <Input type="date" value={template.last_cancellation_date ?? ""}
              onChange={(e) => setTemplate({ ...template, last_cancellation_date: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Supplier</label>
            <Input value={template.supplier ?? ""}
              onChange={(e) => setTemplate({ ...template, supplier: e.target.value || null })} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-medium">Generate</label>
            <Input type="number" min={1} className="w-24 tabular-nums" value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))} />
          </div>
          <Button type="button" onClick={generate}>Generate rooms</Button>
          {rooms.length > 0 && (
            <Button type="button" variant="outline" onClick={applyTemplateToAll}>
              <Copy className="mr-2 h-4 w-4" /> Apply template to all
            </Button>
          )}
        </div>
      </div>

      {/* Per-room cards */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Rooms ({rooms.length})</h3>
        <Button type="button" variant="outline" size="sm" onClick={addRoom}>
          <Plus className="mr-2 h-4 w-4" /> Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground border rounded-lg p-4">
          No rooms yet. Fill the template and click “Generate rooms”.
        </p>
      ) : (
        <div className="space-y-2">
          {rooms.map((r, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">Room {i + 1}</span>
                <Button type="button" variant="ghost" size="sm"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => removeRoom(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Select value={r.room_type} onValueChange={(v) => update(i, { room_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" step="1" className="tabular-nums" value={r.price}
                  onChange={(e) => update(i, { price: Number(e.target.value) })} />
                <Select value={r.meal_plan ?? "__none__"}
                  onValueChange={(v) => update(i, { meal_plan: v === "__none__" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {MEAL_PLANS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" value={r.last_cancellation_date ?? ""}
                  onChange={(e) => update(i, { last_cancellation_date: e.target.value || null })} />
                <Input placeholder="Supplier" value={r.supplier ?? ""}
                  onChange={(e) => update(i, { supplier: e.target.value || null })} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
