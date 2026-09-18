// One-off (2026-09-18): events 1078 / 1079 / 1080 (Napoli, Champions League)
// carry their OWN art_image_url - the Napoli crest on the stadium background,
// no zoom dial - so main rendered the crest at scale 1 and it filled the card.
// Main now standardizes such crests (myt-main lib/events/crestArt.ts); this
// clears the event-level art so the three cards fall back to the automatic
// art instead (home crest VS away crest, or the team's standard crest).
//
// Usage (from the repo root, .env.local present):
//   node scripts/one-off-napoli-crest-cleanup-2026-09-18.mjs            # dry run
//   node scripts/one-off-napoli-crest-cleanup-2026-09-18.mjs --write    # apply
//
// Guarded: touches a row only while it still holds exactly that crest URL on
// shape 8, so a re-run (or art staff changed since) is a no-op.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const IDS = [1078, 1079, 1080];
const WRITE = process.argv.includes("--write");

function loadEnv() {
  const raw = fs.readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY,
);
const CREST_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/templates/napoli-logo-footylogos.png`;

const { data: rows, error } = await supabase
  .from("events")
  .select("id,name,art_image_url,art_shape_index,art_image_scale")
  .in("id", IDS)
  .eq("art_image_url", CREST_URL)
  .eq("art_shape_index", 8);
if (error) {
  console.error(JSON.stringify(error));
  process.exit(1);
}
console.log(`${rows.length} of ${IDS.length} events still carry the crest:`);
for (const r of rows) console.log(`  ${r.id}  ${r.name}`);

if (!WRITE) {
  console.log("\nDry run - nothing written. Re-run with --write to apply.");
} else if (rows.length) {
  const { data: updated, error: updateError } = await supabase
    .from("events")
    .update({ art_image_url: null, art_shape_index: null })
    .in("id", rows.map((r) => r.id))
    .eq("art_image_url", CREST_URL)
    .select("id");
  if (updateError) {
    console.error(JSON.stringify(updateError));
    process.exitCode = 1;
  } else {
    console.log(`\nCleared event-level art on: ${updated.map((r) => r.id).join(", ")}`);
    console.log("Main picks it up on its next events revalidation (save any event in the backoffice, or wait up to 1h).");
  }
}
