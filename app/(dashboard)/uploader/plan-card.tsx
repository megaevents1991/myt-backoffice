"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, RotateCw, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { createRun, parseBrief, previewPlan } from "@/lib/actions/uploader-actions";
import type { PlanPreview } from "@/lib/uploader/action-types";
import { MARKUP_MAX, SHOW_WINDOW_DAYS } from "@/lib/uploader/constants";
import { familyOf } from "@/lib/uploader/description";
import { parsePlanInput, planNonInstant } from "@/lib/uploader/plan";
import { cn } from "@/lib/utils";
import type { SubjectKind, UploaderPlan } from "@/types/uploader.types";
import { actionErrorText, AGENT_OFF_LINE, SUBJECT_KIND_HE } from "./copy";
import { AiQuestions, DescriptionTemplateEditor, SteerBox, useFamilyTemplate, type TemplateDrafts } from "./plan-assist";

// The plan card ("מה הבנתי", spec §5.2): the parsed brief - or the manual form when the agent is
// off - as editable fields, a live preview of what the plan finds, and "בנה את האירועים (N)".
// Nothing here prices anything: a markup is a whole number of dollars passed through as typed,
// and the server re-checks the whole plan (parsePlanInput) on every call.

export type AgentAnswer = "on" | "off" | "failed";
type MarkupKey = "ticket_only" | "additional";

/** What the card opens on - one per parse (or per "manual"); a new seed is a fresh card. */
export type PlanSeed = {
  id: number;
  plan: UploaderPlan;
  /** The model's own plan (createRun's `plan_ai`, the lesson of what staff changed); null = manual. */
  planAi: UploaderPlan | null;
  /** `parseBrief`'s signature of `planAi` - createRun uses `plan_ai` only with it. */
  planToken: string | null;
  fromPrior: MarkupKey[];
  /** null = nothing searched yet (the manual form opens before a subject is typed). */
  preview: PlanPreview | null;
  agent: AgentAnswer;
  problems: string[];
  /** What the model asked the person ("ה-AI שואל:"); [] = nothing, or no model. */
  questions: string[];
  /**
   * A steer replaces the card with a new seed: what is not the plan travels along - the test switch (a person who
   * turned it on must not build a live run by steering) and the description templates they edited.
   */
  carry?: { isTest: boolean; templates: TemplateDrafts };
};

const SUBJECT_KINDS: SubjectKind[] = ["artist", "team", "competition"];

const WITHOUT_LOCATION_HE: Record<UploaderPlan["rules"]["without_location"], string> = {
  ticket_only: "כרטיס בלבד",
  skip: "לדלג",
};

/** Same name and value as the server's (lib/uploader/run-rules.ts) - kept local so the client never imports run-rules. */
const EMPTY_PREVIEW: PlanPreview = { shows: 0, questions: 0, existing: 0, cities: [] };
/** Quiet time after the last edit before the plan is searched again. */
const PREVIEW_DEBOUNCE_MS = 600;
/** Cities printed under the preview line before "ועוד N". */
const CITIES_SHOWN = 14;

/**
 * The fields that decide which shows the plan finds - a markup edit does not search again, nor does
 * the LiveTickets non-instant switch (it changes which tickets a show gets, not which shows exist).
 * The test switch is in it: a test run's preview counts test events as existing (previewPlan's `isTest`).
 */
const searchKeyOf = (p: UploaderPlan, isTest: boolean): string =>
  JSON.stringify({ subject: p.subject, scope: p.scope, rules: { without_location: p.rules.without_location }, isTest });

/** "" = no markup (null); a whole number 0..MARKUP_MAX; anything else = undefined (not valid). */
function markupValue(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n <= MARKUP_MAX ? n : undefined;
}

const markupText = (v: number | null): string => (v === null ? "" : String(v));

type Check = {
  loading: boolean;
  /** The failed preview's kind, worded. While set the counts read "—" and nothing can be built. */
  error: string | null;
  problems: string[];
};

