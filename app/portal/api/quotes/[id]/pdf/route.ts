/**
 * Portal-path alias of /api/quotes/[id]/pdf.
 *
 * The partner's session cookie is path-scoped to /portal (multi-session — see
 * lib/auth/session.ts), so the browser never sends it to /api/* URLs; a
 * partner calling the original route would 401. Same handler, served from a
 * URL the cookie actually rides on. Staff keep using the /api path.
 */
export { POST } from "@/app/api/quotes/[id]/pdf/route";

// Declared literally, NOT re-exported: Next's segment-config extraction is
// static and does not reliably see `export { maxDuration } from ...`. The
// chromium PDF render also needs the 1024MB/30s function config — this file
// has its own entry in vercel.json (per-file, aliases don't inherit).
export const maxDuration = 30;
