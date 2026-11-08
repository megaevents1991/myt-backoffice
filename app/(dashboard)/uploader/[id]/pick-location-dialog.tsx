"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { answerWithLocation, listLocationsForQuestion } from "@/lib/actions/uploader-actions";
import { FAR_VENUE_KM } from "@/lib/uploader/constants";
import type { PickableLocation } from "@/lib/uploader/place";
import { matchesSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { UploaderItem } from "@/types/uploader.types";
import { actionErrorText } from "../copy";
import {
  BTN_CANCEL,
  BTN_PICK_LOCATION,
  LOCATION_TASK_OPEN,
  NETWORK_TEXT,
  PICK_LOCATION_DONE,
  PICK_LOCATION_EMPTY,
  PICK_LOCATION_FAR,
  PICK_LOCATION_INTRO,
  PICK_LOCATION_KM,
  PICK_LOCATION_LOADING,
  PICK_LOCATION_NONE,
  PICK_LOCATION_OPEN_FAILED,
  PICK_LOCATION_OTHERS,
  PICK_LOCATION_SAME_CITY,
  PICK_LOCATION_SEARCH,
  PICK_LOCATION_TITLE,
} from "./board-words";
import { rtl } from "./use-run-board";

// "יש לנו מיקום" (08.11, Dor: "לא זיהה שיש מיקום - צריך שאוכל לדייק אותו"): opened from a `create_location` question.
// A supplier's venue coordinates can be wrong (TixStock put Barcelona's stadium at 40, -4 - the middle of Spain, 53 km
// from Madrid), so the build asks for a location we have. The list (`listLocationsForQuestion`) puts the show's city
// first, then the nearest, each with its distance from the venue; a click picks, the button answers
// (`answerWithLocation`: this question and the run's other open location questions of the same city). Nothing is
// written to `locations`.

type Phase = { kind: "loading" } | { kind: "ready"; locations: PickableLocation[]; city: string; others: number };

export function PickLocationDialog({
  item,
  onClose,
  onDone,
}: {
  /** The question the dialog was opened from; null = closed. */
  item: UploaderItem | null;
  onClose: () => void;
  /** After an answer (its toast already shown): the board closes the dialog, reads the run again and wakes the build. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const itemId = item?.id ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickableLocation | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // A (re)opening starts on the wait in the same render - never a frame of the previous list.
  const [openId, setOpenId] = useState<string | null>(null);
  if (itemId !== openId) {
    setOpenId(itemId);
    if (itemId !== null) {
      setPhase({ kind: "loading" });
      setQuery("");
      setPicked(null);
      setProblem(null);
    }
  }

  useEffect(() => {
    if (itemId === null) return;
    const id = ++seq.current;
    const fail = (description: ReactNode) => {
      toast({ variant: "destructive", title: PICK_LOCATION_OPEN_FAILED, description: rtl(description) });
      closeRef.current();
    };
    listLocationsForQuestion(itemId)
      .then((r) => {
        if (id !== seq.current) return;
        if (!r.ok) return fail(actionErrorText(r.kind));
        setPhase({ kind: "ready", locations: r.locations, city: r.city, others: r.others });
        // The show's own city, when we have exactly one row of it, is the likely answer - picked, still confirmed by a click.
        const same = r.locations.filter((l) => l.sameCity);
        setPicked(same.length === 1 ? same[0] : null);
      })
      .catch(() => {
        if (id === seq.current) fail(NETWORK_TEXT);
      });
    return () => {
      seq.current += 1;
    };
  }, [itemId, toast]);

  const ready = phase.kind === "ready" ? phase : null;
  const visible = useMemo(() => {
    if (!ready) return [];
    const q = query.trim();
    return q === "" ? ready.locations : ready.locations.filter((l) => matchesSearch(q, `${l.name} ${l.iata}`));
  }, [ready, query]);
  const far = picked !== null && picked.km !== null && picked.km > FAR_VENUE_KM;

  async function confirm() {
    if (!ready || !picked || saving || itemId === null) return;
    setSaving(true);
    setProblem(null);
    try {
      const r = await answerWithLocation(itemId, picked.id);
      if (!r.ok) {
        setProblem(actionErrorText(r.kind));
        return;
      }
      toast({
        title: PICK_LOCATION_DONE(r.name, r.applied + 1),
        ...(r.task_closed ? {} : { description: rtl(LOCATION_TASK_OPEN) }),
      });
      await onDone();
    } catch {
      setProblem(NETWORK_TEXT);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={itemId !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-lg [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{PICK_LOCATION_TITLE(ready?.city ?? item?.show.city ?? "")}</DialogTitle>
          <DialogDescription>
            {PICK_LOCATION_INTRO}
            {ready && ready.others > 0 && <> {PICK_LOCATION_OTHERS(ready.others, ready.city)}</>}
          </DialogDescription>
        </DialogHeader>

        {!ready ? (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {PICK_LOCATION_LOADING}
          </p>
        ) : ready.locations.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{PICK_LOCATION_EMPTY}</p>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder={PICK_LOCATION_SEARCH}
                aria-label={PICK_LOCATION_SEARCH}
                disabled={saving}
                className="h-8 ps-8 text-[13px]"
              />
            </div>

            <ul role="listbox" aria-label={PICK_LOCATION_SEARCH} className="max-h-64 divide-y overflow-y-auto rounded-md border bg-background text-[13px]">
              {visible.map((l) => {
                const on = picked?.id === l.id;
                return (
                  <li key={l.id} role="option" aria-selected={on}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setPicked(on ? null : l);
                        setProblem(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-start transition-colors duration-150 ease-out focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60",
                        on ? "bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on && <Check aria-hidden className="h-4 w-4 text-primary" />}</span>
                      <bdi className="font-medium">{l.name}</bdi>
                      <bdi dir="ltr" className="text-muted-foreground">
                        {l.iata}
                      </bdi>
                      {l.sameCity && (
                        <span className="rounded bg-success-muted px-1.5 py-0.5 text-[11px] font-medium text-success">{PICK_LOCATION_SAME_CITY}</span>
                      )}
                      {l.km !== null && <span className="ms-auto shrink-0 tabular-nums text-xs text-muted-foreground">{PICK_LOCATION_KM(l.km)}</span>}
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="px-3 py-2 text-muted-foreground">{PICK_LOCATION_NONE}</li>}
            </ul>

            {far && picked && picked.km !== null && (
              <p className="rounded-md bg-warning-muted px-3 py-2 text-[13px] text-warning">{PICK_LOCATION_FAR(picked.name, picked.km)}</p>
            )}
            {problem && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {problem}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {BTN_CANCEL}
          </Button>
          {ready && ready.locations.length > 0 && (
            <Button type="button" disabled={saving || picked === null} onClick={() => void confirm()}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {BTN_PICK_LOCATION(picked?.name ?? null)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
