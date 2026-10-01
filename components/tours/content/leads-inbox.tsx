"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, RotateCcw } from "lucide-react";
import { toast } from "react-hot-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/data-table";
import { useSessionState } from "@/hooks/use-view-state";
import { exportLeads, getLeadsMeta, listLeads, updateLead } from "@/lib/actions/tours-leads-actions";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import { EmptyRows, LoadError } from "@/components/tours/content/save-bar";
import {
  EMPTY_LEAD_FILTERS,
  LEADS_PAGE_SIZE,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  formatDayTime,
  leadStatusLabel,
  type LeadFilters,
  type LeadRow,
  type LeadsMeta,
  type LeadsPage,
  type LeadStatus,
} from "@/components/tours/content/shared";

const ALL = "all";
const NOBODY = "nobody";
const kindLabel = (kind: string) => LEAD_KIND_LABELS[kind] ?? kind;

const STATUS_VARIANT: Record<LeadStatus, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  in_progress: "secondary",
  done: "outline",
  spam: "destructive",
};
const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={STATUS_VARIANT[status as LeadStatus] ?? "outline"}>{leadStatusLabel(status)}</Badge>
);

const display = (value: unknown): string =>
  value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);

function download(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Everything the site's forms sent: filter, read, set a status, hand to a teammate, export. */
export function LeadsInbox() {
  const [filters, setFilters] = useSessionState<LeadFilters>("filters", EMPTY_LEAD_FILTERS);
  const [search, setSearch] = useState(filters.q);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<LeadsPage | null>(null);
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const request = useRef(0);

  // the free-text box filters a beat after the last keystroke
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => {
      setPage(0);
      setFilters((current) => ({ ...current, q: search }));
    }, 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  const load = useCallback(async (nextFilters: LeadFilters, nextPage: number) => {
    const id = ++request.current;
    setIsLoading(true);
    const result = await listLeads(nextFilters, nextPage).catch(() => null);
    if (id !== request.current) return; // a newer request is on its way
    if (!result || !result.success) {
      setError(result ? result.error : "טעינת הלידים נכשלה");
    } else {
      setError(null);
      setData(result.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load(filters, page);
  }, [filters, page, load]);

  useEffect(() => {
    getLeadsMeta()
      .then((result) => {
        if (result.success) setMeta(result.data);
      })
      .catch(() => undefined);
  }, []);

  const setFilter = <K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_LEAD_FILTERS);
  const reset = () => {
    setSearch("");
    setPage(0);
    setFilters(EMPTY_LEAD_FILTERS);
  };

  const assigneeName = useMemo(() => {
    const names = new Map((meta?.assignees ?? []).map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? (names.get(id) ?? "איש צוות אחר") : "");
  }, [meta]);

  const change = async (lead: LeadRow, patch: { status?: string; assignedTo?: string | null }) => {
    setBusyId(lead.id);
    const result = await updateLead(lead.id, patch).catch(() => null);
    setBusyId(null);
    if (!result || !result.success) {
      toast.error(result ? result.error : "עדכון הליד נכשל");
      return;
    }
    setData((current) =>
      current ? { ...current, rows: current.rows.map((row) => (row.id === lead.id ? result.data : row)) } : current,
    );
    toast.success(patch.status ? `הסטטוס עודכן: ${leadStatusLabel(result.data.status)}` : "השיוך עודכן");
  };

  const runExport = async () => {
    setIsExporting(true);
    const result = await exportLeads(filters).catch(() => null);
    setIsExporting(false);
    if (!result || !result.success) {
      toast.error(result ? result.error : "ייצוא הלידים נכשל");
      return;
    }
    download(result.data.base64, result.data.fileName);
    toast.success(`יוצאו ${result.data.rows} לידים`);
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const open = rows.find((row) => row.id === openId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">סוג</Label>
          <Select value={filters.kind || ALL} onValueChange={(v) => setFilter("kind", v === ALL ? "" : v)}>
            <SelectTrigger dir="rtl" className="h-9 w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value={ALL}>כל הסוגים</SelectItem>
              {(meta?.kinds ?? Object.keys(LEAD_KIND_LABELS)).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kindLabel(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">סטטוס</Label>
          <Select value={filters.status || ALL} onValueChange={(v) => setFilter("status", v === ALL ? "" : v)}>
            <SelectTrigger dir="rtl" className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value={ALL}>כל הסטטוסים</SelectItem>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {LEAD_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="leads-from" className="text-xs text-muted-foreground">
            מתאריך
          </Label>
          <Input
            id="leads-from"
            type="date"
            dir="ltr"
            className="h-9 w-[150px]"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => setFilter("from", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leads-to" className="text-xs text-muted-foreground">
            עד תאריך
          </Label>
          <Input
            id="leads-to"
            type="date"
            dir="ltr"
            className="h-9 w-[150px]"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => setFilter("to", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">חיפוש חופשי</Label>
          <SearchInput value={search} onValueChange={setSearch} placeholder="שם, טלפון, אימייל, הודעה או עמוד מקור" />
        </div>
        {filtered && (
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            <RotateCcw />
            ניקוי הסינון
          </Button>
        )}
        <div className="ms-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{total} לידים</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void runExport()} disabled={isExporting || total === 0}>
            {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
            ייצוא לאקסל
          </Button>
        </div>
      </div>

      {error ? (
        <LoadError message={error} />
      ) : isLoading && !data ? (
        <DataTableSkeleton label="טוען לידים" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card" aria-busy={isLoading}>
          <Table look="list" className={isLoading ? "opacity-60" : undefined}>
            <TableHeader>
              <TableRow>
                <TableHead>תאריך</TableHead>
                <TableHead>סוג</TableHead>
                <TableHead>שם</TableHead>
                <TableHead>טלפון</TableHead>
                <TableHead>אימייל</TableHead>
                <TableHead>הודעה</TableHead>
                <TableHead>עמוד מקור</TableHead>
                <TableHead>משויך ל</TableHead>
                <TableHead>סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a,button,[role=combobox]")) return;
                    setOpenId(lead.id);
                  }}
                >
                  <TableCell className="whitespace-nowrap" dir="ltr">
                    {formatDayTime(lead.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{kindLabel(lead.kind)}</TableCell>
                  <TableCell className="font-medium">{lead.name}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {lead.phone && (
                      <a dir="ltr" href={`tel:${lead.phone}`} className="hover:underline">
                        {lead.phone}
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    {lead.email && (
                      <a dir="ltr" href={`mailto:${lead.email}`} className="hover:underline">
                        {lead.email}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-muted-foreground" title={lead.message ?? undefined}>
                    {lead.message}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground" title={lead.sourcePath ?? undefined}>
                    <span dir="ltr">{lead.sourcePath}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {assigneeName(lead.assignedTo) || <span className="text-muted-foreground">לא משויך</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={lead.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && (
            <EmptyRows
              title={filtered ? "אין לידים שמתאימים לסינון" : "עוד לא הגיעו לידים"}
              description={
                filtered
                  ? "נסו להרחיב את טווח התאריכים או לנקות את הסינון."
                  : "כל טופס שנשלח מהאתר (לידים, צור קשר, בקשת ביטול, ניוזלטר, בקשה ליועץ) יופיע כאן."
              }
            />
          )}
          {total > LEADS_PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                עמוד {page + 1} מתוך {pages}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={page === 0 || isLoading} onClick={() => setPage(page - 1)}>
                  <ChevronRight />
                  הקודם
                </Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= pages || isLoading} onClick={() => setPage(page + 1)}>
                  הבא
                  <ChevronLeft />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <div className="space-y-5 pt-6">
              <SheetHeader className="text-start sm:text-start">
                <SheetTitle>{open.name || open.phone || open.email || "ליד"}</SheetTitle>
                <SheetDescription>
                  {kindLabel(open.kind)} · <span dir="ltr">{formatDayTime(open.createdAt)}</span>
                </SheetDescription>
              </SheetHeader>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">סטטוס</Label>
                  <Select
                    value={open.status}
                    disabled={busyId === open.id}
                    onValueChange={(status) => void change(open, { status })}
                  >
                    <SelectTrigger dir="rtl" aria-label="סטטוס הליד">
                      <SelectValue>{leadStatusLabel(open.status)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {LEAD_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {LEAD_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">משויך ל</Label>
                  <Select
                    value={open.assignedTo ?? NOBODY}
                    disabled={busyId === open.id || !meta}
                    onValueChange={(id) => void change(open, { assignedTo: id === NOBODY ? null : id })}
                  >
                    <SelectTrigger dir="rtl" aria-label="שיוך הליד">
                      <SelectValue>{assigneeName(open.assignedTo) || "לא משויך"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value={NOBODY}>לא משויך</SelectItem>
                      {(meta?.assignees ?? []).map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.name}
                          {person.id === meta?.currentUserId ? " (אני)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <dl className="space-y-3 text-sm">
                <DetailRow label="שם" value={open.name} />
                <DetailRow label="טלפון">
                  {open.phone && (
                    <a dir="ltr" href={`tel:${open.phone}`} className="text-primary hover:underline">
                      {open.phone}
                    </a>
                  )}
                </DetailRow>
                <DetailRow label="אימייל">
                  {open.email && (
                    <a dir="ltr" href={`mailto:${open.email}`} className="text-primary hover:underline">
                      {open.email}
                    </a>
                  )}
                </DetailRow>
                <DetailRow label="עמוד מקור">
                  {open.sourcePath && (
                    <span dir="ltr" className="inline-block">
                      {open.sourcePath}
                    </span>
                  )}
                </DetailRow>
                <DetailRow label="הודעה">
                  {open.message && <p className="whitespace-pre-wrap break-words">{open.message}</p>}
                </DetailRow>
              </dl>

              <KeyValues title="פרטים נוספים מהטופס" values={open.payload} empty="הטופס לא שלח פרטים נוספים." />
              <KeyValues title="מקור ההגעה (UTM)" values={open.utm} empty="אין נתוני קמפיין." />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({ label, value, children }: { label: string; value?: string | null; children?: ReactNode }) {
  const content = children ?? value;
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{content || <span className="text-muted-foreground">לא נמסר</span>}</dd>
    </div>
  );
}

function KeyValues({ title, values, empty }: { title: string; values: Record<string, unknown>; empty: string }) {
  const entries = Object.entries(values);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[130px_1fr] gap-2">
              <dt dir="ltr" className="truncate text-end font-mono text-xs text-muted-foreground" title={key}>
                {key}
              </dt>
              <dd className="min-w-0 break-words" dir="auto">
                {display(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
