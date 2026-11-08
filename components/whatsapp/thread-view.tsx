"use client";

/**
 * The bubbles of a WhatsApp thread, oldest first: where each came from (the app, an automation, a broadcast, the
 * history sync), delivery ticks, media, and "עוד" for older pages. Shared by the tours case / customer pages
 * (components/tours/cases/whatsapp-thread.tsx wraps it) and Mega Events' WhatsApp screen and order fold.
 */
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtInstant } from "@/lib/tours/format";
import { deliveryMark, originLabel, type WaThreadMessage } from "@/lib/tours/cases";

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

export function ThreadView({
  messages,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  messages: WaThreadMessage[];
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {hasMore && onLoadMore && (
        <Button variant="ghost" size="sm" className="self-center" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
          עוד
        </Button>
      )}
      {messages.map((m) => (
        <Bubble key={m.id} m={m} />
      ))}
    </div>
  );
}
