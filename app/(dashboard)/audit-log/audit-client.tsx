"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useSessionState } from "@/hooks/use-view-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAuditLogs, type AuditRow } from "@/lib/actions/audit-actions";
import { FLIGHT_FIELD_BY_KEY } from "@/components/flight-field-groups";
import {
  EVENT_FIELD_LABELS,
  auditDiffRows,
  auditEntityHref,
  auditSearchText,
  changedKeys,
  formatAuditTime,
  formatAuditValue,
  humanizeKey,
  isSensitiveKey,
  matchesAuditSearch,
} from "@/lib/audit-display";

const ACTIONS = [
  "create",
  "update",
  "delete",
  "login",
  "login_failed",
  "logout",
  "user_created",
  "user_updated",
  "user_disabled",
  "password_reset",
  "sync_triggered",
  "quote_created",
  "pdf_generated",
] as const;

const ENTITY_TYPES = [
  "event",
  "coupon",
  "partner",
  "reservation",
  "location",
  "offline_flight",
  "offline_hotel",
  "offline_hotel_room",
  "storage",
  "user",
  "creative",
  "artists",
  "blog_posts",
  "categories",
  "football_teams",
  "live",
  "p1",
  "sports",
  "tixstock",
  "quote",
] as const;

const DESTRUCTIVE_ACTIONS = new Set(["delete", "login_failed", "user_disabled"]);
const NEUTRAL_ACTIONS = new Set(["login", "logout"]);

function actionBadgeVariant(action: string) {
  if (DESTRUCTIVE_ACTIONS.has(action)) return "destructive" as const;
  if (NEUTRAL_ACTIONS.has(action)) return "secondary" as const;
  return "default" as const;
}

type FilterState = {
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
};

const emptyFilters: FilterState = {
  actorEmail: "",
  action: "all",
  entityType: "all",
  entityId: "",
  from: "",
  to: "",
};

const isFilterState = (v: unknown): v is FilterState => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (Object.keys(emptyFilters) as (keyof FilterState)[]).every((k) => typeof o[k] === "string");
};

const FLIGHT_TYPES = new Set(["offline_flight", "flight"]);

/** The form's own label for a changed column, else the key read as words. */
function fieldLabel(entityType: string | null | undefined, key: string): string {
  if (entityType && FLIGHT_TYPES.has(entityType)) {
    const label = FLIGHT_FIELD_BY_KEY.get(key)?.label;
    if (label) return label;
  }
  if (entityType === "event" && EVENT_FIELD_LABELS[key]) return EVENT_FIELD_LABELS[key];
  return humanizeKey(key);
}

