// scripts/image-sniff-selftest.ts - `npx tsx scripts/image-sniff-selftest.ts`
import { sniffImageMime } from "../lib/images/sniff";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${String(got)} want ${String(want)}`); }
  else console.log(`ok   ${name}`);
}
const bytes = (...n: number[]) => Uint8Array.from(n);

check("png", sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)), "image/png");
check("jpeg", sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0)), "image/jpeg");
check("gif", sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0)), "image/gif");
check("webp", sniffImageMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), "image/webp");
// An HTML page renamed screenshot.png must not pass.
check("html rejected", sniffImageMime(bytes(0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0, 0, 0)), null);
check("svg rejected", sniffImageMime(bytes(0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0)), null);
check("too short", sniffImageMime(bytes(0x89, 0x50)), null);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
