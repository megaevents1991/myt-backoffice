"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2, Pencil, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";
import {
  createFootballLogo,
  updateFootballLogo,
  deleteFootballLogo,
} from "@/lib/actions/football-logo-actions";
import type { FootballLogo } from "@/types/football-logo.types";

export function LogoLibrary({ initialLogos }: { initialLogos: FootballLogo[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [logos, setLogos] = useState(initialLogos);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<FootballLogo | null>(null);
  const [editEn, setEditEn] = useState("");
  const [editHe, setEditHe] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logos;
    return logos.filter(
      (l) =>
        l.name_english.toLowerCase().includes(q) ||
        (l.name_hebrew ?? "").toLowerCase().includes(q)
    );
  }, [logos, search]);

  const onUpload = async (formData: FormData) => {
    setUploading(true);
    try {
      const created = await createFootballLogo(formData);
      setLogos((prev) =>
        [...prev, created].sort((a, b) =>
          a.name_english.localeCompare(b.name_english)
        )
      );
      formRef.current?.reset();
      toast({ title: "Logo added", description: created.name_english });
      router.refresh(); // picker options come from the server component
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setUploading(false);
    }
  };

  const openEdit = (logo: FootballLogo) => {
    setEditing(logo);
    setEditEn(logo.name_english);
    setEditHe(logo.name_hebrew ?? "");
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const updated = await updateFootballLogo(editing.id, {
        name_english: editEn,
        name_hebrew: editHe || null,
      });
      setLogos((prev) =>
        prev
          .map((l) => (l.id === updated.id ? updated : l))
          .sort((a, b) => a.name_english.localeCompare(b.name_english))
      );
      setEditing(null);
      toast({ title: "Logo updated", description: updated.name_english });
      router.refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const onDelete = async (logo: FootballLogo) => {
    if (
      !(await confirm({
        title: `Delete logo "${logo.name_english}"?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setDeletingId(logo.id);
    try {
      await deleteFootballLogo(logo.id);
      setLogos((prev) => prev.filter((l) => l.id !== logo.id));
      toast({ title: "Logo deleted", description: logo.name_english });
      router.refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <form
        ref={formRef}
        action={onUpload}
        className="border rounded-md p-4 bg-muted/30 space-y-3"
      >
        <p className="font-medium">העלאת לוגו חדש</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="ll-file">Logo file (PNG/SVG/WebP, max 2MB)</Label>
            <Input
              id="ll-file"
              name="file"
              type="file"
              accept="image/png,image/svg+xml,image/webp,image/jpeg"
              required
            />
          </div>
          <div>
            <Label htmlFor="ll-name-en">Name (English)</Label>
            <Input
              id="ll-name-en"
              name="name_english"
              placeholder="Real Madrid"
              required
            />
          </div>
          <div>
            <Label htmlFor="ll-name-he">שם (עברית, אופציונלי)</Label>
            <Input id="ll-name-he" name="name_hebrew" placeholder="ריאל מדריד" />
          </div>
        </div>
        <Button type="submit" disabled={uploading}>
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Upload logo
        </Button>
      </form>

      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="חפש לוגו (עברית או אנגלית)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground shrink-0">
          {filtered.length} / {logos.length} logos
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="border rounded-md p-10 text-center text-muted-foreground">
          {logos.length === 0
            ? "אין לוגואים עדיין — העלה את הראשון למעלה"
            : "לא נמצאו לוגואים לחיפוש הזה"}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filtered.map((logo) => (
            <div
              key={logo.id}
              className="border rounded-md p-3 flex flex-col items-center gap-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logo.logo_url}
                alt={logo.name_english}
                className="h-16 w-16 object-contain"
                loading="lazy"
              />
              <div className="text-center min-w-0 w-full">
                <p className="text-sm font-medium truncate">{logo.name_english}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {logo.name_hebrew ?? " "}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => openEdit(logo)}
                  aria-label={`Edit ${logo.name_english}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => onDelete(logo)}
                  disabled={deletingId === logo.id}
                  aria-label={`Delete ${logo.name_english}`}
                >
                  {deletingId === logo.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit logo names</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ll-edit-en">Name (English)</Label>
              <Input
                id="ll-edit-en"
                value={editEn}
                onChange={(e) => setEditEn(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ll-edit-he">שם (עברית)</Label>
              <Input
                id="ll-edit-he"
                value={editHe}
                onChange={(e) => setEditHe(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={onSaveEdit} disabled={savingEdit || !editEn.trim()}>
              {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
