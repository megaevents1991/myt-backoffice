# Creative Image Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backoffice page that renders match creatives (2 team logos + VS, date, stadium, price) from a brand template into 1080×1080 + 1200×628 PNGs, auto-saved to Supabase Storage, optionally attached as the event card. Rider: honest sitemap `lastmod` in myt-main.

**Architecture:** `ImageResponse` from `next/og` (satori, built into Next 15) renders a single React template component at two sizes. A GET route serves live preview to the dashboard form; a server action renders + uploads both sizes and optionally writes `events.card_image_url`. Club logos live in a new additive `football_teams.logo_url` column.

**Tech Stack:** Next.js 15 App Router, `next/og`, Supabase (service-role client `@/lib/supabase-server`), shadcn/ui, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-13-creative-image-generator-design.md`

## Global Constraints

- Repo: `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-backoffice` (Tasks 1–6), `...\myt-main` (Task 7).
- Branches: `feat/creative-generator` (backoffice), `fix/sitemap-lastmod` (main).
- No test suite in either repo — type gate is `npx tsc --noEmit`; behavior verified via dev server + curl/browser. Every task ends with both.
- No `any`; explicit column selects; every Supabase call checks `error`; server actions in `lib/actions`; shadcn primitives only.
- Conventional commits, **no AI co-author line**. Global hook prompts Dor on every commit — expected, not an error.
- Prices/currency are display text only here — NO interaction with the price chain.
- `middleware.ts` skips `/api/*` → the render route must check the `session` cookie itself.

---

### Task 1: Branch + DB/storage migration

**Files:**
- Create: `docs/sql/2026-07-13-creative-generator.sql`

**Interfaces:**
- Produces: `football_teams.logo_url text null` column; public bucket `creatives` with virtual folders `logos/`, `output/`, `assets/`.

- [ ] **Step 1: Create branch**

```bash
cd /c/Users/doraz/OneDrive/Desktop/Work/MegaEvent/MYT_Git_Shered/myt-backoffice
git checkout master && git pull && git checkout -b feat/creative-generator
```

- [ ] **Step 2: Write migration SQL**

```sql
-- 2026-07-13 Creative image generator (spec: docs/superpowers/specs/2026-07-13-creative-image-generator-design.md)

-- Club logo (transparent PNG). Additive; main app unaffected.
alter table public.football_teams
  add column if not exists logo_url text null;

-- Public bucket for generator assets + output.
insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do nothing;
```

- [ ] **Step 3: Dor runs the SQL in Supabase SQL editor** (agent cannot — stop and ask). Folders are virtual — created on first upload, no action needed.

- [ ] **Step 4: Upload placeholder assets via backoffice `/storage` page (or Supabase dashboard) — Dor:**
  - `creatives/assets/font.ttf` — Noto Sans Hebrew Bold (placeholder until brand font arrives): download from https://fonts.google.com/noto/specimen/Noto+Sans+Hebrew
  - `creatives/assets/bg-default.png` — any 1200×1080-ish dark image as placeholder background.

- [ ] **Step 5: Verify** — in Supabase: `select logo_url from football_teams limit 1;` returns column; bucket `creatives` listed public.

- [ ] **Step 6: Commit**

```bash
git add docs/sql/2026-07-13-creative-generator.sql
git commit -m "feat(creative): migration - football_teams.logo_url + creatives bucket"
```

---

### Task 2: Team logo field (type + form)

**Files:**
- Modify: `types/person.types.ts` (add `logo_url` to `Person`)
- Modify: `components/templates/PersonForm.tsx` (state + submit mapping + input, pattern of `art_image_url` at lines ~101–181)

**Interfaces:**
- Consumes: Task 1 column.
- Produces: `Person.logo_url: string | null`; football team form saves it.

- [ ] **Step 1: Add to `Person` interface** (after `art_image_url` block, `types/person.types.ts:16`):

```ts
  // Club logo for the creative generator — transparent PNG only.
  logo_url: string | null;
```

`CreatePersonData`/`UpdatePersonData` are derived via `Omit`/`Partial` — no further type edits.

- [ ] **Step 2: Wire into `PersonForm.tsx`** following the exact `artImageUrl` pattern:
  - `const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? "");` next to line ~103
  - reset effect: `setLogoUrl(initial?.logo_url ?? "");` next to line ~160
  - submit payload: `logo_url: logoUrl || null,` next to line ~181
  - UI input next to the Art Image URL field, only meaningful text differs:

```tsx
<div>
  <Label htmlFor="logo_url">Logo URL (transparent PNG — creative generator)</Label>
  <Input
    id="logo_url"
    value={logoUrl}
    onChange={(e) => setLogoUrl(e.target.value)}
    placeholder="https://.../creatives/logos/real-madrid.png"
  />
  {logoUrl && !logoUrl.toLowerCase().endsWith(".png") && (
    <p className="text-sm text-destructive mt-1">Must be a .png (satori cannot render SVG logos)</p>
  )}
</div>
```

  Match the form's actual field markup (it may use `FormField`/`FormControl` — copy the neighboring image_url field's exact wrapper).
  Block submit while invalid: include `logoUrl && !logoUrl.toLowerCase().endsWith(".png")` in the existing disabled/validation logic.

- [ ] **Step 3: Verify types + UI**

```bash
npx tsc --noEmit
npm run dev
```

Open `http://localhost:3000/templates/football`, edit a team, paste a PNG URL into the new field, save, reopen — value persists. Paste `.svg` URL — error text shows, save blocked.

- [ ] **Step 4: Commit**

```bash
git add types/person.types.ts components/templates/PersonForm.tsx
git commit -m "feat(creative): logo_url field on football teams"
```

---

### Task 3: Template component + render helper

**Files:**
- Create: `components/creative/MatchTemplate.tsx`
- Create: `lib/creative/render.tsx`

**Interfaces:**
- Produces:
  - `type CreativeInput = { homeLogoUrl: string; awayLogoUrl: string; homeName: string; awayName: string; dateText: string; timeText: string | null; locationText: string; priceText: string; }`
  - `MatchTemplate(props: CreativeInput & { width: number; height: number; bgUrl: string })` — satori-compatible JSX
  - `SIZES = { square: {width:1080,height:1080}, banner: {width:1200,height:628} }`, `type CreativeSize = "square" | "banner"`
  - `renderCreativePng(input: CreativeInput, size: CreativeSize): Promise<ArrayBuffer>`
  - `buildPriceText(mode: "package" | "ticket", price: number, currency: string): string`

- [ ] **Step 1: Write `components/creative/MatchTemplate.tsx`**

Satori rules: every div with >1 child needs explicit `display:"flex"`; inline styles only (no Tailwind); remote images by absolute URL.

```tsx
export type CreativeInput = {
  homeLogoUrl: string;
  awayLogoUrl: string;
  homeName: string;
  awayName: string;
  dateText: string;          // "14.09.2026"
  timeText: string | null;   // "21:00" or null → omitted
  locationText: string;      // "Santiago Bernabéu, Madrid"
  priceText: string;         // "החל מ-€499" / "כרטיסים החל מ-€99"
};

export function buildPriceText(mode: "package" | "ticket", price: number, currency: string): string {
  return mode === "ticket" ? `כרטיסים החל מ-${currency}${price}` : `חבילות החל מ-${currency}${price}`;
}

export function MatchTemplate({
  homeLogoUrl, awayLogoUrl, homeName, awayName,
  dateText, timeText, locationText, priceText,
  width, height, bgUrl,
}: CreativeInput & { width: number; height: number; bgUrl: string }) {
  const isSquare = height > 700;
  const logoBox = isSquare ? 340 : 220;
  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", position: "relative", backgroundColor: "#0b1020", fontFamily: "brand", color: "#ffffff" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bgUrl} alt="" width={width} height={height} style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover", opacity: 0.55 }} />

      {/* fixed overlay: brand strip */}
      <div style={{ display: "flex", justifyContent: "center", paddingTop: isSquare ? 48 : 28 }}>
        <div style={{ display: "flex", fontSize: isSquare ? 44 : 34, fontWeight: 700, textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>MEGA EVENTS</div>
      </div>

      {/* dynamic: away left, home right (RTL creative), VS between */}
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", padding: `0 ${isSquare ? 70 : 60}px` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: logoBox }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={awayLogoUrl} alt="" style={{ width: logoBox, height: logoBox, objectFit: "contain" }} />
          <div style={{ display: "flex", fontSize: isSquare ? 36 : 26, marginTop: 12, textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>{awayName}</div>
        </div>
        <div style={{ display: "flex", fontSize: isSquare ? 96 : 64, fontWeight: 700, textShadow: "0 2px 10px rgba(0,0,0,0.9)" }}>VS</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: logoBox }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={homeLogoUrl} alt="" style={{ width: logoBox, height: logoBox, objectFit: "contain" }} />
          <div style={{ display: "flex", fontSize: isSquare ? 36 : 26, marginTop: 12, textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>{homeName}</div>
        </div>
      </div>

      {/* dynamic: date / location / price bounding rows */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: isSquare ? 56 : 30 }}>
        <div style={{ display: "flex", fontSize: isSquare ? 40 : 30, textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>
          {timeText ? `${dateText} | ${timeText}` : dateText}
        </div>
        <div style={{ display: "flex", fontSize: isSquare ? 34 : 26, marginTop: 8, textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>{locationText}</div>
        <div style={{ display: "flex", fontSize: isSquare ? 48 : 36, fontWeight: 700, marginTop: 16, color: "#ffd54a", textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>{priceText}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `lib/creative/render.tsx`**

```tsx
import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase-server";
import { MatchTemplate, type CreativeInput } from "@/components/creative/MatchTemplate";

export const SIZES = {
  square: { width: 1080, height: 1080 },
  banner: { width: 1200, height: 628 },
} as const;
export type CreativeSize = keyof typeof SIZES;

const ASSETS = {
  font: "assets/font.ttf",
  bg: "assets/bg-default.png",
} as const;

let fontCache: ArrayBuffer | null = null;

async function loadBrandFont(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache;
  const { data } = supabase.storage.from("creatives").getPublicUrl(ASSETS.font);
  const res = await fetch(data.publicUrl);
  if (!res.ok) {
    throw new Error(
      `Brand font missing — upload a TTF to creatives/${ASSETS.font} (status ${res.status})`,
    );
  }
  fontCache = await res.arrayBuffer();
  return fontCache;
}

export function getBackgroundUrl(): string {
  const { data } = supabase.storage.from("creatives").getPublicUrl(ASSETS.bg);
  return data.publicUrl;
}

export async function renderCreativePng(
  input: CreativeInput,
  size: CreativeSize,
): Promise<ArrayBuffer> {
  const { width, height } = SIZES[size];
  const font = await loadBrandFont();
  const image = new ImageResponse(
    <MatchTemplate {...input} width={width} height={height} bgUrl={getBackgroundUrl()} />,
    {
      width,
      height,
      fonts: [{ name: "brand", data: font, style: "normal", weight: 700 }],
    },
  );
  return image.arrayBuffer();
}
```

- [ ] **Step 3: Verify** `npx tsc --noEmit` → 0 errors. (Render verified in Task 4 via route.)

- [ ] **Step 4: Commit**

```bash
git add components/creative/MatchTemplate.tsx lib/creative/render.tsx
git commit -m "feat(creative): match template + satori render helper"
```

---

### Task 4: Preview render route

**Files:**
- Create: `app/api/creative/route.tsx` (`.tsx` — not used, route only parses; keep `.ts` if no JSX: use **`route.ts`**)
- Create: `lib/creative/input.ts`

**Interfaces:**
- Consumes: `renderCreativePng`, `SIZES`, `CreativeSize`, `buildPriceText`, `CreativeInput` (Task 3).
- Produces:
  - `GET /api/creative?home=<teamId>&away=<teamId>&date=DD.MM.YYYY&time=HH:MM&loc=<text>&price=<number>&cur=<symbol>&mode=package|ticket&size=square|banner` → `image/png`; 401 without `session` cookie; 400 on bad params; 500 with JSON error on render failure.
  - `buildCreativeInput(params: CreativeParams): Promise<CreativeInput>` where `type CreativeParams = { homeId: number; awayId: number; dateText: string; timeText: string | null; locationText: string; price: number; currency: string; mode: "package" | "ticket" }` — throws if a team is missing `logo_url`.

- [ ] **Step 1: Write `lib/creative/input.ts`**

```ts
import { supabase } from "@/lib/supabase-server";
import { buildPriceText, type CreativeInput } from "@/components/creative/MatchTemplate";

export type CreativeParams = {
  homeId: number;
  awayId: number;
  dateText: string;
  timeText: string | null;
  locationText: string;
  price: number;
  currency: string;
  mode: "package" | "ticket";
};

export async function buildCreativeInput(params: CreativeParams): Promise<CreativeInput> {
  const { data, error } = await supabase
    .from("football_teams")
    .select("id,name,logo_url")
    .in("id", [params.homeId, params.awayId]);

  if (error) {
    console.error(JSON.stringify(error));
    throw new Error("Failed to load teams");
  }
  const home = data?.find((t) => t.id === params.homeId);
  const away = data?.find((t) => t.id === params.awayId);
  if (!home || !away) throw new Error("Team not found");
  if (!home.logo_url || !away.logo_url) {
    throw new Error(
      `Missing logo_url for: ${[!home.logo_url && home.name, !away.logo_url && away.name].filter(Boolean).join(", ")}`,
    );
  }

  return {
    homeLogoUrl: home.logo_url,
    awayLogoUrl: away.logo_url,
    homeName: home.name,
    awayName: away.name,
    dateText: params.dateText,
    timeText: params.timeText,
    locationText: params.locationText,
    priceText: buildPriceText(params.mode, params.price, params.currency),
  };
}
```

- [ ] **Step 2: Write `app/api/creative/route.ts`**

```ts
import { type NextRequest, NextResponse } from "next/server";
import { renderCreativePng, SIZES, type CreativeSize } from "@/lib/creative/render";
import { buildCreativeInput } from "@/lib/creative/input";

// middleware.ts skips /api/* — auth enforced here via the session cookie.
export async function GET(req: NextRequest) {
  if (!req.cookies.get("session")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;
  const homeId = Number(q.get("home"));
  const awayId = Number(q.get("away"));
  const dateText = q.get("date") ?? "";
  const price = Number(q.get("price"));
  const size = (q.get("size") ?? "square") as CreativeSize;
  const mode = q.get("mode") === "ticket" ? "ticket" : "package";

  if (!homeId || !awayId || !dateText || !price || !(size in SIZES)) {
    return NextResponse.json(
      { error: "Required: home, away, date, price; optional: time, loc, cur, mode, size" },
      { status: 400 },
    );
  }

  try {
    const input = await buildCreativeInput({
      homeId,
      awayId,
      dateText,
      timeText: q.get("time") || null,
      locationText: q.get("loc") ?? "",
      price,
      currency: q.get("cur") ?? "€",
      mode,
    });
    const png = await renderCreativePng(input, size);
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("creative render failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Render failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run dev
```

1. No cookie: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/creative?home=1&away=2&date=14.09.2026&price=499"` → `401`.
2. Log into the dashboard in browser, then open `http://localhost:3000/api/creative?home=<realId>&away=<realId>&date=14.09.2026&time=21:00&loc=Santiago%20Bernabeu,%20Madrid&price=499&size=square` → PNG renders with logos, VS, Hebrew price line.
3. Same URL with `&size=banner` → 1200×628 variant.
4. Missing params → 400 JSON.

- [ ] **Step 4: Commit**

```bash
git add app/api/creative/route.ts lib/creative/input.ts
git commit -m "feat(creative): preview render route (session-gated)"
```

---

### Task 5: Generate action — upload + optional card attach

**Files:**
- Create: `lib/actions/creative-actions.ts`

**Interfaces:**
- Consumes: `renderCreativePng`, `buildCreativeInput`, `CreativeParams`.
- Produces: `generateCreative(params: CreativeParams & { attachEventId?: number | null }): Promise<{ squareUrl: string; bannerUrl: string }>` — uploads `output/<slug>-square.png` + `output/<slug>-banner.png` (upsert), returns public URLs; when `attachEventId` set, writes `events.card_image_url = squareUrl` and best-effort revalidates main.

- [ ] **Step 1: Write `lib/actions/creative-actions.ts`**

```ts
"use server";

import { supabase } from "@/lib/supabase-server";
import { renderCreativePng, SIZES, type CreativeSize } from "@/lib/creative/render";
import { buildCreativeInput, type CreativeParams } from "@/lib/creative/input";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function revalidateMain(): Promise<void> {
  const baseUrl = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!baseUrl || !secret) return;
  try {
    await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/revalidate?secret=${encodeURIComponent(secret)}`,
    );
  } catch (error) {
    console.error("revalidate main failed (non-fatal):", error);
  }
}

export async function generateCreative(
  params: CreativeParams & { attachEventId?: number | null },
): Promise<{ squareUrl: string; bannerUrl: string }> {
  const input = await buildCreativeInput(params);
  const slug = `${slugify(input.homeName)}-vs-${slugify(input.awayName)}-${params.dateText.replace(/\./g, "-")}`;

  const urls: Record<CreativeSize, string> = { square: "", banner: "" };
  for (const size of Object.keys(SIZES) as CreativeSize[]) {
    const png = await renderCreativePng(input, size);
    const path = `output/${slug}-${size}.png`;
    const { error } = await supabase.storage
      .from("creatives")
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (error) {
      console.error(JSON.stringify(error));
      throw new Error(`Upload failed for ${size}`);
    }
    urls[size] = supabase.storage.from("creatives").getPublicUrl(path).data.publicUrl;
  }

  if (params.attachEventId) {
    const { error } = await supabase
      .from("events")
      .update({ card_image_url: urls.square })
      .eq("id", params.attachEventId);
    if (error) {
      console.error(JSON.stringify(error));
      throw new Error("Creative saved, but attaching to event failed");
    }
    await revalidateMain();
  }

  return { squareUrl: urls.square, bannerUrl: urls.banner };
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` → 0 errors. (Full flow verified in Task 6 UI.)

- [ ] **Step 3: Commit**

```bash
git add lib/actions/creative-actions.ts
git commit -m "feat(creative): generate action - upload both sizes + optional card attach"
```

---

### Task 6: Generator page + form + sidebar link

**Files:**
- Create: `app/(dashboard)/creative-generator/page.tsx`
- Create: `app/(dashboard)/creative-generator/creative-form.tsx`
- Modify: `components/sidebar.tsx:51` (add nav item near Templates)

**Interfaces:**
- Consumes: `getFootballTeams()` (`lib/actions/football-actions.ts`), `getLocations()` (`lib/actions/location-actions.ts`), `getActiveEvents()` (`lib/actions/event-actions.ts`), `generateCreative` (Task 5).

- [ ] **Step 1: Server page `app/(dashboard)/creative-generator/page.tsx`**

```tsx
import { getFootballTeams } from "@/lib/actions/football-actions";
import { getLocations } from "@/lib/actions/location-actions";
import { getActiveEvents } from "@/lib/actions/event-actions";
import { CreativeForm } from "./creative-form";

export default async function CreativeGeneratorPage() {
  const [teams, locations, events] = await Promise.all([
    getFootballTeams(),
    getLocations(),
    getActiveEvents(),
  ]);

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-6">Creative Generator</h1>
      <CreativeForm
        teams={teams
          .filter((t) => t.logo_url)
          .map((t) => ({ id: t.id, name: t.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        events={events.map((e) => ({ id: e.id, name: e.name }))}
      />
    </div>
  );
}
```

(If `getActiveEvents()`/`getLocations()` return shapes lack `name`, adapt the mapping to the real fields — check `types/app.types.ts` `Event.name` and `Location.name` during implementation.)

- [ ] **Step 2: Client form `app/(dashboard)/creative-generator/creative-form.tsx`** — full component:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { generateCreative } from "@/lib/actions/creative-actions";

type Option = { id: number; name: string };

export function CreativeForm({
  teams, locations, events,
}: { teams: Option[]; locations: Option[]; events: Option[] }) {
  const [homeId, setHomeId] = useState<string>("");
  const [awayId, setAwayId] = useState<string>("");
  const [date, setDate] = useState("");        // yyyy-mm-dd from <input type="date">
  const [time, setTime] = useState("");
  const [locationText, setLocationText] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("€");
  const [mode, setMode] = useState<"package" | "ticket">("package");
  const [eventId, setEventId] = useState<string>("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ squareUrl: string; bannerUrl: string } | null>(null);

  const dateText = useMemo(() => {
    if (!date) return "";
    const [y, m, d] = date.split("-");
    return `${d}.${m}.${y}`;
  }, [date]);

  const ready = homeId && awayId && homeId !== awayId && dateText && Number(price) > 0;

  const previewUrl = useMemo(() => {
    if (!ready) return null;
    const q = new URLSearchParams({
      home: homeId, away: awayId, date: dateText, price,
      cur: currency, mode, size: "square",
    });
    if (time) q.set("time", time);
    if (locationText) q.set("loc", locationText);
    return `/api/creative?${q.toString()}`;
  }, [ready, homeId, awayId, dateText, price, currency, mode, time, locationText]);

  const onGenerate = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await generateCreative({
        homeId: Number(homeId),
        awayId: Number(awayId),
        dateText,
        timeText: time || null,
        locationText,
        price: Number(price),
        currency,
        mode,
        attachEventId: eventId && attach ? Number(eventId) : null,
      });
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
                <SelectItem value="€">€</SelectItem>
                <SelectItem value="$">$</SelectItem>
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
        <div>
          <Label>Attach to event (optional)</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger><SelectValue placeholder="No event" /></SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <Button onClick={onGenerate} disabled={!ready || busy} className="w-full">
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
            Fill teams, date and price to preview
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar link** — `components/sidebar.tsx`, after line 51 (`Templates`):

```ts
  { name: "Creative Generator", href: "/creative-generator", icon: ImageIcon },
```

Import `Image as ImageIcon` from `lucide-react` alongside existing icon imports.

- [ ] **Step 4: Verify end-to-end**

```bash
npx tsc --noEmit
npm run dev
```

1. Sidebar shows Creative Generator → page loads with populated selects (teams list only shows teams with `logo_url`).
2. Fill form → preview `<img>` renders live and updates on change.
3. צור תמונה → both download buttons appear; files exist under Storage → `creatives/output/`.
4. With event + checkbox: `select card_image_url from events where id=<id>` → creative URL. Uncheck → untouched.
5. Same team both sides → button disabled.

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/creative-generator components/sidebar.tsx
git commit -m "feat(creative): generator page - form, live preview, storage output, card attach"
```

---

### Task 7 (myt-main): sitemap lastmod fix

**Files:**
- Modify: `../myt-main/app/sitemap.xml/route.ts:9-58`

**Interfaces:**
- Consumes: `getCachedEvents()` rows (select `*` → `created_at` present on `events` rows).
- Produces: same route, honest `lastmod`.

Verified already: `getCachedEvents()` filters `is_deleted is null` AND `date >= now+7d` — **expired events are already excluded; no change needed for spec issue #2.**

- [ ] **Step 1: Branch**

```bash
cd /c/Users/doraz/OneDrive/Desktop/Work/MegaEvent/MYT_Git_Shered/myt-main
git checkout master && git pull && git checkout -b fix/sitemap-lastmod
```

- [ ] **Step 2: Replace fake timestamps.** At top of the `GET` (after `baseUrl`):

```ts
    // Static pages: stable date bumped manually on meaningful content changes.
    const STATIC_LASTMOD = "2026-07-01T00:00:00.000Z";
```

- In each of the 7 `staticPages` entries replace `lastModified: new Date().toISOString(),` → `lastModified: STATIC_LASTMOD,`.
- In `eventPages` map:

```ts
    const eventPages = events.events.map((event) => ({
      url: `${baseUrl}/order/${event.id}`,
      // Real signal: row creation time (rows come from select("*")).
      lastModified: (event as { created_at?: string }).created_at ?? STATIC_LASTMOD,
      changeFrequency: "daily",
      priority: 0.9,
    }));
```

- In `artistPages` and `footballPages` maps replace `lastModified: new Date().toISOString(),` → `lastModified: STATIC_LASTMOD,`.
- Error-fallback sitemap at the bottom: same replacement.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run dev
```

`curl -s http://localhost:3000/sitemap.xml | head -60` → static pages show `2026-07-01T00:00:00.000Z`; `/order/*` entries show differing real `created_at` dates, NOT all identical to now.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.xml/route.ts
git commit -m "fix(seo): honest sitemap lastmod - created_at for events, stable date for static pages"
```

---

## Self-review notes

- Spec coverage: D1 (Task 5+6), D2 (`mode` through Tasks 3–6), D3 (Task 3–4), D4 (Task 7), logo intake §4 (Task 2), assets §9 (Task 1 placeholders), auth §6 (Task 4). Sitemap expired-events check: verified no-op, documented in Task 7.
- Types consistent: `CreativeInput` (T3) consumed by T4/T5; `CreativeParams` (T4) consumed by T5/T6; `SIZES`/`CreativeSize` shared.
- Known adaptation risk (flagged in-task): exact `PersonForm` field wrapper markup, `Location`/`Event` name fields — implementer checks the real file at the noted lines.
