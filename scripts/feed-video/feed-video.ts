// Feed videos for chosen artists - the first, hand-run version (Dor 11.11; the full build with a
// per-artist switch, an approval screen and a nightly run comes with its spec).
//
//   npx tsx --env-file=.env.local scripts/feed-video/feed-video.ts <command> [flags]
//
//   plan                 which events, what each video prints, which style each one drew
//   lines [--only ids]   the AI writes an opening line for every event that has none (pending)
//   approve all|ids      a person approves lines;  set-line <id> "<text>" = typed by a person
//   render [--drafts]    renders every event whose video for TODAY's data is missing
//                        (--drafts = also events whose line is still pending - for review only)
//   review               writes .superpowers/feed-video/review.html (every video + its line)
//   publish [--apply]    uploads the videos and writes events.campaign_video_url - DRY RUN unless
//                        --apply; refuses an event whose line is not approved, whose video is not
//                        rendered for today's data, or whose price differs from the live feed.
//   clear [--apply]      the rollback: campaign_video_url back to null on every video of ours
//
//   --price off          the video prints no price (the pill says what the package holds)
//   --only 1174,1175     limit any command to these events
//
// Nothing here writes to the database or Storage without --apply. State (lines, approvals) is a
// local file: .superpowers/feed-video/state.json.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { chromium, type Browser } from "playwright-core";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { deriveCreativeDefaults, type CreativeLookupCaches } from "@/lib/creative/auto";
import { buildPriceText, cityOf, creativeTagline, Wordmark } from "@/components/creative/MatchTemplate";
import { anthropicKey, answerWithTool } from "@/lib/agents/switch";
import { VIDEO_ARTISTS, type VideoArtist, type VideoStyle } from "./config";
import { videoHtml, hookBeats, type VideoPage } from "./template";

const TEMPLATE_VERSION = 2; // bump when a template changes - every video renders again
const ROOT = path.resolve(".superpowers/feed-video");
const OUT = path.join(ROOT, "out");
const STATE_FILE = path.join(ROOT, "state.json");
const LIVE_FEED = "https://www.mega-events.co.il/feeds/meta-activities.csv";
const STORAGE_BUCKET = "public_resources";
const STORAGE_DIR = "creatives/video";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 30;
const SECONDS = 10;
const MODEL = "claude-opus-5-5";

