/**
 * Signed admin-session token.
 *
 * The dashboard cookie used to be the constant string `"admin-session"` — anyone
 * could set it and become admin. Now the cookie is `base64url(payload).hmac`,
 * signed with HMAC-SHA256 so it cannot be forged without the server signing key.
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

type SessionPayload = { role: "admin"; exp: number };

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

/** Build a fresh signed session cookie value for a successful admin login. */
export async function createSessionValue(): Promise<string> {
  const payload: SessionPayload = {
    role: "admin",
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

/** True only for a well-formed, correctly-signed, unexpired admin session. */
export async function verifySessionValue(value?: string | null): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!body || !sig) return false;

  let expected: string;
  try {
    expected = await hmac(body);
  } catch {
    return false;
  }
  if (!timingSafeEqual(sig, expected)) return false;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body))
    ) as SessionPayload;
    if (payload.role !== "admin") return false;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}
