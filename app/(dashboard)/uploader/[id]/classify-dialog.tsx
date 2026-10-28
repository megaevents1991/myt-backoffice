"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VenueSectionMap } from "@/components/venue-section-map";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { classifyVenue, proposeVenueClassification } from "@/lib/actions/uploader-actions";
import type { ProposeResult } from "@/lib/uploader/action-types";
import {
  CLASSIFY_TIMEOUT_MS,
  parseVenueHeInput,
  readyToConfirm,
  toggleExcludedSection,
  VENUE_HE_MAX,
  ZONE_LABEL_MAX,
  type ClassificationRow,
  type ConfirmedRow,
  type ProposedRow,
} from "@/lib/uploader/classify";
import type { PanelRow } from "@/lib/uploader/run-panel";
import { cn } from "@/lib/utils";
import { actionErrorText } from "../copy";
import { AiWait } from "./ai-wait";
import {
  aiLine,
  BTN_CANCEL,
  BTN_CLOSE,
  BTN_CONFIRM_CLASSIFY,
  CLASSIFY_DESCRIPTION,
  CLASSIFY_DONE,
  CLASSIFY_EMPTY,
  CLASSIFY_FAILED,
  CLASSIFY_OPEN_FAILED,
  CLASSIFY_TITLE,
  COL_CATEGORY,
  COL_DROP,
  COL_LABEL,
  COL_STATUS,
  COL_VENUE_HE,
  DESCRIBE_FAILED_LINE,
  MAP_EXCLUDED_LINE,
  MAP_HINT,
  MAP_PRICES_LINE,
  MAP_TITLE,
  MAP_UNAVAILABLE,
  NETWORK_TEXT,
  PARTIAL_LINE,
  STATUS_AI,
  STATUS_DROPPED,
  STATUS_DROPPED_AI,
  STATUS_DROPPED_STORED,
  STATUS_EXISTING,
  STATUS_KEPT_AGAINST_RULE,
  STATUS_NOT_SOLD,
  STATUS_OFF_MAP,
  STATUS_REVIEW,
  STATUS_RULE_DROP,
  STATUS_SHOWS,
  STATUS_UNSURE,
  VENUE_HE_HINT,
  VENUE_HE_HINT_AI,
  VENUE_HE_NEEDS_HEBREW,
} from "./board-words";
import { rtl } from "./use-run-board";

// "סיווג כרטיסים - <venue>" (spec 5.2): the hall's Hebrew name on top (round 2, D3 - what `{אולם}` prints
// in the event description) and one row per category of the hall - the drawing's and the TixStock
// tickets' of the run - with a Hebrew zone name (the ticket card's title on the site) and a drop switch.
// There is no description box (D4): a zone's stored description stays as it is. Opening asks the AI for a
// proposal (`proposeVenueClassification` - it never fails for the AI's sake: off / timeout / the cap = empty
// boxes and one line above the table); the confirm (`classifyVenue`) writes the venue template and the
// hall's name and rewrites every show of the hall in the run. The confirm sends EVERY row the dialog showed,
// the rows as they were SHOWN before any edit (`proposed` - the server diffs the two for the agent's
// lessons), whether the AI proposed (`ai`), the hall's name (`venueHe`) and the hall's excluded map sections
// (`excludedSections`). Mounted once by the board; every opening is a fresh proposal.
//
// The hall's map (round 2, Task 10 - Alon: "I must see the map"): the drawing beside the table from `md` up, above
// it on a phone (`VenueSectionMap`). Hovering (or focusing) a row lights its category on the map; a click on a
// section EXCLUDES it for every show of the hall - the event editor's exclude-sections look - and the confirm writes
// the list to the venue template and to `tx_excluded_sections` of every ready / approved show of the hall (the
// TixStock price sync re-prices without those listings on its next run).

export type PanelVenue = NonNullable<PanelRow["venue"]>;

/**
 * What a person can change on a row. `aiUnsure`: the AI marked the row unsure - the label it may still
 * have proposed ("Box 12", a latin one) is shown but doubtful, and the row stays "לבדיקה" until a person
 * touches the box (the first edit makes it theirs).
 */
type RowEdit = { label: string; drop: boolean; aiUnsure: boolean };
type Loaded = Extract<ProposeResult, { ok: true }>;
type Phase = { kind: "loading" } | { kind: "ready"; data: Loaded };

/** "לבדיקה" (a kept row): the AI was unsure and nobody touched it, or its Hebrew box is empty - the ticket stays, unzoned, the category stays out of the template. */
const isUnsure = (e: RowEdit): boolean => !e.drop && (e.aiUnsure || e.label.trim() === "");

