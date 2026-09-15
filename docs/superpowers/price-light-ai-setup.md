# Turning the price-light AI on — the exact steps

The רמזור agent is built, wired and **off**. It fails closed: with no key, or with the switch
set to anything but `on`, every match is rule-only — exactly phase-0 behaviour, zero spend.
This is the order to turn it on, and how to stop it again.

Read this once end to end before step 1. The whole thing takes about 15 minutes, and the only
irreversible part is the money.

---

## 0. What you are turning on

| | |
|---|---|
| **What it does** | Decides the matches the rule matcher could not: picks which competitor listing is the same event as ours, and reads what the listing includes (nights, stars, bag, breakfast, transfers, direct flight). |
| **What it never does** | Set a light. Write a price. Touch `price-quote.ts`, `base-price-sync` or anything a customer pays. The light is still arithmetic; the AI only supplies better inputs to it. |
| **Model** | `claude-opus-5` (override with `PRICE_LIGHT_AI_MODEL`). |
| **Ceiling** | `AI_CALLS_PER_RUN = 40` per nightly run. Past it, matching finishes rule-only. |
| **Per call** | ~$0.02–0.04. One full catch-up pass over today's ~110 unresolved pairs ≈ **$3 one-time**, then a handful of calls a night as listings change. |
| **Caching** | One call per (event, listing) pair. A verdict is reused until that listing changes; an `unsure` with no listing is not re-asked until a candidate changes. Cached reuse costs nothing and is marked `cached: true`. |

## 1. Create the console account and key

1. Go to **console.anthropic.com** → sign up with the MYT billing address (this is a
   *console* account, separate from any Claude.ai or Claude Code subscription — a subscription
   seat **cannot** authenticate this, the cron calls the API server-to-server).
2. Add a payment method, then set a **monthly spend limit of $20**. The code has its own
   ceilings, but the account limit is the one nobody can bypass by editing code.
3. **API keys → Create key**, name it `myt-price-light`. Copy it — it starts `sk-ant-`.
   Console shows it once.

## 2. Put the key in Vercel

Project **mega-events-backoffice** → Settings → Environment Variables.

- `ANTHROPIC_API_KEY` already exists as an empty placeholder slot. **Edit it**, paste the key,
  and tick **Production + Preview + Development**.
- Leave `PRICE_LIGHT_AI` alone for now. The key on its own spends nothing.
- Redeploy (or wait for the next deploy) so the new value is picked up.

The shape check is deliberate: `anthropicKey()` accepts a value only if it starts `sk-ant-`, so
a placeholder or a half-pasted key counts as **no key** (rule-only) instead of turning every
match into a 401 nobody notices.

## 3. Prove it on one event — before any run spends money

Locally, with the same key in `.env.local` (`ANTHROPIC_API_KEY=sk-ant-…` and
`PRICE_LIGHT_AI=on`):

```bash
npx tsx --env-file=.env.local scripts/price-light-judge-smoke.ts 717
```

It prints, in order:

1. the model id it will use,
2. **the agent's memory** — the house rules generated from our pricing constants, plus every
   staff correction it has learned so far (this is the "what does it actually know" answer),
3. the candidates it found for that event,
4. the full verdict JSON, and
5. the real cost of that one call.

If the judge is off it tells you *which* switch is wrong instead of printing a bland verdict.
**Expected: one call, a few cents, `same_event` with a confidence, and attrs that match what
the competitor's page actually says.** Open the listing URL and check the nights — that is the
field the whole duration pass turns on.

## 4. Turn it on for the nightly

Vercel → the same env screen → set `PRICE_LIGHT_AI` = `on` (Production + Preview), redeploy.

Nothing else changes: the nightly cron (00:15 UTC) picks it up on its next run. Its summary
email reports `AI n/40 calls`, and `/price-light` shows the month's AI cost in its header line.

**Watch the first two nights.** Expected: 30–40 calls the first night (the backlog), then
single digits. If the first night reports 40/40 two nights running, the budget is the binding
constraint, not the backlog — say so and we raise it deliberately rather than by accident.

## 5. How to stop it

Set `PRICE_LIGHT_AI` to anything else (`off`, or delete the variable) and redeploy. Matching
returns to rule-only immediately; no data is lost, every verdict already stored stays.
Deleting the key does the same thing.

---

## The learning loop — this is the part that makes it an agent

The judge is not a static prompt. Its system prompt is assembled on every call, from two blocks:

1. **House rules, generated from the engine's own constants** (`lib/services/price-light.ts`).
   Never hand-copied, so when we tune a rule — the way the duration pass on 2026-09-13 changed
   how a night is priced — the model is told the new rule on its very next call. The arithmetic
   and the AI cannot drift apart.
2. **The marks your team leaves on `/price-light`.** Every decision now records *what the
   comparison looked like when it was made* — scope, light, the gap, which competitor, both
   normalized prices, both durations — and the agent reads the newest ten back (within 120 days):

   | The mark | What the agent takes from it |
   |---|---|
   | **דריסה** | The only one carrying your own sentence ("איסתא מוכרים 3 לילות, אנחנו 4"). The sharpest signal there is, and the one that speaks directly about matching. |
   | **הוזל** | A human judged the gap REAL and went to cut our price. |
   | **הסר מהאתר** | A human would rather pull the event than match that price. |
   | **השאר בפיד** | A human looked and decided we stay pricier here on purpose. |
   | **משימה** | A human opened a task to chase the gap. |

   So a fix you make today is context the agent has tomorrow night. **`הוזל` used to be a bare
   link** — the strongest signal we had left no trace at all until 2026-09-13.

Two honest limits:

- Marks are quoted as **data, never as instructions** — nothing in them can change the rules or
  the schema the agent answers in. That is a security property, not an oversight: they are free
  text typed into a form, and a prompt that obeys them is a prompt anyone with form access can
  rewrite.
- Four of the five marks are *outcomes* ("what we did"), not matching corrections. They are
  market evidence; only the override note tells the agent it matched the wrong listing. A
  dedicated "this match is wrong" button — writing a `method: "manual"` row the judge learns from
  directly — is the obvious next step.

## Ground prepared for the next agents

The price light is **agent #1 of a registry**, not a one-off. `lib/agents/` holds what every agent
needs: the declaration shape, the registry, the switches (per-agent plus a master `AI_AGENTS=off`
that stops all of them at once), the run budget, the cost maths and the memory assembly. Adding the
next agent — for creatives, pricing, tasks, anything — is a `<name>.agent.ts` declaring its model,
ceilings, house rules and which recorded decisions it learns from, one line in the registry, and one
env switch. None of this feature's plumbing gets copied.

## Where each piece lives

| Piece | File |
|---|---|
| What an agent IS | `lib/agents/types.ts` |
| This agent's declaration | `lib/agents/price-light.agent.ts` |
| Registry | `lib/agents/index.ts` |
| Switches, key, budget, cost | `lib/agents/switch.ts` |
| Memory assembly (rules + marks) | `lib/agents/memory.ts` |
| The one AI call site | `lib/services/price-light-judge.ts` (`extractAndJudge`) |
| Its only production caller | `lib/services/price-light-match.ts` |
| Thresholds, normalization, the light itself | `lib/services/price-light.ts` |
| Agent-layer selftest | `scripts/agents-selftest.ts` |
| Smoke test (one real call) | `scripts/price-light-judge-smoke.ts` |
| Cost this month | `/price-light` header, `aiCostThisMonth()` |
