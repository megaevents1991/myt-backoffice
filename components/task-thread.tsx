"use client";
// components/task-thread.tsx
// The conversation on one task: comments, pasted screenshots, @mentions and
// the system's own activity rows, in one chronological list (spec §3).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";
import { mentionsStillInBody } from "@/lib/tasks/mentions";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  listStaffForMentions,
  listTaskComments,
  uploadTaskAttachment,
} from "@/lib/actions/task-comment-actions";
import { ADMIN_ROLES } from "@/types/auth.types";
import type {
  ActivityField,
  StaffMentionOption,
  TaskAttachment,
  TaskCommentWithAuthor,
} from "@/types/task-comment.types";

const ACTIVITY_LABEL: Record<ActivityField, string> = {
  status: "שינה סטטוס",
  assignee: "שייך ל-",
  priority: "שינה עדיפות",
  due_date: "שינה יעד",
  progress: "עדכן התקדמות",
  board: "העביר לוח",
};

const MAX_ATTACHMENTS_PER_SEND = 5;
const MAX_SHRUNK_WIDTH = 2000;
const MAX_MENTION_RESULTS = 6;

interface PendingUpload {
  id: string;
  name: string;
}

interface ComposerAttachment extends TaskAttachment {
  /** Local object URL for the pre-send thumbnail only - never sent to the server. */
  previewUrl: string;
}

interface MentionTrigger {
  /** Index of the "@" in the textarea value. */
  start: number;
  query: string;
}

/** Draws the file to a canvas and re-encodes it - returns the original file
 *  untouched when it is already narrower than maxWidth. */
async function shrinkToMaxWidth(
  file: File,
  maxWidth: number,
): Promise<{ file: File; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image decode failed"));
    el.src = dataUrl;
  });

  if (image.width <= maxWidth) {
    return { file, width: image.width, height: image.height };
  }

  const scale = maxWidth / image.width;
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, width: image.width, height: image.height };
  ctx.drawImage(image, 0, 0, width, height);

  const mime = file.type || "image/png";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime));
  if (!blob) return { file, width: image.width, height: image.height };
  return { file: new File([blob], file.name, { type: mime }), width, height };
}

/** Where in the text an "@" mention is being typed right now, or null. A
 *  space (or the start of a new word) after the "@" cancels the trigger. */
function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const upToCursor = text.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  const query = upToCursor.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function activityText(activity: NonNullable<TaskCommentWithAuthor["activity"]>, nameOf: Map<string, string>): string {
  const label = ACTIVITY_LABEL[activity.field];
  const resolve = (value: string | null) =>
    activity.field === "assignee" && value ? (nameOf.get(value) ?? value) : value;
  const from = resolve(activity.from);
  const to = resolve(activity.to);
  if (activity.field === "assignee") {
    return to ? `${label}${to}` : "הסיר שיוך";
  }
  return from == null ? `${label}: ${to ?? "-"}` : `${label}: ${from} → ${to ?? "-"}`;
}

