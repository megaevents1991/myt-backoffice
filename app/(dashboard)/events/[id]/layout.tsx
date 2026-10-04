import type { ReactNode } from "react";

// The editor's ready-package actions proxy slow supplier searches through main
// (one flight search and one hotel search per party size) - the default
// function window cuts them off mid-flight and the card reads it as "failed".
export const maxDuration = 120;

export default function EventEditorLayout({ children }: { children: ReactNode }) {
  return children;
}
