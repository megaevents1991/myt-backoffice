"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { parseBrief } from "@/lib/actions/uploader-actions";
import { emptyPlan } from "@/lib/uploader/plan";
import type { UploaderRun } from "@/types/uploader.types";
import { BriefComposer } from "./brief-composer";
import { actionErrorText, PlanCard, type PlanSeed } from "./plan-card";
import { RunsList } from "./runs-list";

// /uploader's three stages: compose (the brief) -> plan (the "מה הבנתי" card) -> navigating (the
// run exists, the board is loading). The brief draft survives a refresh (sessionStorage); the plan
// card does not - a refresh lands back on the brief, one "פענח" away from it.

type Stage =
  | { name: "compose"; returned: boolean }
  | { name: "plan"; seed: PlanSeed }
  | { name: "navigating"; seed: PlanSeed; brief: string };

const isString = (v: unknown): v is string => typeof v === "string";

export function UploaderClient({
  runs,
  agentOn,
  briefMax,
}: {
  runs: UploaderRun[];
  /** agentEnabled(TOUR_UPLOADER_AGENT) on the server - off = the composer offers the manual plan. */
  agentOn: boolean;
  briefMax: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [brief, setBrief] = useSessionState<string>("uploader-brief", "", isString);
  const [stage, setStage] = useState<Stage>({ name: "compose", returned: false });
  const [parsing, setParsing] = useState(false);
  const seedId = useRef(0);

  async function parse() {
    if (parsing || brief.trim() === "" || brief.length > briefMax) return;
    setParsing(true);
    try {
      const res = await parseBrief(brief);
      if (!res.ok) {
        toast({ variant: "destructive", title: "הבריף לא פוענח", description: actionErrorText(res.kind) });
        return;
      }
      setStage({
        name: "plan",
        seed: {
          id: ++seedId.current,
          plan: res.plan,
          planAi: res.planAi,
          fromPrior: res.fromPrior,
          preview: res.preview,
          agent: res.agent,
          problems: res.problems,
        },
      });
    } catch {
      toast({ variant: "destructive", title: "הבריף לא פוענח", description: actionErrorText("") });
    } finally {
      setParsing(false);
    }
  }

  function openManual() {
    if (brief.length > briefMax) return;
    setStage({
      name: "plan",
      seed: { id: ++seedId.current, plan: emptyPlan(), planAi: null, fromPrior: [], preview: null, agent: "off", problems: [] },
    });
  }

  function created(runId: string) {
    if (stage.name !== "plan") return;
    setStage({ name: "navigating", seed: stage.seed, brief });
    // The brief now lives on the run; the next visit starts on an empty box (the card keeps quoting it).
    setBrief("");
    router.push(`/uploader/${runId}`);
  }

  return (
    <div className="space-y-10">
      {stage.name === "compose" ? (
        <BriefComposer
          value={brief}
          onChange={setBrief}
          max={briefMax}
          agentOn={agentOn}
          parsing={parsing}
          onParse={parse}
          onManual={openManual}
          autoFocus={stage.returned}
        />
      ) : (
        <PlanCard
          key={stage.seed.id}
          seed={stage.seed}
          brief={stage.name === "navigating" ? stage.brief : brief}
          navigating={stage.name === "navigating"}
          onEditBrief={() => setStage({ name: "compose", returned: true })}
          onCreated={created}
        />
      )}
      <RunsList runs={runs} />
    </div>
  );
}
