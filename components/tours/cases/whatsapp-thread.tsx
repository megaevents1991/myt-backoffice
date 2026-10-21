"use client";

/**
 * The customer's WhatsApp thread on the case and customer pages (spec 2026-10-21 section 8): bubbles oldest first,
 * where each came from (the app, an automation, a broadcast, the history sync), delivery ticks, media, older pages,
 * the consent line with a staff decision, the 24-hour window, and the rep's own app for a live chat. Opening a
 * card marks its thread seen (the board chip and the TODAY reason read leads.wa_seen_at). Sending from here is
 * phase 2 - the thread only reads.
 */
import { useEffect, useRef, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useActionToast } from "@/hooks/use-action-toast";
import { fmtInstant } from "@/lib/tours/format";
import { WA_CONSENT_LABELS, deliveryMark, originLabel, type WaThread, type WaThreadMessage } from "@/lib/tours/cases";
import { loadThreadBefore, markThreadSeen, setCustomerConsent } from "@/lib/actions/whatsapp-thread-actions";
import { WhatsAppButton } from "@/components/tours/cases/case-ui";
import { Notice } from "@/components/tours/ui";

const NOTE_MIN = 3;

/** "3 דק׳" / "5 שע׳" / "2 ימים" since an instant. */
function sinceLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} שע׳`;
  return `${Math.round(hours / 24)} ימים`;
}

function Bubble({ m }: { m: WaThreadMessage }) {
  const mine = m.direction === "out";
  const origin = originLabel(m.origin);
  const isImage = !!m.mediaUrl && !!m.mediaMime && m.mediaMime.startsWith("image/");
  return (
    <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm", mine ? "ms-auto bg-emerald-50 dark:bg-emerald-950/40" : "me-auto bg-muted")}>
      {origin && <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{origin}</div>}
      {m.template ? (
        <div>
          <span className="font-medium">{m.template.name}</span>
          {m.template.params.length > 0 && <span className="text-muted-foreground"> · {m.template.params.join(" · ")}</span>}
        </div>
      ) : (
        m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>
      )}
      {m.mediaUrl &&
        (isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.mediaUrl} alt="" className="mt-1 max-h-64 rounded-md" />
        ) : (
          <a href={m.mediaUrl} className="mt-1 inline-flex items-center gap-1 text-xs underline">
            <FileDown className="h-3.5 w-3.5" />
            קובץ
          </a>
        ))}
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span dir="ltr">{fmtInstant(m.sentAt)}</span>
        {mine && <span className={cn(m.status === "failed" && "text-destructive")}>{deliveryMark(m.status, m.error)}</span>}
      </div>
    </div>
  );
}

export function WhatsappThread({
  thread,
  customerId,
  caseId,
  phone,
  firstName,
  onSeen,
}: {
  thread: WaThread;
  customerId: string | null;
  caseId: string | null;
  phone: string | null;
  firstName: string | null;
  onSeen?: () => void;
}) {
  const run = useActionToast();
  // what this screen added on top of the thread it was handed; a fresh thread (a reload) starts clean
  const [older, setOlder] = useState<{ base: WaThread; messages: WaThreadMessage[]; hasMore: boolean } | null>(null);
  const [decided, setDecided] = useState<{ base: WaThread; consent: WaThread["consent"] } | null>(null);
  const extra = older && older.base === thread ? older : null;
  const messages = extra ? [...extra.messages, ...thread.messages] : thread.messages;
  const hasMore = extra ? extra.hasMore : thread.hasMore;
  const consent = decided && decided.base === thread ? decided.consent : thread.consent;
  const [loadingMore, setLoadingMore] = useState(false);
  const [deciding, setDeciding] = useState<"opted_in" | "opted_out" | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const seenFor = useRef<string | null>(null);

  // opening a card with inbound messages marks them seen, once per card
  useEffect(() => {
    if (!caseId || seenFor.current === caseId) return;
    if (!thread.messages.some((m) => m.direction === "in")) return;
    seenFor.current = caseId;
    void markThreadSeen(caseId).then((answer) => {
      if (answer.success) onSeen?.();
    });
  }, [caseId, thread, onSeen]);

  const loadMore = async () => {
    if (!customerId || messages.length === 0) return;
    setLoadingMore(true);
    const answer = await run(() => loadThreadBefore(customerId, messages[0].sentAt));
    setLoadingMore(false);
    if (answer.success && answer.data) {
      const page = answer.data;
      setOlder({ base: thread, messages: [...page.messages, ...(extra?.messages ?? [])], hasMore: page.hasMore });
    }
  };

  const decide = async () => {
    if (!customerId || !deciding) return;
    setSaving(true);
    const answer = await run(() => setCustomerConsent(customerId, deciding, note), "Consent recorded");
    setSaving(false);
    if (answer.success && answer.data) {
      setDecided({ base: thread, consent: { state: answer.data.state, source: answer.data.source, at: answer.data.at } });
      setDeciding(null);
      setNote("");
    }
  };

  return (
    <div className="space-y-3" dir="rtl">
      {!thread.connected && <Notice tone="info">המספר של החברה עדיין לא מחובר - הגדרות &gt; WhatsApp</Notice>}

      {messages.length > 0 ? (
        <div className="flex flex-col gap-2">
          {hasMore && customerId && (
            <Button variant="ghost" size="sm" className="self-center" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              עוד
            </Button>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
        </div>
      ) : (
        thread.connected && <p className="text-sm text-muted-foreground">אין הודעות עדיין.</p>
      )}

      {thread.lastInAt &&
        (thread.windowOpen ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">הלקוח/ה כתב/ה לפני {sinceLabel(thread.lastInAt, Date.now())} - אפשר לענות בטקסט חופשי</p>
        ) : (
          <p className="text-xs text-muted-foreground">חלון 24 השעות סגור - רק תבנית</p>
        ))}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{WA_CONSENT_LABELS[consent.state] ?? consent.state}</span>
        {consent.source && <span dir="ltr">· {consent.source}</span>}
        {consent.at && <span dir="ltr">· {fmtInstant(consent.at)}</span>}
        {customerId && !deciding && (
          <>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setDeciding("opted_in")}>
              סמן הסכמה
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setDeciding("opted_out")}>
              סמן הסרה
            </Button>
          </>
        )}
        <span className="ms-auto">
          <WhatsAppButton phone={phone} message={`היי ${firstName ?? ""}`.trim()} iconOnly />
        </span>
      </div>

      {deciding && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">{deciding === "opted_in" ? "מאיפה ההסכמה? (שיחה, מייל, טופס חתום...)" : "למה הסרה? (ביקש/ה בשיחה...)"}</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} dir="auto" />
          <div className="flex gap-2">
            <Button size="sm" disabled={saving || note.trim().length < NOTE_MIN} onClick={() => void decide()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              שמור
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDeciding(null)}>
              ביטול
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
