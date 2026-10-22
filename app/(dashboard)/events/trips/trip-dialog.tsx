"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";

import { saveItineraryRoute, searchTripEvents } from "@/lib/actions/itinerary-routes-actions";
import {
  validateItineraryRoute,
  type ItineraryRouteErrors,
  type ItineraryRouteListItem,
  type TripEventLite,
} from "@/lib/itinerary/routes";
import { MAX_TRIP_EVENTS } from "@/lib/itinerary/settings";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

/** An event's day as the screen writes it: DD/MM/YY from "YYYY-MM-DD" (a timestamp reads by its day). */
export function tripDate(date: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "ללא תאריך";
}

/** "DD/MM/YY · place" - the second line of a picker item / chip. */
const dateAndPlace = (e: TripEventLite) => [tripDate(e.date), e.place].filter(Boolean).join(" · ");

/** A trip's event that the database no longer holds: only its id is left. */
type Picked = TripEventLite & { missing?: boolean };

const missingEvent = (id: number): Picked => ({
  id,
  name: `#${id}`,
  date: null,
  is_deleted: null,
  is_hidden: null,
  deactivated_reason: null,
  tags: null,
  place: "",
  missing: true,
});

const initialPicked = (route: ItineraryRouteListItem | null): Picked[] => {
  if (!route) return [];
  const byId = new Map(route.events.map((e) => [e.id, e]));
  return route.eventIds.map((id) => byId.get(id) ?? missingEvent(id));
};

const SEARCH_DEBOUNCE_MS = 300;

