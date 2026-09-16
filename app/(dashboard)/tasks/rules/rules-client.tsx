"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Play, PlusCircle, Sparkles, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_LABEL } from "@/components/task-editor";
import { BOARD_META } from "@/lib/task-boards";
import {
  createTaskRule,
  deleteTaskRule,
  listTaskRules,
  previewRule,
  runRuleNow,
  updateTaskRule,
} from "@/lib/actions/task-rule-actions";
import type { TaskGenSummary } from "@/lib/services/weekly-task-gen";
import {
  RULE_DOMAINS,
  RULE_MODES,
  type RuleDomain,
  type RuleMatch,
  type RuleMode,
  type TaskRuleWithNames,
} from "@/types/task-rule.types";
import { TASK_BOARDS, TASK_PRIORITIES, type TaskBoard, type TaskPriority } from "@/types/task.types";
import { GAP_KINDS } from "@/types/creative-gap.types";
import type { StaffMentionOption } from "@/types/task-comment.types";

const DOMAIN_LABEL: Record<RuleDomain, string> = {
  price_light: "רמזור מחירים",
  price_changes: "שינויי מחיר",
  creative_gaps: "פערים ויזואליים",
  custom: "מותאם אישית",
};

const MODE_LABEL: Record<RuleMode, string> = {
  weekly_digest: "סיכום שבועי אחד",
  per_item: "משימה לכל פריט",
};

// 0 = Sunday … 6 = Saturday, same index as `dow` and as Date#getUTCDay().
const DOW_LABEL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const UNASSIGNED = "unassigned";
const ANY_SCOPE = "any";

interface RuleFormState {
  name: string;
  domain: RuleDomain;
  mode: RuleMode;
  assignee_id: string;
  priority: TaskPriority;
  due_days: string;
  dow: number;
  board: TaskBoard;
  title: string;
  description: string;
  active: boolean;
  match: RuleMatch;
}

function emptyForm(): RuleFormState {
  return {
    name: "",
    domain: "price_light",
    mode: "weekly_digest",
    assignee_id: UNASSIGNED,
    priority: "medium",
    due_days: "",
    dow: 0,
    board: "ops",
    title: "",
    description: "",
    active: true,
    match: {},
  };
}

function formFromRule(rule: TaskRuleWithNames): RuleFormState {
  return {
    name: rule.name,
    domain: rule.domain,
    mode: rule.mode,
    assignee_id: rule.assignee_id ?? UNASSIGNED,
    priority: rule.priority,
    due_days: rule.due_days === null ? "" : String(rule.due_days),
    dow: rule.dow,
    board: rule.board,
    title: rule.title ?? "",
    description: rule.description ?? "",
    active: rule.active,
    match: rule.match ?? {},
  };
}

/** The raw payload `validateRuleInput` (server-side) checks - the client never
 *  trusts its own form state, it just shapes it the way the action expects. */
function formToInput(form: RuleFormState): Record<string, unknown> {
  return {
    name: form.name,
    domain: form.domain,
    mode: form.mode,
    assignee_id: form.assignee_id === UNASSIGNED ? null : form.assignee_id,
    priority: form.priority,
    due_days: form.due_days.trim() === "" ? null : Number(form.due_days),
    dow: form.dow,
    board: form.board,
    title: form.domain === "custom" ? form.title : null,
    description: form.domain === "custom" ? form.description : null,
    active: form.active,
    match: form.match,
  };
}

function matchSummary(rule: TaskRuleWithNames): string {
  const m = rule.match ?? {};
  const parts: string[] = [];
  if (m.scope) parts.push(m.scope === "package" ? "חבילה" : "כרטיס");
  if (m.vertical) parts.push(m.vertical);
  if (m.min_gap_usd) parts.push(`פער ≥ $${m.min_gap_usd}`);
  if (m.min_weeks_red) parts.push(`≥ ${m.min_weeks_red} שבועות באדום`);
  if (m.min_deviation_usd) parts.push(`סטייה ≥ $${m.min_deviation_usd}`);
  if (m.max_age_days) parts.push(`עד ${m.max_age_days} ימים`);
  if (m.kinds?.length) parts.push(`${m.kinds.length} סוגי פער`);
  if (m.min_severity) parts.push("חמורים בלבד");
  return parts.length ? parts.join(" · ") : "ללא סינון";
}

