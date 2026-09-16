/**
 * Session-free core of the price-light "הוזל" decision, split out of
 * lib/actions/price-light-actions.ts (2026-09-16) so it is reachable from more than
 * the admin-only /price-light screen: the task-closing rule
 * (lib/services/gap-resolution.ts, a price_light task reaching done is a decision
 * too) and the all-staff Pricing tab (lib/actions/pricing-gap-actions.ts markPricingGapHandled,
 * which also mutes the row - that half stays in pricing-gap-actions.ts, not here).
 *
 * markRepriced in price-light-actions.ts is now a thin requireAdmin() wrapper around
 * recordRepriced below - same audit action, same snapshot, unchanged behaviour for
 * the /price-light screen itself (Dor, 16.09: the Pricing tab is staff, not
 * admin-only; /price-light's own decisions stay admin-gated).
 */
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth/guards";
import { loadEventForLight, type LightEvent } from "@/lib/services/price-light-store";
import type { LightDecisionSnapshot, Scope } from "@/types/price-light.types";

type Ok = { ok: true } | { ok: false; error: string };

/**
 * What the comparison looked like when a human decided something about it - moved
 * here unchanged from price-light-actions.ts, so a decision recorded from outside
 * /price-light stamps the exact same evidence the price-light agent learns from
 * (lib/agents/price-light.agent.ts).
 */
export function lightSnapshot(event: LightEvent, scope: Scope): LightDecisionSnapshot | null {
  const detail = event.light_detail?.[scope];
  const light = scope === "package" ? event.light_package : event.light_ticket;
  if (!detail || !light) return null;
  return {
    scope,
    light,
    diff_usd: detail.diff_usd,
    our_usd: detail.our_usd,
    competitor: detail.competitor,
    normalized_usd: detail.normalized_usd,
    nights_ours: detail.nights?.ours ?? null,
    nights_theirs: detail.nights?.theirs ?? null,
    uncertainty_usd: detail.uncertainty_usd ?? null,
  };
}

/** The scope a scope-less decision is really about: the red one, package first. */
function decidedScope(event: LightEvent): Scope {
  if (event.light_package === "red") return "package";
  if (event.light_ticket === "red") return "ticket";
  return "package";
}

/** Snapshot for a decision taken on `eventId`, or null when the event or its light is gone. */
export async function snapshotFor(eventId: number, scope?: Scope): Promise<LightDecisionSnapshot | null> {
  const event = await loadEventForLight(eventId);
  if (!event) return null;
  return lightSnapshot(event, scope ?? decidedScope(event));
}

/**
 * "הוזל": records that a human looked at a red light, judged the gap REAL, and went
 * to fix our price. Nothing else happens here - the price itself is edited on the
 * event page, and the light never writes a price. Three entry points reach this:
 * - /price-light's own "הוזל" button (markRepriced, admin-gated).
 * - a price_light task reaching done/cancelled (gap-resolution.ts resolveGapForTask).
 * - the Pricing tab's "טופל" button on a red light row (markPricingGapHandled).
 *
 * `actorId` is only a fallback for a caller with no live cookie session. Controller ruling #4:
 * `actor` is passed to logAudit ONLY when there is no session - passing an explicit actor on
 * every call (even one built to match the session exactly) skips logAudit's own enrichment,
 * which also stamps `impersonated_by`/`impersonated_by_id` metadata when a superadmin is
 * acting as a partner. Leaving `actor` out when a session exists lets logAudit resolve it
 * itself, so this write carries the same impersonation metadata markRepriced always did.
 *
 * Controller ruling #3: writes nothing when the event has no price-light snapshot for this
 * scope (event not found, or never priced) - an audit row with no evidence behind it is worse
 * than none.
 */
export async function recordRepriced(eventId: number, scope: Scope, actorId: string | null): Promise<Ok> {
  try {
    const snapshot = await snapshotFor(eventId, scope);
    if (!snapshot) return { ok: false, error: "אין נתוני רמזור לאירוע הזה" };
    const session = await getSession().catch(() => null);
    await logAudit({
      action: "price_light.repriced",
      entityType: "event",
      entityId: eventId,
      metadata: { ...snapshot },
      ...(session ? {} : { actor: { id: actorId, email: null, role: null } }),
    });
    return { ok: true };
  } catch (e) {
    console.error("recordRepriced failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