// ---------- args ----------
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const flagValue = (name: string): string | null => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : null;
};
const ONLY = (flagValue("only") ?? "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const PRICE_ON = flagValue("price") !== "off";

// ---------- state ----------
type LineState = { line: string; status: "pending" | "approved"; by: "ai" | "person"; at: string };
type State = { lines: Record<string, LineState> };
function readState(): State {
  if (!existsSync(STATE_FILE)) return { lines: {} };
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
}
function writeState(s: State) {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ---------- the live feed ----------
/** RFC 4180 rows - descriptions carry commas and quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

type FeedRow = { id: number; price: number; label: string };
async function liveFeedRows(): Promise<FeedRow[]> {
  const res = await fetch(LIVE_FEED, { cache: "no-store" });
  if (!res.ok) throw new Error(`live feed answered ${res.status}`);
  const [head, ...rows] = parseCsv(await res.text());
  const col = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`live feed has no ${n} column`);
    return i;
  };
  const [iId, iPrice, iLabel] = [col("id"), col("price"), col("custom_label_2")];
  return rows.map((r) => ({
    id: Number(r[iId]),
    price: Number.parseFloat(r[iPrice]),
    label: r[iLabel],
  }));
}

// ---------- plan ----------
type PlanItem = {
  id: number;
  artist: VideoArtist;
  artistName: string;
  style: VideoStyle;
  page: Omit<VideoPage, "hook" | "logoSvg" | "fontDataUrl">;
  sitePrice: number | null;
  feedPrice: number;
  problems: string[];
};

/** The style an event draws - once, from its id, among the styles its artist can carry. */
export function drawStyle(eventId: number, styles: VideoStyle[]): VideoStyle {
  const h = createHash("sha1").update(`feed-video-style:${eventId}`).digest();
  return styles[h.readUInt32BE(0) % styles.length];
}

async function plan(): Promise<PlanItem[]> {
  const feed = await liveFeedRows();
  const byLabel = new Map(VIDEO_ARTISTS.map((a) => [a.feedLabel, a]));
  const { data: artistRows, error } = await supabaseTyped
    .from("artists")
    .select("id,name")
    .in("id", VIDEO_ARTISTS.map((a) => a.id));
  if (error) throw new Error(JSON.stringify(error));
  const artistName = new Map((artistRows ?? []).map((r) => [r.id, (r.name ?? "").trim()]));
  const caches: CreativeLookupCaches = {};
  const items: PlanItem[] = [];
  for (const row of feed) {
    const artist = byLabel.get(row.label);
    if (!artist) continue;
    if (ONLY.length && !ONLY.includes(row.id)) continue;
    const d = await deriveCreativeDefaults(row.id, caches);
    const problems: string[] = [];
    const expected = artistName.get(artist.id) ?? "";
    if (d.kind !== "artist" || (d.artistName ?? "").trim() !== expected) {
      problems.push(`artist is "${d.artistName}" - expected "${expected}"`);
    }
    if (d.price === null) problems.push("no site price");
    else if (Math.abs(d.price - row.price) >= 1) {
      problems.push(`site price $${d.price} != live feed $${row.price}`);
    }
    // The city alone, as the image ad prints it (cityOf). A place name that reads as a travel
    // note ("נבוורת טיסה ללונדון . בריטניה" - the location row's own name) is held for a person.
    const place = cityOf(d.locationText);
    if (!place) problems.push("no place");
    else if (/טיסה|\s\.\s/.test(place)) problems.push(`place reads "${place}" - fix the location's name first`);
    const style = drawStyle(row.id, artist.styles);
    items.push({
      id: row.id,
      artist,
      artistName: expected,
      style,
      sitePrice: d.price,
      feedPrice: row.price,
      problems,
      page: {
        style,
        name: expected,
        place,
        date: d.dateText,
        priceText: PRICE_ON && d.price !== null ? buildPriceText(d.ticketOnly ? "ticket" : "package", d.price, "$") : null,
        tagline: creativeTagline(d.ticketOnly),
        cta: d.ticketOnly ? "כרטיס בלבד" : "טיסה + מלון + כרטיס",
        cutout: artist.cutout,
        photos: artist.photos,
        cutoutInC: artist.cutoutInC,
      },
    });
  }
  return items;
}

/** What a video prints and shows; the file name carries it, so new data = a new file. */
function videoHash(item: PlanItem, hook: string): string {
  return createHash("sha1")
    .update(JSON.stringify({ v: TEMPLATE_VERSION, hook, ...item.page }))
    .digest("hex")
    .slice(0, 10);
}
const videoFile = (item: PlanItem, hook: string) =>
  `event-${item.id}-${item.style}-${videoHash(item, hook)}.mp4`;

// ---------- lines ----------
const LINE_MAX_CHARS = 34;
/** Why a line cannot go on a video, or null. */
export function lineProblem(line: string, others: string[]): string | null {
  const t = line.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (!/[֐-׿]/.test(t)) return "no Hebrew";
  if (t.length > LINE_MAX_CHARS) return `longer than ${LINE_MAX_CHARS}`;
  if (words.length < 3 || words.length > 7) return "needs 3-7 words";
  if (/[0-9$₪€£%]/.test(t)) return "a number or a price";
  // A geresh is part of a city's name (מנצ'סטר) - only real quotation marks are refused.
  if (/["״«»“”]/.test(t)) return "quotes";
  if (/בירה|יין|אלכוהול|שיכור|וודקה|קוקטייל/.test(t)) return "alcohol";
  if ((t.match(/!/g) ?? []).length > 1) return "more than one !";
  if (others.includes(t)) return "same as another show";
  return null;
}

const LINES_TOOL = {
  name: "hooks",
  description: "One opening line per show.",
  input_schema: {
    type: "object" as const,
    properties: {
      hooks: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "integer" }, line: { type: "string" } },
          required: ["id", "line"],
        },
      },
    },
    required: ["hooks"],
  },
};

const LINES_SYSTEM = `You write the opening line of a 10-second video ad for a travel company that sells
packages (flight + hotel + concert ticket) to see an artist live abroad. The audience is Israeli; write
in natural, everyday Hebrew, addressed to the plural "you" (אתם) or with no addressee at all.
The line is the hook of the first 2.5 seconds: an emotion or a picture of the night itself.
Rules:
- 3 to 7 words, at most ${LINE_MAX_CHARS} characters, one sentence, no emoji, no quotation marks.
- No numbers, no prices, no dates, no "last tickets", "selling out" or any other urgency or scarcity.
- The show is months away: no "tonight" or "today" that reads as if it is happening now (הלילה / היום).
- No alcohol, no drinking.
- No facts about the artist or the tour (no "reunion", "farewell", "first time", "only show"), no song
  titles and no lyrics - only what is true of any great night of live music.
- The artist's name, the city and the date appear right after the line, so the line need not repeat
  them; you may name the city when it makes the line better.
- Every show gets its own line - no two lines the same, and vary the openings.`;

