"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, MapPinPlus, MessageCircleQuestion, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { SubjectArt } from "@/lib/uploader/action-types";
import { ANSWER_TEXT_MAX } from "@/lib/uploader/run-rules";
import { matchesSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { UploaderItem } from "@/types/uploader.types";
import { SIMILAR_LINE, stampHe, type BusyKind } from "./board-words";
import { ACTION, CardShell, RejectButton, StatusPill } from "./card-shell";

// A show the builder could not decide alone (spec §5.3, §10): the loudest card on the board. The
// question, its options as buttons ("skip" last and quiet), a free-text box where the question
// allows one, who it was sent to, and "ענה". The answer keys are the stored options' own keys -
// the server re-checks them against the stored question (`checkAnswer`).

const SKIP = "skip";
/** A location question's option that opens the create-location form instead of answering (spec 4.2). */
const CREATE = "create";
/** A `pick_location` question lists every location - past this many options the list gets a search box. */
const SEARCH_FROM = 8;

export function QuestionCard({
  item,
  art,
  askerName,
  busy,
  focused,
  similar,
  onFocusCard,
  onPick,
  onAnswer,
  onReject,
  onCreateLocation,
}: {
  item: UploaderItem;
  art: SubjectArt;
  askerName: string | null;
  busy: BusyKind | null;
  focused: boolean;
  /** How many OTHER open questions of the run the picked answer's rule would answer (spec 5.4; the board counts - `runRuleOf` + `applyRuleTo`). */
  similar: number;
  onFocusCard: (id: string) => void;
  /** Every change of the picked option (null = none) - what the board counts `similar` from. */
  onPick: (key: string | null) => void;
  onAnswer: (item: UploaderItem, answer: { key: string | null; text: string | null }, opts: { applyToSimilar: boolean }) => Promise<boolean>;
  onReject: (item: UploaderItem) => void;
  /** The `create` option of a location question: opens the form that creates the location and answers with it. */
  onCreateLocation: (item: UploaderItem) => void;
}) {
  const q = item.question;
  const [picked, setPickedState] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [toSimilar, setToSimilar] = useState(false);
  const setPicked = (key: string | null) => {
    setPickedState(key);
    onPick(key);
  };

  // A location question's "create" is an action, not a search result: on `pick_location` (which lists every
  // location and has a search box) it sits beside "skip", always in view.
  const locationQuestion = q?.kind === "pick_location" || q?.kind === "create_location";
  const create = locationQuestion ? ((q?.options ?? []).find((o) => o.key === CREATE) ?? null) : null;
  const pinCreate = create !== null && q?.kind === "pick_location";
  const options = useMemo(() => (q?.options ?? []).filter((o) => o.key !== SKIP && !(pinCreate && o.key === CREATE)), [q, pinCreate]);
  const skip = (q?.options ?? []).find((o) => o.key === SKIP) ?? null;
  const searchable = q?.kind === "pick_location" || options.length > SEARCH_FROM;
  const visible = useMemo(
    () => (searchable && query.trim() !== "" ? options.filter((o) => matchesSearch(query, o.label)) : options),
    [options, query, searchable],
  );

  const answering = busy === "answer";
  const textValue = text.trim();
  const canSend = !answering && busy === null && (picked !== null || (q?.free_text === true && textValue !== ""));

  async function send() {
    if (!canSend) return;
    const ok = await onAnswer(
      item,
      { key: picked, text: q?.free_text && textValue !== "" ? textValue : null },
      { applyToSimilar: toSimilar && similar > 0 },
    );
    if (ok) {
      setPicked(null);
      setText("");
      setQuery("");
      setToSimilar(false);
    }
  }

  const option = (key: string, label: string, quiet = false) => {
    // "create" answers nothing by itself: it opens the form, whose confirm answers with the new location.
    if (create !== null && key === CREATE) {
      return (
        <button
          key={key}
          type="button"
          aria-haspopup="dialog"
          disabled={answering || busy !== null}
          onClick={() => onCreateLocation(item)}
          className={cn(
            "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-dashed border-warning px-2.5 py-1 text-start text-[13px] font-medium leading-snug transition-colors duration-150 ease-out",
            "hover:bg-warning-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50",
          )}
        >
          <MapPinPlus aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span dir="auto" className="min-w-0 break-words">
            {label}
          </span>
        </button>
      );
    }
    const on = picked === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        disabled={answering}
        onClick={() => setPicked(on ? null : key)}
        className={cn(
          "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-start text-[13px] leading-snug transition-colors duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50",
          quiet
            ? on
              ? "border-foreground/40 bg-secondary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
            : on
              ? "border-warning bg-warning font-semibold text-warning-foreground"
              : "border-warning/50 bg-card hover:bg-warning-muted",
        )}
      >
        {on && <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />}
        <span dir="auto" className="min-w-0 break-words">
          {label}
        </span>
      </button>
    );
  };

  return (
    <CardShell
      item={item}
      art={art}
      tone="question"
      focused={focused}
      onFocusCard={onFocusCard}
      footer={
        <>
          <RejectButton item={item} busy={busy} onReject={onReject} />
          <Button
            type="button"
            size="sm"
            disabled={!canSend}
            onClick={send}
            className={cn(ACTION, "ms-auto min-w-[4.5rem] font-semibold")}
          >
            {answering ? <Loader2 aria-hidden className="animate-spin" /> : <MessageCircleQuestion aria-hidden />}
            ענה
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status="question" />
      </div>

      {q ? (
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {/* The system writes it in Hebrew - often opening on a supplier's name, so no dir="auto". */}
          <p className="text-sm font-medium leading-snug">
            {q.text}
          </p>

          {searchable && options.length > 0 && (
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Enter narrows the list - it must never send the answer.
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder={q.kind === "pick_location" ? "חיפוש מיקום…" : "חיפוש…"}
                aria-label="חיפוש באפשרויות"
                disabled={answering}
                className="h-8 ps-8 text-[13px]"
              />
            </div>
          )}

          {options.length > 0 && (
            <div
              role="group"
              aria-label="אפשרויות"
              className={cn("flex flex-wrap gap-1.5", searchable && "max-h-44 overflow-y-auto rounded-md border p-1.5")}
            >
              {visible.map((o) => option(o.key, o.label))}
              {searchable && visible.length === 0 && (
                <p className="px-1 py-0.5 text-xs text-muted-foreground">{q.kind === "pick_location" ? "אין מיקום בשם הזה" : "אין תוצאה"}</p>
              )}
            </div>
          )}

          {(q.free_text || skip || pinCreate) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {q.free_text && (
                <Input
                  dir="auto"
                  value={text}
                  maxLength={ANSWER_TEXT_MAX}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="או תשובה חופשית…"
                  aria-label="תשובה חופשית"
                  disabled={answering}
                  className="h-8 min-w-0 flex-1 basis-40 text-[13px]"
                />
              )}
              {pinCreate && create && option(create.key, create.label)}
              {skip && option(skip.key, skip.label || "דלג", true)}
            </div>
          )}

          {similar > 0 && (
            <label htmlFor={`similar-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded-md bg-warning-muted/60 px-2.5 py-1.5 text-[13px]">
              <Checkbox
                id={`similar-${item.id}`}
                checked={toSimilar}
                disabled={answering}
                onCheckedChange={(v) => setToSimilar(v === true)}
              />
              <span>{SIMILAR_LINE(similar)}</span>
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            {q.task_id ? (
              <>נשלח כמשימה ל{askerName ?? "השולח"}</>
            ) : (
              // Past MAX_QUESTION_TASKS_PER_RUN a question raises no task - its decision line says so.
              (item.decisions ?? []).find((d) => d.code === "question_untasked")?.text ?? <>ממתין לתשובה של {askerName ?? "השולח"}</>
            )}
            {q.asked_at && (
              <>
                {" · "}
                <span dir="ltr" className="tabular-nums">
                  {stampHe(q.asked_at)}
                </span>
              </>
            )}
          </p>
        </form>
      ) : (
        <p className="text-[13px] text-muted-foreground">השאלה לא נשמרה על ההופעה - רעננו את הדף.</p>
      )}
    </CardShell>
  );
}
