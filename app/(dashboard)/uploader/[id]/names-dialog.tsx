"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ImageOff, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { createTeamsAndRename, proposeTeamNames } from "@/lib/actions/uploader-actions";
import type { NamesProposeResult } from "@/lib/uploader/action-types";
import { TEAM_NAME_EN_MAX, TEAM_NAME_HE_MAX, type ConfirmedTeamRow, type TeamRow } from "@/lib/uploader/team-names";
import { cn } from "@/lib/utils";
import { actionErrorText } from "../copy";
import { AiWait } from "./ai-wait";
import {
  aiLine,
  BTN_CANCEL,
  BTN_CLOSE,
  BTN_CONFIRM_ARTIST,
  BTN_CONFIRM_TEAMS,
  BTN_NAMES_LIVE,
  COL_NAME_EN,
  COL_NAME_HE,
  COL_SUPPLIER_NAME,
  COL_WHAT,
  LIVE_NAMED_LINE,
  NAME_NEEDS_ENGLISH,
  NAME_NEEDS_HEBREW,
  NAMES_FAILED,
  NAMES_NONE,
  NAMES_OPEN_FAILED,
  NAMES_TITLE,
  NETWORK_TEXT,
  NO_IMAGES_LINE,
  NO_IMAGES_LINE_ARTIST,
  STATUS_ARTIST_CREATE,
  STATUS_NAME_SKIPPED,
  STATUS_TEAM_CREATE,
  STATUS_TEAM_EXISTING,
  TEAMS_DONE,
} from "./board-words";
import { rtl } from "./use-run-board";

// "שמות בעברית" (spec 5.3): every club (or the artist) of the run the site has no Hebrew name for, one
// AI call for all of them (`proposeTeamNames` - off / failed = the Hebrew boxes open empty, the English
// box holds the clean supplier name), and one confirm (`createTeamsAndRename`) that creates the missing
// rows INACTIVE (no crest, no picture - the AI brings none) and renames every show of the run. A row
// `clubNamesMatch` found after all is "existing": used, never created, both boxes read-only. A row whose
// Hebrew box a person empties is left out (that fixture keeps its English name). Shows that take their
// Hebrew name from LiveTickets need no row; with no row at all the dialog is one button.

type Loaded = Extract<NamesProposeResult, { ok: true }>;
type Phase = { kind: "loading" } | { kind: "ready"; data: Loaded };
type NameEdit = { en: string; he: string };

const HEBREW_LETTER = /[א-ת]/;

/** Why a row cannot be sent as typed; null = fine (an emptied Hebrew box is fine - the row is skipped). */
function rowProblem(e: NameEdit): string | null {
  const he = e.he.trim();
  if (he === "") return null;
  if (!HEBREW_LETTER.test(he)) return NAME_NEEDS_HEBREW;
  if (e.en.trim() === "") return NAME_NEEDS_ENGLISH;
  return null;
}

/** The row as `createTeamsAndRename` takes it, or null = left out (an emptied Hebrew box, or an existing row with no Hebrew name to alias). */
function confirmedOf(row: TeamRow, e: NameEdit): ConfirmedTeamRow | null {
  if (row.status === "existing") {
    // Read-only: exactly what `proposeTeamNames` offered (the server refuses any other `existing_id`).
    return HEBREW_LETTER.test(row.name_he) && row.name_en.trim() !== ""
      ? { supplier_name: row.supplier_name, name_en: row.name_en.trim(), name_he: row.name_he.trim(), existing_id: row.existing_id }
      : null;
  }
  const he = e.he.trim();
  if (he === "" || rowProblem(e) !== null) return null;
  return { supplier_name: row.supplier_name, name_en: e.en.trim(), name_he: he, existing_id: null };
}

/** Enter in a box moves to the next one; in the last box it confirms (spec 11). */
function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
  e.preventDefault();
  const boxes = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>("input[data-box]:not(:disabled):not([readonly])"));
  const at = boxes.indexOf(e.target);
  if (at === -1) return;
  if (at === boxes.length - 1) e.currentTarget.requestSubmit();
  else boxes[at + 1].focus();
}

