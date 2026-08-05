#!/usr/bin/env node
/**
 * PreToolUse hook for Bash/PowerShell — the PUSH GATE.
 *
 * Dor's rule: committing is fine, pushing is not — nothing leaves the machine
 * unless Dor asked for it. But when he HAS asked, the push should just run:
 * no permission prompt, no "are you sure".
 *
 * So the gate reads Dor's last message in the session transcript:
 *   - he asked to push  -> allow, silently (exit 0)
 *   - he didn't         -> deny, with a reason telling Claude to stop and ask
 *                          him in chat instead of pushing after a commit
 *   - can't tell        -> fall back to a permission prompt
 *
 * Matches `git push`, `git -C <dir> push`, `git commit && git push`, etc.
 */
const fs = require("fs");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

/** Text of a real user message, or null for tool results / meta / subagent turns. */
function userText(entry) {
  if (!entry || entry.type !== "user" || entry.isSidechain || entry.isMeta) return null;
  const content = entry.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content))
    text = content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
  // Drop harness-injected blocks (system reminders, slash-command wrappers).
  text = text.replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, "");
  text = text.replace(/<[a-z-]+>[\s\S]*$/g, (m) => (m.length > 200 ? "" : m));
  text = text.trim();
  return text || null;
}

function lastUserMessage(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const text = userText(entry);
    if (text) return text;
  }
  return null;
}

// "push it", "תדחוף", "/commit-push", "ship it" … English + Hebrew.
const PUSH_WORD =
  /(push|pushing|commit-push|ship it|דחוף|תדחוף|תדחף|לדחוף|פוש|דחיפה)/gi;
// A mention that is negated ("don't push", "אל תדחוף") does NOT count as a request.
const NEGATION = /(don'?t|do not|dont|never|without|no need to|instead of|אל |לא |בלי )\s*\S{0,12}\s*$/i;

function asksForPush(message) {
  let match;
  PUSH_WORD.lastIndex = 0;
  while ((match = PUSH_WORD.exec(message)) !== null) {
    const before = message.slice(Math.max(0, match.index - 24), match.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0);
  }

  const cmd = String(payload?.tool_input?.command || "");
  // `git ... push` within one command segment (covers `git -C <path> push`,
  // `git push --force`, and chained `git commit && git push`).
  if (!/\bgit\b[^|;&\n]*\bpush\b/i.test(cmd)) process.exit(0);

  let message = null;
  try {
    message = lastUserMessage(String(payload?.transcript_path || ""));
  } catch {
    /* unreadable transcript -> handled below */
  }

  if (message === null) {
    decide(
      "ask",
      "PUSH GATE: couldn't read the transcript to confirm Dor asked for this push. " +
        "Approve only if he actually did."
    );
  }

  if (asksForPush(message)) process.exit(0); // he asked — push, no prompt

  decide(
    "deny",
    "PUSH GATE: Dor's last message did not ask for a push, and a push must never " +
      "ride along after a commit. Stop here, report what you committed, and let him " +
      "say 'push' (or run /commit-push) when he's ready. Do not retry this command."
  );
}
main();