const editOf = (row: ClassificationRow): RowEdit => ({
  label: row.label_he,
  drop: row.drop,
  aiUnsure: row.unsure && !row.drop,
});

/**
 * The rows exactly as the dialog showed them before any edit, keyed by category key (`classifyVenue`'s `proposed`).
 * The dialog shows no description (round 2, D4), so every row carries "" - what the server's diff compares the
 * confirmed rows' "" with: a zone's stored description is neither edited here nor a lesson.
 */
function shownAsProposed(rows: ClassificationRow[]): Record<string, ProposedRow> {
  return Object.fromEntries(
    rows.map((r): [string, ProposedRow] => [
      r.key,
      { label_he: r.label_he, description_he: "", drop: r.drop, drop_reason: r.drop_reason, unsure: r.unsure },
    ]),
  );
}

/**
 * The row as `classifyVenue` takes it: a dropped or "לבדיקה" row carries no label - an untouched AI-unsure row's
 * doubtful label never becomes a zone. No description (D4): "" makes the server keep the one stored on the zone.
 */
function confirmedOf(row: ClassificationRow, e: RowEdit): ConfirmedRow {
  const named = !e.drop && !isUnsure(e);
  return {
    category: row.category,
    label_he: named ? e.label.trim() : "",
    description_he: "",
    drop: e.drop,
    unsure: isUnsure(e),
  };
}

/** The status column: who said what about the row, as it stands now (an edit can turn an AI row into "לבדיקה"). */
function statusText(row: ClassificationRow, e: RowEdit): string {
  if (e.drop) {
    if (row.drop && row.status === "rule_drop") return STATUS_RULE_DROP;
    if (row.drop && row.status === "existing") return STATUS_DROPPED_STORED;
    if (row.drop && row.status === "ai") return STATUS_DROPPED_AI(row.drop_reason === "away");
    return STATUS_DROPPED;
  }
  const unsure = isUnsure(e) ? (e.aiUnsure ? STATUS_UNSURE : STATUS_REVIEW) : null;
  // The away rule flags the category and it stays - un-dropped now, or kept at an earlier confirm (ruling R22): say so.
  if (row.ruleDrop) return unsure ? `${STATUS_KEPT_AGAINST_RULE} · ${unsure}` : STATUS_KEPT_AGAINST_RULE;
  if (unsure) return unsure;
  if (row.status === "existing" && row.existing) return STATUS_EXISTING(row.existing.label);
  if (row.status === "ai") return STATUS_AI;
  return "";
}

/** Two lists of section ids hold the same ids (order aside). */
function sameSections(a: string[], b: string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((id) => left.has(id));
}

/** Enter in a box moves to the next one; in the last box it confirms (spec 11). */
function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
  e.preventDefault();
  const boxes = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>("input[data-box]:not(:disabled)"));
  const at = boxes.indexOf(e.target);
  if (at === -1) return;
  if (at === boxes.length - 1) e.currentTarget.requestSubmit();
  else boxes[at + 1].focus();
}