const ACTION_FAILED_MSG = "הפעולה נכשלה — ייתכן שההתחברות פגה";

export function RulesClient({
  initialRules,
  initialError,
  staff,
}: {
  initialRules: TaskRuleWithNames[];
  initialError: string | null;
  staff: StaffMentionOption[];
}) {
  const { toast } = useToast();
  const [rules, setRules] = useState<TaskRuleWithNames[]>(initialRules);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRuleWithNames | null>(null);
  const [form, setForm] = useState<RuleFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [removing, setRemoving] = useState<TaskRuleWithNames | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rule: TaskRuleWithNames; summary: TaskGenSummary } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listTaskRules();
      if (result.ok) {
        setRules(result.rules);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : ACTION_FAILED_MSG);
    } finally {
      setLoading(false);
    }
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm());
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((rule: TaskRuleWithNames) => {
    setEditing(rule);
    setForm(formFromRule(rule));
    setEditorOpen(true);
  }, []);

  // Switching domain clears the other domains' match keys (and custom's title/
  // description) - a football filter left behind on a creative-gaps rule would
  // be silently ignored by the generator, but confusing to see in the editor.
  const setDomain = useCallback((domain: RuleDomain) => {
    setForm((prev) => ({ ...prev, domain, match: {}, title: "", description: "" }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const input = formToInput(form);
      const result = editing
        ? await updateTaskRule(editing.id, input)
        : await createTaskRule(input);
      if (!result.ok) {
        toast({ variant: "destructive", title: "השמירה נכשלה", description: result.error });
        return;
      }
      toast({ title: editing ? "הכלל עודכן" : "הכלל נוצר", description: result.rule.name });
      setEditorOpen(false);
      await reload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: ACTION_FAILED_MSG,
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }, [editing, form, reload, toast]);

  const toggleActive = useCallback(
    async (rule: TaskRuleWithNames, active: boolean) => {
      try {
        const result = await updateTaskRule(rule.id, { ...formToInput(formFromRule(rule)), active });
        if (!result.ok) {
          toast({ variant: "destructive", title: "העדכון נכשל", description: result.error });
          return;
        }
        setRules((prev) => prev.map((r) => (r.id === rule.id ? result.rule : r)));
      } catch (e) {
        toast({
          variant: "destructive",
          title: ACTION_FAILED_MSG,
          description: e instanceof Error ? e.message : undefined,
        });
      }
    },
    [toast],
  );

  const runPreview = useCallback(
    async (rule: TaskRuleWithNames) => {
      setBusyId(rule.id);
      try {
        const result = await previewRule(rule.id);
        if (!result.ok) {
          toast({ variant: "destructive", title: `${rule.name}: לא ניתן להריץ תצוגה מקדימה`, description: result.error });
          return;
        }
        setPreview({ rule, summary: result.summary });
      } catch (e) {
        toast({
          variant: "destructive",
          title: ACTION_FAILED_MSG,
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setBusyId(null);
      }
    },
    [toast],
  );

  const runNow = useCallback(
    async (rule: TaskRuleWithNames) => {
      setBusyId(rule.id);
      try {
        const result = await runRuleNow(rule.id);
        if (!result.ok) {
          toast({ variant: "destructive", title: `${rule.name}: הריצה נכשלה`, description: result.error });
          return;
        }
        const { summary } = result;
        if (summary.errors.length) {
          toast({
            variant: "destructive",
            title: `${rule.name}: הריצה נתקלה בשגיאה`,
            description: summary.errors.join(" · "),
          });
        } else {
          toast({
            title: rule.name,
            description: `נוצרו ${summary.created} · קיימות ${summary.existed}${summary.closed ? ` · נסגרו ${summary.closed}` : ""}`,
          });
        }
        await reload();
      } catch (e) {
        toast({
          variant: "destructive",
          title: ACTION_FAILED_MSG,
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setBusyId(null);
      }
    },
    [reload, toast],
  );

  const remove = useCallback(
    async (rule: TaskRuleWithNames) => {
      try {
        const result = await deleteTaskRule(rule.id);
        if (!result.ok) {
          toast({ variant: "destructive", title: "המחיקה נכשלה", description: result.error });
          return;
        }
        toast({ title: "הכלל נמחק", description: rule.name });
        await reload();
      } catch (e) {
        toast({
          variant: "destructive",
          title: ACTION_FAILED_MSG,
          description: e instanceof Error ? e.message : undefined,
        });
      }
    },
    [reload, toast],
  );

  const columns = useMemo<ColumnDef<TaskRuleWithNames>[]>(
    () => [
      {
        accessorKey: "name",
        header: "שם",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{matchSummary(row.original)}</div>
          </div>
        ),
      },
      {
        accessorKey: "domain",
        header: "תחום",
        cell: ({ row }) => <Badge variant="secondary">{DOMAIN_LABEL[row.original.domain]}</Badge>,
      },
      {
        accessorKey: "mode",
        header: "מצב",
        cell: ({ row }) => <span className="text-sm">{MODE_LABEL[row.original.mode]}</span>,
      },
      {
        accessorKey: "dow",
        header: "יום",
        cell: ({ row }) => <span className="text-sm">{DOW_LABEL[row.original.dow] ?? row.original.dow}</span>,
      },
      {
        accessorKey: "assignee_name",
        header: "משובץ",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.assignee_name ?? "לא משובץ"}</span>
        ),
      },
      {
        accessorKey: "priority",
        header: "עדיפות",
        cell: ({ row }) => <span className="text-sm">{PRIORITY_LABEL[row.original.priority]}</span>,
      },
      {
        accessorKey: "board",
        header: "יעד",
        cell: ({ row }) => <span className="text-sm">{BOARD_META[row.original.board].label}</span>,
      },
      {
        accessorKey: "active",
        header: "פעיל",
        cell: ({ row }) => (
          <Switch
            checked={row.original.active}
            onCheckedChange={(checked) => toggleActive(row.original, checked)}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const rule = row.original;
          const busy = busyId === rule.id;
          return (
            <div className="flex justify-end gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => runPreview(rule)}
                title="להריץ בלי לכתוב כלום, ולראות מה היה נוצר"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                תצוגה מקדימה
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => runNow(rule)}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                הרץ עכשיו
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openEdit(rule)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setRemoving(rule)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        },
      },
    ],
    [busyId, openEdit, runNow, runPreview, toggleActive],
  );

  return (
    <>
      {loadError && (
        <div
          dir="rtl"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          טעינת הכללים נכשלה: {loadError}
        </div>
      )}
      <DataTable
        columns={columns}
        data={rules}
        getRowId={(rule) => rule.id}
        searchColumn="name"
        searchPlaceholder="חיפוש כלל..."
        rightActions={
          <Button onClick={openCreate}>
            <PlusCircle className="mr-1.5 h-4 w-4" />
            כלל חדש
          </Button>
        }
        emptyState={{
          title: loading ? "טוען…" : loadError ? "לא ניתן לטעון את הכללים" : "אין עדיין כללים",
          description: loading
            ? undefined
            : loadError
              ? loadError
              : "כלל ראשון שכדאי להתחיל ממנו: רמזור אדום שבועי.",
        }}
      />

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent dir="rtl" className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "עריכת כלל" : "כלל חדש"}</DialogTitle>
            <DialogDescription>
              היום שהכלל רץ הוא לפי UTC — הקרון רץ ראשון 09:00 שעון ישראל.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>שם הכלל</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>תחום</Label>
                <Select value={form.domain} onValueChange={(v) => setDomain(v as RuleDomain)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RULE_DOMAINS.map((d) => (
                      <SelectItem key={d} value={d}>{DOMAIN_LABEL[d]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>מצב</Label>
                <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as RuleMode }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RULE_MODES.map((m) => (
                      <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.domain === "price_light" && (
              <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label>סקופ</Label>
                  <Select
                    value={form.match.scope ?? ANY_SCOPE}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        match: { ...f.match, scope: v === ANY_SCOPE ? undefined : (v as "package" | "ticket") },
                      }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_SCOPE}>חבילה + כרטיס</SelectItem>
                      <SelectItem value="package">חבילה</SelectItem>
                      <SelectItem value="ticket">כרטיס</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>ענף (vertical)</Label>
                  <Input
                    value={form.match.vertical ?? ""}
                    placeholder="football, music…"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, match: { ...f.match, vertical: e.target.value || undefined } }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>פער מינימלי ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.match.min_gap_usd ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        match: { ...f.match, min_gap_usd: e.target.value === "" ? undefined : Number(e.target.value) },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>שבועות באדום (מינימום)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.match.min_weeks_red ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        match: {
                          ...f.match,
                          min_weeks_red: e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      }))
                    }
                  />
                </div>
              </div>
            )}

            {form.domain === "price_changes" && (
              <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label>סטייה מינימלית ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.match.min_deviation_usd ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        match: {
                          ...f.match,
                          min_deviation_usd: e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>גיל מקסימלי (ימים)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.match.max_age_days ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        match: { ...f.match, max_age_days: e.target.value === "" ? undefined : Number(e.target.value) },
                      }))
                    }
                  />
                </div>
              </div>
            )}

            {form.domain === "creative_gaps" && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label>סוגי פער (ריק = הכול)</Label>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {GAP_KINDS.map((kind) => {
                      const checked = form.match.kinds?.includes(kind) ?? false;
                      return (
                        <label key={kind} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setForm((f) => {
                                const current = f.match.kinds ?? [];
                                const next: string[] = e.target.checked
                                  ? [...current, kind]
                                  : current.filter((k) => k !== kind);
                                return { ...f, match: { ...f.match, kinds: next.length ? next : undefined } };
                              })
                            }
                          />
                          {kind}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={(form.match.min_severity ?? 0) >= 1}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, match: { ...f.match, min_severity: checked ? 1 : undefined } }))
                    }
                  />
                  חמורים בלבד
                </label>
              </div>
            )}

            {form.domain === "custom" && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label>כותרת המשימה</Label>
                  <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>תיאור</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>יום בשבוע</Label>
                <Select value={String(form.dow)} onValueChange={(v) => setForm((f) => ({ ...f, dow: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOW_LABEL.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">לפי UTC — הקרון רץ ראשון 09:00 שעון ישראל.</p>
              </div>
              <div className="space-y-1.5">
                <Label>משויך ל-</Label>
                <Select
                  value={form.assignee_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, assignee_id: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>לא משובץ</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.display_name ?? s.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>עדיפות</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TaskPriority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>יעד (board)</Label>
                <Select value={form.board} onValueChange={(v) => setForm((f) => ({ ...f, board: v as TaskBoard }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_BOARDS.map((b) => (
                      <SelectItem key={b} value={b}>{BOARD_META[b].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>יעד לביצוע (ימים)</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  placeholder="ללא"
                  value={form.due_days}
                  onChange={(e) => setForm((f) => ({ ...f, due_days: e.target.value }))}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.active} onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked }))} />
              פעיל
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>ביטול</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "שומר…" : "שמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>תצוגה מקדימה - {preview?.rule.name}</DialogTitle>
            <DialogDescription>אפס כתיבות - כך זה ייראה אם ירוץ עכשיו.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto text-sm">
            {preview?.summary.errors.length ? (
              <p className="text-destructive">{preview.summary.errors.join(" · ")}</p>
            ) : null}
            {preview?.summary.skipped.length ? (
              <p className="text-muted-foreground">
                {preview.summary.skipped.map((s) => s.why).join(" · ")}
              </p>
            ) : null}
            {preview?.summary.wouldCreate.length ? (
              <ul className="list-inside list-disc space-y-1">
                {preview.summary.wouldCreate.map((item, i) => (
                  <li key={i}>{item.title}</li>
                ))}
              </ul>
            ) : (
              !preview?.summary.errors.length && (
                <p className="text-muted-foreground">אין מה ליצור כרגע.</p>
              )
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>סגירה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את הכלל?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.name} יימחק לצמיתות. משימות שכבר נוצרו ממנו לא יימחקו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              onClick={() => {
                if (removing) remove(removing);
                setRemoving(null);
              }}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
