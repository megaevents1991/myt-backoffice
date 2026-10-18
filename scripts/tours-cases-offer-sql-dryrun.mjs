// scripts/tours-cases-offer-sql-dryrun.mjs - `node scripts/tours-cases-offer-sql-dryrun.mjs`
//
// Runs supabase/migrations/20261018110900_tours_cases_offer.sql against PRODUCTION inside one transaction
// and throws it away (same method as tours-cases-rejects-sql-dryrun.mjs): the migration, a few site-like
// bookings on fake phones, then a DO block that RAISES with every check's result - the raise aborts the
// transaction, nothing stays (sequence numbers may skip).
//
// Checks: leads.offer exists; a booking through the link's token marks the offer with its ref and sets
// the follow-up day to today (Israel); a booking that opens a new case sets it too; the backoffice's own
// role can price a choice with tours.booking_quote (the link card's price).
//
// Needs SUPABASE_ACCESS_TOKEN in .env.local. Exit code 1 when a check fails.
import { readFileSync } from "node:fs";

const PROJECT = "fandqafngybfdyslofmr";
const env = readFileSync(".env.local", "utf8");
const token = /^SUPABASE_ACCESS_TOKEN=(.*)$/m.exec(env)?.[1]?.trim().replace(/^"|"$/g, "");
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN missing in .env.local");

async function query(sql, readOnly) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  return { status: res.status, body: await res.text() };
}

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

const pick = await query(
  `select c.id as company_id, d.id as departure_id, coalesce(d.legacy_product_id, d.site_id) as product_id, p.slug
     from public.companies c
     join tours.departures d on d.company_id = c.id and d.is_published and d.is_deleted is null and d.start_date > current_date
     join tours.packages p on p.id = d.package_id
    where c.slug = 'mega-family'
      and exists (select 1 from tours.departure_prices x where x.departure_id = d.id)
    order by d.start_date limit 1`,
  true,
);
const target = JSON.parse(pick.body)[0];
if (!target) throw new Error(`no published, priced future departure found: ${pick.body}`);
const C = lit(target.company_id);
const PID = String(target.product_id);
const PATH = `/package/${encodeURIComponent(target.slug)}/?product_id=${PID}`;
console.log("target:", { departure: target.departure_id, product_id: PID, slug: target.slug });

const booking = (first, phone, extra = {}) =>
  lit(
    JSON.stringify({
      product_id: PID,
      rooms: ["double_room"],
      customer: { first, last: "בדיקה", phone, email: "" },
      passengers: [{ type: "adult", first, last: "בדיקה" }],
      note: "dry run",
      source_path: PATH,
      estimate: { total: 1000, currency: "USD", rooms: [{ key: "double_room", title: "זוגי", adults: 2, children: 0 }] },
      ...extra,
    }),
  );

const migration = readFileSync("supabase/migrations/20261018110900_tours_cases_offer.sql", "utf8");
const A = `(select id from public.leads where phone = '054-000 3333')`;
const checks = `
create temp table _dry(step text, result jsonb);

-- (a) a lead with a sent offer and a token, then the customer books through the link
insert into public.leads (company_id, kind, name, phone, payload, link_token, follow_up_date, offer)
values (${C}, 'lead', 'אור בדיקה', '054-000 3333', '{}'::jsonb, 'TESToffer_0123456789', current_date + 5,
        jsonb_build_object('departureId', ${lit(target.departure_id)}, 'rooms', jsonb_build_array('double_room'), 'url', 'https://x', 'sentAt', now(), 'sentVia', 'whatsapp'));
insert into _dry select 'a_booking', tours.booking_create(${C}, 'request', ${booking("אור", "0549990000", { lead_ref: "TESToffer_0123456789" })}::jsonb);
insert into _dry select 'b_case', to_jsonb(x) from (
  select follow_up_date = (now() at time zone 'Asia/Jerusalem')::date as follow_up_today,
         offer->>'bookingRef' = (select result->>'ref' from _dry where step = 'a_booking') as offer_booked,
         offer->>'sentVia' as sent_via
    from public.leads where id = ${A}) x;

-- (c) a booking that opens its own case: follow-up today too
insert into _dry select 'c_new', tours.booking_create(${C}, 'request', ${booking("חדש", "0547770123")}::jsonb);
insert into _dry select 'd_new_case', to_jsonb(x) from (
  select l.follow_up_date = (now() at time zone 'Asia/Jerusalem')::date as follow_up_today, l.offer is null as no_offer
    from public.leads l join tours.bookings b on b.lead_id = l.id
   where b.ref = (select result->>'ref' from _dry where step = 'c_new')) x;

-- (e) the link card's price: the site's own quote
insert into _dry select 'e_quote', tours.booking_quote(${C}, jsonb_build_object('product_id', ${PID}, 'rooms', jsonb_build_array('double_room', 'double_room')));

do $dry$
declare r text;
begin
  select string_agg(step || ' = ' || result::text, E'\\n' order by step) into r from _dry;
  raise exception 'DRYRUN_RESULT%', E'\\n' || r;
end
$dry$;
`;

const run = await query(`begin;\n${migration}\n${checks}`, false);
const text = (() => {
  try {
    const j = JSON.parse(run.body);
    return typeof j.message === "string" ? j.message : run.body;
  } catch {
    return run.body;
  }
})();
const result = /DRYRUN_RESULT([\s\S]*?)(?:\nCONTEXT:|$)/.exec(text)?.[1];
if (!result) {
  console.error(`dry run did not reach the checks (HTTP ${run.status}):\n${run.body}`);
  process.exit(1);
}
console.log(result.trim());

const lines = Object.fromEntries(
  result
    .trim()
    .split("\n")
    .map((line) => {
      const at = line.indexOf(" = ");
      return [line.slice(0, at), JSON.parse(line.slice(at + 3))];
    }),
);
const failures = [];
const expect = (ok, what) => {
  if (!ok) failures.push(what);
};
expect(lines.a_booking?.ok === true, "(a) booking through the link ok");
expect(lines.b_case?.follow_up_today === true, "(b) the case's follow-up day is today");
expect(lines.b_case?.offer_booked === true && lines.b_case?.sent_via === "whatsapp", "(b) the offer names the booking, keeps how it was sent");
expect(lines.c_new?.ok === true, "(c) a booking of its own ok");
expect(lines.d_new_case?.follow_up_today === true && lines.d_new_case?.no_offer === true, "(d) a new case is followed up today, no offer");
expect(lines.e_quote?.ok === true && Number(lines.e_quote?.total) > 0, "(e) booking_quote prices two double rooms");

const after = await query(
  "select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'offer'",
  true,
);
const stayed = JSON.parse(after.body)[0]?.n;
console.log("offer column on prod after the run:", stayed);
expect(Number(stayed) === 0 || process.env.MIGRATED === "1", "production unchanged (no offer column)");

if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\ntours-cases offer sql dry run: ok");