export function ClassifyDialog({
  runId,
  venue,
  open,
  onClose,
  onDone,
}: {
  runId: string;
  /** The panel row's hall; null while closed. */
  venue: PanelVenue | null;
  open: boolean;
  onClose: () => void;
  /** After a saved confirm (its toast already shown): the board closes the dialog and reads the run again. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  // The hall's Hebrew name box (round 2, D3): opens with the stored name, else the AI's proposal.
  const [venueHe, setVenueHe] = useState("");
  // The hall's excluded map sections (round 2, Task 10): open with the stored list; a click on the map toggles one.
  const [excluded, setExcluded] = useState<string[]>([]);
  // The row under the pointer (or holding the focus) - its category is lit on the map.
  const [hovered, setHovered] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The hall on screen - kept after `venue` turns null so the dialog closes with its title.
  const [shown, setShown] = useState<PanelVenue | null>(venue);
  if (venue && venue !== shown) setShown(venue);

  const seq = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const sourceUrl = open ? (venue?.sourceUrl ?? null) : null;
  // A (re)opening starts on the wait in the same render - never a frame of the previous hall's table.
  // Closing keeps the table, so the dialog closes with what it showed.
  const [requested, setRequested] = useState<string | null>(null);
  if (sourceUrl !== requested) {
    setRequested(sourceUrl);
    if (sourceUrl !== null) {
      setPhase({ kind: "loading" });
      setEdits({});
      setVenueHe("");
      setExcluded([]);
      setHovered(null);
    }
  }

  useEffect(() => {
    if (sourceUrl === null) return;
    const id = ++seq.current;
    const fail = (description: ReactNode) => {
      toast({ variant: "destructive", title: CLASSIFY_OPEN_FAILED, description: rtl(description) });
      closeRef.current();
    };
    proposeVenueClassification(runId, sourceUrl)
      .then((r) => {
        if (id !== seq.current) return;
        if (!r.ok) return fail(actionErrorText(r.kind));
        setEdits(Object.fromEntries(r.rows.map((row) => [row.key, editOf(row)])));
        setVenueHe(r.venue_he ?? "");
        setExcluded(r.excludedSections);
        setPhase({ kind: "ready", data: r });
      })
      .catch(() => {
        if (id === seq.current) fail(NETWORK_TEXT);
      });
    // Closing (or another hall) drops the answer still on its way.
    return () => {
      seq.current += 1;
    };
  }, [runId, sourceUrl, toast]);

  const data = phase.kind === "ready" ? phase.data : null;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const editFor = (row: ClassificationRow): RowEdit => edits[row.key] ?? editOf(row);
  const setEdit = (key: string, patch: Partial<RowEdit>) =>
    setEdits((all) => {
      const row = rows.find((r) => r.key === key);
      const base = all[key] ?? (row ? editOf(row) : { label: "", drop: false, aiUnsure: false });
      return { ...all, [key]: { ...base, ...patch } };
    });

  const current = rows.map((row) => ({ row, e: editFor(row) }));
  const confirmed: ConfirmedRow[] = current.map(({ row, e }) => confirmedOf(row, e));
  // The hall's name: empty clears it, anything typed must be Hebrew and fit the box (the server refuses the same).
  const venueHeCheck = parseVenueHeInput(venueHe);
  const venueHeBad = !venueHeCheck.ok;
  // Still the AI's proposal as it came: the hint says to check it; a person's edit makes it theirs.
  const venueHeFromAi = data !== null && data.venue_he_ai && venueHe.trim() === data.venue_he;
  // Something must be decided (ruling R19 - stricter than 5.2's "every row labelled or for review"), and a hall
  // with no template needs a NAMED zone (ruling R25 - the rule's away drop alone would adopt the drawing with
  // nothing lit and move every show onto it). The server refuses the same.
  const decided = readyToConfirm(confirmed, data !== null && data.venue.templateId !== null);
  const canConfirm = data !== null && rows.length > 0 && !venueHeBad && decided && !saving;
  const line = data ? aiLine(data.ai) : null;

  async function confirm() {
    if (!data || !canConfirm) return;
    setSaving(true);
    try {
      const r = await classifyVenue(runId, data.venue.sourceUrl, {
        rows: confirmed,
        proposed: shownAsProposed(data.rows),
        ai: data.ai.used,
        venueHe: venueHe.trim(),
        excludedSections: excluded,
      });
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: CLASSIFY_FAILED,
          description: rtl(
            <>
              <p>{actionErrorText(r.kind)}</p>
              {r.message && (
                <p dir="ltr" className="mt-1 text-xs opacity-80">
                  {r.message}
                </p>
              )}
            </>,
          ),
        });
        return;
      }
      // Saved either way: a partial run and event descriptions that could not be rewritten are warning lines under the normal toast;
      // a changed list of excluded sections says when the ticket prices follow.
      const lines = [
        sameSections(excluded, data.excludedSections) ? null : MAP_PRICES_LINE,
        r.reached < r.total ? PARTIAL_LINE(r.total - r.reached) : null,
        r.describeFailed ? DESCRIBE_FAILED_LINE : null,
      ].filter((line): line is string => line !== null);
      toast({ title: CLASSIFY_DONE(r), description: lines.length === 0 ? undefined : rtl(lines.map((line) => <p key={line}>{line}</p>)) });
      await onDone();
    } catch {
      toast({ variant: "destructive", title: CLASSIFY_FAILED, description: rtl(NETWORK_TEXT) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="flex max-h-[90vh] max-w-6xl flex-col gap-4 [&>button:last-child]:left-4 [&>button:last-child]:right-auto"
      >
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{CLASSIFY_TITLE(data?.venue.name || shown?.name || "")}</DialogTitle>
          <DialogDescription>{CLASSIFY_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        {phase.kind === "loading" ? (
          <AiWait timeoutMs={CLASSIFY_TIMEOUT_MS} />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{CLASSIFY_EMPTY}</p>
        ) : (
          <form
            id="uploader-classify"
            className="flex min-h-0 flex-col gap-3 overflow-y-auto md:overflow-visible"
            onKeyDown={onFormKeyDown}
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {line && (
              <p className="flex items-center gap-1.5 rounded-md bg-warning-muted px-3 py-2 text-[13px] text-warning">
                <Wand2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {line}
              </p>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="uploader-classify-venue-he" className="text-[13px] font-medium">
                {COL_VENUE_HE}
              </label>
              <Input
                id="uploader-classify-venue-he"
                data-box
                dir="rtl"
                value={venueHe}
                maxLength={VENUE_HE_MAX}
                disabled={saving}
                aria-invalid={venueHeBad || undefined}
                onChange={(ev) => setVenueHe(ev.target.value)}
                className={cn("h-8 max-w-sm text-[13px]", venueHeFromAi && "italic text-muted-foreground", venueHeBad && "border-destructive")}
              />
              <p className={cn("text-[11px] leading-snug", venueHeBad ? "text-destructive" : "text-muted-foreground")}>
                {venueHeBad ? VENUE_HE_NEEDS_HEBREW : venueHeFromAi ? VENUE_HE_HINT_AI : VENUE_HE_HINT}
              </p>
            </div>
            {/* The map first in the markup (above the table on a phone); from md up it sits beside the table, at the end side. */}
            <div className="flex min-h-0 flex-col gap-3 md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-start">
              <div className="flex flex-col gap-1 md:order-last">
                <p className="text-[13px] font-medium">{MAP_TITLE}</p>
                <VenueSectionMap
                  svg={data?.svg ?? ""}
                  excluded={excluded}
                  highlightCategory={hovered}
                  onToggle={(sectionId, wedges) => setExcluded((list) => toggleExcludedSection(list, sectionId, wedges))}
                  disabled={saving}
                  className="h-[32vh] md:h-[50vh]"
                  fallback={<p className="rounded-md border px-3 py-6 text-center text-xs text-muted-foreground">{MAP_UNAVAILABLE}</p>}
                />
                <p className={cn("text-[11px] leading-snug", excluded.length > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {excluded.length > 0 ? MAP_EXCLUDED_LINE(excluded.length) : MAP_HINT}
                </p>
              </div>
              <Table containerClassName="max-h-[40vh] rounded-md border md:max-h-[50vh]" className="min-w-[34rem] text-[13px]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 w-[24%] text-start">{COL_CATEGORY}</TableHead>
                    <TableHead className="h-9 w-[34%] text-start">{COL_LABEL}</TableHead>
                    <TableHead className="h-9 w-[8%] text-center">{COL_DROP}</TableHead>
                    <TableHead className="h-9 w-[34%] text-start">{COL_STATUS}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.map(({ row, e }) => {
                    const status = statusText(row, e);
                    const unsure = isUnsure(e);
                    return (
                      <TableRow
                        key={row.key}
                        className={cn("align-top", e.drop && "bg-muted/40", hovered === row.key && row.onMap && "bg-accent/40")}
                        onMouseEnter={() => setHovered(row.key)}
                        onMouseLeave={() => setHovered((h) => (h === row.key ? null : h))}
                        onFocus={() => setHovered(row.key)}
                        onBlur={() => setHovered((h) => (h === row.key ? null : h))}
                      >
                        <TableCell className="py-2">
                          <bdi dir="ltr" className={cn("block break-words font-medium", e.drop && "text-muted-foreground line-through")}>
                            {row.category}
                          </bdi>
                        </TableCell>
                        <TableCell className="py-2">
                          <Input
                            data-box
                            dir="rtl"
                            value={e.label}
                            // An English stored label is no label (ruling R26): shown as a hint, never sent.
                            placeholder={row.placeholder || undefined}
                            maxLength={ZONE_LABEL_MAX}
                            disabled={e.drop || saving}
                            aria-label={`${COL_LABEL}: ${row.category}`}
                            onChange={(ev) => setEdit(row.key, { label: ev.target.value, aiUnsure: false })}
                            className={cn("h-8 text-[13px]", e.aiUnsure && "italic text-muted-foreground")}
                          />
                        </TableCell>
                        <TableCell className="py-2 text-center">
                          <Switch
                            checked={e.drop}
                            disabled={saving}
                            aria-label={`${COL_DROP}: ${row.category}`}
                            onCheckedChange={(drop) => setEdit(row.key, { drop })}
                            className="mt-1"
                          />
                        </TableCell>
                        <TableCell className="py-2 text-xs leading-snug">
                          <span className={cn(unsure ? "text-warning" : "text-muted-foreground")}>
                            {status}
                            {status && " · "}
                            {row.shows > 0 ? STATUS_SHOWS(row.shows) : STATUS_NOT_SOLD}
                          </span>
                          {!row.onMap && <span className="mt-0.5 block text-muted-foreground">{STATUS_OFF_MAP}</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </form>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {phase.kind === "ready" && rows.length === 0 ? BTN_CLOSE : BTN_CANCEL}
          </Button>
          {phase.kind === "ready" && rows.length > 0 && (
            <Button type="submit" form="uploader-classify" disabled={!canConfirm}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {BTN_CONFIRM_CLASSIFY(data?.shows ?? 0)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
