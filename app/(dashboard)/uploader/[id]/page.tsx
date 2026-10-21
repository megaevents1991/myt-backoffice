import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getRun } from "@/lib/actions/uploader-actions";
import { requireAdmin } from "@/lib/auth/guards";
import { BoardClient } from "./board-client";

// The review board of one tour-uploader run (spec docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md
// §5.3, §11, §13): every show the run found as a card - built hidden, waiting on a question, skipped -
// with approve / edit / reject. The client drives the build loop and keeps the view fresh.

// Admin-only (requireAdmin throws for anyone else - the route's error boundary renders instead),
// like /uploader itself: hiding the menu item is not the guard.
export default async function UploaderBoardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const view = await getRun(id);
  if (view === null) notFound();

  return (
    // useUrlState (?f=) reads the search params - a Suspense boundary keeps that legal on any render.
    <Suspense fallback={null}>
      {view.run === null ? (
        <BoardClient runId={id} initial={null} initialError={view.kind} />
      ) : (
        <BoardClient runId={id} initial={view} initialError={null} />
      )}
    </Suspense>
  );
}
