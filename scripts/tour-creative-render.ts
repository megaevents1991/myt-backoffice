// Draws the branded Meta pictures of a tours report to local PNG files, to look at them. Writes nothing anywhere else
// (no Storage, no DB): only the brand font is read from the public creatives bucket.
//   npx tsx --env-file=.env.local scripts/tour-creative-render.ts <out-dir> [report-url] [item-id]
//   report-url defaults to the company site's https://mega-family.vercel.app/feeds/tours.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [out = "./tour-creatives", url = "https://mega-family.vercel.app/feeds/tours.json", only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
async function main() {
  // tsx compiles JSX with the classic runtime: React must be global before the template loads
  (globalThis as unknown as { React: unknown }).React = (await import("react")).default;
  const { renderTourCreativePng } = await import("../lib/creative/render");
  const { tourCreativeInput } = await import("../lib/creative/tours");
  const { parseToursReport } = await import("../lib/feed/tours-feed");
  const report = parseToursReport(await (await fetch(url, { cache: "no-store" })).json());
  for (const item of report.items.filter((i) => !only || i.id === only)) {
    const input = tourCreativeInput(item, report.logo);
    for (const size of ["square", "banner"] as const) {
      const file = join(out, `${item.id}-${size}.png`);
      writeFileSync(file, Buffer.from(await renderTourCreativePng(input, size)));
      console.log(file);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
