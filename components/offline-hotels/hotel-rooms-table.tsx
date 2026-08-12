"use client";

import { useState, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { ExternalLink, ChevronRight, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { updateOfflineHotelRoom } from "@/lib/actions/offline-hotel-room-actions";
import type { OfflineHotelRoom } from "@/types/offline-hotel.types";
import type { InventoryReservation } from "@/lib/actions/reservation-actions";

type EditableField = "order_no" | "acc_no" | "supplier";

const NONE = "__none__";

function reservationLabel(r: InventoryReservation): string {
  const name = `${r.main_contact_first_name ?? ""} ${r.main_contact_last_name ?? ""}`.trim();
  return name ? `${r.id} · ${name}` : String(r.id);
}

function InlineField({
  room, field, label, placeholder, onSaved,
}: {
  room: OfflineHotelRoom;
  field: EditableField;
  label: string;
  placeholder: string;
  onSaved: (room: OfflineHotelRoom) => void;
}) {
  const [value, setValue] = useState(room[field] ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = value.trim() || null;
    if (next === (room[field] ?? null)) return; // no change
    setSaving(true);
    try {
      const updated = await updateOfflineHotelRoom(room.id, { [field]: next });
      onSaved(updated);
      toast.success(`Room ${room.id} ${field.replace("_", " ")} saved`);
    } catch (e) {
      toast.error((e as Error)?.message || "Save failed");
      setValue(room[field] ?? ""); // revert
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={value}
        placeholder={placeholder}
        disabled={saving}
        className="h-8 tabular-nums"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

// Per-row reservation selector. Picking a reservation links the room and marks
// it Booked (consumes inventory); "None" unlinks and frees the room.
function ReservationCell({
  room, reservations, onSaved,
}: {
  room: OfflineHotelRoom;
  reservations: InventoryReservation[];
  onSaved: (room: OfflineHotelRoom, refresh?: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);

  const onChange = async (val: string) => {
    const reservationId = val === NONE ? null : Number(val);
    setSaving(true);
    try {
      const updated = await updateOfflineHotelRoom(room.id, {
        reservation_id: reservationId,
        is_booked: reservationId !== null,
      });
      onSaved(updated, true);
      toast.success(
        reservationId === null
          ? `Room ${room.id} freed`
          : `Room ${room.id} → reservation ${reservationId}`
      );
    } catch (e) {
      toast.error((e as Error)?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Select
        value={room.reservation_id ? String(room.reservation_id) : NONE}
        disabled={saving}
        onValueChange={onChange}
      >
        <SelectTrigger className="h-8 min-w-[9rem]">
          <SelectValue placeholder="-" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>- None -</SelectItem>
          {reservations.map((r) => (
            <SelectItem key={r.id} value={String(r.id)}>
              {reservationLabel(r)}
            </SelectItem>
          ))}
          {room.reservation_id != null &&
            !reservations.some((r) => r.id === room.reservation_id) && (
              <SelectItem value={String(room.reservation_id)}>
                {room.reservation_id} (released)
              </SelectItem>
            )}
        </SelectContent>
      </Select>
      {room.reservation_id != null && (
        <Link
          href={`/reservations/${room.reservation_id}`}
          className="text-primary hover:text-primary/80"
          title={`Open reservation ${room.reservation_id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export function HotelRoomsTable({
  initialRooms,
  reservations,
}: {
  initialRooms: OfflineHotelRoom[];
  reservations: InventoryReservation[];
}) {
  const router = useRouter();
  const [rooms, setRooms] = useState(initialRooms);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const onSaved = (u: OfflineHotelRoom, refresh = false) => {
    setRooms((rs) => rs.map((r) => (r.id === u.id ? u : r)));
    if (refresh) router.refresh(); // booking change → resync summary + price
  };

  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Jump-to-room: a "#room-<id>" hash (from a reservation chip) expands that
  // room and scrolls it into view. Listens for both initial load and changes.
  useEffect(() => {
    const handleHash = () => {
      const match = window.location.hash.match(/^#room-(\d+)$/);
      if (!match) return;
      const id = Number(match[1]);
      if (!rooms.some((r) => r.id === id)) return;
      setExpanded((s) => new Set(s).add(id));
      // Defer scroll until the expanded row has rendered.
      requestAnimationFrame(() => {
        document.getElementById(`room-${id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [rooms]);

  if (rooms.length === 0) {
    return (
      <p className="text-sm text-muted-foreground px-6 py-4">
        No rooms recorded for this hotel yet. Add them on the Edit page.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>#</TableHead>
          <TableHead>Room Type</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Reservation</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rooms.map((r, i) => {
          const isOpen = expanded.has(r.id);
          return (
            <Fragment key={r.id}>
              <TableRow
                id={`room-${r.id}`}
                className={`cursor-pointer scroll-mt-24 ${r.is_booked ? "bg-muted/30" : ""}`}
                onClick={() => toggle(r.id)}
              >
                <TableCell className="text-muted-foreground">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </TableCell>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{r.room_type}</TableCell>
                <TableCell className="text-right tabular-nums">${Number(r.price).toFixed(2)}</TableCell>
                <TableCell>
                  {r.is_booked
                    ? <Badge variant="secondary">Booked</Badge>
                    : <Badge variant="default" className="bg-green-600 hover:bg-green-600">Available</Badge>}
                </TableCell>
                <TableCell>
                  <ReservationCell room={r} reservations={reservations} onSaved={onSaved} />
                </TableCell>
              </TableRow>

              {isOpen && (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell />
                  <TableCell colSpan={5} className="py-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Meal</span>
                        <p className="text-sm">{r.meal_plan ?? "-"}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Cancel by</span>
                        <p className="text-sm">{r.last_cancellation_date ?? "-"}</p>
                      </div>
                      <InlineField room={r} field="supplier" label="Supplier" placeholder="-" onSaved={onSaved} />
                      <InlineField room={r} field="order_no" label="Order No" placeholder="-" onSaved={onSaved} />
                      <InlineField room={r} field="acc_no" label="Acc No" placeholder="doket…" onSaved={onSaved} />
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
