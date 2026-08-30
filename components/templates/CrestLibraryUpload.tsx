"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createFootballLogo,
  getFootballLogos,
} from "@/lib/actions/football-logo-actions";
import {
  LOGO_ACCEPT,
  duplicateLogoMessage,
  findDuplicateLogo,
  validateLogoFile,
} from "@/lib/football-logo-upload";
import type {
  CreateFootballLogoResult,
  FootballLogo,
} from "@/types/football-logo.types";

// Light copy of the site's clubNamesMatch (myt-main lib/eventNameMatch.ts):
// identifying tokens equal, qualifiers ignored - "Tottenham Hotspur FC" finds
// the library's "Tottenham Hotspur". Keep the token list in sync.
const GENERIC_TOKENS = new Set([
  "fc", "afc", "cf", "cfc", "sc", "ac", "as", "ss", "ssc", "us", "ud",
  "ca", "rc", "rcd", "sl", "bc", "de", "del", "calcio", "club", "balompie",
]);
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t && !GENERIC_TOKENS.has(t));
const tokensEqual = (a: string[], b: string[]): boolean =>
  a.length > 0 && a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Inline "upload straight to the football_logos library" widget for the team
 * form - saves the trip to Assets → Football logos. Shows the library crest
 * the site will resolve for this team (exact english / exact hebrew / token
 * match), or an upload button that files the crest under the team's names.
 * The library is the site's PRIMARY crest source; per-team art is only a
 * fallback, so this is THE place to put a new team's logo.
 */
export function CrestLibraryUpload({
  nameEnglish,
  nameHebrew,
}: {
  nameEnglish: string;
  nameHebrew: string;
}) {
  const [logos, setLogos] = useState<FootballLogo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getFootballLogos()
      .then(setLogos)
      .catch(() => setLogos([]));
  }, []);

  const en = nameEnglish.trim();
  const he = nameHebrew.trim();
  const match = logos?.find(
    (l) =>
      (en && l.name_english.trim().toLowerCase() === en.toLowerCase()) ||
      (he && l.name_hebrew?.trim() === he) ||
      (en && tokensEqual(tokens(l.name_english), tokens(en)))
  );

  const onFile = async (file: File) => {
    const clearInput = () => {
      if (fileRef.current) fileRef.current.value = "";
    };

    // Same rules the action enforces, answered without a round-trip.
    const localError = !en
      ? "חובה למלא שם באנגלית לקבוצה לפני העלאת הסמל."
      : (validateLogoFile(file) ??
        (findDuplicateLogo(logos ?? [], en) ? duplicateLogoMessage(en) : null));
    if (localError) {
      toast.error(localError);
      clearInput();
      return;
    }

    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("name_english", en);
    fd.set("name_hebrew", he);

    let result: CreateFootballLogoResult;
    try {
      result = await createFootballLogo(fd);
    } catch (error) {
      console.error("createFootballLogo transport error:", error);
      result = {
        ok: false,
        kind: "server",
        message: "הבקשה לשרת נכשלה עוד לפני שההעלאה התחילה.",
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      setBusy(false);
      clearInput();
    }

    if (!result.ok) {
      // Only "server" is ours to fix; the rest is the file or the name.
      if (result.kind === "server") {
        console.error("createFootballLogo failed:", result.message, result.detail);
        toast.error(
          `באג בצד השרת - לא בגלל הקובץ: ${result.message}${
            result.detail ? ` (${result.detail})` : ""
          }`,
        );
      } else {
        toast.error(result.message);
      }
      return;
    }

    setLogos((prev) => [...(prev ?? []), result.logo]);
    toast.success("Crest uploaded to the library - the site updates automatically.");
  };

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Label>Crest - football logos library (what the site actually shows)</Label>
      {match ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={match.logo_url}
            alt={match.name_english}
            className="h-12 w-12 object-contain"
          />
          <p className="text-sm text-muted-foreground">
            In the library as <span className="font-medium">{match.name_english}</span> -
            the site renders this crest at the standard size. Replace it in{" "}
            <a href="/assets" className="underline">Assets → Football logos</a>.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            asChild
            variant="outline"
            disabled={busy || (!en && !he)}
            type="button"
          >
            <label className="cursor-pointer">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span className="ml-2">
                {busy ? "Uploading…" : "Upload crest to library"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept={LOGO_ACCEPT}
                hidden
                disabled={busy || (!en && !he)}
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </label>
          </Button>
          <p className="text-xs text-muted-foreground">
            {logos === null
              ? "Checking the library…"
              : en || he
                ? "No library crest for this team yet. Transparent tight-cropped PNG, up to 2MB - files under the team's names; no zoom/position needed."
                : "Fill the team names first - the crest files under them."}
          </p>
        </div>
      )}
    </div>
  );
}
