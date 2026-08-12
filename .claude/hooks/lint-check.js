#!/usr/bin/env node
/**
 * Stop hook: typecheck + lint what THIS SESSION edited, surface real failures
 * back to Claude before it wraps up.
 *
 * - Scoped to the .ts/.tsx files the session touched (Edit/Write tool calls in
 *   the transcript). The repo carries pre-existing tsc/eslint errors and Dor's
 *   working tree stays dirty across sessions, so checking the whole repo (or
 *   the git delta) would block every stop on someone else's mess.
 * - tsc must run project-wide (types are global) - its findings are filtered
 *   to the session's files. eslint runs on those files only (`next lint --file`).
 * - Windows: .cmd shims (npx/npm) can't be spawned without a shell on
 *   Node >= 21.7 (spawn EINVAL) - that's why the previous version of this hook
 *   silently never ran. Everything goes through the platform shell now.
 * - FAIL-OPEN on infrastructure problems (missing deps, spawn errors, empty
 *   output). Block (exit 2) only when a tool produced real diagnostics.
 * - Loop guard via stop_hook_active.
 */
const { spawnSync } = require("child_process");
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
function run(cmdline, cwd) {
  try {
    const r = spawnSync(cmdline, {
      encoding: "utf8",
      cwd,
      shell: true,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (r.error) return { status: "skip", out: "" };
    if (r.status === 0) return { status: "pass", out: "" };
    const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
    return out ? { status: "findings", out } : { status: "skip", out: "" };
  } catch {
    return { status: "skip", out: "" };
  }
}

/** Repo-relative forward-slash .ts/.tsx paths the session edited (lowercased). */
function sessionFiles(transcriptPath, root) {
  const files = new Set();
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  } catch {
    return files;
  }
  for (const line of lines) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== "tool_use") continue;
      if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name || "")) continue;
      const fp = c.input?.file_path || c.input?.notebook_path;
      if (!fp) continue;
      const rel = path
        .relative(root, path.resolve(String(fp)))
        .replace(/\\/g, "/");
      if (rel.startsWith("..") || !/\.(ts|tsx)$/.test(rel)) continue; // outside repo / not TS
      if (rel.startsWith(".next/")) continue;
      files.add(rel.toLowerCase());
    }
  }
  return files;
}

/** Keep only the tsc error blocks whose file is one the session edited. */
function filterTsc(out, files) {
  const kept = [];
  let keeping = false;
  for (const line of out.split(/\r?\n/)) {
    const m = /^(.+?)\(\d+,\d+\): error TS/.exec(line);
    if (m) keeping = files.has(m[1].replace(/\\/g, "/").toLowerCase());
    else if (/^\S/.test(line)) keeping = false; // non-indented, non-error line
    if (keeping) kept.push(line); // indented lines ride with their error
  }
  return kept.join("\n").trim();
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

  const files = sessionFiles(String(payload?.transcript_path || ""), root);
  if (!files.size) process.exit(0); // session touched no TS files -> nothing to gate

  const blocks = [];

  const tsc = run("npx tsc --noEmit", root);
  if (tsc.status === "findings") {
    const own = filterTsc(tsc.out, files);
    if (own)
      blocks.push(
        `[tsc --noEmit - files edited this session]\n${own.slice(-4000)}`,
      );
  }

  const fileArgs = [...files].map((f) => `--file "${f}"`).join(" ");
  const lint = run(`npx next lint ${fileArgs}`, root);
  if (lint.status === "findings")
    blocks.push(
      `[next lint - files edited this session]\n${lint.out.slice(-4000)}`,
    );

  if (!blocks.length) process.exit(0); // pass or skipped - let the session stop

  console.error(
    "Pre-stop checks failed in files you edited - fix before wrapping up:\n\n" +
      blocks.join("\n\n"),
  );
  process.exit(2);
}
main();
