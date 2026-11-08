"use client";

/**
 * The app's own automatic texts (greeting / away message) of the number: an echo of one of these is not a rep's
 * answer, so a chat stays "new" and "unanswered" until a person replies (spec 2026-11-08 section 5).
 */
import { useState } from "react";
import { Loader2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import { Section } from "@/components/tours/ui";
import { addAutoText, findAutoTexts, removeAutoText, type AutoTextRow } from "@/lib/actions/whatsapp-auto-text-actions";

const SOURCE_LABEL: Record<string, string> = { history: "זוהה מההיסטוריה", staff: "הוזן ידנית" };

export function AutoTextsCard({ initial }: { initial: AutoTextRow[] }) {
  const run = useActionToast();
  const [rows, setRows] = useState<AutoTextRow[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const apply = (res: { success: boolean; data?: AutoTextRow[] }) => {
    if (res.success && res.data) setRows(res.data);
  };

  return (
    <Section
      title="הודעות אוטומטיות של האפליקציה"
      description="הודעת הפתיחה והודעת 'לא זמינים' של אפליקציית וואטסאפ ביזנס. הודעה כזו לא נחשבת תשובה של נציג, כך שהשיחה נשארת 'חדשה' ו'לא נענתה' עד שמישהו עונה."
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("find");
            apply(await run(() => findAutoTexts(), "החיפוש הסתיים"));
            setBusy(null);
          }}
        >
          {busy === "find" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          מצא מההיסטוריה
        </Button>
      }
    >
      <div dir="rtl" className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין עדיין. אחרי החיבור המערכת מזהה אותן לבד מההיסטוריה, או שמדביקים כאן.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.textNorm} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{r.text}</span>
                <Badge variant="secondary">{SOURCE_LABEL[r.source] ?? r.source}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="הסר"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(r.textNorm);
                    apply(await run(() => removeAutoText(r.textNorm), "הוסר"));
                    setBusy(null);
                  }}
                >
                  {busy === r.textNorm ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="הדביקו את הטקסט שהאפליקציה שולחת" rows={2} />
        <div>
          <Button
            size="sm"
            disabled={busy !== null || !draft.trim()}
            onClick={async () => {
              setBusy("add");
              const res = await run(() => addAutoText(draft), "נוסף");
              apply(res);
              if (res.success) setDraft("");
              setBusy(null);
            }}
          >
            {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : null}
            הוסף
          </Button>
        </div>
      </div>
    </Section>
  );
}
