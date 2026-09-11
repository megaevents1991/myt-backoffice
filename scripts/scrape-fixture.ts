/**
 * Runs a crawler's pure parsers on saved HTML - regression without network.
 * Run: node --env-file=.env.local scripts/scrape-fixture.ts <liveevents|issta|ontour|golasso>
 * --save fetches that site's fixture pages once (the only network access this script makes,
 * one visit per page, 20s apart) into scripts/fixtures/<site>/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { withBrowser } from "../lib/services/browser.ts";
import { stealthHeaders } from "../lib/services/competitor-scrapers/shared.ts";
import type { FixtureSpec } from "./fixture-checks/types.ts";

const SITES = ["liveevents", "issta", "ontour", "golasso"] as const;
const site = process.argv[2] as (typeof SITES)[number];
if (!SITES.includes(site)) {
  console.error(`usage: scrape-fixture.ts <${SITES.join("|")}> [--save]`);
  process.exit(2);
}
const save = process.argv.includes("--save");
const dir = `scripts/fixtures/${site}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchViaBrowser(url: string, waitFor?: string): Promise<string> {
  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    return page.content();
  });
}

async function fetchPlain(url: string): Promise<string> {
  const res = await fetch(url, { headers: stealthHeaders() });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function saveFixtures(spec: FixtureSpec): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const entries = Object.entries(spec.files);
  for (let i = 0; i < entries.length; i++) {
    const [file, f] = entries[i];
    console.error(`fetching ${f.url} (${f.via}) ...`);
    const html = f.via === "browser" ? await fetchViaBrowser(f.url, f.waitFor) : await fetchPlain(f.url);
    writeFileSync(`${dir}/${file}`, html, "utf8");
    console.error(`saved ${dir}/${file} (${html.length} bytes)`);
    if (i < entries.length - 1) { console.error("pausing 20s ..."); await sleep(20_000); }
  }
}

async function main(): Promise<void> {
  const spec = (await import(`./fixture-checks/${site}.ts`)).default as FixtureSpec;
  if (save) await saveFixtures(spec);
  else spec.check((file) => readFileSync(`${dir}/${file}`, "utf8"));
}

main().catch((err) => { console.error(err); process.exit(1); });
