#!/usr/bin/env node
/**
 * PreToolUse hook for Bash/PowerShell — the PUSH GATE.
 *
 * Dor's rule: committing is fine, pushing is not. Nothing leaves the machine
 * until Dor explicitly asks ("push" / "/commit-push"). This hook forces a
 * permission prompt on every push, so a push can never ride along silently
 * after a commit (and can't be auto-allowed by a `Bash(git push *)` allow rule
 * or by auto mode).
 *
 * Matches `git push`, `git -C <dir> push`, `git commit && git push`, etc.
 * Fails open: any parse/exec error -> allow (never wedge the session).
 */
function readStdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const REASON =
  "PUSH GATE (project hook): pushing requires Dor's explicit go-ahead. " +
  "Do NOT push just because you committed — stop, report the diff, and wait " +
  "for Dor to say 'push' or run /commit-push. If Dor already asked for this " +
  "push in the current turn, say so and let him approve the prompt.";

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
  }

  const cmd = String(payload?.tool_input?.command || "");
  // `git ... push` on a single command segment (covers `git -C <path> push`,
  // `git push --force`, and chained `git commit && git push`).
  if (!/\bgit\b[^|;&\n]*\bpush\b/i.test(cmd)) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: REASON,
      },
    })
  );
  process.exit(0);
}
main();
