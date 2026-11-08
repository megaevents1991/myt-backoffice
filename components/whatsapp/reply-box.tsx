"use client";

/**
 * The reply box of a Mega Events conversation (spec 2026-11-08 section 8): free text inside the 24-hour window after
 * the customer wrote, sent from the company's number through the Cloud API (a fifth seat beside the app's four linked
 * devices). Past the window it is closed - the rep answers in the app, which can always write. Text only.
 */
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import { replyState } from "@/lib/whatsapp/events/chat-rules";
import { WA_TEXT_MAX } from "@/lib/whatsapp/rules";
import { replyEventsChat } from "@/lib/actions/whatsapp-events-actions";

export function ReplyBox({
  chatId,
  reservationId,
  lastInAt,
  onSent,
}: {
  chatId: string;
  reservationId: number | null;
  lastInAt: string | null;
  onSent: () => void;
}) {
  const run = useActionToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const state = replyState(lastInAt, new Date().toISOString());

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const res = await run(() => replyEventsChat({ chatId, text, reservationId }), "נשלח");
    setSending(false);
    if (res.success) {
      setText("");
      onSent();
    }
  };

  if (!state.open) return <p className="text-xs text-muted-foreground" dir="rtl">{state.note}</p>;
  return (
    <div className="flex items-end gap-2" dir="rtl">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        maxLength={WA_TEXT_MAX}
        rows={2}
        dir="auto"
        placeholder="תשובה ללקוח (Enter שולח, Shift+Enter שורה חדשה)"
        className="min-w-0 flex-1"
      />
      <Button size="icon" aria-label="שלח" disabled={sending || !text.trim()} onClick={() => void send()}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
