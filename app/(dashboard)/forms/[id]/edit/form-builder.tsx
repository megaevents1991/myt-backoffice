"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  BarChart3,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Plus,
  Save,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { saveFormFields, setFormStatus, updateFormMeta } from "@/lib/actions/form-actions";
import { FormRenderer } from "@/app/f/form-renderer";
import {
  CHOICE_TYPES,
  FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  enabledLangs,
} from "@/types/form.types";
import { adminLabel, hasAnyLang } from "@/lib/forms/i18n";
import { BRAND_ACCENTS, DEFAULT_ACCENT } from "@/lib/forms/brand";
import { StorageImageBrowser } from "@/components/storage-image-browser";
import type {
  Form,
  FormField,
  FormFieldDraft,
  FormFieldType,
  FormLang,
  FormLanguages,
  FormStatus,
  FormTheme,
} from "@/types/form.types";
import { FieldEditor } from "./field-editor";
import { BilingualInput } from "./bilingual-input";

/** Pick an image from Supabase Storage, or clear the one already chosen. */
function ImageSlot({
  label,
  hint,
  url,
  onChange,
}: {
  label: string;
  hint: string;
  url: string;
  onChange: (url: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-contain" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <StorageImageBrowser
            uploadBucket="templates"
            uploadFolder="forms"
            trigger={
              <Button type="button" variant="outline" size="sm">
                {url ? "Change" : "Choose"}
              </Button>
            }
            onConfirm={(urls) => urls[0] && onChange(urls[0])}
          />
          {url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => onChange("")}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function defaultConfig(type: FormFieldType) {
  switch (type) {
    case "rating":
      return { max: 5 };
    case "scale":
      return { min: 1, max: 10 };
    case "long_text":
      return { rows: 4 };
    default:
      return {};
  }
}

function newField(type: FormFieldType, id: number, position: number): FormFieldDraft {
  return {
    id,
    type,
    position,
    label_en: "",
    label_he: null,
    help_en: null,
    help_he: null,
    placeholder_en: null,
    placeholder_he: null,
    required: false,
    staff_only: false,
    options: CHOICE_TYPES.includes(type)
      ? [
          { value: "", label_en: "", label_he: null },
          { value: "", label_en: "", label_he: null },
        ]
      : [],
    config: defaultConfig(type),
  };
}

/** Options must carry a stable non-empty value before they reach the DB. */
function withOptionValues(field: FormFieldDraft): FormFieldDraft {
  if (!CHOICE_TYPES.includes(field.type)) return { ...field, options: [] };
  return {
    ...field,
    options: field.options
      .filter(
        (option) =>
          option.label_en.trim() !== "" ||
          (option.label_he ?? "").trim() !== "" ||
          option.value !== "",
      )
      .map((option, index) => ({
        ...option,
        value:
          option.value ||
          option.label_en
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) ||
          `option-${index + 1}`,
      })),
  };
}

type Props = {
  form: Form;
  initialFields: FormField[];
};

export function FormBuilder({ form, initialFields }: Props) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [status, setStatus] = useState<FormStatus>(form.status);
  const [titleEn, setTitleEn] = useState(form.title_en);
  const [titleHe, setTitleHe] = useState(form.title_he ?? "");
  const [descriptionEn, setDescriptionEn] = useState(form.description_en ?? "");
  const [descriptionHe, setDescriptionHe] = useState(form.description_he ?? "");
  const [thankYouEn, setThankYouEn] = useState(form.thank_you_en ?? "");
  const [thankYouHe, setThankYouHe] = useState(form.thank_you_he ?? "");
  const [reviewLink, setReviewLink] = useState(form.review_link_url ?? "");
  const [slug, setSlug] = useState(form.slug);
  const [languages, setLanguages] = useState<FormLanguages>(form.languages ?? "both");
  const [defaultLang, setDefaultLang] = useState<FormLang>(form.default_lang);
  const [allowMultiple, setAllowMultiple] = useState(form.allow_multiple);
  const [theme, setTheme] = useState<FormTheme>(form.theme ?? "dark");
  const [accent, setAccent] = useState(form.accent_color || DEFAULT_ACCENT);
  const [logoUrl, setLogoUrl] = useState(form.logo_url ?? "");
  const [coverUrl, setCoverUrl] = useState(form.cover_image_url ?? "");

  // Which language tabs the builder offers, and what the fill page can render.
  const langs = enabledLangs(languages);

  const [fields, setFields] = useState<FormFieldDraft[]>(
    initialFields.map((field) => ({ ...field })),
  );
  const [previewLang, setPreviewLang] = useState<FormLang>(form.default_lang);
  const [dirty, setDirty] = useState(false);

  // Switching the form to one language must not leave the preview on the other.
  const activePreviewLang = langs.includes(previewLang) ? previewLang : langs[0];

  // Next draft field gets the next negative id; the server treats those as inserts.
  const nextDraftId = useRef(-1);

  // Warn before losing unsaved edits - external browser state, so an effect.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setDirty(true);
      setter(value);
    };
  }

  function updateField(index: number, patch: Partial<FormFieldDraft>) {
    setDirty(true);
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function addField(type: FormFieldType) {
    setDirty(true);
    setFields((prev) => [...prev, newField(type, nextDraftId.current--, prev.length)]);
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    setDirty(true);
    setFields((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function duplicateField(index: number) {
    setDirty(true);
    setFields((prev) => {
      const copy: FormFieldDraft = {
        ...prev[index],
        id: nextDraftId.current--,
        label_en: `${prev[index].label_en} (copy)`,
      };
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
  }

  function deleteField(index: number) {
    setDirty(true);
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * Yes/No questions above `index` that a conditional field may depend on.
   * Drafts are excluded: their negative id is replaced on insert, so a
   * condition pointing at one would dangle. Save first, then wire it up.
   */
  function conditionSources(index: number) {
    return fields
      .slice(0, index)
      .filter((field) => field.type === "yes_no" && field.id > 0 && !field.staff_only)
      .map((field) => ({
        id: field.id,
        label: adminLabel(field.label_en, field.label_he) || `Question ${field.id}`,
      }));
  }

  const previewPayload = useMemo(
    () => ({
      form: {
        id: form.id,
        slug,
        title_en: titleEn,
        title_he: titleHe || null,
        description_en: descriptionEn || null,
        description_he: descriptionHe || null,
        languages,
        default_lang: defaultLang,
        thank_you_en: thankYouEn || null,
        thank_you_he: thankYouHe || null,
        status,
        theme,
        accent_color: accent,
        logo_url: logoUrl || null,
        cover_image_url: coverUrl || null,
      },
      fields: fields.map((field, index) => {
        const prepared = withOptionValues(field);
        return {
          ...prepared,
          id: field.id,
          form_id: form.id,
          position: index,
        } as FormField;
      }),
    }),
    [
      form.id,
      slug,
      titleEn,
      titleHe,
      descriptionEn,
      descriptionHe,
      languages,
      defaultLang,
      thankYouEn,
      thankYouHe,
      status,
      theme,
      accent,
      logoUrl,
      coverUrl,
      fields,
    ],
  );

  function handleSave() {
    // Either language will do - a Hebrew-only form is legitimate, and the
    // renderer falls back to whichever string was filled in.
    if (!hasAnyLang(titleEn, titleHe)) {
      toast({ title: "Give the form a title", variant: "destructive" });
      return;
    }
    const missingLabel = fields.findIndex(
      (field) => !hasAnyLang(field.label_en, field.label_he),
    );
    if (missingLabel >= 0) {
      toast({
        title: `Question ${missingLabel + 1} has no text yet`,
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      try {
        const saved = await updateFormMeta(form.id, {
          title_en: titleEn,
          title_he: titleHe || null,
          description_en: descriptionEn || null,
          description_he: descriptionHe || null,
          thank_you_en: thankYouEn || null,
          thank_you_he: thankYouHe || null,
          review_link_url: reviewLink || null,
          slug,
          languages,
          default_lang: defaultLang,
          allow_multiple: allowMultiple,
          theme,
          accent_color: accent,
          logo_url: logoUrl || null,
          cover_image_url: coverUrl || null,
        });
        setSlug(saved.slug);

        const savedFields = await saveFormFields(
          form.id,
          fields.map(withOptionValues),
        );
        setFields(savedFields.map((field) => ({ ...field })));
        setDirty(false);
        toast({ title: "Saved" });
      } catch (error) {
        toast({
          title: "Could not save",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    });
  }

  function handleStatus(next: FormStatus) {
    startTransition(async () => {
      try {
        await setFormStatus(form.id, next);
        setStatus(next);
        toast({
          title:
            next === "live"
              ? "Form is live - the public link now works"
              : `Form set to ${next}`,
        });
      } catch {
        toast({ title: "Could not change the status", variant: "destructive" });
      }
    });
  }

  async function copyLink() {
    const url = `${window.location.origin}/f/${slug}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Public link copied", description: url });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {adminLabel(titleEn, titleHe) || "Untitled form"}
          </h1>
          <p className="text-sm text-muted-foreground">
            /f/{slug}
            {dirty && <span className="ms-2 text-amber-600">• unsaved changes</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(next) => handleStatus(next as FormStatus)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={copyLink} disabled={status !== "live"}>
            <Link2 className="mr-2 h-4 w-4" />
            Copy link
          </Button>

          <Button variant="outline" asChild>
            <a href={`/f/${slug}`} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </a>
          </Button>

          <Button variant="outline" asChild>
            <Link href={`/forms/${form.id}/invites`}>
              <Send className="mr-2 h-4 w-4" />
              Send
            </Link>
          </Button>

          <Button variant="outline" asChild>
            <Link href={`/forms/${form.id}/responses`}>
              <BarChart3 className="mr-2 h-4 w-4" />
              Responses
            </Link>
          </Button>

          <Button onClick={handleSave} disabled={pending}>
            <Save className="mr-2 h-4 w-4" />
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <BilingualInput
              label="Form title"
              required
              langs={langs}
              valueEn={titleEn}
              valueHe={titleHe}
              onChangeEn={touch(setTitleEn)}
              onChangeHe={touch(setTitleHe)}
            />
            <BilingualInput
              label="Description"
              multiline
              langs={langs}
              valueEn={descriptionEn}
              valueHe={descriptionHe}
              onChangeEn={touch(setDescriptionEn)}
              onChangeHe={touch(setDescriptionHe)}
            />
            <BilingualInput
              label="Thank-you message"
              multiline
              rows={2}
              langs={langs}
              valueEn={thankYouEn}
              valueHe={thankYouHe}
              onChangeEn={touch(setThankYouEn)}
              onChangeHe={touch(setThankYouHe)}
            />

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Review link (optional)
              </Label>
              <Input
                dir="ltr"
                placeholder="https://www.google.com/search?q=…"
                value={reviewLink}
                onChange={(e) => touch(setReviewLink)(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Offered on the thank-you screen only when every star rating the
                client answered got full marks.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Public link
                </Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">/f/</span>
                  <Input value={slug} onChange={(e) => touch(setSlug)(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Form language
                </Label>
                <Select
                  value={languages}
                  onValueChange={(next) => {
                    const value = next as FormLanguages;
                    touch(setLanguages)(value);
                    // A single-language form opens in that language.
                    if (value !== "both") {
                      setDefaultLang(value);
                      setPreviewLang(value);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English only</SelectItem>
                    <SelectItem value="he">עברית בלבד</SelectItem>
                    <SelectItem value="both">Both - client can switch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {languages === "both" && (
              <div className="space-y-1.5 sm:max-w-[50%]">
                <Label className="text-xs font-medium text-muted-foreground">
                  Opens in
                </Label>
                <Select
                  value={defaultLang}
                  onValueChange={(next) => touch(setDefaultLang)(next as FormLang)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="he">עברית</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The client sees this first and can switch with a button. Invite
                  emails open in the recipient&apos;s own language.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Switch
                id="allow-multiple"
                checked={allowMultiple}
                onCheckedChange={touch(setAllowMultiple)}
              />
              <Label htmlFor="allow-multiple" className="text-sm font-normal">
                Let one invite link be submitted more than once
              </Label>
            </div>
          </div>

          {/* Branding for the public page */}
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Design</h2>
              <div className="flex overflow-hidden rounded-md border text-xs">
                {(["dark", "light"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => touch(setTheme)(option)}
                    className={cn(
                      "px-3 py-1 capitalize transition-colors",
                      theme === option
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Accent colour
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                {BRAND_ACCENTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.name}
                    aria-label={option.name}
                    aria-pressed={accent.toLowerCase() === option.value.toLowerCase()}
                    onClick={() => touch(setAccent)(option.value)}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
                      accent.toLowerCase() === option.value.toLowerCase()
                        ? "border-foreground"
                        : "border-transparent",
                    )}
                    style={{ background: option.value }}
                  />
                ))}
                <Input
                  value={accent}
                  onChange={(e) => touch(setAccent)(e.target.value)}
                  placeholder="#5BFF95"
                  className="h-8 w-[110px] font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ImageSlot
                label="Logo"
                hint="Shown top-left. PNG/SVG with transparency works best."
                url={logoUrl}
                onChange={touch(setLogoUrl)}
              />
              <ImageSlot
                label="Cover image"
                hint="Sits behind the title, dimmed so text stays readable."
                url={coverUrl}
                onChange={touch(setCoverUrl)}
              />
            </div>
          </div>

          <div className="space-y-3">
            {fields.map((field, index) => (
              <FieldEditor
                key={field.id}
                field={field}
                index={index}
                total={fields.length}
                langs={langs}
                conditionSources={conditionSources(index)}
                onChange={(patch) => updateField(index, patch)}
                onMove={(direction) => moveField(index, direction)}
                onDuplicate={() => duplicateField(index)}
                onDelete={() => deleteField(index)}
              />
            ))}

            {fields.length === 0 && (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No questions yet. Add the first one below.
              </p>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Add question
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {FORM_FIELD_TYPES.map((type) => (
                <DropdownMenuItem key={type} onClick={() => addField(type)}>
                  {FIELD_TYPE_LABELS[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border bg-background">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">Preview</span>
              <div className="flex items-center gap-2">
                <Badge variant={status === "live" ? "default" : "secondary"}>{status}</Badge>
                {langs.length > 1 && (
                  <div className="flex overflow-hidden rounded-md border text-xs">
                    {langs.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setPreviewLang(code)}
                        className={cn(
                          "px-2 py-1",
                          activePreviewLang === code
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent",
                        )}
                      >
                        {code === "en" ? "EN" : "עב"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              <FormRenderer
                key={activePreviewLang}
                payload={previewPayload}
                initialLang={activePreviewLang}
                preview
                showLangToggle={false}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
