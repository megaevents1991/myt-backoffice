// scripts/tours-cases-sql-dryrun.mjs - `node scripts/tours-cases-sql-dryrun.mjs`
//
// Runs supabase/migrations/20261014220000_tours_unified_cases.sql against PRODUCTION and
// throws it away: the migration, a few site-like inserts and bookings, then a DO block that
// RAISES an exception carrying every check's result. The raise aborts the one implicit
// transaction the management API runs the statements in, so nothing stays (sequence numbers
// may skip). A second, read-only query then confirms the schema is unchanged.
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

// 1. a real company and a real published departure to point at
const pick = await query(
  `select c.id as company_id, d.id as departure_id, coalesce(d.legacy_product_id, d.site_id) as product_id, p.slug
     from public.companies c
     join tours.departures d on d.company_id = c.id and d.is_published and d.is_deleted is null and d.start_date > current_date
     join tours.packages p on p.id = d.package_id
    where c.slug = 'mega-family'
    order by d.start_date limit 1`,
  true,
);
const target = JSON.parse(pick.body)[0];
if (!target) throw new Error(`no published future departure found: ${pick.body}`);
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
      passengers: [],
      note: "dry run",
      source_path: PATH,
      estimate: { total: 1000, currency: "USD", rooms: [{ key: "double_room", title: "זוגי", adults: 2, children: 0 }] },
      ...extra,
    }),
  );

const migration = readFileSync("supabase/migrations/20261014220000_tours_unified_cases.sql", "utf8");
const checks = `
create temp table _dry(step text, result jsonb);

-- (a) a lead from a tour page, like c_<slug>.submit_lead
insert into public.leads (company_id, kind, name, phone, email, message, payload, source_path, utm)
values (${C}, 'lead', 'דנה בדיקה', '054-000 1111', null, 'dry run', '{}'::jsonb, ${lit(PATH)},
        '{"source":"fb","x":"drop","medium":5}'::jsonb);
insert into _dry select 'a_lead', to_jsonb(x) from (
  select case_no > 1000 as numbered, type, first_name, last_name, departure_id = ${lit(target.departure_id)}::uuid as departure_ok,
         package_id is not null as package_ok, utm, status, source
    from public.leads where phone = '054-000 1111') x;

-- (b) the same customer books on the site (other phone writing): attaches, one case
insert into _dry select 'b_request', tours.booking_create(${C}, 'request', ${booking("דנה", "0540001111", { utm: { source: "ig" } })}::jsonb);
insert into _dry select 'c_after_request', jsonb_build_object(
  'cases', (select count(*) from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '540001111'),
  'type', (select type from public.leads where phone = '054-000 1111'),
  'status', (select status from public.leads where phone = '054-000 1111'),
  'utm_kept_first', (select utm->>'source' from public.leads where phone = '054-000 1111'),
  'matched_by', (select payload->>'matched_by' from public.leads where phone = '054-000 1111'),
  'phone_untouched', (select phone from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '540001111'),
  'bookings', (select count(*) from tours.bookings b join public.leads l on l.id = b.lead_id where l.phone = '054-000 1111'));

-- (d) a second booking through the case's link token, from ANOTHER phone: same case
update public.leads set link_token = 'TESTtoken_0123456789' where phone = '054-000 1111';
insert into _dry select 'd_token_booking', tours.booking_create(${C}, 'request',
  ${booking("אחר", "0549999999", { lead_ref: "TESTtoken_0123456789" })}::jsonb);
insert into _dry select 'e_after_token', jsonb_build_object(
  'cases_for_other_phone', (select count(*) from public.leads where phone = '0549999999'),
  'bookings_on_case', (select count(*) from tours.bookings b where b.lead_id = (select id from public.leads where phone = '054-000 1111')),
  'matched_by', (select payload->>'matched_by' from public.leads where phone = '054-000 1111'));

-- (f) the booking is paid: the case reads paid
update tours.bookings set status = 'paid' where lead_id = (select id from public.leads where phone = '054-000 1111');
insert into _dry select 'f_after_paid', to_jsonb(x) from (select status from public.leads where phone = '054-000 1111') x;

-- (g) "notify me" opens a potential
insert into public.leads (company_id, kind, name, phone, payload, source_path)
values (${C}, 'notify', 'פוטנציאל לבדיקה', '0547777777', '{}'::jsonb, '/destination/x/');
insert into _dry select 'g_notify', to_jsonb(x) from (select type, first_name, last_name from public.leads where phone = '0547777777') x;

-- (h) a spam lead with the customer's phone is not reused: the booking opens its own case
insert into public.leads (company_id, kind, name, phone, payload, status) values (${C}, 'contact', 'ספאם', '0546666666', '{}'::jsonb, 'spam');
insert into _dry select 'h_spam_not_reused', tours.booking_create(${C}, 'request', ${booking("לקוח", "054-666-6666")}::jsonb);
insert into _dry select 'i_spam_cases', jsonb_build_object(
  'cases', (select count(*) from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '546666666'),
  'spam_still_spam', (select status from public.leads where phone = '0546666666'));

-- (j) url_decode / clean_utm
insert into _dry select 'j_helpers', jsonb_build_object(
  'decoded', public.url_decode('%D7%98%D7%99%D7%95%D7%9C'),
  'broken', public.url_decode('%E0%A4%A'),
  'utm', public.clean_utm('{"source":" s ","bad":"x","term":3}'::jsonb));

do $dry$
declare r text;
begin
  select string_agg(step || ' = ' || result::text, E'\\n' order by step) into r from _dry;
  raise exception 'DRYRUN_RESULT%', E'\\n' || r;
end
$dry$;
`;

