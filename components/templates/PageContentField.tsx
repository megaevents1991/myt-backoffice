"use client";

import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GalleryField } from "@/components/templates/gallery-field";
import { HeroImageField } from "@/components/templates/HeroImageField";
import type {
  CategoryFactCard,
  CategoryFaqItem,
  CategoryPageContent,
  CategoryStadium,
} from "@/types/page-content.types";

/**
 * Editor for `categories.page_content` - the rich content of a vertical hub
 * page (/c/football) or a league/genre page under it.
 *
 * Only relevant on hub-style categories, so the whole block is collapsed by
 * default and opens when there is already content. Every section is optional:
 * whatever is left blank simply doesn't render on the site, which falls back
 * to the bundled launch copy in myt-main until content is written here.
 */
export function PageContentField({
  value,
  onChange,
}: {
  value: CategoryPageContent;
  onChange: (next: CategoryPageContent) => void;
}) {
  const hasContent =
    !!value.intro ||
    !!value.seo_text ||
    !!value.seo_title ||
    !!value.gallery?.length ||
    !!value.stadiums?.length ||
    !!value.facts?.length ||
    !!value.faq?.length ||
    !!value.city_info ||
    !!value.matchday?.length ||
    !!value.honours?.length;
  const [open, setOpen] = useState(hasContent);

  const patch = (p: Partial<CategoryPageContent>) => onChange({ ...value, ...p });

  const stadiums = value.stadiums ?? [];
  const faq = value.faq ?? [];
  const facts = value.facts ?? [];
  const matchday = value.matchday ?? [];

  const setStadium = (i: number, p: Partial<CategoryStadium>) =>
    patch({ stadiums: stadiums.map((s, idx) => (idx === i ? { ...s, ...p } : s)) });
  const setFaq = (i: number, p: Partial<CategoryFaqItem>) =>
    patch({ faq: faq.map((f, idx) => (idx === i ? { ...f, ...p } : f)) });
  const setFact = (i: number, p: Partial<CategoryFactCard>) =>
    patch({ facts: facts.map((f, idx) => (idx === i ? { ...f, ...p } : f)) });
  const setMatchday = (i: number, p: Partial<CategoryFactCard>) =>
    patch({ matchday: matchday.map((f, idx) => (idx === i ? { ...f, ...p } : f)) });

  return (
    <div className="rounded-lg border md:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-right"
      >
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span>
          <span className="block font-semibold">תוכן עמוד הקטגוריה</span>
          <span className="block text-xs text-muted-foreground">
            טקסט שיווקי, גלריה, אצטדיונים ושאלות נפוצות - לעמודי ורטיקל (כדורגל, מוזיקה)
            ולעמודי ליגה/ז&apos;אנר. ריק = הסקשן לא מוצג באתר.
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-6 border-t px-4 py-4">
          {/* ---- cover intro ---- */}
          <section className="space-y-2">
            <label className="text-sm font-medium">פתיח על הקאבר</label>
            <Textarea
              rows={3}
              value={value.intro ?? ""}
              onChange={(e) => patch({ intro: e.target.value })}
              placeholder="הטקסט שעל הבאנר - עמודי ליגה / ז'אנר / יעד (בוורטיקלים מחליף את הפסקה הראשונה)"
            />
          </section>

          {/* ---- marketing text ---- */}
          <section className="space-y-2">
            <label className="text-sm font-medium">כותרת הטקסט השיווקי</label>
            <Input
              value={value.seo_title ?? ""}
              onChange={(e) => patch({ seo_title: e.target.value })}
              placeholder='חבילות כדורגל בחו"ל - כרטיס, טיסה ומלון במקום אחד'
            />
            <label className="mt-3 block text-sm font-medium">טקסט שיווקי / SEO</label>
            <Textarea
              rows={8}
              value={value.seo_text ?? ""}
              onChange={(e) => patch({ seo_text: e.target.value })}
              placeholder="שורה ריקה בין פסקאות."
            />
            <p className="text-xs text-muted-foreground">
              שורה ריקה כפולה = פסקה חדשה באתר.
            </p>
          </section>

          {/* ---- gallery ---- */}
          <section className="space-y-2">
            <label className="text-sm font-medium">גלריית תמונות</label>
            <GalleryField
              value={value.gallery ?? []}
              onChange={(urls) => patch({ gallery: urls })}
            />
          </section>

          {/* ---- stadiums / venues ---- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">אצטדיונים / אולמות מומלצים</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    stadiums: [...stadiums, { name: "", city: "", description: "" }],
                  })
                }
              >
                <Plus className="ml-1 size-4" aria-hidden />
                הוסף
              </Button>
            </div>
            {stadiums.map((s, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">אצטדיון {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patch({ stadiums: stadiums.filter((_, idx) => idx !== i) })
                    }
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input
                    value={s.name}
                    onChange={(e) => setStadium(i, { name: e.target.value })}
                    placeholder="שם האצטדיון"
                  />
                  <Input
                    value={s.city}
                    onChange={(e) => setStadium(i, { city: e.target.value })}
                    placeholder="עיר, מדינה"
                  />
                  <Input
                    value={s.capacity ?? ""}
                    onChange={(e) => setStadium(i, { capacity: e.target.value })}
                    placeholder="קיבולת (למשל: כ-74,000 מקומות)"
                  />
                  <Input
                    value={s.teams ?? ""}
                    onChange={(e) => setStadium(i, { teams: e.target.value })}
                    placeholder="הקבוצה הביתית"
                  />
                </div>
                <Textarea
                  rows={3}
                  value={s.description}
                  onChange={(e) => setStadium(i, { description: e.target.value })}
                  placeholder="תיאור קצר - מה מיוחד באצטדיון הזה"
                />
                <HeroImageField
                  label="תמונת אצטדיון (אופציונלי)"
                  value={s.image_url ?? ""}
                  onChange={(url) => setStadium(i, { image_url: url || null })}
                />
              </div>
            ))}
          </section>

          {/* ---- fact cards ---- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                כרטיסי מידע (&quot;מידע מעניין&quot; / &quot;טוב לדעת&quot;)
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ facts: [...facts, { title: "", text: "" }] })}
              >
                <Plus className="ml-1 size-4" aria-hidden />
                הוסף
              </Button>
            </div>
            {facts.map((f, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">כרטיס {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ facts: facts.filter((_, idx) => idx !== i) })}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
                <Input
                  value={f.title}
                  onChange={(e) => setFact(i, { title: e.target.value })}
                  placeholder="כותרת"
                />
                <Textarea
                  rows={2}
                  value={f.text}
                  onChange={(e) => setFact(i, { text: e.target.value })}
                  placeholder="הטקסט"
                />
              </div>
            ))}
          </section>

          {/* ---- team-page extras (עמוד קבוצה) ---- */}
          <section className="space-y-3 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">עמוד קבוצה (רלוונטי רק לקטגוריות קבוצה)</p>
            <label className="block text-xs text-muted-foreground">העיר - כותרת + טקסט</label>
            <Input
              value={value.city_info?.title ?? ""}
              onChange={(e) =>
                patch({ city_info: { title: e.target.value, text: value.city_info?.text ?? "" } })
              }
              placeholder="שם העיר"
            />
            <Textarea
              rows={2}
              value={value.city_info?.text ?? ""}
              onChange={(e) =>
                patch({
                  city_info:
                    e.target.value || value.city_info?.title
                      ? { title: value.city_info?.title ?? "", text: e.target.value }
                      : undefined,
                })
              }
              placeholder="על העיר"
            />
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">טיפים ליום המשחק</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ matchday: [...matchday, { title: "", text: "" }] })}
              >
                <Plus className="ml-1 size-4" aria-hidden />
                הוסף
              </Button>
            </div>
            {matchday.map((f, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">טיפ {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patch({ matchday: matchday.filter((_, idx) => idx !== i) })
                    }
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
                <Input
                  value={f.title}
                  onChange={(e) => setMatchday(i, { title: e.target.value })}
                  placeholder="כותרת (למשל: דרכי הגעה)"
                />
                <Textarea
                  rows={2}
                  value={f.text}
                  onChange={(e) => setMatchday(i, { text: e.target.value })}
                  placeholder="הטקסט"
                />
              </div>
            ))}
            <label className="block text-xs text-muted-foreground">
              הישגים (מופרדים בפסיק)
            </label>
            <Input
              value={(value.honours ?? []).join(", ")}
              onChange={(e) =>
                patch({
                  honours: e.target.value
                    .split(",")
                    .map((h) => h.trim())
                    .filter(Boolean),
                })
              }
              placeholder="20 אליפויות אנגליה, 3 גביעי אלופות"
            />
          </section>

          {/* ---- FAQ ---- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">שאלות נפוצות</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ faq: [...faq, { question: "", answer: "" }] })}
              >
                <Plus className="ml-1 size-4" aria-hidden />
                הוסף
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ריק = מוצגות השאלות הכלליות של האתר.
            </p>
            {faq.map((f, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">שאלה {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ faq: faq.filter((_, idx) => idx !== i) })}
                  >
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </div>
                <Input
                  value={f.question}
                  onChange={(e) => setFaq(i, { question: e.target.value })}
                  placeholder="השאלה"
                />
                <Textarea
                  rows={3}
                  value={f.answer}
                  onChange={(e) => setFaq(i, { answer: e.target.value })}
                  placeholder="התשובה"
                />
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
