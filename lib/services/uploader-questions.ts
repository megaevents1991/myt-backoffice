/**
 * Tour uploader (agent #3) - a question a show is waiting on IS a task (spec section 10): source
 * `uploader`, board `ops`, priority `high`, assigned to the run's asker, opened by nobody
 * (`created_by: null` - a system task like a rule's, so the assignment mail reaches the asker even
 * when they started the run themselves).
 *
 * `openQuestionTask` raises it (one open task per item and question kind - asking twice reuses the
 * open one), `closeQuestionTask` closes it once answered (the `closeSupplierGapTask` pattern: done,
 * completed, the answer appended to the description), `countOpenQuestions` feeds the toast and the
 * menu badge. Every audit row carries `metadata.agent: "tour-uploader"`.
 *
 * Session-free: the server actions that call it own the guard (Task 8).
 */
import { logAudit } from "@/lib/audit";
import { notifyTaskAssigned } from "@/lib/services/task-notify";
import { megaEventsTasks, type TaskResult } from "@/lib/tasks-scope";
import { OPEN_TASK_STATUSES, type TaskSourceRef } from "@/types/task.types";
import type { UploaderItem, UploaderQuestion, UploaderRun } from "@/types/uploader.types";

const SOURCE = "uploader";

/** `source_ref` of a question task: the task-board shape (kind / table / row_id / label / url) plus where the question lives. */
export type UploaderTaskRef = TaskSourceRef & {
  run_id: string;
  item_id: string;
  /** The run's subject (English name) and the question's text - what the toast prints. */
  subject: string;
  text: string;
};

/** "2027-05-20" -> "20.05.2027". */
const dayLabel = (day: string): string => day.split("-").reverse().join(".");

function sourceRef(run: UploaderRun, item: UploaderItem, q: UploaderQuestion): UploaderTaskRef {
  const subject = run.plan.subject.name_en;
  return {
    kind: q.kind,
    table: "uploader_items",
    row_id: item.id,
    label: `${subject} · ${item.show.city} ${dayLabel(item.show.date)}`,
    url: `/uploader/${run.id}#item-${item.id}`,
    run_id: run.id,
    item_id: item.id,
    subject,
    text: q.text,
  };
}

function title(run: UploaderRun, item: UploaderItem): string {
  return `שאלה מהמעלה · ${run.plan.subject.name_en} · ${item.show.city} ${dayLabel(item.show.date)}`;
}

function description(run: UploaderRun, item: UploaderItem, q: UploaderQuestion): string {
  const subject = [run.plan.subject.name_en, run.plan.subject.name_he].filter((n): n is string => !!n?.trim()).join(" / ");
  return [
    `ההופעה של ${subject} ב-${item.show.city} ב-${dayLabel(item.show.date)} מחכה לתשובה - שאר הריצה ממשיכה בינתיים.`,
    q.text,
    "אפשרויות:",
    ...q.options.map((o) => `- ${o.label}`),
    q.free_text ? "אפשר גם לענות בטקסט חופשי." : "",
    "עונים בלוח של המעלה (הקישור למטה) - התשובה סוגרת את המשימה ובונה את ההופעה.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Raise the question as a task for the run's asker and mail them (`notifyTaskAssigned`, no
 * assigner = "the system"). An open task for the same item and kind is reused, not duplicated.
 * Returns the task id, or null when the insert failed (logged - the item still shows the question).
 */
export async function openQuestionTask(run: UploaderRun, item: UploaderItem, q: UploaderQuestion): Promise<string | null> {
  const tasks = megaEventsTasks();
  const { data: open, error: openError } = (await tasks
    .select("id")
    .eq("source", SOURCE)
    .eq("source_ref->>item_id", item.id)
    .eq("source_ref->>kind", q.kind)
    .is("deleted_at", null)
    .in("status", OPEN_TASK_STATUSES)
    .limit(1)) as TaskResult<{ id: string }[]>;
  if (openError) {
    console.error("uploader-questions: open-task lookup failed", JSON.stringify(openError));
    return null;
  }
  if (open && open.length > 0) return open[0].id;

  const ref = sourceRef(run, item, q);
  const taskTitle = title(run, item);
  const taskDescription = description(run, item, q);
  const { data, error } = (await tasks
    .insert({
      title: taskTitle,
      description: taskDescription,
      priority: "high",
      assignee_id: run.asker_id,
      created_by: null,
      source: SOURCE,
      source_ref: ref,
      board: "ops",
    })
    .select("id")
    .single()) as TaskResult<{ id: string }>;
  if (error || !data) {
    console.error("uploader-questions: task insert failed", JSON.stringify(error));
    return null;
  }

  await notifyTaskAssigned({
    taskId: data.id,
    companyId: tasks.companyId,
    title: taskTitle,
    description: taskDescription,
    priority: "high",
    dueDate: null,
    sourceRef: ref,
    assigneeId: run.asker_id,
    assignerId: null,
  });
  await logAudit({
    action: "uploader.asked",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: { agent: "tour-uploader", run_id: run.id, item_id: item.id, kind: q.kind, key: q.key, task_id: data.id },
  });
  return data.id;
}

/**
 * The question was answered: the task is done, with the answer appended to its description
 * (`closeSupplierGapTask`'s pattern). Only an `uploader` task is touched. THROWS when the write
 * fails - an answered question whose task stays open would keep the asker's badge lit.
 */
export async function closeQuestionTask(taskId: string, answerText: string): Promise<void> {
  const tasks = megaEventsTasks();
  const { data: task, error: readError } = (await tasks
    .select("description")
    .eq("id", taskId)
    .eq("source", SOURCE)
    .maybeSingle()) as TaskResult<{ description: string | null }>;
  if (readError) {
    console.error("uploader-questions: task read failed", JSON.stringify(readError));
    throw new Error(`task read failed: ${readError.message}`);
  }
  if (!task) return; // not an uploader task of this company (or gone) - nothing to close
  const note = `נענתה (${new Date().toISOString().slice(0, 10)}): ${answerText.trim()}`;
  const { error } = (await tasks
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      description: `${task.description ?? ""}\n${note}`.trim(),
    })
    .eq("id", taskId)
    .eq("source", SOURCE)) as TaskResult<null>;
  if (error) {
    console.error("uploader-questions: task close failed", JSON.stringify(error));
    throw new Error(`task close failed: ${error.message}`);
  }
}

/**
 * The asker's open uploader questions: how many, and the newest one (its run, subject and text) -
 * the toast and the menu badge. THROWS on a failed read (a zero would hide waiting questions).
 */
export async function countOpenQuestions(
  userId: string,
): Promise<{ count: number; newest: { run_id: string; subject: string; text: string } | null }> {
  const { data, error, count } = (await megaEventsTasks()
    .select("id,title,source_ref", { count: "exact" })
    .eq("source", SOURCE)
    .eq("assignee_id", userId)
    .is("deleted_at", null)
    .in("status", OPEN_TASK_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)) as TaskResult<{ id: string; title: string; source_ref: Partial<UploaderTaskRef> | null }[]> & { count: number | null };
  if (error) {
    console.error("uploader-questions: open questions read failed", JSON.stringify(error));
    throw new Error(`open questions read failed: ${error.message}`);
  }
  const top = data?.[0];
  const ref = top?.source_ref ?? null;
  return {
    count: count ?? data?.length ?? 0,
    newest: top && ref?.run_id ? { run_id: ref.run_id, subject: ref.subject ?? ref.label ?? "", text: ref.text ?? top.title } : null,
  };
}
