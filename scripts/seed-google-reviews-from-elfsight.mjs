// One-time seed of `google_reviews` from the retired Elfsight widget's public
// review feed (2026-09-09). The Places API only ever returns 5 reviews per
// call, so the historical backlog (71 reviews at the time) is imported once
// from here and the daily cron keeps adding new ones on top.
//
// Usage (from the repo root, .env.local present):
//   node scripts/seed-google-reviews-from-elfsight.mjs            # dry run
//   node scripts/seed-google-reviews-from-elfsight.mjs --write    # upsert
//
// Safe to re-run: keyed by the Google review id from each review's Maps URL,
// so existing rows are updated, never duplicated. Hidden flags are preserved.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const PLACE_ID = process.env.NEXT_SECRET_GOOGLE_PLACE_ID || "ChIJ4_iJNrNJZWoRHYuKTpYGzDE";
const FEED_URL =
  "https://service-reviews-ultimate.elfsight.com/data/reviews" +
  `?uris%5B%5D=${encodeURIComponent(PLACE_ID)}&page_length=500&order=date`;
const WRITE = process.argv.includes("--write");

function loadEnv() {
  const raw = fs.readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/** Google's review id rides in the Maps URL as `!1s<id>` (first occurrence). */
function reviewKeyFromUrl(url, fallback) {
  const m = /!1s([A-Za-z0-9_-]+)/.exec(url ?? "");
  return m ? m[1] : `elfsight:${fallback}`;
}

function toIso(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const res = await fetch(FEED_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
if (!res.ok) {
  console.error("feed fetch failed:", res.status, (await res.text()).slice(0, 200));
  process.exit(1);
}
const payload = await res.json();
const feed = payload?.result?.data;
if (!Array.isArray(feed)) {
  console.error("unexpected feed shape:", JSON.stringify(payload).slice(0, 300));
  process.exit(1);
}

const rows = feed
  .filter((r) => r.supplier === "google" && r.reviewer_name && r.rating && r.published_at)
  .map((r) => ({
    review_key: reviewKeyFromUrl(r.url, r.id),
    place_id: PLACE_ID,
    author_name: String(r.reviewer_name).trim(),
    author_photo_url: r.reviewer_picture_url || null,
    author_url: null,
    rating: Math.max(1, Math.min(5, Math.round(Number(r.rating)))),
    text: r.text || null,
    text_html: r.text_html || null,
    language: r.language || null,
    published_at: toIso(r.published_at),
    review_url: r.url || null,
    reply_text: r.response?.text || null,
    reply_at: r.response?.date ? toIso(r.response.date) : null,
    images: Array.isArray(r.images)
      ? r.images.map((i) => (typeof i === "string" ? i : i?.url)).filter(Boolean)
      : [],
    updated_at: new Date().toISOString(),
  }));

const ratings = rows.reduce((acc, r) => ((acc[r.rating] = (acc[r.rating] || 0) + 1), acc), {});
const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : null;
console.log(`feed: ${feed.length} reviews, mapped: ${rows.length}, ratings:`, ratings, "avg:", avg?.toFixed(2));
console.log("sample:", JSON.stringify({ ...rows[0], text: rows[0]?.text?.slice(0, 40) }));

if (!WRITE) {
  console.log("dry run - pass --write to upsert");
  process.exit(0);
}

const { error: srcErr } = await supabase.from("google_review_sources").upsert(
  {
    place_id: PLACE_ID,
    display_name: "Mega Events – חבילות להופעות ואירועי ספורט בחו״ל",
    rating: avg == null ? null : Math.round(avg * 10) / 10,
    review_count: rows.length,
    maps_url: "https://www.google.com/maps?cid=3588250245740006173",
    synced_at: new Date().toISOString(),
    sync_error: null,
  },
  { onConflict: "place_id" },
);
if (srcErr) {
  console.error("source upsert failed:", JSON.stringify(srcErr));
  process.exit(1);
}

const { data, error } = await supabase
  .from("google_reviews")
  .upsert(rows, { onConflict: "review_key" })
  .select("review_key");
if (error) {
  console.error("reviews upsert failed:", JSON.stringify(error));
  process.exit(1);
}
console.log("upserted:", data.length);
