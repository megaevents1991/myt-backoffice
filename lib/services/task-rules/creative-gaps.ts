import { computeOpenCreativeGaps } from "@/lib/services/creative-gaps";
import { GAP_META } from "@/types/creative-gap.types";
import type { RuleGenerator } from "./types";

export const creativeGapsGenerator: RuleGenerator = {
  domain: "creative_gaps",
  label: "פערי קריאייטיב",
  screenUrl: "/tasks?tab=gaps",
  digestTitle: (count) => `פערי קריאייטיב — ${count} נכסים חסרים`,
  async candidates(match) {
    // strict: true - a per-kind DB failure must reject the whole call, not degrade to
    // an empty list for that kind. The /tasks gaps tab (listAllCreativeGaps) still calls
    // with no options and keeps showing a partial list on a failing kind; this generator
    // cannot, because the weekly cron auto-closes a digest task once candidates() returns
    // zero - a swallowed failure here would silently close an open digest. No try/catch:
    // the throw is meant to propagate out of candidates().
    const gaps = await computeOpenCreativeGaps({ strict: true });

    const kinds = match.kinds && match.kinds.length > 0 ? new Set(match.kinds) : null;
    // 0 = every gap, 1 = severe only - GapMeta only has "crit"/"warn", so "severe" means crit.
    const severeOnly = match.min_severity != null && match.min_severity >= 1;

    return gaps
      .filter((gap) => (kinds ? kinds.has(gap.kind) : true))
      .filter((gap) => (severeOnly ? GAP_META[gap.kind].severity === "crit" : true))
      .map((gap) => ({
        key: `${gap.kind}:${gap.table}:${gap.row_id}`,
        // Same title shape as gapPrefill() in tasks-client.tsx, so a gap reads
        // identically whether it became a task by hand or via the weekly rule.
        title: `${GAP_META[gap.kind].label}: ${gap.label}`,
        description: gap.detail ?? GAP_META[gap.kind].label,
        // Exactly what the "Do" button builds today (gapPrefill in tasks-client.tsx).
        sourceRef: {
          kind: gap.kind,
          table: gap.table,
          row_id: gap.row_id,
          label: gap.label,
          url: gap.fixUrl,
        },
      }));
  },
};
