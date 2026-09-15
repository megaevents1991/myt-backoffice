// The only file that knows how a browser is obtained (spec §3.3, decision D1).
//   NEXT_SECRET_BROWSER_CDP_URL set  -> remote stealth browser over CDP (Browserbase / Bright Data)
//   otherwise                         -> local @sparticuz/chromium + optional residential proxy
// Every page is hardened the same way regardless of mode.
import type { Browser, BrowserContext, Page } from "playwright-core";
// The UA list lives in its own dependency-free module so the fetch-mode crawlers can share it
// WITHOUT importing this file (which pulls playwright/chromium in). Re-exported here for the
// existing call sites (final review, M8).
import { UAS } from "./ua.ts";

export { UAS };
const VIEWPORTS = [{ width: 1366, height: 768 }, { width: 1536, height: 864 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];

export const PAGE_TIMEOUT_MS = 45_000;
export const PAUSE_MIN_MS = 20_000;
export const PAUSE_MAX_MS = 60_000;
export const PAUSE_SHORT_MIN_MS = 5_000;
export const PAUSE_SHORT_MAX_MS = 15_000;
// Applied in BOTH modes (harden()) so a remote CDP provider that doesn't
// pre-configure Hebrew locale itself still sees an Israeli Accept-Language.
const ACCEPT_LANGUAGE = "he-IL,he;q=0.9,en-US;q=0.8";

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export function scrapeEnabled(): boolean {
  return (process.env.PRICE_LIGHT_SCRAPE ?? "on").toLowerCase() !== "off";
}

export function browserMode(): "remote" | "local" {
  return process.env.NEXT_SECRET_BROWSER_CDP_URL ? "remote" : "local";
}

export async function randomPause(): Promise<void> {
  const ms = PAUSE_MIN_MS + Math.floor(Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS));
  await new Promise((r) => setTimeout(r, ms));
}

/** Between paginated GETs of the SAME site in fetch mode (a person clicking league tabs) -
 *  the full 20-60s pause is for browser page loads and for switching sites. */
export async function shortPause(): Promise<void> {
  const ms = PAUSE_SHORT_MIN_MS + Math.floor(Math.random() * (PAUSE_SHORT_MAX_MS - PAUSE_SHORT_MIN_MS));
  await new Promise((r) => setTimeout(r, ms));
}

function parseProxy(url: string): { server: string; username?: string; password?: string } {
  const u = new URL(url);
  return { server: `${u.protocol}//${u.host}`, username: u.username || undefined, password: u.password || undefined };
}

async function launch(): Promise<{ browser: Browser; context: BrowserContext }> {
  // Lazy imports keep chromium out of every other route's bundle.
  const { chromium: playwright } = await import("playwright-core");
  const cdp = process.env.NEXT_SECRET_BROWSER_CDP_URL;
  if (cdp) {
    // Remote provider (Browserbase / Bright Data) owns the fingerprint - UA,
    // locale, timezone, proxy - so we don't override any of that here; only
    // the Accept-Language header and the route/referrer/timeout hardening in
    // harden() apply on top of whatever context the provider hands back.
    const browser = await playwright.connectOverCDP(cdp, { timeout: PAGE_TIMEOUT_MS });
    const context = browser.contexts()[0] ?? (await withBrowserClosedOnFailure(browser, () => browser.newContext()));
    return { browser, context };
  }
  const { default: chromium } = await import("@sparticuz/chromium");
  const proxy = process.env.NEXT_SECRET_SCRAPE_PROXY_URL;
  const localChrome = process.env.NODE_ENV !== "production" ? process.env.LOCAL_CHROME_PATH : undefined;
  const browser = await playwright.launch({
    args: localChrome ? [] : chromium.args,
    executablePath: localChrome || (await chromium.executablePath()),
    headless: true,
    proxy: proxy ? parseProxy(proxy) : undefined,
  });
  const context = await withBrowserClosedOnFailure(browser, () => browser.newContext({
    userAgent: pick(UAS),
    viewport: pick(VIEWPORTS),
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  }));
  return { browser, context };
}

/**
 * Context creation happens after the browser exists but before `withBrowser`'s try/finally owns it -
 * a throw there used to leave a stray Chromium in a warm Lambda, or an open, billed remote session.
 */
async function withBrowserClosedOnFailure<T>(browser: Browser, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

async function harden(page: Page): Promise<void> {
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  // Applies in both local and remote-CDP modes - see the note on the CDP
  // branch in launch() for why locale/timezone/UA don't also live here.
  await page.setExtraHTTPHeaders({ "Accept-Language": ACCEPT_LANGUAGE });
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "image" || type === "media" || type === "font" || type === "stylesheet") return route.abort();
    const headers = { ...route.request().headers() };
    delete headers.referer;
    return route.continue({ headers });
  });
}

export async function withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const { browser, context } = await launch();
  try {
    const page = await context.newPage();
    try {
      await harden(page);
      return await fn(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
