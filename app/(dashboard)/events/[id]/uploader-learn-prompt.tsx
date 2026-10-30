"use client";

import { ToastAction } from "@/components/ui/toast";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { toast } from "@/hooks/use-toast";
import { learnPromptForEvent } from "@/lib/actions/uploader-actions";

/**
 * After the editor saved an event (second-edit round, Alon: "לוודא שתמיד אחרי עריכה יקפוץ השאלות"): when it is a built show of an
 * AI Uploader run and another show would really get the change, one toast asks, and its button opens that card's learn dialog on the
 * board in a new tab - the editor stays where it is. Anything else, or any failure, shows nothing: this never touches the save. The
 * editor calls it only when this save touched something a learn carries (`editTouchesLearnFields`).
 */
export async function promptUploaderLearn(eventId: number): Promise<void> {
  try {
    const prompt = await learnPromptForEvent(eventId);
    if (!prompt) return;
    toast({
      title: "האירוע הזה שייך לריצת העלאה",
      description: <div dir="rtl">{prompt.others === 1 ? "להחיל את השינוי גם על הופעה נוספת בריצה?" : `להחיל את השינוי גם על ${prompt.others} הופעות נוספות בריצה?`}</div>,
      action: (
        <ToastAction altText="פתיחת הדיאלוג בלוח" asChild>
          <a href={`/uploader/${prompt.runId}?learn=${prompt.itemId}`} target="_blank" rel="noreferrer">
            להחיל
          </a>
        </ToastAction>
      ),
      duration: 20_000,
    });
  } catch {
    // swallowed on purpose - see the note above
  }
}
