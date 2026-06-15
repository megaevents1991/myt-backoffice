#!/usr/bin/env node
/**
 * PreToolUse hook for Bash(git commit:*).
 * Blocks (exit 2) when:
 *   (a) current branch is main/master  -> force a feature branch
 *   (b) commit message carries an AI co-author / "Generated with Claude" line
 * Fails open: any parse/exec error -> allow.
 */
const { execFileSync } = require("child_process");

function readStdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
  }
  const cmd = String(payload?.tool_input?.command || "");
  if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

  if (/Co-?Authored-?By:.*claude/i.test(cmd) || /Generated with .*Claude/i.test(cmd)) {
    console.error(
      "Blocked: commit message contains an AI co-author/attribution line. " +
        "Remove it (Dor's rule: no AI attribution in commits)."
    );
    process.exit(2);
  }

  let branch = "";
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    process.exit(0);
  }
  if (branch === "main" || branch === "master") {
    console.error(
      `Blocked: on '${branch}'. Create a feature branch first ` +
        "(e.g. `git switch -c fix/...`). Never commit to main/master."
    );
    process.exit(2);
  }
  process.exit(0);
}
main();
