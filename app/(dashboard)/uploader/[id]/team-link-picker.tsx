"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchTeamsForLink } from "@/lib/actions/uploader-actions";
import { LINK_QUERY_MAX, linkQueryOf, type LinkTeam } from "@/lib/uploader/team-names";
import { actionErrorText } from "../copy";
import { LINK_CLOSE, LINK_INACTIVE, LINK_NONE, LINK_SEARCH_FAILED, LINK_SEARCH_HINT, LINK_SEARCH_LABEL, LINK_SEARCH_PLACEHOLDER, NETWORK_TEXT } from "./board-words";

// "זה עמוד קיים" (round 2, spec 5): a search over every `football_teams` page (Hebrew + English, inactive ones
// too) for the names dialog. The query goes to the server `DEBOUNCE_MS` after the last key; an answer that is
// no longer for the box's text is dropped. Picking a page hands it to the row; the X closes the search.

/** How long the box waits for the last key before it asks the server. */
export const LINK_DEBOUNCE_MS = 250;

type Phase = { kind: "idle" } | { kind: "loading" } | { kind: "done"; teams: LinkTeam[] } | { kind: "failed"; text: string };

export function TeamLinkPicker({ disabled, onPick, onClose }: { disabled: boolean; onPick: (team: LinkTeam) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const seq = useRef(0);

  // Debounced search. A new keystroke (or closing) invalidates the call in flight through `seq`.
  useEffect(() => {
    const q = linkQueryOf(query);
    const id = ++seq.current;
    if (q === null) {
      setPhase({ kind: "idle" });
      return;
    }
    const timer = window.setTimeout(() => {
      setPhase({ kind: "loading" });
      searchTeamsForLink(q)
        .then((r) => {
          if (id !== seq.current) return;
          setPhase(r.ok ? { kind: "done", teams: r.teams } : { kind: "failed", text: actionErrorText(r.kind) });
        })
        .catch(() => {
          if (id === seq.current) setPhase({ kind: "failed", text: NETWORK_TEXT });
        });
    }, LINK_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      seq.current += 1;
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            maxLength={LINK_QUERY_MAX}
            disabled={disabled}
            placeholder={LINK_SEARCH_PLACEHOLDER}
            aria-label={LINK_SEARCH_LABEL}
            onChange={(ev) => setQuery(ev.target.value)}
            className="h-8 ps-8 text-[13px]"
          />
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={LINK_CLOSE} onClick={onClose}>
          <X aria-hidden className="h-4 w-4" />
        </Button>
      </div>

      {phase.kind === "idle" && <p className="text-xs text-muted-foreground">{LINK_SEARCH_HINT}</p>}
      {phase.kind === "loading" && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        </p>
      )}
      {phase.kind === "failed" && (
        <p role="alert" className="text-xs text-destructive">
          {LINK_SEARCH_FAILED} {phase.text}
        </p>
      )}
      {phase.kind === "done" && phase.teams.length === 0 && <p className="text-xs text-muted-foreground">{LINK_NONE}</p>}
      {phase.kind === "done" && phase.teams.length > 0 && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border bg-background text-[13px]">
          {phase.teams.map((team) => (
            <li key={team.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(team)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
              >
                <bdi className="font-medium">{team.name}</bdi>
                {team.name_english && (
                  <>
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                    <bdi dir="ltr" className="text-muted-foreground">
                      {team.name_english}
                    </bdi>
                  </>
                )}
                {!team.is_active && <span className="ms-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{LINK_INACTIVE}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
