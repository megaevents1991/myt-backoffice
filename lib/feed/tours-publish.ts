import { ensureTourCreatives, listTourCreatives, tourCreativeLookup, type TourCreativeRun } from "@/lib/creative/tours";
import { ensureWorldCovers, worldCoverLookup, type WorldCoverRun } from "@/lib/creative/worlds";
import { fetchToursReport, listFeedCompanies, publishToursFeed, type FeedCompany, type PublishedToursReport } from "@/lib/feed/tours-feed";

/**
 * The tours companies' Meta feeds, end to end (lib/feed/tours-feed.ts + lib/creative/tours.ts):
 *  - the publish cron (`publishMetaFeed`, after Mega Events) publishes every company with the pictures already drawn;
 *  - the creatives cron (`nightlyCampaignCreatives`, hourly) draws what is missing - the tours' pictures, then the
 *    worlds' feed covers (lib/creative/worlds.ts);
 *  - "Sync now" on Website > Product Feed draws what is missing, then publishes - one company, its own.
 * One company's failure never stops another's, and never Mega Events'.
 */

export type CompanyFeedResult =
  | { company: string; ok: true; items: number; skipped: number; branded: number; covers: number; live: boolean; csvUrl: string; drawn?: TourCreativeRun; coversDrawn?: WorldCoverRun }
  | { company: string; ok: false; error: string };

const summary = (company: FeedCompany, p: PublishedToursReport, drawn?: TourCreativeRun, coversDrawn?: WorldCoverRun): CompanyFeedResult => ({
  company: company.slug,
  ok: true,
  items: p.items.length,
  skipped: p.skipped.length,
  branded: Object.values(p.images).filter((i) => i.branded).length,
  covers: Object.keys(p.covers ?? {}).length,
  live: p.live,
  csvUrl: p.csvUrl,
  ...(drawn ? { drawn } : {}),
  ...(coversDrawn ? { coversDrawn } : {}),
});

/** One company: its site's report, (optionally) the missing pictures and covers until `deadline`, the files in Storage. Throws. */
export async function publishCompanyFeed(
  company: FeedCompany,
  draw: { deadline: number } | null,
): Promise<{ published: PublishedToursReport; drawn?: TourCreativeRun; coversDrawn?: WorldCoverRun }> {
  if (!company.siteUrl) throw new Error(`${company.slug} has no site address`);
  const report = await fetchToursReport(company.siteUrl);
  let existing: Set<string>;
  let drawn: TourCreativeRun | undefined;
  let coversDrawn: WorldCoverRun | undefined;
  if (draw) {
    const r = await ensureTourCreatives(company, report, draw.deadline);
    existing = r.existing;
    drawn = r.run;
    // the covers share the tours' folder, so the same listing tells which are current
    coversDrawn = await ensureWorldCovers(company, report, draw.deadline, existing);
  } else {
    existing = await listTourCreatives(company.slug);
  }
  const published = await publishToursFeed(
    company,
    tourCreativeLookup(company.slug, report.logo, existing),
    report,
    worldCoverLookup(company.slug, report.logo, existing),
  );
  return { published, drawn, coversDrawn };
}

/** Every tours company with a site, published one by one; never throws. */
export async function publishAllToursFeeds(): Promise<CompanyFeedResult[]> {
  let companies: FeedCompany[];
  try {
    companies = await listFeedCompanies();
  } catch (e) {
    return [{ company: "*", ok: false, error: e instanceof Error ? e.message : String(e) }];
  }
  const out: CompanyFeedResult[] = [];
  for (const company of companies) {
    try {
      const { published } = await publishCompanyFeed(company, null);
      out.push(summary(company, published));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[tours-feed] ${company.slug} failed:`, error);
      out.push({ company: company.slug, ok: false, error });
    }
  }
  return out;
}

/** The creatives cron's part: every company's missing pictures, until `deadline`; never throws. */
export async function drawAllTourCreatives(deadline: number): Promise<((TourCreativeRun & { covers: WorldCoverRun }) | { company: string; error: string })[]> {
  let companies: FeedCompany[];
  try {
    companies = await listFeedCompanies();
  } catch (e) {
    return [{ company: "*", error: e instanceof Error ? e.message : String(e) }];
  }
  const out: ((TourCreativeRun & { covers: WorldCoverRun }) | { company: string; error: string })[] = [];
  for (const company of companies) {
    try {
      const work = (async () => {
        const report = await fetchToursReport(company.siteUrl as string);
        const { run, existing } = await ensureTourCreatives(company, report, deadline);
        const covers = await ensureWorldCovers(company, report, deadline, existing);
        return { ...run, covers };
      })();
      // the deadline is checked between tours; a picture whose photo never answers is cut here, 15 s past it
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("out of time - the next run goes on")), Math.max(0, deadline - Date.now()) + 15_000);
      });
      try {
        out.push(await Promise.race([work, stop]));
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[tour-creatives] ${company.slug} failed:`, error);
      out.push({ company: company.slug, error });
    }
  }
  return out;
}

export { summary as companyFeedSummary };
