"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  EyeOff,
  GripVertical,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Star,
  StarOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { refKind, type MergedRow, type RowRef } from "@/lib/homepage/merge";
import { insertInOrder, moveInOrder, pinsForOrder } from "@/lib/homepage/row-edit";
import type { HomepageItemKind, HomepageItemRow } from "@/types/homepage.types";

/** What the board draws for one card (from the site's cards, else the board's own list). */
export type BoardCard = {
  ref: RowRef;
  name: string;
  sub: string | null;
  image: string | null;
  image2?: string | null;
  soldOut?: boolean;
  available?: boolean;
  prioritized?: boolean;
  vip?: boolean;
  rating?: number;
  /** Events: when they were created (the "newest" search sorts by it). */
  createdAt?: string | null;
};

const KIND_LABEL: Record<HomepageItemKind, string> = {
  event: "אירועים",
  artist: "אמנים",
  team: "קבוצות",
  review: "ביקורות",
};

/** A long row shows this many cards until "show all". */
const COLLAPSED = 24;

/** Why a pinned card is not where it was pinned - in staff words. */
const deadReason = (card: BoardCard | undefined, rowKey: string) => {
  if (!card) return "לא באוויר באתר";
  if (refKind(card.ref) === "event") return card.soldOut ? "אזל / לא זמין" : "לא מוצג";
  if (card.available === false) {
    return rowKey === "hero" ? "אין לו אירוע זמין - לא מוצג בהירו" : "אין לו אירוע זמין - מוצג בסוף, לפי שם";
  }
  return "לא מוצג";
};

/**
 * One homepage row as the site will show it: numbered cards in the site's
 * order, pinned ones marked. Drag a card (mouse, touch, or keyboard: focus the
 * handle, Space, arrows, Space), use its arrows, or click its number and type
 * a place - the card is pinned at its new place and every other pinned card
 * keeps the place it shows at (lib/homepage/row-edit.ts). Unpin, hide from the
 * row, add from a search, set the row's length.
 */
