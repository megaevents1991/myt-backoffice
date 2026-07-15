"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown, Download } from "lucide-react";
import {
  generateCreative,
  getCreativeDefaults,
} from "@/lib/actions/creative-actions";

type Option = { id: number; name: string };
// ref = "team:<id>" (football_teams) or "logo:<id>" (football_logos library).
// searchText carries both Hebrew + English names so the combobox finds either.
type SubjectOption = { ref: string; label: string; searchText: string };
type EventOption = { id: number; name: string; dateText: string; location: string };

function SubjectCombobox({
  value, onChange, subjects, placeholder,
}: {
  value: string;
  onChange: (ref: string) => void;
  subjects: SubjectOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = subjects.find((s) => s.ref === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected?.label ?? placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="חפש קבוצה (עברית או אנגלית)..." />
          <CommandList>
            <CommandEmpty>לא נמצאו קבוצות</CommandEmpty>
            <CommandGroup>
              {subjects.map((s) => (
                <CommandItem
                  key={s.ref}
                  /* ref prefix keeps values unique — same team can exist in
                     both the logo library and football_teams. */
                  value={`${s.ref}|${s.searchText}`}
                  onSelect={() => {
                    setOpen(false);
                    onChange(s.ref);
                  }}
                >
                  {s.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// "14.09.2026" → "2026-09-14" (for <input type="date">)
const ddmmyyyyToIso = (t: string) => {
  const [dd, mm, yyyy] = t.split(".");
  return yyyy && mm && dd ? `${yyyy}-${mm}-${dd}` : "";
};

export function CreativeForm({
  subjects, locations, events,
}: { subjects: SubjectOption[]; locations: Option[]; events: EventOption[] }) {
  const [kind, setKind] = useState<"match" | "artist">("match");
  const [eventId, setEventId] = useState<string>("");
  const [eventOpen, setEventOpen] = useState(false);
  const [homeRef, setHomeRef] = useState<string>("");
  const [awayRef, setAwayRef] = useState<string>("");
  const [artistName, setArtistName] = useState("");
  const [artistImg, setArtistImg] = useState("");
  const [date, setDate] = useState("");        // yyyy-mm-dd from <input type="date">
  const [time, setTime] = useState("");
  const [locationText, setLocationText] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("$");
  const [mode, setMode] = useState<"package" | "ticket">("package");
  const [attach, setAttach] = useState(true);
  // Card design overrides ("" = auto: football bg for matches, blob for artists).
  const [cardBg, setCardBg] = useState<string>("");
  const [blobColor, setBlobColor] = useState<string>("");
  const [blobShape, setBlobShape] = useState<string>("");
  // Designer sizing (rendered into the PNG): zoom in %, offsets in % of card.
  const [imgZoom, setImgZoom] = useState(100);
  const [imgX, setImgX] = useState(0);
  const [imgY, setImgY] = useState(0);
  const [bgZoom, setBgZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ squareUrl: string; bannerUrl: string } | null>(null);

  // Pick an event → everything below auto-fills (and stays editable).
  const onEventChange = async (value: string) => {
    setEventId(value);
    setResult(null);
    setError(null);
    if (!value) return;
    setLoadingDefaults(true);
    try {
      const d = await getCreativeDefaults(Number(value));
      setKind(d.kind);
      setDate(ddmmyyyyToIso(d.dateText));
      setTime(d.timeText ?? "");
      setLocationText(d.locationText);
      setPrice(d.price != null ? String(d.price) : "");
      setCurrency(d.currency);
      setMode("package");
      setHomeRef(d.homeRef ?? "");
      setAwayRef(d.awayRef ?? "");
      setArtistName(d.artistName ?? "");
      setArtistImg(d.artistImageUrl ?? "");
      setWarnings(d.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load event defaults");
    } finally {
      setLoadingDefaults(false);
    }
  };

  const dateText = useMemo(() => {
    if (!date) return "";
    const [y, m, d] = date.split("-");
    return `${d}.${m}.${y}`;
  }, [date]);

  const subjectReady =
    kind === "match"
      ? homeRef && awayRef && homeRef !== awayRef
      : artistName.trim() && artistImg.trim();
  const ready = subjectReady && dateText && Number(price) > 0;

  const previewUrl = useMemo(() => {
    if (!ready) return null;
    const q = new URLSearchParams({
      kind, date: dateText, price, cur: currency, mode, size: "square",
    });
    if (kind === "match") {
      q.set("home", homeRef);
      q.set("away", awayRef);
    } else {
      q.set("img", artistImg);
      q.set("name", artistName);
    }
    if (time) q.set("time", time);
    if (locationText) q.set("loc", locationText);
    if (cardBg) q.set("bg", cardBg);
    if (blobColor) q.set("color", blobColor);
    if (blobShape) q.set("shape", blobShape);
    if (imgZoom !== 100) q.set("iscale", String(imgZoom / 100));
    if (imgX !== 0) q.set("ix", String(imgX));
    if (imgY !== 0) q.set("iy", String(imgY));
    if (bgZoom !== 100) q.set("bgscale", String(bgZoom / 100));
    return `/api/creative?${q.toString()}`;
  }, [ready, kind, homeRef, awayRef, artistImg, artistName, dateText, price, currency, mode, time, locationText, cardBg, blobColor, blobShape, imgZoom, imgX, imgY, bgZoom]);

  // Design-base download: full branded canvas WITHOUT blob/subject image —
  // works even when the event has no cut-out image yet (that's the point).
  const bareUrl = useMemo(() => {
    const subjectOk =
      kind === "match" ? homeRef && awayRef && homeRef !== awayRef : artistName.trim();
    if (!subjectOk || !dateText || !(Number(price) > 0)) return null;
    const q = new URLSearchParams({
      kind, date: dateText, price, cur: currency, mode, size: "square", bare: "1",
    });
    if (kind === "match") {
      q.set("home", homeRef);
      q.set("away", awayRef);
    } else {
      q.set("name", artistName);
    }
    if (time) q.set("time", time);
    if (locationText) q.set("loc", locationText);
    return `/api/creative?${q.toString()}`;
  }, [kind, homeRef, awayRef, artistName, dateText, price, currency, mode, time, locationText]);

  const onGenerate = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const base = {
        dateText,
        timeText: time || null,
        locationText,
        price: Number(price),
        currency,
        mode,
        bgKind: (cardBg || undefined) as "blob" | "football" | "tennis" | "cars" | undefined,
        colorIndex: blobColor ? Number(blobColor) : null,
        shapeIndex: blobShape ? Number(blobShape) : null,
        imgScale: imgZoom !== 100 ? imgZoom / 100 : null,
        imgOffsetX: imgX !== 0 ? imgX : null,
        imgOffsetY: imgY !== 0 ? imgY : null,
        bgScale: bgZoom !== 100 ? bgZoom / 100 : null,
        attachEventId: eventId && attach ? Number(eventId) : null,
      };
      const res = await generateCreative(
        kind === "match"
          ? { kind: "match", homeRef, awayRef, ...base }
          : { kind: "artist", imageUrl: artistImg, artistName, ...base },
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-4">
        <div className="border rounded-md p-4 bg-muted/30">
          <Label>בחר אירוע — הכול יתמלא אוטומטית</Label>
          <Popover open={eventOpen} onOpenChange={setEventOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={eventOpen}
                className="w-full justify-between font-normal"
              >
                {eventId
                  ? events.find((e) => String(e.id) === eventId)?.name ?? "בחר אירוע"
                  : loadingDefaults
                    ? "טוען..."
                    : "חפש אירוע..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="חפש לפי שם, עיר או תאריך..." />
                <CommandList>
                  <CommandEmpty>לא נמצאו אירועים עתידיים</CommandEmpty>
                  <CommandGroup>
                    {events.map((e) => (
                      <CommandItem
                        key={e.id}
                        /* id prefix keeps the value unique — duplicate values
                           (e.g. same artist, same date) make cmdk treat two
                           rows as one and clicking the second does nothing. */
                        value={`${e.id}|${e.name} ${e.location} ${e.dateText}`}
                        onSelect={() => {
                          setEventOpen(false);
                          onEventChange(String(e.id));
                        }}
                      >
                        <div className="flex flex-col">
                          <span>{e.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {e.dateText}
                            {e.location ? ` · ${e.location}` : ""}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {warnings.map((w) => (
            <p key={w} className="text-sm text-amber-600 mt-1">⚠ {w}</p>
          ))}
          {eventId && (
            <div className="flex items-center gap-2 mt-2">
              <Checkbox
                id="cg-attach"
                checked={attach}
                onCheckedChange={(v) => setAttach(v === true)}
              />
              <Label htmlFor="cg-attach">Set as event card image (overwrites current card)</Label>
            </div>
          )}
          {eventId && (
            <div className="mt-3 border-t pt-3">
              <p className="text-sm font-medium mb-1">קבצי עזר למעצב</p>
              <p className="text-xs text-muted-foreground mb-2">
                כשאין לאירוע תמונה חתוכה — מורידים בסיס, מלבישים עליו את התמונה, ומעלים חזרה.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/creative?kind=blob&seed=${eventId}&size=square`} target="_blank" rel="noreferrer">
                    <Download className="mr-2 h-4 w-4" />
                    צורת Blob שקופה (PNG)
                  </a>
                </Button>
                {bareUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={bareUrl} target="_blank" rel="noreferrer">
                      <Download className="mr-2 h-4 w-4" />
                      תבנית מלאה בלי תמונה
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <Label>Type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "match" | "artist")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Match (2 teams + VS)</SelectItem>
              <SelectItem value="artist">Artist (single image)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === "match" ? (
          <>
            <div>
              <Label>Home team</Label>
              <SubjectCombobox
                value={homeRef}
                onChange={setHomeRef}
                subjects={subjects}
                placeholder="Select home team"
              />
            </div>
            <div>
              <Label>Away team</Label>
              <SubjectCombobox
                value={awayRef}
                onChange={setAwayRef}
                subjects={subjects}
                placeholder="Select away team"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="cg-artist-name">Artist name</Label>
              <Input
                id="cg-artist-name"
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                placeholder="סלין דיון"
              />
            </div>
            <div>
              <Label htmlFor="cg-artist-img">Artist image URL</Label>
              <Input
                id="cg-artist-img"
                value={artistImg}
                onChange={(e) => setArtistImg(e.target.value)}
                placeholder="https://.../artist.png"
              />
            </div>
          </>
        )}

        <div className="flex gap-4">
          <div className="flex-1">
            <Label htmlFor="cg-date">Date</Label>
            <Input id="cg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label htmlFor="cg-time">Time (optional)</Label>
            <Input id="cg-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Location</Label>
          <Select value={locationText} onValueChange={setLocationText}>
            <SelectTrigger><SelectValue placeholder="Stadium / city" /></SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="mt-2"
            placeholder="Or type free text (e.g. Santiago Bernabéu, Madrid)"
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
          />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <Label htmlFor="cg-price">Price</Label>
            <Input id="cg-price" type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="w-24">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="$">$</SelectItem>
                <SelectItem value="€">€</SelectItem>
                <SelectItem value="₪">₪</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "package" | "ticket")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="package">Package (flight+hotel+ticket)</SelectItem>
                <SelectItem value="ticket">Ticket only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <Label>רקע כרטיס</Label>
            <Select value={cardBg} onValueChange={(v) => setCardBg(v === "auto" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="אוטומטי" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">אוטומטי (משחק=כדורגל, אמן=Blob)</SelectItem>
                <SelectItem value="football">רקע כדורגל</SelectItem>
                <SelectItem value="blob">Blob</SelectItem>
                <SelectItem value="tennis">רקע טניס</SelectItem>
                <SelectItem value="cars">רקע מירוצים</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label>צבע Blob</Label>
            <Select value={blobColor} onValueChange={(v) => setBlobColor(v === "auto" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="אוטומטי" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">אוטומטי</SelectItem>
                <SelectItem value="0">מנטה</SelectItem>
                <SelectItem value="1">תכלת</SelectItem>
                <SelectItem value="2">סגול</SelectItem>
                <SelectItem value="3">קורל</SelectItem>
                <SelectItem value="4">זהב</SelectItem>
                <SelectItem value="5">כתום</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label>צורת Blob</Label>
            <Select value={blobShape} onValueChange={(v) => setBlobShape(v === "auto" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="אוטומטי" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">אוטומטי</SelectItem>
                <SelectItem value="0">צורה 1</SelectItem>
                <SelectItem value="1">צורה 2</SelectItem>
                <SelectItem value="2">צורה 3</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label>גודל ומיקום (נשמר בתמונה הסופית)</Label>
            {(imgZoom !== 100 || imgX !== 0 || imgY !== 0 || bgZoom !== 100) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setImgZoom(100); setImgX(0); setImgY(0); setBgZoom(100); }}
              >
                איפוס
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">זום תמונה</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{imgZoom}%</span>
              </div>
              <Slider
                className="mt-1"
                min={50}
                max={200}
                step={5}
                value={[imgZoom]}
                onValueChange={([v]) => setImgZoom(v)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">זום רקע</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{bgZoom}%</span>
              </div>
              <Slider
                className="mt-1"
                min={50}
                max={200}
                step={5}
                value={[bgZoom]}
                onValueChange={([v]) => setBgZoom(v)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">מיקום תמונה ↔</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{imgX}%</span>
              </div>
              <Slider
                className="mt-1"
                min={-50}
                max={50}
                step={1}
                value={[imgX]}
                onValueChange={([v]) => setImgX(v)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">מיקום תמונה ↕</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{imgY}%</span>
              </div>
              <Slider
                className="mt-1"
                min={-50}
                max={50}
                step={1}
                value={[imgY]}
                onValueChange={([v]) => setImgY(v)}
              />
            </div>
          </div>
        </div>

        <Button onClick={onGenerate} disabled={!ready || busy || loadingDefaults} className="w-full">
          {busy ? "Generating…" : "צור תמונה"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="space-y-2 border rounded-md p-4">
            <p className="font-medium">Saved to storage:</p>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={result.squareUrl} download target="_blank" rel="noreferrer">Download 1080×1080</a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={result.bannerUrl} download target="_blank" rel="noreferrer">Download 1200×628</a>
              </Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <Label>Preview (1080×1080)</Label>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Creative preview" className="w-full max-w-[540px] border rounded-md mt-2" />
        ) : (
          <div className="w-full max-w-[540px] aspect-square border rounded-md mt-2 flex items-center justify-center text-muted-foreground">
            בחר אירוע — או מלא ידנית
          </div>
        )}
      </div>
    </div>
  );
}
