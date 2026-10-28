"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getFamilyTemplate } from "@/lib/actions/uploader-actions";
import { STEER_MAX, STEER_MIN } from "@/lib/uploader/constants";
import {
  cleanTemplate,
  DESCRIPTION_TEMPLATE_MAX,
  DESCRIPTION_TOKENS,
  fillDescription,
  previewValues,
  type TemplateFamily,
} from "@/lib/uploader/description";
import type { UploaderPlan } from "@/types/uploader.types";

// What sits under the plan card's fields (round 2, Task 11): what the AI asks, the box that steers it, and the
// standing description template of the subject's family. The card owns the state that matters (the plan, the
// seed it hands on); these are the pieces, so plan-card.tsx stays the card. Every rule is pure and selftested
// (lib/uploader/plan.ts `cleanSteer` / `parseQuestions`, lib/uploader/description.ts `previewValues` /
// `templateEdit`); nothing here prices or writes anything - the template is saved by `createRun`.

const norm = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

// ---- what the AI asks ----------------------------------------------------------------------------------------------

/** "ה-AI שואל:" - the questions the model could not settle from the brief; the person answers in the steering box below. */
export function AiQuestions({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="plan-ai-asks" className="space-y-2 rounded-md border border-info/40 bg-info-muted/40 px-3 py-3">
      <h3 id="plan-ai-asks" className="text-sm font-semibold">
        ה-AI שואל:
      </h3>
      <ul className="space-y-1 ps-5 text-sm">
        {questions.map((q, i) => (
          <li key={i} dir="auto" className="list-disc">
            {q}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">אפשר לענות בתיבת &quot;כוון את ה-AI&quot; שמתחת - הוא יעדכן את התוכנית.</p>
    </section>
  );
}

// ---- the steering box ----------------------------------------------------------------------------------------------

/**
 * "כוון את ה-AI": a box and "שלח". The card does the call (and the confirm that precedes it when it would replace
 * the person's edits); the text stays in the box when the steer failed, so it can be sent again or reworded.
 */
export function SteerBox({ disabled, steering, onSend }: { disabled: boolean; steering: boolean; onSend: (instruction: string) => void }) {
  const [text, setText] = useState("");
  const length = text.trim().length;
  const sendable = !disabled && !steering && length >= STEER_MIN && length <= STEER_MAX;
  return (
    <section aria-labelledby="plan-steer" className="space-y-2">
      <h3 id="plan-steer" className="text-sm font-semibold">
        כוון את ה-AI
      </h3>
      <p className="text-xs text-muted-foreground">
        אמרו לסוכן מה לשנות בתוכנית, או ענו על שאלותיו. הוא קורא שוב את הבריף ואת התוכנית כפי שהיא עכשיו, ולומד מההוראה לפעם הבאה.
      </p>
      <Textarea
        dir="rtl"
        rows={2}
        value={text}
        maxLength={STEER_MAX}
        disabled={disabled || steering}
        onChange={(e) => setText(e.target.value)}
        placeholder="למשל: בלי ברלין, ומארק אפ של 50 על חבילות"
        aria-label="הוראה ל-AI"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={!sendable} onClick={() => onSend(text.trim())}>
          {steering && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          {steering ? "שולח…" : "שלח"}
        </Button>
        <span dir="ltr" className="text-[11px] tabular-nums text-muted-foreground">
          {text.length}/{STEER_MAX}
        </span>
      </div>
    </section>
  );
}

// ---- the description template --------------------------------------------------------------------------------------

/** The templates a card carries over when a steer replaces it: only what the person edited, per family. */
export type TemplateDrafts = Partial<Record<TemplateFamily, string>>;

/**
 * The standing template of the plan's family, loaded once per family (`getFamilyTemplate`) and edited as a draft.
 * `payload` is what `createRun` is handed: undefined unless the person changed it (an untouched box must never
 * overwrite what another person saved meanwhile), null = clear it. `ready` = the stored one was read; `failed` =
 * it could not be (no editing then - the run keeps whatever is stored).
 */
export function useFamilyTemplate(family: TemplateFamily, carried: TemplateDrafts | undefined) {
  const [loaded, setLoaded] = useState<Partial<Record<TemplateFamily, string | null>>>({});
  const [failed, setFailed] = useState<Partial<Record<TemplateFamily, true>>>({});
  const [edits, setEdits] = useState<TemplateDrafts>(carried ?? {});
  const requested = useRef(new Set<TemplateFamily>());

  useEffect(() => {
    if (requested.current.has(family)) return;
    requested.current.add(family);
    getFamilyTemplate(family)
      .then((r) => {
        if (r.ok) setLoaded((l) => ({ ...l, [family]: r.template }));
        else setFailed((f) => ({ ...f, [family]: true }));
      })
      .catch(() => setFailed((f) => ({ ...f, [family]: true })));
  }, [family]);

  const stored = loaded[family];
  const text = edits[family] ?? stored ?? "";
  const dirty = stored !== undefined && edits[family] !== undefined && norm(edits[family] ?? "") !== norm(stored ?? "");
  const problem = useMemo(() => {
    const clean = cleanTemplate(text, family);
    return clean.ok ? null : clean.problem;
  }, [text, family]);
  return {
    family,
    text,
    setText: (next: string) => setEdits((e) => ({ ...e, [family]: next })),
    ready: stored !== undefined,
    failed: failed[family] === true,
    dirty,
    problem,
    payload: dirty ? (norm(text) === "" ? null : text) : undefined,
    drafts: edits,
  };
}

export type FamilyTemplate = ReturnType<typeof useFamilyTemplate>;

const FAMILY_LINE: Record<TemplateFamily, string> = {
  football: "למשחקי כדורגל - קבוצה או ליגה",
  artist: "להופעות של אמן",
};

/** Israel's calendar day, YYYY-MM-DD - the date the sample shows. */
const israelToday = (): string => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

/**
 * "תבנית תיאור": the line the order page prints under the event's title (and the Meta feed's text), written once
 * with `{token}` places the build fills for every show - the artist, the teams, the hall, the city. The chips put a
 * token in at the cursor and the sample under it shows the result; the plan's own names stand in for the artist.
 */
export function DescriptionTemplateEditor({ tpl, subject, disabled }: { tpl: FamilyTemplate; subject: UploaderPlan["subject"]; disabled: boolean }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const today = useMemo(israelToday, []);
  const preview = useMemo(
    () => (tpl.problem === null && norm(tpl.text) !== "" ? fillDescription(tpl.text, previewValues(tpl.family, subject, today)).text : null),
    [tpl.problem, tpl.text, tpl.family, subject, today],
  );

  /** A token goes in at the cursor (or replaces the selection) and the cursor lands right after it. */
  function insert(token: string) {
    const el = area.current;
    const piece = `{${token}}`;
    const start = el?.selectionStart ?? tpl.text.length;
    const end = el?.selectionEnd ?? tpl.text.length;
    tpl.setText(`${tpl.text.slice(0, start)}${piece}${tpl.text.slice(end)}`.slice(0, DESCRIPTION_TEMPLATE_MAX));
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + piece.length, start + piece.length);
    });
  }

  return (
    <section aria-labelledby="plan-template" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id="plan-template" className="text-sm font-semibold">
          תבנית תיאור
        </h3>
        <span className="text-xs text-muted-foreground">{FAMILY_LINE[tpl.family]}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        השורה שמופיעה באתר מתחת לשם האירוע. את מה שבסוגריים המסולסלים הסוכן ממלא לכל הופעה לבד - האמן, הקבוצות, האולם והעיר. מה שנכתב כאן נשמר כתבנית קבועה לכל
        הריצות הבאות.
      </p>

      {tpl.failed ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">לא הצלחנו לקרוא את התבנית הקבועה - הריצה תיבנה עם התבנית השמורה.</p>
      ) : !tpl.ready ? (
        <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          טוען את התבנית…
        </p>
      ) : (
        <>
          <Textarea
            ref={area}
            dir="rtl"
            rows={3}
            value={tpl.text}
            maxLength={DESCRIPTION_TEMPLATE_MAX}
            disabled={disabled}
            onChange={(e) => tpl.setText(e.target.value)}
            placeholder="אין עדיין תבנית - האירועים ייבנו עם התיאור הרגיל"
            aria-label="תבנית תיאור"
            aria-invalid={tpl.problem !== null || undefined}
          />
          <div className="flex flex-wrap gap-1.5">
            {DESCRIPTION_TOKENS[tpl.family].map((t) => (
              <Button key={t.token} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" title={t.hint} disabled={disabled} onClick={() => insert(t.token)}>
                {`{${t.token}}`}
              </Button>
            ))}
          </div>
          {tpl.problem !== null && (
            <p role="alert" className="text-xs text-destructive">
              {tpl.problem} - התבנית לא תישמר עם הריצה עד שתתוקן
            </p>
          )}
          <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">כך זה ייראה (דוגמה)</p>
            {preview !== null ? (
              <p dir="auto" className="whitespace-pre-wrap text-sm">
                {preview}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{tpl.problem !== null ? "—" : "בלי תבנית - התיאור ייבנה כרגיל"}</p>
            )}
          </div>
          {tpl.dirty && tpl.problem === null && <p className="text-xs text-muted-foreground">התבנית תישמר כשתיצרו את הריצה.</p>}
        </>
      )}
    </section>
  );
}