async function writeLines(items: PlanItem[]) {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is missing or not an sk-ant- key");
  const state = readState();
  const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 0 });
  const byArtist = new Map<number, PlanItem[]>();
  for (const it of items) {
    if (state.lines[it.id]) continue;
    byArtist.set(it.artist.id, [...(byArtist.get(it.artist.id) ?? []), it]);
  }
  for (const [, shows] of byArtist) {
    const taken = Object.values(state.lines).map((l) => l.line);
    const list = shows.map((s) => `- id ${s.id}: ${s.page.place}, ${s.page.date}`).join("\n");
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4_000,
      system: `${LINES_SYSTEM}\n\n${answerWithTool("hooks")}`,
      tools: [LINES_TOOL],
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `Artist: ${shows[0].artistName}\nShows:\n${list}\n\nLines already used (do not repeat):\n${taken.join("\n") || "(none)"}`,
        },
      ],
    });
    if (res.stop_reason === "max_tokens") throw new Error("lines: cut at max_tokens");
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("lines: no tool call");
    // External model output - one boundary cast, narrowed per field below.
    const raw = (block.input as { hooks?: unknown }).hooks;
    const hooks = Array.isArray(raw) ? raw : [];
    const ids = new Set(shows.map((s) => s.id));
    for (const h of hooks as { id?: unknown; line?: unknown }[]) {
      const id = Number(h.id);
      const line = typeof h.line === "string" ? h.line.trim() : "";
      if (!ids.has(id)) continue;
      const others = Object.values(state.lines).map((l) => l.line);
      const why = lineProblem(line, others);
      if (why) {
        console.log(`  ${id}: refused "${line}" - ${why}`);
        continue;
      }
      state.lines[id] = { line, status: "pending", by: "ai", at: new Date().toISOString() };
      console.log(`  ${id}: ${line}`);
    }
    const missing = shows.filter((s) => !state.lines[s.id]).map((s) => s.id);
    if (missing.length) console.log(`  ${shows[0].artistName}: no usable line for ${missing.join(", ")} - run lines again`);
    console.log(`  cost: ${res.usage.input_tokens} in / ${res.usage.output_tokens} out`);
    writeState(state);
  }
}

// ---------- render ----------
function fontDataUrl(): string {
  const buf = readFileSync(path.resolve("app/fonts/rubik.woff2"));
  return `data:font/woff2;base64,${buf.toString("base64")}`;
}
function logoSvg(): string {
  // MatchTemplate is compiled with the classic JSX transform under tsx - it needs React in scope.
  (globalThis as { React?: typeof React }).React = React;
  return renderToStaticMarkup(createElement(Wordmark, { width: 96 }));
}

/** Runs inside the page: fonts, every picture, every [data-fit] box; then pauses the clock. */
const PAGE_CHECK = `(async () => {
  const problems = [];
  await document.fonts.ready;
  if (!document.fonts.check("900 20px Rubik")) problems.push("Rubik did not load");
  for (const img of Array.from(document.images)) {
    try { await img.decode(); } catch (e) {}
    if (!img.naturalWidth) problems.push("picture failed: " + img.src);
  }
  const bgs = Array.from(document.querySelectorAll("[style*='background-image']"))
    .map(function (el) { const m = /url\\(['"]?(.*?)['"]?\\)/.exec(el.style.backgroundImage); return m && m[1]; })
    .filter(Boolean);
  for (const url of bgs) {
    const ok = await new Promise(function (resolve) {
      const im = new Image();
      im.onload = function () { resolve(im.naturalWidth > 0); };
      im.onerror = function () { resolve(false); };
      im.src = url;
    });
    if (!ok) problems.push("picture failed: " + url);
  }
  function over(el) { return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1; }
  for (const el of Array.from(document.querySelectorAll("[data-fit]"))) {
    const min = Number(el.dataset.min || 10);
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (over(el) && size > min) { size -= 0.5; el.style.fontSize = size + "px"; }
    if (over(el)) problems.push("text does not fit: " + el.className + ' "' + (el.textContent || "").trim() + '"');
  }
  document.getAnimations().forEach(function (a) { a.pause(); });
  return problems;
})()`;

