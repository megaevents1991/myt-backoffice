import { ensureTourCreatives, listTourCreatives, tourCreativeLookup, type TourCreativeRun } from "@/lib/creative/tours";
import { fetchToursReport, listFeedCompanies, publishToursFeed, type FeedCompany, type PublishedToursReport } from "@/lib/feed/tours-feed";

/**
 * The tours companies' Meta feeds, end to end (lib/feed/tours-feed.ts + lib/creative/tours.ts):
 *  - the publish cron (`publishMetaFeed`, after Mega Events) publishes every company with the pictures already drawn;
 *  - the creatives cron (`nightlyCampaignCreatives`, hourly) draws what is missing;
 *  - "Sync now" on Website > Product Feed draws what is missing, then publishes - one company, its own.
 * One company's failure never stops another's, and never Mega Events'.
 */

export type CompanyFeedResult =
  | { company: string; ok: true; items: number; skipped: number; branded: number; live: boolean; csvUrl: string; drawn?: TourCreativeRun }
  | { company: string; ok: false; error: string };

const summary = (company: FeedCompany, p: PublishedToursReport, drawn?: TourCreativeRun): CompanyFeedResult => ({
  company: company.slug,
  ok: true,
  items: p.items.length,
  skipped: p.skipped.length,
  branded: Object.values(p.images).filter((i) => i.branded).length,
  live: p.live,
  csvUrl: p.csvUrl,
  ...(drawn ? { drawn } : {}),
});

/** One company: its site's report, (optionally) the missing pictures until `deadline`, the files in Storage. Throws. */
export async function publishCompanyFeed(company: FeedCompany, draw: { deadline: number } | null): Promise<{ published: PublishedToursReport; drawn?: TourCreativeRun }> {
  if (!company.siteUrl) throw new Error(`${company.slug} has no site address`);
  const report = await fetchToursReport(company.siteUrl);
  let existing: Set<string>;
  let drawn: TourCreativeRun | undefined;
  if (draw) {
    const r = await ensureTourCreatives(company, report, draw.deadline);
    existing = r.existing;
    drawn = r.run;
  } else {
    existing = await listTourCreatives(company.slug);
  }
  const published = await publishToursFeed(company, tourCreativeLookup(company.slug, report.logo, existing), report);
  return { published, drawn };
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
export async function drawAllTourCreatives(deadline: number): Promise<(TourCreativeRun | { company: string; error: string })[]> {
  let companies: FeedCompany[];
  try {
    companies = await listFeedCompanies();
  } catch (e) {
    return [{ company: "*", error: e instanceof Error ? e.message : String(e) }];
  }
  const out: (TourCreativeRun | { company: string; error: string })[] = [];
  for (const company of companies) {
    try {
      const report = await fetchToursReport(company.siteUrl as string);
      out.push((await ensureTourCreatives(company, report, deadline)).run);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[tour-creatives] ${company.slug} failed:`, error);
      out.push({ company: company.slug, error });
    }
  }
  return out;
}

export { summary as companyFeedSummary };
