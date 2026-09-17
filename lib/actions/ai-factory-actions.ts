"use server";

// AI Factory mutations (spec docs/superpowers/specs/2026-09-16-price-light-gaps-ai-factory-design.md
// §5, §8): teaching an agent a rule, retiring one, and recording direct feedback on one verdict.
// Reads live in lib/services/ai-factory.ts instead - this file is client-callable, that one isn't.
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents";
import { isMissingTableError } from "@/lib/services/ai-factory";

// `agent_instructions` predates the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const TEXT_MIN = 3;
const TEXT_MAX = 500;
const NOTE_MAX = 300;

export type Ok = { ok: true } | { ok: false; kind: string };
export type AddInstructionResult = { ok: true; id: string } | { ok: false; kind: string };

function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === "string" && (AGENT_KEYS as readonly string[]).includes(value);
}

/** "למד אותו": add one taught rule. It rides WITH the house rules on every future call
 *  (lib/agents/memory.ts) - real instructions, so only an admin may write one. */
export async function addAgentInstruction(key: AgentKey, text: string): Promise<AddInstructionResult> {
  const session = await requireAdmin();
  if (!isAgentKey(key)) return { ok: false, kind: "invalid_key" };
  const trimmed = (text ?? "").trim();
  if (trimmed.length < TEXT_MIN || trimmed.length > TEXT_MAX) return { ok: false, kind: "invalid_text" };

  const { data, error } = await db
    .from("agent_instructions")
    .insert({ agent_key: key, text: trimmed, created_by: session.email })
    .select("id")
    .single();
  if (error) {
    if (isMissingTableError(error)) return { ok: false, kind: "not_migrated" };
    console.error("addAgentInstruction failed", JSON.stringify(error));
    return { ok: false, kind: "db_error" };
  }

  await logAudit({
    action: "agent.instruction_added",
    entityType: "agent_instructions",
    entityId: data.id as string,
    metadata: { agent: key, text: trimmed },
  });
  return { ok: true, id: data.id as string };
}

/** Retires a taught rule - it stops riding on future calls but the row (and its audit trail)
 *  stays, so "what did we used to teach it" is never lost. */
export async function deactivateAgentInstruction(id: string): Promise<Ok> {
  await requireAdmin();
  if (!id || typeof id !== "string") return { ok: false, kind: "invalid_id" };

  const { error } = await db
    .from("agent_instructions")
    .update({ active: false, deactivated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (isMissingTableError(error)) return { ok: false, kind: "not_migrated" };
    console.error("deactivateAgentInstruction failed", JSON.stringify(error));
    return { ok: false, kind: "db_error" };
  }

  await logAudit({
    action: "agent.instruction_deactivated",
    entityType: "agent_instructions",
    entityId: id,
    metadata: {},
  });
  return { ok: true };
}

interface FeedbackMatchRow {
  event_id: number;
  competitor: string;
  scope: string;
  status: string;
}

/** A short, factual summary of what was judged - built server-side from the match row rather
 *  than trusted from the client, so a feedback lesson always describes a real comparison. No row
 *  found (a stale id) means no summary, and the learning source drops such a row rather than
 *  teach from a comparison nobody can verify. */
async function summarizeMatch(matchId: number): Promise<string | null> {
  const { data, error } = await db
    .from("competitor_matches")
    .select("event_id,competitor,scope,status")
    .eq("id", matchId)
    .maybeSingle();
  if (error) {
    console.error("summarizeMatch failed", JSON.stringify(error));
    return null;
  }
  if (!data) return null;
  const row = data as FeedbackMatchRow;
  return `${row.competitor} ${row.scope} match on event ${row.event_id} (${row.status})`;
}

/** "יומן" tab, approve/reject: direct feedback on ONE verdict - the sharpest signal an agent can
 *  learn from, because it names exactly which answer was right or wrong instead of an outcome a
 *  human happened to act on. Always recorded (feeds `agent.feedback` maturity counts) even when
 *  the match row itself can no longer be summarized. */
export async function recordAgentFeedback(
  key: AgentKey,
  matchId: number,
  verdictOk: boolean,
  note?: string,
): Promise<Ok> {
  await requireAdmin();
  if (!isAgentKey(key)) return { ok: false, kind: "invalid_key" };
  if (!Number.isInteger(matchId) || matchId <= 0) return { ok: false, kind: "invalid_match_id" };
  const trimmedNote = (note ?? "").trim();
  if (trimmedNote.length > NOTE_MAX) return { ok: false, kind: "note_too_long" };

  const summary = await summarizeMatch(matchId);
  await logAudit({
    action: "agent.feedback",
    entityType: "competitor_matches",
    entityId: matchId,
    metadata: {
      agent: key,
      match_id: matchId,
      verdict_ok: verdictOk,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(summary ? { summary } : {}),
    },
  });
  return { ok: true };
}