/** Loads the page, checks every picture and every text box, then pauses the clock. */
async function preparePage(browser: Browser, html: string) {
  const page = await browser.newPage({ viewport: { width: 270, height: 338 }, deviceScaleFactor: 4 });
  await page.setContent(html, { waitUntil: "networkidle", timeout: 60_000 });
  // A string, not a function: tsx compiles named arrows with an `__name` helper the page lacks.
  const report = (await page.evaluate(PAGE_CHECK)) as string[];
  if (report.length) {
    await page.close();
    throw new Error(report.join("; "));
  }
  return page;
}

async function renderOne(browser: Browser, html: string, outFile: string) {
  const page = await preparePage(browser, html);
  const part = `${outFile}.part.mp4`;
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", String(SECONDS),
    "-vf", "crop=1080:1350:0:1",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart",
    part,
  ]);
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d));
  const done = new Promise<void>((resolve, reject) =>
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${ffErr}`)))),
  );
  try {
    for (let f = 0; f < FPS * SECONDS; f++) {
      const ms = (f * 1000) / FPS;
      await page.evaluate(`document.getAnimations().forEach(function (a) { a.currentTime = ${ms}; })`);
      const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
    renameSync(part, outFile);
  } finally {
    await page.close();
  }
}

async function render(items: PlanItem[]) {
  const state = readState();
  mkdirSync(OUT, { recursive: true });
  const drafts = flag("drafts");
  const font = fontDataUrl();
  const logo = logoSvg();
  const jobs = items.flatMap((it) => {
    const l = state.lines[it.id];
    if (!l) { console.log(`  ${it.id}: no line yet - run lines`); return []; }
    if (l.status !== "approved" && !drafts) return [];
    if (it.problems.length) { console.log(`  ${it.id}: held - ${it.problems.join("; ")}`); return []; }
    const file = path.join(OUT, videoFile(it, l.line));
    if (existsSync(file)) return [];
    return [{ it, hook: l.line, file }];
  });
  console.log(`rendering ${jobs.length} video(s)`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const concurrency = Number(flagValue("concurrency") ?? 3);
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { it, hook, file } = jobs[next++];
      const t0 = Date.now();
      try {
        if (it.style === "B") hookBeats(hook);
        await renderOne(browser, videoHtml({ ...it.page, hook, logoSvg: logo, fontDataUrl: font }), file);
        console.log(`  ${it.id} ${it.style} ${((Date.now() - t0) / 1000).toFixed(0)}s ${path.basename(file)}`);
      } catch (e) {
        failed++;
        console.log(`  ${it.id} ${it.style} FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
}

// ---------- review page ----------
function review(items: PlanItem[]) {
  const state = readState();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rows = items.map((it) => {
    const l = state.lines[it.id];
    const file = l ? videoFile(it, l.line) : null;
    const has = file && existsSync(path.join(OUT, file));
    return `<div class="card">
      ${has ? `<video src="out/${file}" muted loop autoplay playsinline></video>` : `<div class="none">אין סרטון עדיין</div>`}
      <div class="meta"><b>#${it.id}</b> · ${esc(it.artistName)} · ${esc(it.page.place)} · ${it.page.date} · סגנון ${it.style}</div>
      <div class="line">${l ? esc(l.line) : "-"}</div>
      <div class="st ${l?.status ?? ""}">${l ? (l.status === "approved" ? "אושר" : "ממתין לאישור") : ""}</div>
      ${it.problems.length ? `<div class="prob">${esc(it.problems.join(" · "))}</div>` : ""}
    </div>`;
  });
  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>Feed videos - review</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;margin:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}
