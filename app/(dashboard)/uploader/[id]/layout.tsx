import type { ReactNode } from "react";

// The board builds one show per server-action call (two supplier reads + two price quotes, ~6-12 s)
// and approve-all re-checks availability inside its own 55 s budget - the platform default would cut
// either off mid-way. Spec docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md §9.
export const maxDuration = 60;

export default function UploaderBoardLayout({ children }: { children: ReactNode }) {
  return children;
}
