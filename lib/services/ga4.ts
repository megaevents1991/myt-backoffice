/**
 * GA4 Data API reader (v1beta) with a service account - no client library (spec 2026-10-14 section 7).
 * Property `NEXT_SECRET_GA4_PROPERTY_ID` ("MegaEvents - Production", 483131557); key `NEXT_SECRET_GA4_SA_JSON_B64`
 * = base64 of the service account JSON (`ga4-reader@mega-tourism-ads`, Viewer on the property - read only).
 * The JWT is signed here with node:crypto, like lib/services/ads/google.ts. Every failure THROWS with GA4's message.
 */
import { createSign } from "node:crypto";

const API = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** GA4 answers at most this many rows a report; more means the report must be narrowed, never silently cut. */
const ROW_LIMIT = 100_000;

interface ServiceAccount { client_email: string; private_key: string; private_key_id: string; token_uri: string }

export function ga4Configured(): boolean {
  return Boolean(process.env.NEXT_SECRET_GA4_PROPERTY_ID?.trim() && process.env.NEXT_SECRET_GA4_SA_JSON_B64?.trim());
}

function serviceAccount(): ServiceAccount {
  const b64 = process.env.NEXT_SECRET_GA4_SA_JSON_B64?.trim();
  if (!b64) throw new Error("NEXT_SECRET_GA4_SA_JSON_B64 is not set");
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    // V8's own message quotes a fragment of the input - a piece of the private key would land in a log.
    throw new Error("NEXT_SECRET_GA4_SA_JSON_B64 is not valid JSON");
  }
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = serviceAccount();
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT", kid: sa.private_key_id })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(sa.token_uri, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!body.access_token) throw new Error(`GA4 token: ${body.error_description ?? res.status}`);
  cached = { token: body.access_token, exp: now + (body.expires_in ?? 3600) };
  return body.access_token;
}

export interface Ga4Row { dims: string[]; mets: number[] }

/** One RunReportRequest body (dateRanges, dimensions, metrics, dimensionFilter ...) - see the GA4 Data API. */
export type Ga4ReportRequest = Record<string, unknown>;

/** Up to five reports in one call (GA4's batch limit). Rows come back as plain arrays in the request's order. */
export async function ga4BatchReports(requests: Ga4ReportRequest[]): Promise<Ga4Row[][]> {
  if (requests.length > 5) throw new Error("GA4 batch: at most 5 reports");
  const property = process.env.NEXT_SECRET_GA4_PROPERTY_ID?.trim();
  if (!property || !/^\d+$/.test(property)) throw new Error("NEXT_SECRET_GA4_PROPERTY_ID is not set");
  const res = await fetch(`${API}/properties/${property}:batchRunReports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: requests.map((r) => ({ limit: ROW_LIMIT, ...r })) }),
    signal: AbortSignal.timeout(30_000),
  });
  type Report = { rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]; rowCount?: number };
  const body = (await res.json().catch(() => null)) as { reports?: Report[]; error?: { message?: string } } | null;
  if (!res.ok || !body || body.error) throw new Error(`GA4: ${body?.error?.message ?? res.status}`);
  if (!Array.isArray(body.reports)) throw new Error("GA4: unreadable response");
  return body.reports.map((rep, i) => {
    const rows = (rep.rows ?? []).map((r) => ({
      dims: (r.dimensionValues ?? []).map((d) => d.value ?? ""),
      mets: (r.metricValues ?? []).map((m) => Number(m.value) || 0),
    }));
    if ((rep.rowCount ?? rows.length) > rows.length) throw new Error(`GA4 report ${i + 1}: ${rep.rowCount} rows, more than ${ROW_LIMIT} - narrow the range`);
    return rows;
  });
}
