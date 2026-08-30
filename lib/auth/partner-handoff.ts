/**
 * Cross-app agent handoff: mints a SHORT-LIVED token in myt-main's
 * `partner_session` format so the portal can hand a signed-in agent over to
 * the customer site with their identity intact.
 *
 * Why it exists: main's agent-mode settlement (`agent_card` / `voucher`)
 * requires a live partner session ON MAIN'S DOMAIN (`requireAgent()` in
 * main's lib/partner-auth). Since the partner portal moved back here
 * (2026-08-02), agents sign in to the backoffice only - main never sees a
 * cookie, and both paid-by-agent settlement methods die with "Agent session
 * required". The fix: "הזמנה עבור הלקוח" routes through
 * `{main}/api/partner-handoff?token=…&next=…`, which verifies this token,
 * re-checks the profile against the DB, sets main's own week-long cookie and
 * redirects into the order flow.
 *
 * Token format is main's exact session shape - `base64url(payload).hmac`
 * over {sub, email, role, partner_code, display_name, exp} - verified by
 * main's `verifyPartnerSession`. Signing key MUST be the same
 * `NEXT_SECRET_SESSION_SECRET` value in BOTH Vercel projects; unlike the
 * dashboard session, there is deliberately NO fallback to
 * NEXT_SECRET_ADMIN_PASSWORD here (main has no such fallback, so a token
 * signed with it would never verify - fail loudly instead).
 *
 * The token rides in a URL, so it is kept deliberately short-lived: main
 * swaps it for its own httpOnly cookie on first use and the URL copy expires
 * minutes later.
 */

const HANDOFF_TTL_MS = 10 * 60 * 1000;

export type PartnerHandoffUser = {
  /** auth.users uuid */
  sub: string;
  email: string;
  role: "agent" | "affiliate";
  partner_code: string;
  display_name?: string | null;
  /**
   * The portal login id (lib/auth/portal-session-id.ts). Main stores it in its
   * own cookie and re-checks it against `user_profiles.portal_session_id` on
   * every partner request, so logging out here - or logging in as a different
   * agent - ends agent mode there. Without it main refuses agent mode outright.
   */
  sid?: string | null;
};

function signingKey(): string {
  const key = process.env.NEXT_SECRET_SESSION_SECRET;
  if (!key) {
    throw new Error(
      "Missing NEXT_SECRET_SESSION_SECRET - the agent handoff cannot sign tokens (must equal myt-main's value)",
    );
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return toBase64Url(new Uint8Array(sig));
}

/** A main-format partner session token that expires in minutes, not a week. */
export async function mintPartnerHandoffToken(
  user: PartnerHandoffUser,
): Promise<string> {
  const payload = {
    sub: user.sub,
    email: user.email,
    role: user.role,
    partner_code: user.partner_code,
    display_name: user.display_name ?? null,
    ...(user.sid ? { sid: user.sid } : {}),
    exp: Date.now() + HANDOFF_TTL_MS,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}