const IDLE: Check = { loading: false, error: null, problems: [] };

export function PlanCard({
  seed,
  brief,
  navigating,
  onEditBrief,
  onCreated,
  onSteered,
}: {
  seed: PlanSeed;
  brief: string;
  /** The run exists and the board is loading - everything is frozen. */
  navigating: boolean;
  onEditBrief: () => void;
  onCreated: (runId: string) => void;
  /** "כוון את ה-AI" answered: the new plan opens as a fresh card (a new seed). */
  onSteered: (seed: Omit<PlanSeed, "id">) => void;
}) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<UploaderPlan>(seed.plan);
  const [markupDraft, setMarkupDraft] = useState<Record<MarkupKey, string>>({
    ticket_only: markupText(seed.plan.markups.ticket_only),
    additional: markupText(seed.plan.markups.additional),
  });
  const [touched, setTouched] = useState<MarkupKey[]>([]);
  const [isTest, setIsTest] = useState(seed.carry?.isTest ?? false);
  const [preview, setPreview] = useState<PlanPreview>(seed.preview ?? EMPTY_PREVIEW);
  const [check, setCheck] = useState<Check>(IDLE);
  /** The counts on screen belong to the plan as it stands: false after a failed check, until a new one lands ("—", B9). */
  const [known, setKnown] = useState(seed.preview !== null);
  const [creating, setCreating] = useState(false);
  /** "בדוק שוב" bumps it - the same plan is searched again, at once. */
  const [retry, setRetry] = useState(0);
  const [nameTouched, setNameTouched] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  /** A steer is in flight (the model is answering), or waits for the confirm that it replaces the person's edits. */
  const [steering, setSteering] = useState(false);
  const [confirmSteer, setConfirmSteer] = useState<string | null>(null);
  const tpl = useFamilyTemplate(familyOf(plan.subject.kind), seed.carry?.templates);

  const busy = creating || navigating || steering;
  const shapeOk = useMemo(() => parsePlanInput(plan).ok, [plan]);
  const searchKey = searchKeyOf(plan, isTest);
  const needsName = plan.subject.name_en.trim() === "";
  const invalidMarkup = (key: MarkupKey): boolean => markupValue(markupDraft[key]) === undefined;
  const anyInvalidMarkup = invalidMarkup("ticket_only") || invalidMarkup("additional");
  const failed = check.error !== null;
  /** The counts are not the plan's (a failed check, or the re-check after one still loading): "—", never a 0. */
  const unknown = failed || !known;
  /** Every show the run would start with - the ready ones and the ones waiting on a question. */
  const total = preview.shows + preview.questions;

  // The newest plan, for the debounced search to read when it fires (a markup edit alone does not search).
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  // The search key whose answer is on screen - the parse's own preview, at first. Only a SUCCESS (or
  // the blank-name state) sets it: after a failure nothing valid is on screen, so any key - the same
  // one, or an edit back to an older one - searches again. Only the newest search may write (`seq`).
  // The parse's own preview was taken with the switch off.
  const shownKey = useRef<string | null>(seed.preview ? searchKeyOf(seed.plan, false) : null);
  const isTestRef = useRef(isTest);
  useEffect(() => {
    isTestRef.current = isTest;
  }, [isTest]);
  const seq = useRef(0);
  const lastRetry = useRef(retry);

  useEffect(() => {
    const immediate = retry !== lastRetry.current;
    lastRetry.current = retry;
    if (searchKey === shownKey.current) {
      // Edited back to what is on screen: drop whatever was pending for the edits in between.
      seq.current += 1;
      setCheck((c) => (c.loading ? { ...c, loading: false } : c));
      return;
    }
    const mine = ++seq.current;
    if (needsName) {
      shownKey.current = searchKey;
      setPreview(EMPTY_PREVIEW);
      setKnown(true);
      setCheck(IDLE);
      return;
    }
    /** A failed check leaves nothing to trust: the counts go blank ("—") and the key is not marked shown. */
    const fail = (error: string, problems: string[]) => {
      if (mine !== seq.current) return;
      shownKey.current = null;
      setPreview(EMPTY_PREVIEW);
      setKnown(false);
      setCheck({ loading: false, error, problems });
    };
    setCheck({ loading: true, error: null, problems: [] });
    const timer = setTimeout(
      () => {
        const shape = parsePlanInput(planRef.current);
        if (!shape.ok) {
          fail(actionErrorText("bad_plan"), shape.problems);
          return;
        }
        previewPlan(shape.plan, { isTest: isTestRef.current })
          .then((res) => {
            if (!res.ok) {
              fail(actionErrorText(res.kind), res.problems ?? []);
              return;
            }
            if (mine !== seq.current) return;
            shownKey.current = searchKey;
            setPreview(res.preview);
            setKnown(true);
            setCheck(IDLE);
          })
          .catch(() => fail(actionErrorText(""), []));
      },
      immediate ? 0 : PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchKey, needsName, retry]);

  const setSubject = (patch: Partial<UploaderPlan["subject"]>) =>
    setPlan((p) => ({ ...p, subject: { ...p.subject, ...patch } }));
  const setScope = (patch: Partial<UploaderPlan["scope"]>) => setPlan((p) => ({ ...p, scope: { ...p.scope, ...patch } }));

  function onMarkup(key: MarkupKey, raw: string) {
    setMarkupDraft((d) => ({ ...d, [key]: raw }));
    setTouched((t) => (t.includes(key) ? t : [...t, key]));
    const value = markupValue(raw);
    if (value !== undefined) setPlan((p) => ({ ...p, markups: { ...p.markups, [key]: value } }));
  }

  const canBuild =
    !busy && !check.loading && !unknown && !needsName && shapeOk && !anyInvalidMarkup && total > 0;

  // Anything changed since the card opened - "ערוך את הבריף" then asks before throwing it away.
  const seedJson = useMemo(() => JSON.stringify(seed.plan), [seed.plan]);
  /** The plan's own fields differ from what the card opened with - the part a steer would replace (the test switch and the template travel along). */
  const planEdited =
    JSON.stringify(plan) !== seedJson ||
    markupDraft.ticket_only !== markupText(seed.plan.markups.ticket_only) ||
    markupDraft.additional !== markupText(seed.plan.markups.additional);
  const edited = isTest || planEdited || tpl.dirty;

  /** "שלח": a steer that would replace the person's edits asks first (like "ערוך את הבריף" does). */
  function requestSteer(instruction: string) {
    if (busy) return;
    if (planEdited) setConfirmSteer(instruction);
    else void steer(instruction);
  }

  /** The model reads the brief, the plan as it stands and the instruction again; its answer opens as a fresh card. The card stays as it was on any failure. */
  async function steer(instruction: string) {
    if (busy) return;
    setConfirmSteer(null);
    setSteering(true);
    try {
      const res = await parseBrief(brief, { instruction, plan, ...(seed.questions.length > 0 ? { questions: seed.questions } : {}) });
      if (!res.ok) {
        toast({ variant: "destructive", title: "ה-AI לא עודכן", description: actionErrorText(res.kind) });
        return;
      }
      onSteered({
        plan: res.plan,
        planAi: res.planAi,
        planToken: res.planToken ?? null,
        fromPrior: res.fromPrior,
        preview: res.preview,
        agent: res.agent,
        problems: res.problems,
        questions: res.questions,
        carry: { isTest, templates: tpl.drafts },
      });
    } catch {
      toast({ variant: "destructive", title: "ה-AI לא עודכן", description: actionErrorText("") });
    } finally {
      setSteering(false);
    }
  }

  async function build() {
    if (!canBuild) return;
    setCreating(true);
    try {
      const res = await createRun({
        brief,
        plan,
        plan_ai: seed.planAi,
        ...(seed.planToken ? { planToken: seed.planToken } : {}),
        asker_id: null,
        is_test: isTest,
        // Only what the person changed: an untouched box must never overwrite a template another person saved meanwhile.
        ...(tpl.payload !== undefined ? { descriptionTemplate: tpl.payload } : {}),
      });
      if (!res.ok) {
        const problems = res.problems?.slice(0, 3).join(" · ");
        toast({
          variant: "destructive",
          title: "הריצה לא נוצרה",
          description: problems ? `${actionErrorText(res.kind)}: ${problems}` : actionErrorText(res.kind),
        });
        setCreating(false);
        return;
      }
      // The run is made either way - a template that could not be saved is told, never a reason to stop.
      if (res.template === "failed") {
        toast({
          variant: "destructive",
          title: "הריצה נוצרה, אבל תבנית התיאור לא נשמרה",
          description: "בדקו אותה ב\"תבנית תיאור\" בלוח הריצה ושמרו שוב.",
        });
      }
      onCreated(res.runId);
    } catch {
      toast({ variant: "destructive", title: "הריצה לא נוצרה", description: actionErrorText("") });
      setCreating(false);
    }
  }

  const manual = seed.agent === "off";
  const datesReversed =
    plan.scope.date_from !== null && plan.scope.date_to !== null && plan.scope.date_from > plan.scope.date_to;
  const ticketOnlyUnpriced = plan.rules.without_location === "ticket_only" && plan.markups.ticket_only === null;
  const extraCities = preview.cities.length - CITIES_SHOWN;

  return (
    <section aria-labelledby="uploader-plan-title" className="rounded-lg border bg-card text-card-foreground shadow-sm">
      {/* ---- header: what this card is, and how the brief was read ---- */}
      <div className="space-y-3 border-b p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="uploader-plan-title" className="font-display text-lg font-semibold">
            {manual ? "התוכנית" : "מה הבנתי"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {manual
              ? AGENT_OFF_LINE
              : seed.agent === "on"
                ? "כך הסוכן קרא את הבריף - בדקו ותקנו לפני שבונים"
                : null}
          </p>
        </div>

        {brief.trim() !== "" && (
          <blockquote dir="auto" className="line-clamp-2 border-s-2 border-border ps-3 text-sm text-muted-foreground">
            {brief}
          </blockquote>
        )}

        {seed.agent === "failed" && (
          <div role="status" className="rounded-md border border-warning/40 bg-warning-muted/60 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
              הסוכן לא הצליח לפענח את כל הבריף - בדקו את השדות
            </p>
            {seed.problems.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 ps-6 text-xs text-foreground/80">
                {seed.problems.map((p, i) => (
                  <li key={i} className="list-disc">
                    <bdi dir="ltr">{p}</bdi>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ---- the plan's fields ---- */}
      <fieldset disabled={busy} className="grid gap-x-8 gap-y-6 p-5 sm:p-6 md:grid-cols-2">
        <Group title="נושא">
          <Field label="סוג" htmlFor="plan-kind">
            <Select
              dir="rtl"
              value={plan.subject.kind}
              onValueChange={(v) => {
                const kind = SUBJECT_KINDS.find((k) => k === v);
                if (kind) setSubject({ kind });
              }}
            >
              <SelectTrigger id="plan-kind">
                <SelectValue>{SUBJECT_KIND_HE[plan.subject.kind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {SUBJECT_KIND_HE[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="שם באנגלית" htmlFor="plan-name-en" hint="כפי שהספק כותב אותו">
              <Input
                id="plan-name-en"
                dir="ltr"
                maxLength={120}
                value={plan.subject.name_en}
                onChange={(e) => {
                  setNameTouched(true);
                  setSubject({ name_en: e.target.value });
                }}
                onBlur={() => setNameTouched(true)}
                placeholder="Eric Clapton"
                aria-invalid={(nameTouched && needsName) || undefined}
              />
            </Field>
            <Field label="שם בעברית" htmlFor="plan-name-he">
              <Input
                id="plan-name-he"
                dir="rtl"
                maxLength={120}
                value={plan.subject.name_he ?? ""}
                onChange={(e) => setSubject({ name_he: e.target.value.trim() === "" ? null : e.target.value })}
                placeholder="אריק קלפטון"
              />
            </Field>
          </div>
        </Group>

        <Group title="אילו הופעות">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="מתאריך" htmlFor="plan-from" hint={`ריק = מ-${SHOW_WINDOW_DAYS} ימים מהיום`}>
              <Input
                id="plan-from"
                type="date"
                dir="ltr"
                value={plan.scope.date_from ?? ""}
                onChange={(e) => setScope({ date_from: e.target.value || null })}
              />
            </Field>
            <Field label="עד תאריך" htmlFor="plan-to" hint="ריק = בלי הגבלה">
              <Input
                id="plan-to"
                type="date"
                dir="ltr"
                value={plan.scope.date_to ?? ""}
                onChange={(e) => setScope({ date_to: e.target.value || null })}
              />
            </Field>
          </div>
          {datesReversed && <p className="text-xs text-warning">תאריך הסיום לפני תאריך ההתחלה</p>}
          {plan.subject.kind === "team" && (
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <span className="text-sm">רק משחקי בית</span>
              <Switch checked={plan.scope.home_only} onCheckedChange={(on) => setScope({ home_only: on })} />
            </label>
          )}
          <ScopeExtras plan={plan} onScope={setScope} />
        </Group>

        <Group title="איך בונים">
          <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">הופעה עם לוקיישן</span>
            <span className="font-medium">חבילה - טיסה, מלון וכרטיס</span>
          </div>
          <Field label="הופעה בלי לוקיישן" htmlFor="plan-without">
            <Select
              dir="rtl"
              value={plan.rules.without_location}
              onValueChange={(v) => {
                if (v === "ticket_only" || v === "skip") setPlan((p) => ({ ...p, rules: { ...p.rules, without_location: v } }));
              }}
            >
              <SelectTrigger id="plan-without">
                <SelectValue>{WITHOUT_LOCATION_HE[plan.rules.without_location]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ticket_only">{WITHOUT_LOCATION_HE.ticket_only}</SelectItem>
                <SelectItem value="skip">{WITHOUT_LOCATION_HE.skip}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">ספקים</div>
            <div className="flex flex-wrap gap-1.5">
              {["TixStock", "LiveTickets"].map((s) => (
                <span key={s} className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium">
                  <bdi>{s}</bdi>
                </span>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <span className="text-sm">
              כולל קטגוריות <bdi>LiveTickets</bdi> ללא אישור מיידי
            </span>
            <Switch
              checked={planNonInstant(plan)}
              onCheckedChange={(on) => setPlan((p) => ({ ...p, rules: { ...p.rules, livetickets_non_instant: on } }))}
            />
          </label>
        </Group>

        <Group title="מארק אפ">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["ticket_only", "לכרטיס בלבד"],
                ["additional", "אדישנל"],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                htmlFor={`plan-markup-${key}`}
                tag={seed.fromPrior.includes(key) && !touched.includes(key) ? "מהפעם הקודמת" : undefined}
                error={invalidMarkup(key) ? `מספר שלם בין 0 ל-${MARKUP_MAX.toLocaleString("en-US")}` : undefined}
              >
                <div className="relative" dir="ltr">
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id={`plan-markup-${key}`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={markupDraft[key]}
                    onChange={(e) => onMarkup(key, e.target.value)}
                    placeholder="לא נקבע"
                    aria-invalid={(touched.includes(key) && invalidMarkup(key)) || undefined}
                    className={cn("ps-7 tabular-nums", invalidMarkup(key) && "border-destructive focus-visible:ring-destructive")}
                  />
                </div>
              </Field>
            ))}
          </div>
          {ticketOnlyUnpriced && (
            <p className="text-xs text-warning">
              בלי מארק אפ לכרטיס בלבד, כל אירוע כרטיס-בלבד ייחסם באישור עד שימולא בעורך.
            </p>
          )}
        </Group>

        {plan.notes.length > 0 && (
          <div className="md:col-span-2">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">עוד מהבריף (לא נכנס לתוכנית)</div>
            <ul className="space-y-0.5 ps-4 text-sm">
              {plan.notes.map((n, i) => (
                <li key={i} dir="auto" className="list-disc">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex items-start justify-between gap-4 rounded-md border border-dashed px-3 py-3 md:col-span-2">
          <span>
            <span className="block text-sm font-medium">ריצת בדיקה</span>
            <span className="block text-xs text-muted-foreground">
              האירועים יסומנו גם כאירועי בדיקה - בטוח גם לפני שהאתר עודכן
            </span>
          </span>
          <Switch checked={isTest} onCheckedChange={setIsTest} className="mt-0.5" />
        </label>
      </fieldset>

      {/* ---- under the plan: what the AI asks, how to steer it, the standing description template ---- */}
      <fieldset disabled={busy} className="space-y-6 border-t p-5 sm:p-6">
        {!manual && <AiQuestions questions={seed.questions} />}
        {!manual && <SteerBox disabled={creating || navigating} steering={steering} onSend={requestSteer} />}
        <DescriptionTemplateEditor tpl={tpl} subject={plan.subject} disabled={busy} />
      </fieldset>

      {/* ---- what the plan finds, and the one action that builds it ---- */}
      <div className="space-y-3 rounded-b-lg bg-sidebar px-5 py-4 text-sidebar-foreground sm:px-6">
        <div aria-live="polite" className="space-y-1">
          {needsName ? (
            <p className="text-sm">הקלידו את שם הנושא באנגלית - החיפוש אצל הספקים רץ עליו</p>
          ) : (
            <p className={cn("text-sm transition-opacity", check.loading && "opacity-60")}>
              נמצאו <Num value={preview.shows} unknown={unknown} /> הופעות · <Num value={preview.existing} unknown={unknown} />{" "}
              קיימות · <Num value={preview.questions} unknown={unknown} /> שאלות
              {check.loading && <span className="ms-2 text-xs">בודק…</span>}
              {!unknown && !check.loading && typeof preview.hasPage === "boolean" && (
                <span
                  className={cn(
                    "ms-2 rounded-full border px-2 py-0.5 align-middle text-[11px] font-medium",
                    preview.hasPage ? "border-sidebar-foreground/30" : "border-brand-gold/60 text-brand-gold",
                  )}
                  title={preview.hasPage ? "לנושא יש עמוד באתר" : "לנושא אין עמוד באתר - האירועים ייבנו עם אזהרה; צרו עמוד ב-Templates"}
                >
                  {preview.hasPage ? "עמוד ✓" : "אין עמוד"}
                </span>
              )}
            </p>
          )}
          {!needsName && !failed && preview.cities.length > 0 && (
            <p className="text-xs leading-relaxed text-sidebar-foreground/80">
              {/* One isolated run: the supplier's city names keep their own order and commas. */}
              <bdi>{preview.cities.slice(0, CITIES_SHOWN).join(", ")}</bdi>
              {extraCities > 0 && <> ועוד {extraCities}</>}
            </p>
          )}
          {check.error && (
            <div className="text-xs text-brand-gold">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="flex items-center gap-1.5">
                  <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  הבדיקה נכשלה: {check.error}
                </p>
                <button
                  type="button"
                  onClick={() => setRetry((r) => r + 1)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-sidebar-accent-foreground underline-offset-4 hover:bg-sidebar-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50"
                >
                  <RotateCw aria-hidden className="h-3 w-3" />
                  בדוק שוב
                </button>
              </div>
              {check.problems.length > 0 && (
                <ul className="mt-0.5 ps-5">
                  {check.problems.map((p, i) => (
                    <li key={i} className="list-disc">
                      <bdi dir="ltr">{p}</bdi>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            onClick={build}
            disabled={!canBuild}
            className={cn(
              "bg-brand-mint font-semibold text-brand-forest hover:bg-brand-mint/90 focus-visible:ring-brand-mint focus-visible:ring-offset-sidebar",
              canBuild && "shadow-mint-glow",
            )}
          >
            {navigating
              ? "פותח את הלוח…"
              : creating
                ? "יוצר את הריצה…"
                : `בנה את האירועים (${unknown ? "—" : total})`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => (edited ? setConfirmBack(true) : onEditBrief())}
            disabled={busy}
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-offset-sidebar"
          >
            ערוך את הבריף
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmSteer !== null} onOpenChange={(open) => !open && setConfirmSteer(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="sm:text-start">
            <AlertDialogTitle>לכוון את ה-AI?</AlertDialogTitle>
            <AlertDialogDescription>
              השינויים שעשיתם בתוכנית יוחלפו בתוכנית ש-AI יחזיר. הוא מקבל את התוכנית כפי שהיא עכשיו, אבל לא בטוח שישמור כל שינוי.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>הישארו בתוכנית</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmSteer !== null && void steer(confirmSteer)}>כוון</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBack} onOpenChange={setConfirmBack}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="sm:text-start">
            <AlertDialogTitle>לחזור לבריף?</AlertDialogTitle>
            <AlertDialogDescription>
              השינויים שעשיתם בתוכנית לא יישמרו. פענוח חוזר יבנה אותה מחדש מהבריף.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>הישארו בתוכנית</AlertDialogCancel>
            <AlertDialogAction onClick={onEditBrief}>חזרה לבריף</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** A count inside the preview sentence - left-to-right digits, a touch larger than the words; "—" when unknown. */
function Num({ value, unknown }: { value: number; unknown: boolean }) {
  return (
    <span dir="ltr" className="font-display text-base font-semibold tabular-nums text-sidebar-accent-foreground">
      {unknown ? "—" : value}
    </span>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  tag,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  /** A small mark beside the label ("מהפעם הקודמת"). */
  tag?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {/* Fixed height: a tag beside one label must not push its input below its neighbour's. */}
      <div className="flex h-5 items-center gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        {tag && <span className="rounded-full bg-info-muted px-1.5 text-[11px] font-medium leading-4 text-info">{tag}</span>}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * What the brief narrowed that the form has no field for (a round, cities to keep or drop). Shown so
 * nothing hidden steers the search; each can be removed, none added here.
 */
function ScopeExtras({ plan, onScope }: { plan: UploaderPlan; onScope: (patch: Partial<UploaderPlan["scope"]>) => void }) {
  const { round, include_cities: include, exclude_cities: exclude } = plan.scope;
  if (!round && include.length === 0 && exclude.length === 0) return null;
  return (
    <div className="space-y-2 text-sm">
      {round && (
        <ExtraRow label="סבב">
          <Chip text={round} onRemove={() => onScope({ round: null })} />
        </ExtraRow>
      )}
      {include.length > 0 && (
        <ExtraRow label="רק בערים">
          {include.map((c) => (
            <Chip key={c} text={c} onRemove={() => onScope({ include_cities: include.filter((x) => x !== c) })} />
          ))}
        </ExtraRow>
      )}
      {exclude.length > 0 && (
        <ExtraRow label="בלי הערים">
          {exclude.map((c) => (
            <Chip key={c} text={c} onRemove={() => onScope({ exclude_cities: exclude.filter((x) => x !== c) })} />
          ))}
        </ExtraRow>
      )}
    </div>
  );
}

function ExtraRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {children}
    </div>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pe-1 ps-2.5 text-xs">
      <bdi>{text}</bdi>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`הסר ${text}`}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="h-3 w-3" />
      </button>
    </span>
  );
}
