"use client";

/**
 * Mega Events' WhatsApp screen (spec 2026-11-08 section 8): the conversations of the company's number, newest first,
 * with the orders of each phone; a click opens the thread with the reply box, "טופל", "הצמד להזמנה" and the app link.
 * The settings tab (admins) connects the number and lists the app's own automatic texts. One read on mount.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/url-tabs";
import { useUrlState } from "@/hooks/use-view-state";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { fmtInstant } from "@/lib/tours/format";
import type { WaThread, WaThreadMessage } from "@/lib/tours/cases";
import { ThreadView } from "@/components/whatsapp/thread-view";
import { ReplyBox } from "@/components/whatsapp/reply-box";
import { AutoTextsCard } from "@/components/whatsapp/auto-texts-card";
import { WhatsappCard } from "@/components/tours/content/whatsapp-card";
import { WhatsAppButton } from "@/components/tours/cases/case-ui";
import { Notice } from "@/components/tours/ui";
import {
  linkChatToReservation,
  listEventsChats,
  loadEventsChatBefore,
  markChatHandled,
  openEventsChat,
  searchReservationsForLink,
  type ChatRow,
  type LinkCandidate,
} from "@/lib/actions/whatsapp-events-actions";
import { getEventsWhatsappSettingsTab, type EventsWhatsappSettingsTab } from "@/lib/actions/whatsapp-auto-text-actions";

const TABS = ["chats", "settings"] as const;
const FILTERS = ["all", "new", "unanswered", "no_order"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = { all: "הכול", new: "חדשות", unanswered: "לא נענו", no_order: "בלי הזמנה" };

const isUnseen = (c: ChatRow) => !!c.lastInAt && (!c.seenAt || c.lastInAt > c.seenAt);
const isUnanswered = (c: ChatRow) => !!c.lastInAt && (!c.answeredAt || c.lastInAt > c.answeredAt);
const minutesLabel = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export function WhatsappScreen({ isAdmin }: { isAdmin: boolean }) {
  return (
    <UrlTabs defaultValue="chats" values={TABS} dir="rtl">
      <TabsList>
        <TabsTrigger value="chats">שיחות</TabsTrigger>
        {isAdmin && <TabsTrigger value="settings">הגדרות</TabsTrigger>}
      </TabsList>
      <TabsContent value="chats">
        <ChatsTab />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      )}
    </UrlTabs>
  );
}

function ChatsTab() {
  const run = useActionToast();
  const [filter, setFilter] = useUrlState<Filter>("f", "all", FILTERS);
  const [chatId, setChatId] = useUrlState<string>("chat", "");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<{ rows: ChatRow[]; total: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listEventsChats({ filter, page });
    setLoading(false);
    if (res.success && res.data) setList(res.data);
    else if (!res.success) void run(async () => res);
  }, [filter, page, run]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={f === filter ? "default" : "outline"}
              onClick={() => {
                setPage(0);
                setFilter(f);
              }}
            >
              {FILTER_LABELS[f]}
            </Button>
          ))}
          <Button size="icon" variant="ghost" aria-label="רענון" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        {list && list.rows.length === 0 && !loading && <p className="text-sm text-muted-foreground">אין שיחות כאן.</p>}
        <ul className="divide-y rounded-md border">
          {list?.rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setChatId(c.id)}
                className={cn("flex w-full flex-col gap-1 p-3 text-start hover:bg-muted/50", c.id === chatId && "bg-muted")}
              >
                <div className="flex items-center gap-2">
                  {isUnseen(c) && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="חדש" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{c.displayName}</span>
                  {c.lastInAt && <span className="text-xs text-muted-foreground" dir="ltr">{fmtInstant(c.lastInAt)}</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span dir="ltr">{c.phone}</span>
                  {c.unansweredMinutes !== null && isUnanswered(c) && (
                    <Badge variant="destructive" className="h-5">
                      לא נענתה {minutesLabel(c.unansweredMinutes)}
                    </Badge>
                  )}
                  {c.optedOutAt && <Badge variant="secondary">הוסר/ה</Badge>}
                </div>
                {c.lastText && <p className="truncate text-sm">{c.lastText}</p>}
                {c.orders.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.orders.slice(0, 4).map((o) => (
                      <Badge key={o.id} variant="outline" className="h-5">
                        #{o.id} {o.status}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              הקודם
            </Button>
            <span>
              {page + 1} / {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              הבא
            </Button>
          </div>
        )}
      </div>
      <div className="min-w-0">{chatId ? <ChatPane key={chatId} chatId={chatId} onChanged={() => void load()} /> : <p className="text-sm text-muted-foreground">בחרו שיחה מהרשימה.</p>}</div>
    </div>
  );
}

function ChatPane({ chatId, onChanged }: { chatId: string; onChanged: () => void }) {
  const run = useActionToast();
  const [data, setData] = useState<{ chat: ChatRow; thread: WaThread } | null>(null);
  const [older, setOlder] = useState<{ messages: WaThreadMessage[]; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = useCallback(async () => {
    const res = await openEventsChat(chatId);
    if (res.success && res.data) {
      setData(res.data);
      setOlder(null);
    } else if (!res.success) void run(async () => res);
  }, [chatId, run]);

  useEffect(() => {
    void open();
  }, [open]);

  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const { chat, thread } = data;
  const messages = older ? [...older.messages, ...thread.messages] : thread.messages;
  const hasMore = older ? older.hasMore : thread.hasMore;

  return (
    <div className="space-y-3 rounded-md border p-3" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{chat.displayName}</span>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {chat.phone}
        </span>
        <span className="ms-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await run(() => markChatHandled(chat.id), "סומן כטופל");
              setBusy(false);
              if (res.success) {
                void open();
                onChanged();
              }
            }}
          >
            <CheckCheck className="h-4 w-4" />
            טופל
          </Button>
          <LinkButton chat={chat} onLinked={() => { void open(); onChanged(); }} />
          <WhatsAppButton phone={chat.phone} message="" iconOnly />
        </span>
      </div>
      {chat.orders.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs">
          {chat.orders.map((o) => (
            <Link key={o.id} href={`/reservations/${o.id}`} className="underline">
              #{o.id} {o.status}
            </Link>
          ))}
        </div>
      )}
      {chat.optedOutAt && <Notice tone="info">הלקוח/ה ביקש/ה הסרה משיווק - עדכונים על ההזמנה ממשיכים.</Notice>}
      {!thread.connected && <Notice tone="info">המספר עדיין לא מחובר - WhatsApp &gt; הגדרות</Notice>}
      <ThreadView
        messages={messages}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={async () => {
          if (messages.length === 0) return;
          setLoadingMore(true);
          const res = await run(() => loadEventsChatBefore(chat.id, messages[0].sentAt));
          setLoadingMore(false);
          if (res.success && res.data) setOlder({ messages: [...res.data.messages, ...(older?.messages ?? [])], hasMore: res.data.hasMore });
        }}
      />
      <ReplyBox chatId={chat.id} reservationId={chat.linkedReservationId} lastInAt={chat.lastInAt} onSent={() => { void open(); onChanged(); }} />
    </div>
  );
}

function LinkButton({ chat, onLinked }: { chat: ChatRow; onLinked: () => void }) {
  const run = useActionToast();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LinkCandidate[]>([]);
  const [open, setOpen] = useState(false);

  if (chat.linkedReservationId !== null) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          const res = await run(() => linkChatToReservation(chat.id, null), "ההצמדה בוטלה");
          if (res.success) onLinked();
        }}
      >
        <Link2Off className="h-4 w-4" />
        בטל הצמדה (#{chat.linkedReservationId})
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 className="h-4 w-4" />
          הצמד להזמנה
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" dir="rtl">
        <Input
          value={q}
          placeholder="מספר הזמנה, שם או טלפון"
          onChange={async (e) => {
            const term = e.target.value;
            setQ(term);
            const res = await searchReservationsForLink(term);
            if (res.success && res.data) setHits(res.data);
          }}
        />
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-start hover:bg-muted"
                onClick={async () => {
                  const res = await run(() => linkChatToReservation(chat.id, h.id), `הוצמד להזמנה #${h.id}`);
                  if (res.success) {
                    setOpen(false);
                    onLinked();
                  }
                }}
              >
                #{h.id} {h.name} · {h.status}
                {h.eventName && <span className="text-muted-foreground"> · {h.eventName}</span>}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function SettingsTab() {
  const [state, setState] = useState<{ data: EventsWhatsappSettingsTab | null; error: string | null } | null>(null);
  useEffect(() => {
    void getEventsWhatsappSettingsTab().then((res) => setState(res.success ? { data: res.data ?? null, error: null } : { data: null, error: res.error }));
  }, []);
  if (!state) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const d = state.data;
  return (
    <div className="space-y-6">
      {state.error && <Notice tone="warning">{state.error}</Notice>}
      {d?.settingsError && <Notice tone="warning">{d.settingsError}</Notice>}
      {d?.trialPhoneLast4 && <Notice tone="info">מצב ניסיון: כל ההודעות האוטומטיות הולכות לטלפון שמסתיים ב-{d.trialPhoneLast4}, לא ללקוחות.</Notice>}
      {d?.autoOff && <Notice tone="warning">ההודעות האוטומטיות כבויות (EVENTS_WHATSAPP_AUTO=off).</Notice>}
      {d?.settings && <WhatsappCard initial={d.settings} />}
      {d && <AutoTextsCard initial={d.autoTexts} />}
    </div>
  );
}