/** The server's field errors (typed loosely over the wire) as the form's three. */
const fieldErrorsOf = (raw: Record<string, string> | undefined): ItineraryRouteErrors => ({
  ...(raw?.title ? { title: raw.title } : {}),
  ...(raw?.eventIds ? { eventIds: raw.eventIds } : {}),
  ...(raw?.sortOrder ? { sortOrder: raw.sortOrder } : {}),
});

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * The events picker: a Popover + Command combobox over `searchTripEvents` (upcoming, not deleted; the server
 * does the matching, so cmdk's own filter is off). Debounced; a late answer to an old query is dropped.
 */
function EventPicker({
  picked,
  onPick,
  invalid,
  describedBy,
}: {
  picked: Picked[];
  onPick: (e: TripEventLite) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TripEventLite[]>([]);
  // idle = nothing to search for yet (under 2 characters and not a number), loading, done.
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const full = picked.length >= MAX_TRIP_EVENTS;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 && !/^\d+$/.test(q)) {
      setResults([]);
      setPhase("idle");
      return;
    }
    setPhase("loading");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await searchTripEvents(q);
        if (cancelled) return;
        setResults(found);
        setPhase("done");
      } catch (e) {
        console.error("searchTripEvents failed", e);
        if (cancelled) return;
        setResults([]);
        setPhase("done");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults([]);
      setPhase("idle");
    }
  };

  const emptyText =
    phase === "idle"
      ? "הקלידו לפחות 2 תווים משם האירוע, או את מספר האירוע"
      : phase === "loading"
        ? "מחפש..."
        : "לא נמצאו אירועים עתידיים";

  return (
    // `modal`: inside a Dialog the list would otherwise swallow the mouse wheel (the dialog locks page scroll).
    <Popover open={open} onOpenChange={changeOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-labelledby="trip-events-label"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          disabled={full}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-muted-foreground">
            {full ? `אפשר עד ${MAX_TRIP_EVENTS} אירועים בטריפ` : "חיפוש אירוע לפי שם או מספר..."}
          </span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" dir="rtl">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="שם האירוע (עברית או אנגלית) או מספר..." />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {results.map((e) => {
                const taken = picked.some((p) => p.id === e.id);
                return (
                  <CommandItem
                    key={e.id}
                    value={String(e.id)}
                    disabled={taken}
                    onSelect={() => {
                      onPick(e);
                      changeOpen(false);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">
                        <bdi>{e.name}</bdi>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        <bdi>{dateAndPlace(e)}</bdi>
                      </span>
                    </div>
                    {taken && <Check className="text-muted-foreground" aria-label="כבר בטריפ" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The form itself. Mounted fresh on every open (the dialog unmounts its content), so its state starts from `route`. */
function TripForm({
  route,
  defaultSortOrder,
  onClose,
  onSaved,
}: {
  route: ItineraryRouteListItem | null;
  defaultSortOrder: number;
  onClose: () => void;
  onSaved: (outcome: { created: boolean; warning?: string }) => void;
}) {
  const [title, setTitle] = useState(route?.title ?? "");
  const [picked, setPicked] = useState<Picked[]>(() => initialPicked(route));
  const [sortText, setSortText] = useState(String(route?.sortOrder ?? defaultSortOrder));
  const [isActive, setIsActive] = useState(route?.isActive ?? true);
  const [errors, setErrors] = useState<ItineraryRouteErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** A change clears its own field's message and the save-level one; Save checks everything again. */
  const touched = (field?: keyof ItineraryRouteErrors) => {
    if (field) setErrors((shown) => ({ ...shown, [field]: undefined }));
    setServerError(null);
  };

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (saving) return;
    setServerError(null);
    const checked = validateItineraryRoute({
      ...(route ? { id: route.id } : {}),
      title,
      eventIds: picked.map((e) => e.id),
      sortOrder: sortText.trim() === "" ? Number.NaN : Number(sortText),
      isActive,
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await saveItineraryRoute(checked.route);
      if ("error" in res) {
        setErrors(fieldErrorsOf(res.fieldErrors));
        // The message of a field error already sits under its field; only a general failure gets the banner.
        if (!res.fieldErrors || Object.keys(res.fieldErrors).length === 0) setServerError(res.error);
        return;
      }
      onSaved({ created: !route, warning: res.warning });
    } catch (e) {
      console.error("saveItineraryRoute failed", e);
      setServerError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="trip-title">כותרת</Label>
        <Input
          id="trip-title"
          value={title}
          placeholder="לדוגמה: דון טוליבר והקלאסיקר"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "trip-title-error" : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            touched("title");
          }}
        />
        <FieldError id="trip-title-error" message={errors.title} />
      </div>

      <div className="space-y-1.5">
        <Label id="trip-events-label">אירועים</Label>
        {picked.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {picked.map((e) => {
              const problem = e.missing ? "לא נמצא" : e.is_deleted ? "נמחק" : null;
              return (
                <li
                  key={e.id}
                  className={cn(
                    "flex max-w-full items-center gap-1 rounded-md border bg-muted/50 py-1 ps-3 pe-1",
                    problem && "border-amber-500/60",
                  )}
                >
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">
                      <bdi>{e.name}</bdi>
                    </div>
                    <div className={cn("truncate text-xs", problem ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                      <bdi>{problem ? `${problem} - הסירו אותו` : dateAndPlace(e)}</bdi>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`הסרת ${e.name} מהטריפ`}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setPicked((all) => all.filter((p) => p.id !== e.id));
                      touched("eventIds");
                    }}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <EventPicker
          picked={picked}
          invalid={!!errors.eventIds}
          describedBy={errors.eventIds ? "trip-events-error" : "trip-events-help"}
          onPick={(e) => {
            setPicked((all) => (all.some((p) => p.id === e.id) || all.length >= MAX_TRIP_EVENTS ? all : [...all, e]));
            touched("eventIds");
          }}
        />
        <p id="trip-events-help" className="text-xs text-muted-foreground">
          2 עד {MAX_TRIP_EVENTS} אירועים עתידיים. האתר מסדר אותם לפי תאריך.
        </p>
        <FieldError id="trip-events-error" message={errors.eventIds} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="trip-sort">סדר</Label>
        <Input
          id="trip-sort"
          type="number"
          inputMode="numeric"
          dir="ltr"
          className="max-w-[10rem] text-end"
          step={1}
          value={sortText}
          aria-invalid={errors.sortOrder ? true : undefined}
          aria-describedby={errors.sortOrder ? "trip-sort-help trip-sort-error" : "trip-sort-help"}
          onChange={(e) => {
            setSortText(e.target.value);
            touched("sortOrder");
          }}
        />
        <p id="trip-sort-help" className="text-xs text-muted-foreground">
          מספר נמוך מוצג קודם. שווים - הישן קודם.
        </p>
        <FieldError id="trip-sort-error" message={errors.sortOrder} />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="trip-active">פעיל</Label>
          <p id="trip-active-help" className="text-xs text-muted-foreground">
            כבוי = הטריפ נשמר כאן ולא מוצג באתר.
          </p>
        </div>
        <Switch
          id="trip-active"
          checked={isActive}
          aria-describedby="trip-active-help"
          onCheckedChange={(v) => {
            setIsActive(v);
            touched();
          }}
        />
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          שמירה
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

/** "טריפ חדש" (route = null) and "עריכה" in one dialog. */
export function TripDialog({
  open,
  onOpenChange,
  route,
  defaultSortOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trip being edited; null = a new one. */
  route: ItineraryRouteListItem | null;
  /** What a new trip starts with in "סדר": after the last one. */
  defaultSortOrder: number;
  onSaved: (outcome: { created: boolean; warning?: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-xl overflow-y-auto">
        {/* The dialog's close button sits at the physical right = the title's start in RTL: leave it room. */}
        <DialogHeader className="text-start ps-7 sm:text-start">
          <DialogTitle>{route ? "עריכת טריפ" : "טריפ חדש"}</DialogTitle>
          <DialogDescription>2-3 אירועים שמוצגים יחד בעמוד Build Your Euro Trip, עם כותרת משלכם.</DialogDescription>
        </DialogHeader>
        <TripForm
          key={route?.id ?? "new"}
          route={route}
          defaultSortOrder={defaultSortOrder}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}
