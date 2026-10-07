"use client";

/**
 * "Pick from the feedback forms" in the Reviews section of the site editors: the
 * answers customers left on the company's feedback forms, to tick and copy into the
 * section as reviews (lib/tours/form-reviews.ts). Nothing reaches the site by
 * itself: a picked answer becomes an ordinary review of the section, which staff
 * can still edit, and it is saved with the page.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchInput } from "@/components/search-input";
import { cn } from "@/lib/utils";
import { matchesSearch } from "@/lib/search";
import { EmptyLine, Notice, selectClass } from "@/components/tours/ui";
import { getFormReviewCandidates, type FormReviewCandidates } from "@/lib/actions/tours-form-reviews-actions";
import { formReviewRef, type FormReviewCandidate } from "@/lib/tours/form-reviews";

export interface PickedReview {
  name: string;
  text: string;
  rating: number;
  ref: string;
}

const day = (iso: string): string => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "");

const STAR_FILTERS = [
  { value: 5, label: "5 stars only" },
  { value: 4, label: "4 stars and up" },
  { value: 0, label: "Any rating" },
] as const;

function CandidateRow({
  review,
  taken,
  checked,
  disabled,
  onToggle,
}: {
  review: FormReviewCandidate;
  taken: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const long = review.text.length > 220;
  const boxId = `form-review-${review.id}`;
  return (
    <li className={cn("flex items-start gap-3 rounded-md border bg-background p-2", taken && "opacity-60")}>
      <Checkbox id={boxId} checked={taken || checked} disabled={taken || disabled} onCheckedChange={onToggle} className="mt-1" />
      <div className="min-w-0 flex-1 text-sm">
        <label htmlFor={boxId} className="flex flex-wrap items-center gap-x-2">
          <span dir="auto" className="font-medium">
            {review.name || "(no name)"}
          </span>
          {review.rating > 0 && (
            <span className="inline-flex items-center gap-0.5 text-muted-foreground" title={`${review.rating} of 5 stars`}>
              {review.rating}
              <Star className="h-3.5 w-3.5 fill-current" />
            </span>
          )}
          <span className="text-muted-foreground">{day(review.date)}</span>
          {review.trip && (
            <span dir="auto" className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {review.trip}
            </span>
          )}
          {taken && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Already in the reviews</span>}
        </label>
        <p dir="auto" className={cn("whitespace-pre-line text-muted-foreground", !open && "line-clamp-3")}>
          {review.text}
        </p>
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="text-xs font-medium underline">
            {open ? "Show less" : "Show all"}
          </button>
        )}
      </div>
    </li>
  );
}

function PickerDialog({ takenRefs, room, onAdd, onClose }: { takenRefs: string[]; room: number; onAdd: (reviews: PickedReview[]) => void; onClose: () => void }) {
  const [data, setData] = useState<FormReviewCandidates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formId, setFormId] = useState<number | null>(null);
  const [minStars, setMinStars] = useState<number>(4);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    void getFormReviewCandidates(formId).then((result) => {
      if (!alive) return;
      if (result.success) setData(result.data);
      else setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, [formId]);

  const taken = useMemo(() => new Set(takenRefs), [takenRefs]);
  const shown = useMemo(
    () => (data?.candidates ?? []).filter((r) => r.rating >= minStars && matchesSearch(search, r.name, r.text, r.trip)),
    [data, minStars, search],
  );
  const full = picked.length >= room;

  const toggle = (id: number) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const add = () => {
    const byId = new Map((data?.candidates ?? []).map((r) => [r.id, r]));
    // in the order they were ticked: the first one ticked is the first one added
    onAdd(
      picked.flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ name: r.name, text: r.text, rating: r.rating, ref: formReviewRef(r.id) }] : [];
      }),
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[88svh] flex-col sm:max-w-3xl">
        <DialogHeader className="pt-4 text-start sm:text-start">
          <DialogTitle>Pick from the feedback forms</DialogTitle>
          <DialogDescription>
            What customers wrote on the feedback forms. Tick the ones to show on the site: each is copied into the reviews of this section, where you can still
            shorten its text or change the name before saving.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Notice tone="warning">{error}</Notice>
        ) : !data ? (
          <EmptyLine>Loading the answers…</EmptyLine>
        ) : data.formId == null ? (
          <Notice tone="info">No feedback form asks its customers for a free text yet, so there is nothing to pick from.</Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {data.forms.length > 1 && (
                <select
                  aria-label="Feedback form"
                  value={data.formId}
                  onChange={(e) => {
                    setPicked([]);
                    setFormId(Number(e.target.value));
                  }}
                  className={selectClass}
                >
                  {data.forms.map((form) => (
                    <option key={form.id} value={form.id}>
                      {form.title}
                      {form.live ? "" : " (closed)"}
                    </option>
                  ))}
                </select>
              )}
              <select aria-label="Stars" value={minStars} onChange={(e) => setMinStars(Number(e.target.value))} className={selectClass}>
                {STAR_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <SearchInput value={search} onValueChange={setSearch} placeholder="Search by name, text or trip" wrapperClassName="sm:w-[260px]" />
            </div>
            <p className="text-sm text-muted-foreground">
              {shown.length} of the {data.candidates.length} answers with a text ({data.answers} answers in all). Room for {Math.max(0, room - picked.length)} more
              in this section.
            </p>
            {shown.length === 0 ? (
              <EmptyLine>No answer matches. Change the stars or the search.</EmptyLine>
            ) : (
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pe-1">
                {shown.map((review) => (
                  <CandidateRow
                    key={review.id}
                    review={review}
                    taken={taken.has(formReviewRef(review.id))}
                    checked={picked.includes(review.id)}
                    disabled={full && !picked.includes(review.id)}
                    onToggle={() => toggle(review.id)}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={add} disabled={picked.length === 0}>
            {picked.length === 0 ? "Add reviews" : `Add ${picked.length} ${picked.length === 1 ? "review" : "reviews"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The button and its dialog. `takenRefs` = the marks of the reviews already in the
 * section, `room` = how many more it can hold.
 */
export function FormReviewsPicker({ takenRefs, room, onAdd }: { takenRefs: string[]; room: number; onAdd: (reviews: PickedReview[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={room <= 0} title={room <= 0 ? "This section is full. Remove a review first." : undefined}>
        <ClipboardList />
        Pick from the feedback forms
      </Button>
      {open && <PickerDialog takenRefs={takenRefs} room={room} onAdd={onAdd} onClose={() => setOpen(false)} />}
    </>
  );
}
