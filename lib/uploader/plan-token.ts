/**
 * Tour uploader (agent #3) - the signature on the model's plan (security review A5, 21.10).
 *
 * `createRun` learns from what staff changed on the plan card: `plan_ai` (the model's plan) against
 * the plan they confirmed (`uploader.plan_edited` lessons, which the agent reads on its next call).
 * `plan_ai` travels through the browser, so without a signature anyone with the screen could send a
 * made-up `plan_ai` and write lessons the model never earned. `parseBrief` signs the model's plan
 * together with the brief it came from (`planTokenFor`); `createRun` takes `plan_ai` only when the
 * token checks out (`verifyPlanToken`) - otherwise it is treated as no model plan (no lessons; the
 * run is still created).
 *
 * The message is the plan as canonical JSON (keys sorted, so the order the object travelled in never
 * matters) + "\n" + the brief; the MAC is HMAC-SHA256 under the caller's key, hex. Web Crypto, so it
 * runs in any runtime. Pure apart from that - the key is handed in, never read from the env here.
 * A plan answered to a STEER is signed under its own prefix (`steered`): the card showed it WITHOUT the
 * last run's markups (final fix wave A4), so `createRun` must measure the edit lessons from the bare plan.
 * The prefix cannot be forged by a brief - a plain message always starts with the plan's `{`.
 * Selftest: scripts/tour-uploader-selftest.ts.
 */
import type { UploaderPlan } from "@/types/uploader.types";

/** JSON with every object's keys sorted (arrays keep their order): two equal plans, one string. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Which parse made the plan: a first parse (the default) or an answer to a steer. */
export type PlanTokenOpts = { steered?: boolean };

/** The token of the model's plan for this brief (`steered`: a steer's answer - another message, another token). */
export async function planTokenFor(planAi: UploaderPlan, brief: string, key: string, opts?: PlanTokenOpts): Promise<string> {
  return hmacHex(key, `${opts?.steered === true ? "steered\n" : ""}${canonicalJson(planAi)}\n${brief}`);
}

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Does `token` (whatever the client sent) sign exactly this plan and brief under `key` - as a first parse, or with
 * `steered` as a steer's answer? A missing key, a missing or malformed token, the other kind, or any other plan /
 * brief = false. Never throws.
 */
export async function verifyPlanToken(token: unknown, planAi: UploaderPlan, brief: string, key: string | null, opts?: PlanTokenOpts): Promise<boolean> {
  if (!key || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  try {
    return sameHex(await planTokenFor(planAi, brief, key, opts), token);
  } catch {
    return false;
  }
}
