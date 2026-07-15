/**
 * Signed session token carrying user identity.
 *
 * The dashboard cookie is `base64url(payload).hmac`, signed with HMAC-SHA256
 * so it cannot be forged without the server signing key. Unlike the old hardcoded
 * `"admin-session"` cookie, this carries real user identity (sub, email, role, partner_code).
 * Old cookies fail the `sub` check → forced re-login (intended).
 *
 * Signing key: `NEXT_SECRET_SESSION_SECRET` if set, else the existing
 * `NEXT_SECRET_ADMIN_PASSWORD` (always present — the login check requires it), so
 * this works on deploy with no new env var. Rotating either invalidates all
 * outstanding sessions. Uses Web Crypto (works in both the Node runtime for
 * routes/actions and the Edge runtime for middleware). Never import from a
 * client component — it reads server-only secrets.
 */

export const SESSION_COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 1 week
export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

import type { Role } from "@/types/auth.types";

export type SessionPayload = {
  sub: string;          // auth.users uuid
  email: string;
  role: Role;
  partner_code: string | null; // partners.partner_tracking_code for agent/affiliate
  exp: number;          // ms epoch
};

function signingKey(): string {
  const key =
    process.env.NEXT_SECRET_SESSION_SECRET ||
    process.env.NEXT_SECRET_ADMIN_PASSWORD;
  if (!key) {
    throw new Error(
      "Missing session signing secret: set NEXT_SECRET_SESSION_SECRET or NEXT_SECRET_ADMIN_PASSWORD"
    );
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toBase64Url(new Uint8Array(sig));
}

/** Constant-time string comparison (avoids leaking the signature via timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a fresh signed session cookie value for a successful login. */
export async function createSessionValue(user: {
  sub: string;
  email: string;
  role: Role;
  partner_code?: string | null;
}): Promise<string> {
  const payload: SessionPayload = {
    sub: user.sub,
    email: user.email,
    role: user.role,
    partner_code: user.partner_code ?? null,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

/** The verified payload for a well-formed, correctly-signed, unexpired session; else null. */
export async function verifySessionValue(
  value?: string | null
): Promise<SessionPayload | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!body || !sig) return null;

  let expected: string;
  try {
    expected = await hmac(body);
  } catch {
    return null;
  }
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body))
    ) as SessionPayload;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (!["superadmin", "admin", "editor", "agent", "affiliate"].includes(payload.role)) return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
