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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { deriveCreativeDefaults, type CreativeLookupCaches } from "@/lib/creative/auto";
import { cityOf } from "@/components/creative/MatchTemplate";
import { launchVideoBrowser, renderVideo, videoFontDataUrl, videoLogoSvg } from "@/lib/services/feed-video-render";
import { anthropicKey, answerWithTool } from "@/lib/agents/switch";
import { VIDEO_ARTISTS, type VideoArtist } from "./config";
import { videoHtml, hookBeats } from "@/lib/feed-video/template";
import {
  holdProblems, lineProblem, LINES_SYSTEM, printedFor, drawStyle, videoFileName, videoHash,
  VIDEO_BUCKET, VIDEO_DIR, type PrintedVideo, type VideoStyle,
} from "@/lib/feed-video/rules";

const ROOT = path.resolve(".superpowers/feed-video");
const OUT = path.join(ROOT, "out");
const STATE_FILE = path.join(ROOT, "state.json");
const LIVE_FEED = "https://www.mega-events.co.il/feeds/meta-activities.csv";
const STORAGE_BUCKET = VIDEO_BUCKET;
const STORAGE_DIR = VIDEO_DIR;
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
  page: PrintedVideo;
  sitePrice: number | null;
  feedPrice: number;
  problems: string[];
};

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
    const expected = artistName.get(artist.id) ?? "";
    // The city alone, as the image ad prints it (cityOf); holdProblems refuses a travel-note place.
    const place = cityOf(d.locationText);
    const problems = holdProblems({
      expectedName: expected, eventArtistName: d.artistName, kind: d.kind,
      sitePrice: d.price, feedPrice: row.price, place,
    });
    const style = drawStyle(row.id, artist.styles);
    items.push({
      id: row.id,
      artist,
      artistName: expected,
      style,
      sitePrice: d.price,
      feedPrice: row.price,
      problems,
      page: printedFor(d, { name: expected, ...artist }, style, PRICE_ON),
    });
  }
  return items;
}

/** What a video prints and shows; the file name carries it, so new data = a new file. */
const videoFile = (item: PlanItem, hook: string) => videoFileName(item.id, item.style, videoHash(item.page, hook));

// ---------- lines ----------
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
async function render(items: PlanItem[]) {
  const state = readState();
  mkdirSync(OUT, { recursive: true });
  const drafts = flag("drafts");
  const font = videoFontDataUrl();
  const logo = await videoLogoSvg();
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
  const browser = await launchVideoBrowser();
  const concurrency = Number(flagValue("concurrency") ?? 3);
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { it, hook, file } = jobs[next++];
      const t0 = Date.now();
      try {
        if (it.style === "B") hookBeats(hook);
        const { mp4 } = await renderVideo(videoHtml({ ...it.page, hook, logoSvg: logo, fontDataUrl: font }), { browser });
        writeFileSync(`${file}.part.mp4`, mp4);
        renameSync(`${file}.part.mp4`, file);
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
  // What each event shows today - a live video that no longer matches today's data comes down.
  const { data: liveRows, error: liveErr } = await supabaseTyped
    .from("events")
    .select("id,campaign_video_url")
    .in("id", items.map((i) => i.id));
  if (liveErr) throw new Error(JSON.stringify(liveErr));
  const liveUrl = new Map((liveRows ?? []).map((r) => [r.id, r.campaign_video_url ?? ""]));
  let ok = 0;
  for (const it of items) {
    const l = state.lines[it.id];
    const current = liveUrl.get(it.id) ?? "";
    const why =
      it.problems.length ? it.problems.join("; ")
      : !l ? "no line"
      : l.status !== "approved" ? "line not approved"
      : !existsSync(path.join(OUT, videoFile(it, l.line))) ? "no video for today's data - render again"
      : null;
    if (why) {
      // Dor 11.11: the video keeps the price, and a moved price gets a NEW video. Until that video
      // exists the old one comes down, so the ad falls back to its image and never shows a wrong price.
      if (current.includes(`/${STORAGE_DIR}/`)) {
        if (!apply) console.log(`  ${it.id}: would take its live video down - ${why}`);
        else {
          const res = await supabaseTyped.from("events").update({ campaign_video_url: null }).eq("id", it.id);
          console.log(`  ${it.id}: live video taken down (${why})${res.error ? ` - FAILED ${JSON.stringify(res.error)}` : ""}`);
        }
      } else console.log(`  ${it.id}: skipped - ${why}`);
      continue;
    }
    const file = videoFile(it, l!.line);
    const objectPath = `${STORAGE_DIR}/${file}`;
    const url = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
    if (current === url) { console.log(`  ${it.id}: already live`); ok++; continue; }
    // A video someone uploaded by hand (the event editor's "Campaign Video URL") is never replaced.
    if (current && !current.includes(`/${STORAGE_DIR}/`)) { console.log(`  ${it.id}: skipped - a video uploaded by hand stays`); continue; }
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
