/**
 * Refuse `npm run db:push` unless it is safe.
 *
 * Why this exists: `supabase db push` writes to the SHARED PRODUCTION database.
 * Pushing from a feature branch applies migration files that exist only on that
 * branch, so the remote migration-history table gains versions master has never
 * seen - and every later push from master or CI then fails with
 * "Remote migration versions not found in local migrations directory".
 *
 * Migrations should land the same way code does: merge to master, then let the
 * "Apply DB Migrations" workflow apply them.
 *
 * Emergency override: ALLOW_DB_PUSH=1 npm run db:push
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const RESET = "[0m";
const RED = "[31m";
const YELLOW = "[33m";
const BOLD = "[1m";

// execFileSync with an argument array: no shell, so nothing here is interpreted.
function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(title, lines) {
  console.error(`\n${RED}${BOLD}✖ db:push blocked - ${title}${RESET}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(
    `\n  ${YELLOW}Override for a real emergency:${RESET} ALLOW_DB_PUSH=1 npm run db:push\n`,
  );
  process.exit(1);
}

if (process.env.ALLOW_DB_PUSH === "1") {
  console.warn(
    `${YELLOW}⚠ ALLOW_DB_PUSH=1 - skipping the db:push safety checks.${RESET}`,
  );
  process.exit(0);
}

let branch;
try {
  branch = git("rev-parse", "--abbrev-ref", "HEAD");
} catch {
  fail("not a git repository", ["Run this from the repo root."]);
}

if (branch !== "master") {
  fail(`you are on "${branch}", not master`, [
    "supabase db push applies every local migration to the PRODUCTION database.",
    "Migrations on a feature branch would be applied before the branch merges,",
    "leaving master unable to push until someone copies the files across.",
    "",
    "Do this instead:",
    "  1. Open a PR and merge the migration to master",
    "  2. GitHub → Actions → Apply DB Migrations → Run workflow",
  ]);
}

// Uncommitted migrations are the same hazard: applied to prod, absent from git.
const status = git("status", "--porcelain", "--", "supabase/migrations");
if (status) {
  fail("you have uncommitted migration files", [
    "These would be applied to production but exist on no branch:",
    "",
    ...status.split("\n").map((line) => `  ${line}`),
    "",
    "Commit and push them to master first.",
  ]);
}

try {
  execFileSync("git", ["fetch", "origin", "master", "--quiet"], {
    stdio: "ignore",
  });
  const behind = git("rev-list", "--count", "HEAD..origin/master");
  if (behind !== "0") {
    fail(`your master is ${behind} commit(s) behind origin/master`, [
      "Someone else's migrations may already be applied to production.",
      "Run: git pull --ff-only",
    ]);
  }
  const ahead = git("rev-list", "--count", "origin/master..HEAD");
  if (ahead !== "0") {
    fail(`your master is ${ahead} commit(s) ahead of origin/master`, [
      "Push to origin first so the migration exists for everyone else:",
      "  git push origin master",
    ]);
  }
} catch (error) {
  if (error?.status === 1) throw error;
  console.warn(
    `${YELLOW}⚠ Could not reach origin to compare branches - continuing.${RESET}`,
  );
}

// Two files sharing a version prefix make the applied version ambiguous.
const versions = new Map();
for (const file of readdirSync("supabase/migrations")) {
  const version = file.match(/^(\d+)_/)?.[1];
  if (!version) continue;
  if (versions.has(version)) {
    fail(`two migrations share the version ${version}`, [
      `  ${versions.get(version)}`,
      `  ${file}`,
      "",
      "Rename the newer one to a later timestamp.",
    ]);
  }
  versions.set(version, file);
}

console.log(
  "✓ db:push checks passed - on master, in sync, no version clashes.",
);
