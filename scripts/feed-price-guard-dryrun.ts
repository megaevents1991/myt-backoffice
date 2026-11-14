// The feed's abnormal-price guard against the REAL database, read only: judges every listed future
// event and prints what a pass would hold, keep, release and mail - writes nothing, mails nobody.
//   npx tsx --env-file=.env.local scripts/feed-price-guard-dryrun.ts [eventId ...]
import { runFeedPriceGuard } from "@/lib/services/feed-price-guard";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const summary = await runFeedPriceGuard({ dryRun: true, ids: ids.length ? ids : undefined });
  console.log(JSON.stringify({ ...summary, holds: Object.fromEntries(summary.holds) }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