export function RowEditor({
  sectionKey,
  label,
  kinds,
  row,
  pins,
  hidden,
  max,
  defaultMax,
  cardOf,
  pickable,
  onPinsChange,
  onHiddenChange,
  onMaxChange,
  onUnprioritize,
  busy,
  emptyHint,
  note,
}: {
  sectionKey: string;
  /** The row's name, for accessible labels. */
  label: string;
  kinds: HomepageItemKind[];
  /** The merged row (lib/homepage/merge); null = the site could not be read - pins only. */
  row: MergedRow | null;
  pins: HomepageItemRow[];
  hidden: RowRef[];
  max: number | null;
  defaultMax: number | null;
  cardOf: (ref: RowRef) => BoardCard | undefined;
  /** Everything that may be added to this row. */
  pickable: BoardCard[];
  onPinsChange: (pins: HomepageItemRow[]) => void;
  onHiddenChange: (hidden: RowRef[]) => void;
  onMaxChange: (max: number | null) => void;
  /** "המבוקשים" only: drop an event's Prioritized flag (immediate, not part of Save). */
  onUnprioritize?: (card: BoardCard) => void;
  busy: boolean;
  emptyHint?: string;
  /** A line under the row (e.g. how many cards a phone shows). */
  note?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addAt, setAddAt] = useState("1");
  const [editingPlace, setEditingPlace] = useState<RowRef | null>(null);

  const pinnedRefs = useMemo(() => new Set(pins.map((p) => `${p.kind}:${p.ref_id}`)), [pins]);

  // What the row shows, in order. Without the site's pools: the pins alone.
  const shown: { ref: RowRef; pinned: boolean }[] = useMemo(() => {
    if (row) return row.cards;
    return [...pins]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ ref: `${p.kind}:${p.ref_id}`, pinned: true }));
  }, [row, pins]);
  const order = useMemo(() => shown.map((c) => c.ref), [shown]);
  const notShown = useMemo(
    () => (row ? [...row.deadPins, ...row.offRange] : []),
    [row],
  );

  /** Write the pins that make the row read `next`, with `moved` pinned too. */
  const commit = (next: RowRef[], moved: RowRef) => {
    const pinned = new Set(shown.filter((c) => c.pinned).map((c) => c.ref));
    pinned.add(moved);
    onPinsChange(pinsForOrder(sectionKey, next, pinned, notShown));
    if (hidden.includes(moved)) onHiddenChange(hidden.filter((r) => r !== moved));
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return;
    commit(moveInOrder(order, from, to), order[from]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
  };

  const pinInPlace = (ref: RowRef) => commit(order, ref);
  const unpin = (ref: RowRef) => {
    const pinned = new Set(shown.filter((c) => c.pinned && c.ref !== ref).map((c) => c.ref));
    onPinsChange(pinsForOrder(sectionKey, order, pinned, notShown.filter((r) => r !== ref)));
  };
  const hide = (ref: RowRef) => {
    if (pinnedRefs.has(ref)) unpin(ref);
    if (!hidden.includes(ref)) onHiddenChange([...hidden, ref]);
  };
  const release = (ref: RowRef) =>
    onPinsChange(pins.filter((p) => `${p.kind}:${p.ref_id}` !== ref));
  const add = (card: BoardCard) => {
    const at = Math.max(1, Math.floor(Number(addAt) || 1)) - 1;
    commit(insertInOrder(order, card.ref, at), card.ref);
    setAddOpen(false);
  };

  const visible = expanded ? shown : shown.slice(0, COLLAPSED);
  const shownSet = useMemo(() => new Set(order), [order]);
  const pickList = useMemo(
    () => pickable.filter((c) => !shownSet.has(c.ref) && kinds.includes(refKind(c.ref) as HomepageItemKind)),
    [pickable, shownSet, kinds],
  );

  return (
    <div className="space-y-2 px-3 py-3" dir="rtl">
      {/* Row toolbar: length + add. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {shown.length} בשורה
          {row ? "" : " (רק הנעוצים - האתר לא נקרא)"}
        </span>
        <span aria-hidden>·</span>
        <label className="flex items-center gap-1">
          כמה להציג
          <Input
            type="number"
            min={1}
            max={200}
            inputMode="numeric"
            className="h-7 w-16 text-center text-xs"
            value={max ?? ""}
            placeholder={defaultMax === null ? "הכל" : String(defaultMax)}
            onChange={(e) => {
              const v = e.target.value.trim();
              const n = Math.floor(Number(v));
              onMaxChange(v === "" || !Number.isFinite(n) || n < 1 ? null : Math.min(n, 200));
            }}
            aria-label={`How many cards "${label}" shows`}
          />
        </label>
        <div className="flex-1" />
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" aria-label={`Add to ${label}`}>
              <Plus className="h-3.5 w-3.5" />
              הוסף
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0" align="start" dir="rtl">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
              <span>במקום</span>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                className="h-7 w-16 text-center text-xs"
                value={addAt}
                onChange={(e) => setAddAt(e.target.value)}
                aria-label="Place to add at"
              />
              <span className="text-muted-foreground">בשורה - ייכנס נעוץ</span>
            </div>
            <Command>
              <CommandInput placeholder="חיפוש בעברית או באנגלית…" />
              <CommandList className="max-h-80">
                <CommandEmpty>אין מה להוסיף.</CommandEmpty>
                {kinds.map((kind) => {
                  const rows = pickList.filter((c) => refKind(c.ref) === kind);
                  if (!rows.length) return null;
                  return (
                    <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
                      {rows.map((c) => (
                        <CommandItem
                          key={c.ref}
                          value={`${c.name} ${c.sub ?? ""} ${c.ref}`}
                          onSelect={() => add(c)}
                          className="gap-2"
                        >
                          <Thumb card={c} className="h-8 w-11" />
                          <span className="min-w-0 flex-1 text-right">
                            <span className="block truncate text-sm">{c.name}</span>
                            {c.sub && (
                              <span className="block truncate text-[11px] text-muted-foreground">{c.sub}</span>
                            )}
                          </span>
                          {c.soldOut && <span className="text-[10px] text-destructive">אזל</span>}
                          {c.available === false && (
                            <span className="text-[10px] text-muted-foreground">לא זמין</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyHint ?? "השורה ריקה כרגע - האתר לא יציג אותה."}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((c) => c.ref)} strategy={rectSortingStrategy}>
            <ol className="flex flex-wrap gap-2">
              {visible.map((c, i) => (
                <SortableCard
                  key={c.ref}
                  index={i}
                  last={order.length - 1}
                  card={cardOf(c.ref)}
                  refId={c.ref}
                  pinned={c.pinned}
                  editingPlace={editingPlace === c.ref}
                  onEditPlace={(on) => setEditingPlace(on ? c.ref : null)}
                  onMove={(to) => move(i, to)}
                  onPin={() => pinInPlace(c.ref)}
                  onUnpin={() => unpin(c.ref)}
                  onHide={() => hide(c.ref)}
                  onUnprioritize={onUnprioritize}
                  busy={busy}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {shown.length > COLLAPSED && (
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "הצג פחות" : `הצג את כל ${shown.length}`}
        </button>
      )}

      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}

      {notShown.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">נעוצים שלא במקומם ({notShown.length}):</span>
          {notShown.map((ref) => {
            const card = cardOf(ref);
            const why = row?.offRange.includes(ref) ? "מעבר לאורך השורה" : deadReason(card, sectionKey);
            return (
              <button
                key={ref}
                type="button"
                onClick={() => release(ref)}
                className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                title={`${why} - לחיצה משחררת את הנעיצה`}
                aria-label={`Release pin ${card?.name ?? ref}`}
              >
                {card?.name ?? ref} · {why}
                <PinOff className="h-3 w-3" aria-hidden />
              </button>
            );
          })}
        </div>
      )}

      {hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">הוסתרו מהשורה ({hidden.length}):</span>
          {hidden.map((ref) => {
            const card = cardOf(ref);
            return (
              <button
                key={ref}
                type="button"
                onClick={() => onHiddenChange(hidden.filter((r) => r !== ref))}
                className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                title="להחזיר לשורה"
                aria-label={`Restore ${card?.name ?? ref}`}
              >
                {card?.name ?? `${ref} (לא באוויר)`}
                <RotateCcw className="h-3 w-3" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Thumb({ card, className }: { card: BoardCard | undefined; className?: string }) {
  if (card && refKind(card.ref) === "review") {
    return card.image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={card.image} alt="" className={cn("shrink-0 rounded-full object-cover", className)} />
    ) : (
      <div className={cn("shrink-0 rounded-full bg-muted", className)} />
    );
  }
  if (!card?.image) return <div className={cn("shrink-0 rounded bg-muted", className)} />;
  if (card.image2) {
    // A fixture: the site draws home crest VS away crest.
    return (
      <div className={cn("flex shrink-0 items-center justify-center gap-0.5 rounded bg-muted p-0.5", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image} alt="" className="h-full w-[45%] object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image2} alt="" className="h-full w-[45%] object-contain" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={card.image} alt="" loading="lazy" className={cn("shrink-0 rounded object-cover", className)} />;
}

function SortableCard({
  index,
  last,
  card,
  refId,
  pinned,
  editingPlace,
  onEditPlace,
  onMove,
  onPin,
  onUnpin,
  onHide,
  onUnprioritize,
  busy,
}: {
  index: number;
  last: number;
  card: BoardCard | undefined;
  refId: RowRef;
  pinned: boolean;
  editingPlace: boolean;
  onEditPlace: (on: boolean) => void;
  onMove: (to: number) => void;
  onPin: () => void;
  onUnpin: () => void;
  onHide: () => void;
  onUnprioritize?: (card: BoardCard) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: refId });
  const [place, setPlace] = useState(String(index + 1));
  const isReview = refKind(refId) === "review";
  const name = card?.name ?? refId;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative flex w-[7.75rem] flex-col overflow-hidden rounded-lg border bg-background text-right shadow-sm",
        pinned ? "border-primary/60 ring-1 ring-primary/30" : "border-border",
        isDragging && "z-20 opacity-80 shadow-xl",
      )}
    >
      {/* The picture is the drag handle (mouse / touch / keyboard: focus it, Space,
          arrows, Space). A click shorter than the drag distance still reaches the
          buttons on it. */}
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag ${name} - place ${index + 1}`}
        className="relative h-[4.5rem] w-full cursor-grab touch-none bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
      >
        {isReview ? (
          <div className="flex h-full items-start gap-1.5 p-1.5">
            <Thumb card={card} className="h-7 w-7" />
            <p className="line-clamp-3 text-[10px] leading-tight text-muted-foreground">{card?.sub}</p>
          </div>
        ) : (
          <Thumb card={card} className="h-full w-full rounded-none" />
        )}
        <GripVertical
          className="absolute bottom-1 left-1 h-3.5 w-3.5 rounded bg-background/80 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        {editingPlace ? (
          <input
            autoFocus
            type="number"
            min={1}
            max={last + 1}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            onBlur={() => onEditPlace(false)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // Never let Enter / Space reach the drag handle around it.
              e.stopPropagation();
              if (e.key === "Enter") {
                const to = Math.floor(Number(place)) - 1;
                if (Number.isFinite(to)) onMove(Math.min(Math.max(to, 0), last));
                onEditPlace(false);
              }
              if (e.key === "Escape") onEditPlace(false);
            }}
            className="absolute right-1 top-1 h-5 w-10 rounded border bg-background text-center font-mono text-[11px]"
            aria-label={`New place for ${name}`}
          />
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={() => {
              setPlace(String(index + 1));
              onEditPlace(true);
            }}
            className={cn(
              "absolute right-1 top-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
              pinned ? "bg-primary text-primary-foreground" : "bg-background/90 text-muted-foreground",
            )}
            title="לחיצה - להקליד מקום חדש"
            aria-label={`Place ${index + 1}${pinned ? ", pinned" : ""} - click to type a new place`}
          >
            {pinned && <Pin className="h-2.5 w-2.5" aria-hidden />}
            {index + 1}
          </button>
        )}
        {card?.prioritized && (
          <span className="absolute left-1 top-1 rounded bg-background/90 p-0.5 text-amber-500" title="Prioritized">
            <Star className="h-3 w-3 fill-current" />
          </span>
        )}
      </div>
      <div className="min-h-[2.4rem] px-1.5 py-1">
        <div className="truncate text-[11px] font-semibold" title={name}>
          {card ? name : <span className="text-destructive">{refId} (לא באוויר)</span>}
        </div>
        {!isReview && card?.sub && (
          <div className="truncate text-[10px] text-muted-foreground" title={card.sub}>
            {card.sub}
          </div>
        )}
        {isReview && card?.rating && (
          <div className="text-[10px] text-amber-500">{"★".repeat(Math.round(card.rating))}</div>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between border-t px-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onMove(index - 1)}
          disabled={index === 0}
          aria-label={`Move ${name} earlier`}
          title="מקום אחד קדימה"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        {pinned ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-primary"
            onClick={onUnpin}
            aria-label={`Unpin ${name}`}
            title="שחרור - הכרטיס חוזר למקום שהחוק האוטומטי נותן לו"
          >
            <PinOff className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onPin}
            aria-label={`Pin ${name} here`}
            title="נעיצה - הכרטיס יישאר במקום הזה"
          >
            <Pin className="h-3.5 w-3.5" />
          </Button>
        )}
        {onUnprioritize && card?.prioritized && !pinned ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => onUnprioritize(card)}
            disabled={busy}
            aria-label={`Remove prioritize from ${name}`}
            title="מוריד את הסימון Prioritized מהאירוע (מיידי, לא חלק מ-Save)"
          >
            <StarOff className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onHide}
          aria-label={`Hide ${name} from this row`}
          title="הסתרה מהשורה הזו בלבד (ב-Save). בשאר האתר הוא נשאר."
        >
          <EyeOff className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onMove(index + 1)}
          disabled={index === last}
          aria-label={`Move ${name} later`}
          title="מקום אחד אחורה"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
