-- AI Factory (spec docs/superpowers/specs/2026-09-16-price-light-gaps-ai-factory-design.md §5, §8):
-- taught rules an admin adds to an agent's memory from the "זיכרון ולימוד" tab. These ride WITH
-- the house rules on every call (lib/agents/memory.ts) - not evidence like the recorded
-- decisions, actual instructions, so only an admin may write one (enforced in
-- lib/actions/ai-factory-actions.ts, not here).
--
-- The length CHECK is a safety rail on a column an admin free-types into a prompt on every call,
-- not a business-value allow-list (the repo's "no CHECK on a column main writes" rule is about
-- the latter) - a 0-char or multi-page row would either teach nothing or blow the memory budget.

create table if not exists public.agent_instructions (
  id             uuid primary key default gen_random_uuid(),
  agent_key      text not null,
  text           text not null check (char_length(text) between 3 and 500),
  active         boolean not null default true,
  created_by     text,
  created_at     timestamptz not null default now(),
  deactivated_at timestamptz
);

create index if not exists agent_instructions_agent_active_idx
  on public.agent_instructions (agent_key, active, created_at desc);

-- Service-role only, like tasks / user_profiles: RLS on, no policies. Every access goes through
-- guarded server actions (lib/actions/ai-factory-actions.ts, requireAdmin).
alter table public.agent_instructions enable row level security;