.card{background:#1e293b;border-radius:12px;padding:10px}video,.none{width:100%;aspect-ratio:4/5;border-radius:8px;background:#000;display:block}
.none{display:flex;align-items:center;justify-content:center;color:#64748b}.meta{font-size:12px;color:#94a3b8;margin-top:8px}
.line{font-size:16px;font-weight:700;margin-top:4px}.st{font-size:12px;margin-top:4px;color:#fbbf24}.st.approved{color:#5BFF95}.prob{font-size:12px;color:#f87171;margin-top:4px}</style>
</head><body><h1>סרטונים לפיד - לאישור</h1><p>${items.length} הופעות. כל סרטון מתנגן בלולאה, בלי קול.</p><div class="grid">${rows.join("")}</div></body></html>`;
  writeFileSync(path.join(ROOT, "review.html"), html);
  console.log(`wrote ${path.join(ROOT, "review.html")}`);
}

// ---------- publish / clear ----------
async function publish(items: PlanItem[]) {
  const apply = flag("apply");
  const state = readState();
  let ok = 0;
  for (const it of items) {
    const l = state.lines[it.id];
    const why =
      it.problems.length ? it.problems.join("; ")
      : !l ? "no line"
      : l.status !== "approved" ? "line not approved"
      : !existsSync(path.join(OUT, videoFile(it, l.line))) ? "no video for today's data - render again"
      : null;
    if (why) { console.log(`  ${it.id}: skipped - ${why}`); continue; }
    const file = videoFile(it, l!.line);
    const objectPath = `${STORAGE_DIR}/${file}`;
    const url = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    if (!apply) { console.log(`  ${it.id}: would upload ${objectPath} and set campaign_video_url`); ok++; continue; }
    const body = readFileSync(path.join(OUT, file));
    const up = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, body, {
      contentType: "video/mp4", upsert: true, cacheControl: "31536000",
    });
    if (up.error) { console.log(`  ${it.id}: upload failed - ${up.error.message}`); continue; }
    const { error } = await supabaseTyped.from("events").update({ campaign_video_url: url }).eq("id", it.id);
    if (error) { console.log(`  ${it.id}: column write failed - ${JSON.stringify(error)}`); continue; }
    console.log(`  ${it.id}: live ${url}`);
    ok++;
  }
  console.log(`${apply ? "published" : "dry run:"} ${ok} of ${items.length}`);
}

async function clear(items: PlanItem[]) {
  const apply = flag("apply");
  const ids = items.map((i) => i.id);
  const { data, error } = await supabaseTyped.from("events").select("id,campaign_video_url").in("id", ids);
  if (error) throw new Error(JSON.stringify(error));
  const ours = (data ?? []).filter((r) => String(r.campaign_video_url ?? "").includes(`/${STORAGE_DIR}/`));
  for (const r of ours) {
    if (!apply) { console.log(`  ${r.id}: would clear ${r.campaign_video_url}`); continue; }
    const res = await supabaseTyped.from("events").update({ campaign_video_url: null }).eq("id", r.id);
    console.log(`  ${r.id}: ${res.error ? `failed - ${JSON.stringify(res.error)}` : "cleared"}`);
  }
  console.log(`${apply ? "cleared" : "dry run:"} ${ours.length} event(s)`);
}

// ---------- main ----------
async function main() {
  const state = readState();
  if (command === "approve") {
    const ids = rest[0] === "all" ? Object.keys(state.lines) : (rest[0] ?? "").split(",");
    for (const id of ids) if (state.lines[id]) state.lines[id].status = "approved";
    writeState(state);
    console.log(`approved ${ids.length}`);
    return;
  }
  if (command === "set-line") {
    const [id, ...words] = rest;
    const line = words.join(" ").trim();
    const others = Object.entries(state.lines).filter(([k]) => k !== id).map(([, v]) => v.line);
    const why = lineProblem(line, others);
    if (why) throw new Error(`refused: ${why}`);
    state.lines[id] = { line, status: "approved", by: "person", at: new Date().toISOString() };
    writeState(state);
    console.log(`${id}: ${line} (approved)`);
    return;
  }
  const items = await plan();
  if (command === "plan") {
    for (const it of items) {
      const l = state.lines[it.id];
      console.log(
        [it.id, it.artistName, it.page.place, it.page.date, it.page.priceText ?? "(no price)", `feed $${it.feedPrice}`,
          it.style, l ? `${l.status}: ${l.line}` : "no line", it.problems.join("; ")].join(" | "),
      );
    }
    const counts = items.reduce<Record<string, number>>((m, it) => ({ ...m, [it.style]: (m[it.style] ?? 0) + 1 }), {});
    console.log(`${items.length} events, styles ${JSON.stringify(counts)}, problems ${items.filter((i) => i.problems.length).length}`);
  } else if (command === "lines") await writeLines(items);
  else if (command === "render") await render(items);
  else if (command === "review") review(items);
  else if (command === "publish") await publish(items);
  else if (command === "clear") await clear(items);
  else throw new Error(`unknown command "${command}"`);
  // keep the out dir tidy: list the videos no event points at any more
  if (command === "render" && existsSync(OUT)) {
    const wanted = new Set(items.flatMap((it) => (state.lines[it.id] ? [videoFile(it, state.lines[it.id].line)] : [])));
    const stale = readdirSync(OUT).filter((f) => f.endsWith(".mp4") && !wanted.has(f));
    if (stale.length) console.log(`${stale.length} older video(s) in out/ no longer match today's data`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