export function AuditClient({
  initialRows,
  initialFilters,
}: {
  initialRows: AuditRow[];
  /** From the URL (`?entity=…&id=…`): the rows arrived filtered to it. */
  initialFilters?: Partial<FilterState> | null;
}) {
  const [rows, setRows] = useState<AuditRow[]>(initialRows);
  // Remembered for the browser tab (hooks/use-view-state.ts) - a refresh used to clear them.
  const [storedFilters, setFilters] = useSessionState<FilterState>("filters", emptyFilters, isFilterState);
  const filters: FilterState = { ...emptyFilters, ...storedFilters };
  const [search, setSearch] = useSessionState<string>("search", "");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = (next: FilterState) => {
    startTransition(async () => {
      const entityId = next.entityId.trim();
      const result = await getAuditLogs({
        actorEmail: next.actorEmail || undefined,
        action: next.action === "all" ? undefined : next.action,
        entityType: next.entityType === "all" ? undefined : next.entityType,
        entityId: entityId || undefined,
        from: next.from || undefined,
        to: next.to || undefined,
        // One entity's whole story is short; give it every row we keep.
        limit: entityId ? 500 : undefined,
      });
      setRows(result);
    });
  };

  const handleApply = () => load(filters);

  const handleClear = () => {
    setFilters(emptyFilters);
    setSearch("");
    load(emptyFilters);
  };

  // A link to one entity's history wins over the remembered filters - the page
  // arrived with the rows of that entity. Otherwise the page arrives with the
  // UNFILTERED rows and restored filters have to be applied once, or the boxes
  // would say one thing and the table another.
  useEffect(() => {
    if (initialFilters) {
      setFilters({ ...emptyFilters, ...initialFilters });
      return;
    }
    if (JSON.stringify(filters) !== JSON.stringify(emptyFilters)) handleApply();
    // Mount only - afterwards the Apply button decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The search box narrows the rows on screen (every word, any order, over the
  // actor, the entity, its label and every value of the change) - no new read.
  const searchable = useMemo(() => rows.map((row) => ({ row, text: auditSearchText(row) })), [rows]);
  const visible = useMemo(() => {
    const q = search.trim();
    if (!q) return rows;
    return searchable.filter((s) => matchesAuditSearch(s.text, q)).map((s) => s.row);
  }, [rows, searchable, search]);

  const entityTypeOptions: string[] =
    filters.entityType !== "all" && !(ENTITY_TYPES as readonly string[]).includes(filters.entityType)
      ? [filters.entityType, ...ENTITY_TYPES]
      : [...ENTITY_TYPES];

  const toggleExpanded = (id: number) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  /** The "history" link on a row: the screen narrows to that one entity. */
  const showHistoryOf = (row: AuditRow) => {
    if (!row.entity_type || !row.entity_id) return;
    const next = { ...emptyFilters, entityType: row.entity_type, entityId: row.entity_id };
    setFilters(next);
    setSearch("");
    load(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          Track staff actions across the backoffice. Rows are kept 30 days; a row opens to the
          fields it changed, before and after.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-md border p-4">
        <div className="space-y-1.5">
          <Label htmlFor="audit-actor-email">Actor email</Label>
          <Input
            id="audit-actor-email"
            value={filters.actorEmail}
            onChange={(e) => setFilters({ ...filters, actorEmail: e.target.value })}
            placeholder="name@example.com"
            className="w-56"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Action</Label>
          <Select
            value={filters.action}
            onValueChange={(v) => setFilters({ ...filters, action: v })}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Entity type</Label>
          <Select
            value={filters.entityType}
            onValueChange={(v) => setFilters({ ...filters, entityType: v })}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entityTypeOptions.map((entityType) => (
                <SelectItem key={entityType} value={entityType}>
                  {entityType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-entity-id">Entity ID</Label>
          <Input
            id="audit-entity-id"
            value={filters.entityId}
            onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
            placeholder="57"
            className="w-28"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            className="w-40"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input
            id="audit-to"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            className="w-40"
          />
        </div>

        <Button onClick={handleApply} disabled={isPending}>
          {isPending ? "Loading..." : "Apply"}
        </Button>
        <Button variant="ghost" onClick={handleClear} disabled={isPending}>
          Clear
        </Button>

        <div className="ml-auto space-y-1.5">
          <Label htmlFor="audit-search">Search the rows on screen</Label>
          <Input
            id="audit-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="20/07, LY123, a name, an email…"
            className="w-72"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {search.trim()
          ? `${visible.length} of ${rows.length} loaded rows match the search`
          : `${rows.length} rows (the newest ${filters.entityId.trim() ? 500 : 200} that match the filters)`}
      </p>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table look="list">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>What changed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {rows.length === 0 ? "No audit log entries." : "No row on screen matches the search."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => toggleExpanded(row.id)}
                  >
                    <TableCell className="whitespace-nowrap">{formatAuditTime(row.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{row.actor_email || "-"}</span>
                        {row.actor_role && (
                          <Badge variant="outline">{row.actor_role}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionBadgeVariant(row.action)}>{row.action}</Badge>
                    </TableCell>
                    <TableCell>
                      <EntityCell row={row} onHistory={() => showHistoryOf(row)} />
                    </TableCell>
                    <TableCell className="max-w-[28rem]">
                      <ChangedSummary row={row} />
                    </TableCell>
                  </TableRow>
                  {expandedId === row.id && (
                    <TableRow key={`${row.id}-details`}>
                      <TableCell colSpan={5} className="bg-muted/30">
                        <ChangesPanel row={row} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** The entity by its own name, linked to its page, with a way to its whole history. */
function EntityCell({ row, onHistory }: { row: AuditRow; onHistory: () => void }) {
  if (!row.entity_type) return <span>-</span>;
  const ref = `${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ""}`;
  const href = auditEntityHref(row.entity_type, row.entity_id);
  const name = row.entity_label ? (
    <span className="font-medium">{row.entity_label}</span>
  ) : null;
  return (
    <div className="flex flex-col gap-0.5">
      {href ? (
        <Link
          href={href}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
          title="Open"
        >
          {name ?? <span className="font-medium">{ref}</span>}
        </Link>
      ) : (
        name ?? <span className="font-medium">{ref}</span>
      )}
      <span className="text-xs text-muted-foreground">
        {name ? ref : null}
        {row.entity_id && (
          <>
            {name ? " · " : ""}
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onHistory();
              }}
            >
              history
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** The changed fields by name on the row itself - no need to open it to know. */
function ChangedSummary({ row }: { row: AuditRow }) {
  const keys = changedKeys(row.changes);
  if (keys.length === 0) {
    const meta =
      row.metadata && typeof row.metadata === "object" ? Object.keys(row.metadata as object) : [];
    return <span className="text-muted-foreground">{meta.length ? meta.join(", ") : "—"}</span>;
  }
  const shown = keys.slice(0, 4);
  return (
    <span className="text-sm">
      {shown.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && ", "}
          <span className={isSensitiveKey(key) ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
            {fieldLabel(row.entity_type, key)}
          </span>
        </Fragment>
      ))}
      {keys.length > shown.length && (
        <span className="text-muted-foreground"> +{keys.length - shown.length}</span>
      )}
    </span>
  );
}

/** Field by field, before and after - a create lists its values. */
function ChangesPanel({ row }: { row: AuditRow }) {
  const diff = auditDiffRows(row.changes);
  const isUpdate = diff.length > 0 && diff[0].pair;
  const meta = row.metadata && typeof row.metadata === "object" && Object.keys(row.metadata as object).length > 0
    ? JSON.stringify(row.metadata)
    : null;
  return (
    <div className="space-y-3 py-1">
      {diff.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-4 font-medium">Field</th>
              {isUpdate ? (
                <>
                  <th className="py-1 pr-4 font-medium">Before</th>
                  <th className="py-1 pr-4 font-medium">After</th>
                </>
              ) : (
                <th className="py-1 pr-4 font-medium">Value</th>
              )}
            </tr>
          </thead>
          <tbody>
            {diff.map((d) => {
              const moved = d.pair && JSON.stringify(d.from) !== JSON.stringify(d.to);
              const hot = moved && isSensitiveKey(d.key);
              return (
                <tr
                  key={d.key}
                  className={`border-t border-border/60 align-top ${hot ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                >
                  <td className="py-1.5 pr-4" title={d.key}>
                    <span className={hot ? "font-medium" : ""}>{fieldLabel(row.entity_type, d.key)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{d.key}</span>
                  </td>
                  {d.pair ? (
                    <>
                      <td className="py-1.5 pr-4 text-muted-foreground" dir="auto">
                        {formatAuditValue(d.from, 400)}
                      </td>
                      <td className={`py-1.5 pr-4 ${hot ? "font-medium" : ""}`} dir="auto">
                        {formatAuditValue(d.to, 400)}
                      </td>
                    </>
                  ) : (
                    <td className="py-1.5 pr-4" dir="auto">
                      {formatAuditValue(d.to, 400)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <pre className="text-xs overflow-x-auto">
          {JSON.stringify(row.changes ?? row.metadata, null, 2)}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">
        {row.ip ? `IP ${row.ip}` : "No IP"}
        {row.actor_id ? ` · actor ${row.actor_id}` : ""}
        {meta && diff.length > 0 ? ` · ${meta}` : ""}
      </p>
    </div>
  );
}
