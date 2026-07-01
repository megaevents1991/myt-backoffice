#!/usr/bin/env node
/**
 * Stop hook: run eslint + tsc on session end, surface REAL failures back to Claude.
 * - Build ignores TS errors (next.config), so `tsc --noEmit` is the real type gate.
 * - Loop guard via stop_hook_active. Uses npm (this repo's package manager).
 * - FAIL-OPEN: never block on the hook's own infrastructure problems —
 *   missing node_modules, binary not found, or a non-zero exit with no output.
 *   Only block (exit 2) when a tool produced actual diagnostic output.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// {status: 'pass' | 'findings' | 'skip', out}
function run(file, args, cwd) {
  try {
    execFileSync(file, args, { encoding: "utf8", stdio: "pipe", cwd });
    return { status: "pass", out: "" };
  } catch (e) {
    if (e && e.code) return { status: "skip", out: "" }; // ENOENT etc — binary missing
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    return out ? { status: "findings", out } : { status: "skip", out: "" };
  }
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
  }
  if (payload?.stop_hook_active) process.exit(0); // loop guard

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!fs.existsSync(path.join(root, "node_modules"))) process.exit(0); // deps not installed -> skip

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  const tsc = run(npx, ["tsc", "--noEmit"], root);
  const lint = run(npm, ["run", "lint"], root);

  const blocks = [];
  if (tsc.status === "findings") blocks.push(`[tsc --noEmit]\n${tsc.out.slice(-4000)}`);
  if (lint.status === "findings") blocks.push(`[npm run lint]\n${lint.out.slice(-4000)}`);

  if (!blocks.length) process.exit(0); // pass or skipped — let the session stop

  console.error("Pre-stop checks failed — fix before wrapping up:\n\n" + blocks.join("\n\n"));
  process.exit(2);
}
main();
