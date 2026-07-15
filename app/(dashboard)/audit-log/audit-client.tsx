"use client";

import { Fragment, useState, useTransition } from "react";
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
  from: string;
  to: string;
};

const emptyFilters: FilterState = {
  actorEmail: "",
  action: "all",
  entityType: "all",
  from: "",
  to: "",
};

export function AuditClient({ initialRows }: { initialRows: AuditRow[] }) {
  const [rows, setRows] = useState<AuditRow[]>(initialRows);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleApply = () => {
    startTransition(async () => {
      const result = await getAuditLogs({
        actorEmail: filters.actorEmail || undefined,
        action: filters.action === "all" ? undefined : filters.action,
        entityType: filters.entityType === "all" ? undefined : filters.entityType,
        from: filters.from || undefined,
        to: filters.to || undefined,
      });
      setRows(result);
    });
  };

  const toggleExpanded = (id: number) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          Track staff actions across the backoffice.
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
              {ENTITY_TYPES.map((entityType) => (
                <SelectItem key={entityType} value={entityType}>
                  {entityType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No audit log entries.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => toggleExpanded(row.id)}
                  >
                    <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{row.actor_email || "—"}</span>
                        {row.actor_role && (
                          <Badge variant="outline">{row.actor_role}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionBadgeVariant(row.action)}>{row.action}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.entity_type || "—"}
                      {row.entity_id ? ` #${row.entity_id}` : ""}
                    </TableCell>
                    <TableCell>{row.ip || "—"}</TableCell>
                  </TableRow>
                  {expandedId === row.id && (
                    <TableRow key={`${row.id}-details`}>
                      <TableCell colSpan={5}>
                        <pre className="text-xs overflow-x-auto">
                          {JSON.stringify(row.changes ?? row.metadata, null, 2)}
                        </pre>
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