export function NamesDialog({
  runId,
  open,
  personKind,
  onClose,
  onDone,
}: {
  runId: string;
  open: boolean;
  /** The run's subject kind as the names action reads it: an artist run's one row is the artist. */
  personKind: "team" | "artist";
  onClose: () => void;
  /** After a saved confirm (its toast already shown): the board closes the dialog and reads the run again. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [edits, setEdits] = useState<Record<string, NameEdit>>({});
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    setPhase({ kind: "loading" });
    setEdits({});
    const fail = (description: ReactNode) => {
      toast({ variant: "destructive", title: NAMES_OPEN_FAILED, description: rtl(description) });
      closeRef.current();
    };
    proposeTeamNames(runId)
      .then((r) => {
        if (id !== seq.current) return;
        if (!r.ok) return fail(actionErrorText(r.kind));
        setEdits(Object.fromEntries(r.rows.map((row) => [row.supplier_name, { en: row.name_en, he: row.name_he }])));
        setPhase({ kind: "ready", data: r });
      })
      .catch(() => {
        if (id === seq.current) fail(NETWORK_TEXT);
      });
    return () => {
      seq.current += 1;
    };
  }, [open, runId, toast]);

  const artist = personKind === "artist";
  const data = phase.kind === "ready" ? phase.data : null;
  const rows = data?.rows ?? [];
  const editFor = (row: TeamRow): NameEdit => edits[row.supplier_name] ?? { en: row.name_en, he: row.name_he };
  const setEdit = (row: TeamRow, patch: Partial<NameEdit>) =>
    setEdits((all) => ({ ...all, [row.supplier_name]: { ...(all[row.supplier_name] ?? { en: row.name_en, he: row.name_he }), ...patch } }));

  const current = rows.map((row) => ({ row, e: editFor(row) }));
  const blocked = current.some(({ row, e }) => row.status !== "existing" && rowProblem(e) !== null);
  const send = current.map(({ row, e }) => confirmedOf(row, e)).filter((r): r is ConfirmedTeamRow => r !== null);
  const liveNamed = data?.liveNamed ?? 0;
  /** [] is a valid confirm when LiveTickets names some shows (it renames them). */
  const canConfirm = data !== null && !blocked && !saving && (send.length > 0 || liveNamed > 0);
  const onlyLive = data !== null && rows.length === 0 && liveNamed > 0;
  const nothing = data !== null && rows.length === 0 && liveNamed === 0;
  const line = data ? aiLine(data.ai) : null;

  async function confirm() {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const r = await createTeamsAndRename(runId, send);
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: NAMES_FAILED,
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
      toast({ title: TEAMS_DONE(r, artist) });
      await onDone();
    } catch {
      toast({ variant: "destructive", title: NAMES_FAILED, description: rtl(NETWORK_TEXT) });
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
        className="flex max-h-[90vh] max-w-4xl flex-col gap-4 [&>button:last-child]:left-4 [&>button:last-child]:right-auto"
      >
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{NAMES_TITLE}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5">
            <ImageOff aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {artist ? NO_IMAGES_LINE_ARTIST : NO_IMAGES_LINE}
          </DialogDescription>
        </DialogHeader>

        {phase.kind === "loading" ? (
          <AiWait />
        ) : nothing ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{NAMES_NONE}</p>
        ) : (
          <form
            id="uploader-names"
            className="flex min-h-0 flex-col gap-3"
            onKeyDown={onFormKeyDown}
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {line && rows.length > 0 && (
              <p className="flex items-center gap-1.5 rounded-md bg-warning-muted px-3 py-2 text-[13px] text-warning">
                <Wand2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {line}
              </p>
            )}
            {rows.length > 0 && (
              <Table containerClassName="max-h-[50vh] rounded-md border" className="min-w-[44rem] text-[13px]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 w-[26%] text-start">{COL_SUPPLIER_NAME}</TableHead>
                    <TableHead className="h-9 w-[24%] text-start">{COL_NAME_EN}</TableHead>
                    <TableHead className="h-9 w-[24%] text-start">{COL_NAME_HE}</TableHead>
                    <TableHead className="h-9 w-[26%] text-start">{COL_WHAT}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.map(({ row, e }) => {
                    const existing = row.status === "existing";
                    const problem = existing ? null : rowProblem(e);
                    const skipped = !existing && e.he.trim() === "";
                    return (
                      <TableRow key={row.supplier_name} className="align-top">
                        <TableCell className="py-2">
                          <bdi dir="ltr" className="block break-words font-medium">
                            {row.supplier_name}
                          </bdi>
                        </TableCell>
                        <TableCell className="py-2">
                          <Input
                            data-box
                            dir="ltr"
                            value={existing ? row.name_en : e.en}
                            readOnly={existing}
                            maxLength={TEAM_NAME_EN_MAX}
                            disabled={saving}
                            aria-label={`${COL_NAME_EN}: ${row.supplier_name}`}
                            aria-invalid={problem === NAME_NEEDS_ENGLISH || undefined}
                            onChange={(ev) => setEdit(row, { en: ev.target.value })}
                            className={cn("h-8 text-[13px]", existing && "bg-muted/50", problem === NAME_NEEDS_ENGLISH && "border-destructive")}
                          />
                        </TableCell>
                        <TableCell className="py-2">
                          <Input
                            data-box
                            dir="rtl"
                            value={existing ? row.name_he : e.he}
                            readOnly={existing}
                            maxLength={TEAM_NAME_HE_MAX}
                            disabled={saving}
                            aria-label={`${COL_NAME_HE}: ${row.supplier_name}`}
                            aria-invalid={problem === NAME_NEEDS_HEBREW || undefined}
                            onChange={(ev) => setEdit(row, { he: ev.target.value })}
                            className={cn("h-8 text-[13px]", existing && "bg-muted/50", problem === NAME_NEEDS_HEBREW && "border-destructive")}
                          />
                          {problem && <p className="mt-1 text-[11px] leading-snug text-destructive">{problem}</p>}
                        </TableCell>
                        <TableCell className={cn("py-2 text-xs leading-snug", skipped ? "text-warning" : "text-muted-foreground")}>
                          {existing ? STATUS_TEAM_EXISTING : skipped ? STATUS_NAME_SKIPPED : artist ? STATUS_ARTIST_CREATE : STATUS_TEAM_CREATE}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {liveNamed > 0 && <p className="text-[13px] text-muted-foreground">{LIVE_NAMED_LINE(liveNamed)}</p>}
          </form>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {nothing ? BTN_CLOSE : BTN_CANCEL}
          </Button>
          {data !== null && !nothing && (
            <Button type="submit" form="uploader-names" disabled={!canConfirm}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {onlyLive ? BTN_NAMES_LIVE : artist ? BTN_CONFIRM_ARTIST : BTN_CONFIRM_TEAMS}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