export function TaskThread({
  taskId,
  onCommentAdded,
}: {
  taskId: string;
  /** The inline thread on /tasks refreshes the row's comment count with it. */
  onCommentAdded?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = !!user && (ADMIN_ROLES as readonly string[]).includes(user.role);

  const [comments, setComments] = useState<TaskCommentWithAuthor[] | null>(null);
  const [staff, setStaff] = useState<StaffMentionOption[]>([]);

  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [pickedMentions, setPickedMentions] = useState<Array<{ id: string; label: string }>>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<MentionTrigger | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Every live preview blob URL, tracked outside state: the unmount cleanup below
  // runs with the FIRST render's closure, where `attachments` is always [].
  const previewUrlsRef = useRef<Set<string>>(new Set());

  function makePreviewUrl(file: Blob): string {
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.add(url);
    return url;
  }

  function releasePreviewUrl(url: string) {
    URL.revokeObjectURL(url);
    previewUrlsRef.current.delete(url);
  }

  const load = useCallback(async () => {
    setComments(await listTaskComments(taskId));
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listStaffForMentions().then(setStaff);
  }, []);

  // Attachment preview URLs are local blobs - release them once they're no
  // longer shown (sent, removed, or the thread unmounts).
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of staff) map.set(person.id, person.display_name || person.email);
    return map;
  }, [staff]);

  const filteredStaff = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return staff
      .filter((person) => (person.display_name || person.email).toLowerCase().includes(query))
      .slice(0, MAX_MENTION_RESULTS);
  }, [mention, staff]);

  async function uploadFiles(files: File[]) {
    for (const file of files.slice(0, MAX_ATTACHMENTS_PER_SEND)) {
      if (!file.type.startsWith("image/")) continue;
      const id = crypto.randomUUID();
      setPending((prev) => [...prev, { id, name: file.name }]);
      try {
        const shrunk = await shrinkToMaxWidth(file, MAX_SHRUNK_WIDTH);
        const form = new FormData();
        form.set("file", shrunk.file);
        form.set("width", String(shrunk.width));
        form.set("height", String(shrunk.height));
        const result = await uploadTaskAttachment(taskId, form);
        if (!result.ok) {
          toast({ title: result.error, variant: "destructive" });
          continue;
        }
        setAttachments((prev) => [
          ...prev,
          { ...result.attachment, previewUrl: makePreviewUrl(shrunk.file) },
        ]);
      } catch (error) {
        // A shrink/upload that throws (bad image, network, server action error) must not
        // leave a spinner behind - the finally below removes this file's placeholder.
        console.error("task-thread: upload failed", error);
        toast({ title: `ההעלאה של ${file.name} נכשלה`, variant: "destructive" });
      } finally {
        setPending((prev) => prev.filter((item) => item.id !== id));
      }
    }
  }

  function removeAttachment(path: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.path === path);
      if (target) releasePreviewUrl(target.previewUrl);
      return prev.filter((a) => a.path !== path);
    });
  }

  function onBodyChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setBody(value);
    const trigger = findMentionTrigger(value, event.target.selectionStart);
    setMention(trigger);
    setHighlighted(0);
  }

  function selectMention(person: StaffMentionOption) {
    if (!mention) return;
    const name = person.display_name || person.email;
    const cursor = mention.start + 1 + mention.query.length;
    const next = `${body.slice(0, mention.start)}@${name} ${body.slice(cursor)}`;
    setBody(next);
    if (!mentions.includes(person.id)) {
      setMentions((prev) => [...prev, person.id]);
      setPickedMentions((prev) => [...prev, { id: person.id, label: name }]);
    }
    setMention(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function onMentionKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!mention || filteredStaff.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((prev) => (prev + 1) % filteredStaff.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((prev) => (prev - 1 + filteredStaff.length) % filteredStaff.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectMention(filteredStaff[highlighted]);
      return true;
    }
    if (event.key === "Escape") {
      setMention(null);
      return true;
    }
    return false;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (onMentionKeyDown(event)) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      if (pending.length === 0) {
        event.preventDefault();
        send();
      }
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length) uploadFiles(files);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length) uploadFiles(files);
  }

  function onFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) uploadFiles(files);
    event.target.value = "";
  }

  async function send() {
    const trimmed = body.trim();
    if (sending || pending.length > 0 || (!trimmed && attachments.length === 0)) return;
    setSending(true);
    try {
      // Strip the local-only preview blob URL before it crosses the server
      // action boundary - the server never needs it and shouldn't store it.
      const payloadAttachments: TaskAttachment[] = attachments.map((a) => ({
        path: a.path,
        name: a.name,
        mime: a.mime,
        size: a.size,
        width: a.width,
        height: a.height,
      }));
      // Prune mention IDs whose @<label> no longer appears in the body text
      const prunedMentions = mentionsStillInBody(trimmed, pickedMentions);
      const result = await addTaskComment({
        taskId,
        body: trimmed,
        attachments: payloadAttachments,
        mentions: prunedMentions,
      });
      if (!result.ok) {
        toast({ title: result.error, variant: "destructive" });
        return;
      }
      attachments.forEach((a) => releasePreviewUrl(a.previewUrl));
      setBody("");
      setAttachments([]);
      setMentions([]);
      setPickedMentions([]);
      await load();
      onCommentAdded?.();
    } finally {
      setSending(false);
    }
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    const result = await editTaskComment(id, text);
    if (!result.ok) {
      toast({ title: result.error, variant: "destructive" });
      return;
    }
    setEditingId(null);
    await load();
  }

  async function removeComment(id: string) {
    const result = await deleteTaskComment(id);
    if (!result.ok) {
      toast({ title: result.error, variant: "destructive" });
      return;
    }
    await load();
  }

  if (comments === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground">אין עדיין תגובות על המשימה הזו.</p>
        )}
        {comments.map((row) => {
          if (row.kind === "activity") {
            return (
              <div key={row.id} className="px-1 text-xs text-muted-foreground">
                <span className="font-medium">{row.author_name ?? "המערכת"}</span>{" "}
                {row.activity && activityText(row.activity, nameOf)}
                {" · "}
                <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
              </div>
            );
          }

          const isOwn = !!user && row.author_id === user.id;
          const canEdit = isOwn && !row.deleted_at;
          const canDelete = !row.deleted_at && (isOwn || isAdmin);
          const isEditing = editingId === row.id;

          return (
            <div key={row.id} className="flex gap-3 rounded-md border bg-card p-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs">{initials(row.author_name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{row.author_name ?? "משתמש"}</span>
                  <time dateTime={row.created_at} className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                    {row.edited_at && " (נערך)"}
                  </time>
                </div>

                {row.deleted_at ? (
                  <p className="text-sm italic text-muted-foreground">התגובה נמחקה</p>
                ) : isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      dir="auto"
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(row.id)} disabled={!editText.trim()}>
                        שמור
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        ביטול
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {row.body && (
                      <p dir="auto" className="whitespace-pre-wrap text-sm">
                        {row.body}
                      </p>
                    )}
                    {row.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {row.attachments.map((attachment, index) => (
                          <button
                            key={attachment.path}
                            type="button"
                            className="overflow-hidden rounded border"
                            onClick={() =>
                              setLightbox({
                                url: row.attachment_urls[index] ?? "",
                                alt: attachment.name,
                              })
                            }
                          >
                            <img
                              src={row.attachment_urls[index] || undefined}
                              alt={attachment.name}
                              className="h-20 w-20 object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {(canEdit || canDelete) && (
                      <div className="flex gap-3 pt-0.5">
                        {canEdit && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            onClick={() => {
                              setEditingId(row.id);
                              setEditText(row.body ?? "");
                            }}
                          >
                            עריכה
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-destructive hover:underline"
                            onClick={() => removeComment(row.id)}
                          >
                            מחיקה
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t pt-3">
        <Label htmlFor="task-thread-body">הוסף תגובה</Label>
        <div className="relative" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <Textarea
            id="task-thread-body"
            ref={textareaRef}
            dir="auto"
            rows={3}
            value={body}
            placeholder="כתוב תגובה… (Ctrl+Enter לשליחה, @ לאזכור, אפשר להדביק צילום מסך)"
            onChange={onBodyChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setMention(null)}
          />
          {mention && filteredStaff.length > 0 && (
            <div
              role="listbox"
              aria-label="בחר איש צוות לאזכור"
              className="absolute z-10 mt-1 max-h-48 w-64 overflow-auto rounded-md border bg-popover shadow-md"
            >
              {filteredStaff.map((person, index) => (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={cn(
                    "block w-full px-2 py-1.5 text-start text-sm hover:bg-accent",
                    index === highlighted && "bg-accent",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectMention(person)}
                >
                  {person.display_name || person.email}
                </button>
              ))}
            </div>
          )}
        </div>

        {(attachments.length > 0 || pending.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div key={attachment.path} className="group relative h-16 w-16 overflow-hidden rounded border">
                <img src={attachment.previewUrl} alt={attachment.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`הסר את ${attachment.name}`}
                  className="absolute right-0 top-0 rounded-bl bg-background/80 px-1 text-xs opacity-0 group-hover:opacity-100"
                  onClick={() => removeAttachment(attachment.path)}
                >
                  ✕
                </button>
              </div>
            ))}
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex h-16 w-16 items-center justify-center rounded border bg-muted text-[10px] text-muted-foreground"
              >
                מעלה…
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFileInput}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="צרף תמונה"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            onClick={send}
            disabled={sending || pending.length > 0 || (!body.trim() && attachments.length === 0)}
          >
            {sending ? "שולח…" : "שלח"}
          </Button>
        </div>
      </div>

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">{lightbox?.alt ?? "תמונה"}</DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lightbox.url} alt={lightbox.alt} className="h-auto w-full rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
