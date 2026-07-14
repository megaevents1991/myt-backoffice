"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  generateCreative,
  getCreativeDefaults,
} from "@/lib/actions/creative-actions";

type Option = { id: number; name: string };

// "14.09.2026" → "2026-09-14" (for <input type="date">)
const ddmmyyyyToIso = (t: string) => {
  const [dd, mm, yyyy] = t.split(".");
  return yyyy && mm && dd ? `${yyyy}-${mm}-${dd}` : "";
};

export function CreativeForm({
  teams, locations, events,
}: { teams: Option[]; locations: Option[]; events: Option[] }) {
  const [kind, setKind] = useState<"match" | "artist">("match");
  const [eventId, setEventId] = useState<string>("");
  const [homeId, setHomeId] = useState<string>("");
  const [awayId, setAwayId] = useState<string>("");
  const [artistName, setArtistName] = useState("");
  const [artistImg, setArtistImg] = useState("");
  const [date, setDate] = useState("");        // yyyy-mm-dd from <input type="date">
  const [time, setTime] = useState("");
  const [locationText, setLocationText] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("$");
  const [mode, setMode] = useState<"package" | "ticket">("package");
  const [attach, setAttach] = useState(true);
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
      setHomeId(d.homeTeamId != null ? String(d.homeTeamId) : "");
      setAwayId(d.awayTeamId != null ? String(d.awayTeamId) : "");
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
      ? homeId && awayId && homeId !== awayId
      : artistName.trim() && artistImg.trim();
  const ready = subjectReady && dateText && Number(price) > 0;

  const previewUrl = useMemo(() => {
    if (!ready) return null;
    const q = new URLSearchParams({
      kind, date: dateText, price, cur: currency, mode, size: "square",
    });
    if (kind === "match") {
      q.set("home", homeId);
      q.set("away", awayId);
    } else {
      q.set("img", artistImg);
      q.set("name", artistName);
    }
    if (time) q.set("time", time);
    if (locationText) q.set("loc", locationText);
    return `/api/creative?${q.toString()}`;
  }, [ready, kind, homeId, awayId, artistImg, artistName, dateText, price, currency, mode, time, locationText]);

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
        attachEventId: eventId && attach ? Number(eventId) : null,
      };
      const res = await generateCreative(
        kind === "match"
          ? { kind: "match", homeId: Number(homeId), awayId: Number(awayId), ...base }
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
          <Select value={eventId} onValueChange={onEventChange}>
            <SelectTrigger>
              <SelectValue placeholder={loadingDefaults ? "טוען..." : "בחר אירוע"} />
            </SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <Select value={homeId} onValueChange={setHomeId}>
                <SelectTrigger><SelectValue placeholder="Select home team" /></SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Away team</Label>
              <Select value={awayId} onValueChange={setAwayId}>
                <SelectTrigger><SelectValue placeholder="Select away team" /></SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
