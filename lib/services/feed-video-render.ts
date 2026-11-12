// Feed videos - the ONE place a video is made (spec section 5: the replaceable piece).
// HTML page (lib/feed-video/template.ts) -> Chromium, frame by frame -> ffmpeg -> mp4 bytes.
//   On Vercel: @sparticuz/chromium + ffmpeg-static (node_modules/ffmpeg-static/ffmpeg, traced in
//   next.config.mjs). Elsewhere (Dor's Mac, the hand tool): local Chrome + the same ffmpeg-static.
// Nothing here calls Claude, reads the database or writes Storage - it only renders.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Page } from "playwright-core";

export const VIDEO_FPS = 30;
export const VIDEO_SECONDS = 10;
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launchVideoBrowser(): Promise<Browser> {
  const { chromium: playwright } = await import("playwright-core");
  if (process.env.VERCEL) {
    const { default: chromium } = await import("@sparticuz/chromium");
    return playwright.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  return playwright.launch({ executablePath: process.env.LOCAL_CHROME_PATH || MAC_CHROME, headless: true });
}

function ffmpegBinary(): string {
  // ffmpeg-static's own lookup uses __dirname, which a bundle may rewrite - the path is fixed instead.
  return path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
}

/** Rubik as a data: URL (a file:// font is blocked by CORS inside the page). */
export function videoFontDataUrl(): string {
  const buf = readFileSync(path.join(process.cwd(), "app", "fonts", "rubik.woff2"));
  return `data:font/woff2;base64,${buf.toString("base64")}`;
}

/** The real MegaΣvents. wordmark as SVG markup (light ink), as the templates draw it. */
export async function videoLogoSvg(): Promise<string> {
  const React = await import("react");
  // MatchTemplate is compiled with the classic JSX transform under tsx - it needs React in scope.
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Wordmark } = await import("@/components/creative/MatchTemplate");
  return renderToStaticMarkup(React.createElement(Wordmark, { width: 96 }));
}

/** Runs inside the page: fonts, every picture, every [data-fit] box; then pauses the clock.
 *  A string, not a function: tsx compiles named arrows with an `__name` helper the page lacks. */
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

/** Loads the page at 270x338 CSS px x4, checks every picture and text box, pauses the clock. */
async function preparePage(browser: Browser, html: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 270, height: 338 }, deviceScaleFactor: 4 });
  await page.setContent(html, { waitUntil: "networkidle", timeout: 60_000 });
  const report = (await page.evaluate(PAGE_CHECK)) as string[];
  if (report.length) {
    await page.close();
    throw new Error(report.join("; "));
  }
  return page;
}

/**
 * Renders one page to a 1080x1350, 10 s, 30 fps H.264 mp4 with a silent AAC track. Throws with the
 * page's own problems (a font, a picture, a box that does not fit) - never a video with a hole.
 * Pass a browser to reuse one across videos; otherwise one is launched and closed.
 */
export async function renderVideo(html: string, opts: { browser?: Browser } = {}): Promise<{ mp4: Buffer; ms: number }> {
  const t0 = Date.now();
  const browser = opts.browser ?? (await launchVideoBrowser());
  const dir = await mkdtemp(path.join(tmpdir(), "feed-video-"));
  const out = path.join(dir, "video.mp4");
  try {
    const page = await preparePage(browser, html);
    const ff = spawn(ffmpegBinary(), [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(VIDEO_FPS), "-c:v", "mjpeg", "-i", "-",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t", String(VIDEO_SECONDS),
      "-vf", "crop=1080:1350:0:1",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart",
      out,
    ]);
    let ffErr = "";
    ff.stderr.on("data", (d) => (ffErr += d));
    const done = new Promise<void>((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${ffErr}`))));
    });
    try {
      for (let f = 0; f < VIDEO_FPS * VIDEO_SECONDS; f++) {
        const ms = (f * 1000) / VIDEO_FPS;
        await page.evaluate(`document.getAnimations().forEach(function (a) { a.currentTime = ${ms}; })`);
        const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
        if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
      }
      ff.stdin.end();
      await done;
    } finally {
      await page.close();
    }
    return { mp4: await readFile(out), ms: Date.now() - t0 };
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (!opts.browser) await browser.close();
  }
}
