"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";
import {
  listTagRules, createTagRule, updateTagRule, deleteTagRule, runTagRules,
  type TagRuleWithTag,
} from "@/lib/actions/tag-rule-actions";
import type { EventTag, TagRuleField } from "@/types/taxonomy.types";

export function RulesManager({
  initialRules,
  tags,
}: {
  initialRules: TagRuleWithTag[];
  tags: EventTag[];
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [rules, setRules] = useState(initialRules);
  const [tagId, setTagId] = useState("");
  const [field, setField] = useState<TagRuleField>("name");
  const [pattern, setPattern] = useState("");
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(false);
  const addingRef = useRef(false);

  const refresh = async () => setRules(await listTagRules());

  const add = async () => {
    if (addingRef.current) return;
    if (!tagId || !pattern.trim()) {
      toast({ variant: "destructive", title: "Tag + pattern required" });
      return;
    }
    addingRef.current = true;
    setAdding(true);
    try {
      await createTagRule({ tag_id: Number(tagId), field, pattern });
      setPattern("");
      await refresh();
      toast({ title: "Rule added" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const toggle = async (r: TagRuleWithTag, on: boolean) => {
    try {
      await updateTagRule(r.id, { is_active: on });
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    }
  };

  const remove = async (r: TagRuleWithTag) => {
    if (
      !(await confirm({
        title: `Delete rule "${r.pattern}" → ${r.tag_name}?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteTagRule(r.id);
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    }
  };

  const runAll = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await runTagRules();
      toast({
        title: "Rules applied",
        description: `${res.eventsScanned} events scanned, ${res.linksAdded} tag links added.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={tagId} onValueChange={setTagId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            {tags.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name} · {t.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={field} onValueChange={(v) => setField(v as TagRuleField)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Event name contains</SelectItem>
            <SelectItem value="city">City IATA equals</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-56"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={field === "city" ? "LON" : "Arsenal"}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button onClick={add} disabled={adding}>
          {adding ? "Adding..." : "Add rule"}
        </Button>
        <Button variant="secondary" onClick={runAll} disabled={running}>
          {running ? "Running..." : "Run rules on all events"}
        </Button>
      </div>

      <div className="rounded-md border">
        {rules.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No rules yet.</div>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-1.5 px-2 border-b">
            <span className="flex-1 text-sm">
              <span className="font-mono">{r.pattern}</span>
              <span className="text-muted-foreground">
                {" "}({r.field === "city" ? "city IATA" : "name contains"})
              </span>
              {" → "}
              <span className="font-semibold">{r.tag_name}</span>
              <span className="text-xs text-muted-foreground"> · {r.tag_slug}</span>
            </span>
            <Switch
              checked={r.is_active}
              onCheckedChange={(v) => toggle(r, v)}
              aria-label={`Rule ${r.pattern} active`}
            />
            <Button size="sm" variant="ghost" onClick={() => remove(r)}>
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