const run = await query(`${migration}\n${checks}`, false);
const text = (() => { try { const j = JSON.parse(run.body); return typeof j.message === "string" ? j.message : run.body; } catch { return run.body; } })();
// the error text: "...DRYRUN_RESULT\n<step> = <json>\n...", possibly followed by a CONTEXT line
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
const a = lines.a_lead;
expect(a?.type === "lead" && a.first_name === "דנה" && a.last_name === "בדיקה", "(a) lead TYPE + names");
expect(a?.numbered && a.departure_ok && a.package_ok && a.source === "site", "(a) case no + departure + package + source");
expect(JSON.stringify(a?.utm) === '{"source":"fb"}', "(a) utm cleaned");
expect(lines.b_request?.ok === true, "(b) booking_create request ok");
const c = lines.c_after_request;
expect(c?.cases === 1 && c.type === "reservation" && c.status === "new" && c.bookings === 1, "(c) one case, reservation, new, 1 booking");
expect(c?.utm_kept_first === "fb", "(c) the case keeps its first utm");
expect(c?.matched_by === "contact" && c?.phone_untouched === "054-000 1111", "(c) a contact match writes no contact field");
expect(lines.d_token_booking?.ok === true, "(d) token booking ok");
expect(lines.e_after_token?.cases_for_other_phone === 0 && lines.e_after_token?.bookings_on_case === 2, "(e) token attaches to the same case");
expect(lines.e_after_token?.matched_by === "token", "(e) the token match is recorded");
expect(lines.f_after_paid?.status === "paid", "(f) paid booking -> case paid");
expect(lines.g_notify?.type === "potential", "(g) notify -> potential");
expect(lines.i_spam_cases?.cases === 2 && lines.i_spam_cases?.spam_still_spam === "spam", "(i) spam lead not reused");
expect(lines.j_helpers?.decoded === "טיול" && lines.j_helpers?.broken === "%E0%A4%A", "(j) url_decode");
expect(JSON.stringify(lines.j_helpers?.utm) === '{"source":"s"}', "(j) clean_utm");

// nothing stayed
const after = await query(
  "select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'case_no'",
  true,
);
const stayed = JSON.parse(after.body)[0]?.n;
console.log("case_no column on prod after the run:", stayed);
expect(Number(stayed) === 0 || process.env.MIGRATED === "1", "production unchanged (no case_no column)");

if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\ntours-cases sql dry run: ok");
