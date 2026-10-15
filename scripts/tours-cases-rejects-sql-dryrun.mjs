// scripts/tours-cases-rejects-sql-dryrun.mjs - `node scripts/tours-cases-rejects-sql-dryrun.mjs`
//
// Runs supabase/migrations/20261015172708_tours_cases_rejects.sql against PRODUCTION inside one
// transaction and throws it away (same method as tours-cases-sql-dryrun.mjs): the migration, a few
// site-like leads and bookings on fake phones, then a DO block that RAISES with every check's
// result - the raise aborts the transaction, nothing stays (sequence numbers may skip).
//
// Checks: "Offer sent" lands right after "Follow-up" in each tours company's list; close_reason
// exists; a second booking of a known customer opens its own case on the same rep and names the
// first; a waiting-list form's payload.date finds the departure; merge_lead_cases moves bookings,
// seats and notes into the older case and marks the newer one merged.
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
  `select c.id as company_id, d.id as departure_id, coalesce(d.legacy_product_id, d.site_id) as product_id, p.slug,
          (select assigned_to from public.leads where assigned_to is not null limit 1) as rep
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
console.log("target:", { departure: target.departure_id, product_id: PID, slug: target.slug, rep: target.rep });

const booking = (first, phone) =>
  lit(
    JSON.stringify({
      product_id: PID,
      rooms: ["double_room"],
      customer: { first, last: "בדיקה", phone, email: "" },
      passengers: [{ type: "adult", first, last: "בדיקה" }],
      note: "dry run",
      source_path: PATH,
      estimate: { total: 1000, currency: "USD", rooms: [{ key: "double_room", title: "זוגי", adults: 2, children: 0 }] },
    }),
  );

const migration = readFileSync("supabase/migrations/20261015172708_tours_cases_rejects.sql", "utf8");
const A = `(select id from public.leads where phone = '054-000 2222')`;
const checks = `
create temp table _dry(step text, result jsonb);

-- (a) "Offer sent" sits right after "Follow-up", positions stay one per status
insert into _dry select 'a_offer_sent', jsonb_build_object(
  'exists', exists (select 1 from public.lead_statuses where company_id = ${C} and key = 'offer_sent' and is_system and not is_closed),
  'after_follow_up', (select o.position = f.position + 1 from public.lead_statuses o, public.lead_statuses f
                       where o.company_id = ${C} and f.company_id = ${C} and o.key = 'offer_sent' and f.key = 'follow_up'),
  'positions_unique', (select count(distinct position) = count(*) from public.lead_statuses where company_id = ${C}));

-- (b) a lead on a rep, then the customer books twice without the link
insert into public.leads (company_id, kind, name, phone, payload, source_path, assigned_to, notes)
values (${C}, 'lead', 'רון בדיקה', '054-000 2222', '{}'::jsonb, ${lit(PATH)}, ${target.rep ? lit(target.rep) : "null"}, 'note A');
insert into _dry select 'b_first', tours.booking_create(${C}, 'request', ${booking("רון", "0540002222")}::jsonb);
insert into _dry select 'c_second', tours.booking_create(${C}, 'request', ${booking("רון", "0540002222")}::jsonb);
update public.leads set notes = 'note B' where id = (select lead_id from tours.bookings where ref = (select result->>'ref' from _dry where step = 'c_second'));
insert into _dry select 'd_related', jsonb_build_object(
  'cases', (select count(*) from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '540002222' and is_deleted is null),
  'first_bookings', (select count(*) from tours.bookings where lead_id = ${A}),
  'second_rep_same', (select l.assigned_to is not distinct from (select assigned_to from public.leads where id = ${A})
                        from public.leads l join tours.bookings b on b.lead_id = l.id where b.ref = (select result->>'ref' from _dry where step = 'c_second')),
  'second_names_first', (select l.related_lead_id = ${A}
                           from public.leads l join tours.bookings b on b.lead_id = l.id where b.ref = (select result->>'ref' from _dry where step = 'c_second')));

-- (d2) a visitor cannot forge the system keys through a form payload
insert into public.leads (company_id, kind, name, phone, payload)
values (${C}, 'lead', 'זיוף בדיקה', '0547771111',
        jsonb_build_object('related_case', jsonb_build_object('id', gen_random_uuid(), 'case_no', 1), 'matched_by', 'contact', 'merged_into', 'x', 'keep', 'yes'));
insert into _dry select 'd2_forged', to_jsonb(x) from (select payload, related_lead_id from public.leads where phone = '0547771111') x;

-- (e) the close reason column takes a value
update public.leads set close_reason = 'dry run reason' where id = ${A};
insert into _dry select 'e_close_reason', to_jsonb(x) from (select close_reason from public.leads where id = ${A}) x;

-- (f) a waiting-list form names its date: the case finds the departure
insert into public.leads (company_id, kind, name, phone, payload, source_path)
values (${C}, 'waitlist', 'המתנה בדיקה', '0547770000',
        jsonb_build_object('date', jsonb_build_object('productId', ${PID}, 'code', 'X', 'label', '1.1 - 5.1')), '/destination/x/');
insert into _dry select 'f_waitlist', to_jsonb(x) from (
  select type, departure_id = ${lit(target.departure_id)}::uuid as departure_ok, package_id is not null as package_ok
    from public.leads where phone = '0547770000') x;

-- (g) merge the second case into the first
insert into _dry select 'g_merge', public.merge_lead_cases(${C},
  (select l.id from public.leads l join tours.bookings b on b.lead_id = l.id where b.ref = (select result->>'ref' from _dry where step = 'c_second')),
  ${A});
insert into _dry select 'h_after_merge', jsonb_build_object(
  'first_bookings', (select count(*) from tours.bookings where lead_id = ${A}),
  'live_cases', (select count(*) from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '540002222' and is_deleted is null),
  'merged_into_set', (select count(*) from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '540002222'
                        and is_deleted is not null and payload ? 'merged_into'),
  'notes', (select notes from public.leads where id = ${A}),
  'merged_list', (select jsonb_array_length(payload->'merged') from public.leads where id = ${A}),
  'contact_kept', (select phone = '054-000 2222' and email is null from public.leads where id = ${A}),
  'type', (select type from public.leads where id = ${A}));
-- merging a deleted case again is refused
insert into _dry select 'i_merge_again', public.merge_lead_cases(${C},
  (select id from public.leads where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '540002222' and is_deleted is not null limit 1), ${A});

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
const a = lines.a_offer_sent;
expect(a?.exists && a.after_follow_up && a.positions_unique, "(a) offer_sent right after follow_up, positions unique");
expect(lines.b_first?.ok === true && lines.c_second?.ok === true, "(b/c) both bookings ok");
const d = lines.d_related;
expect(d?.cases === 2 && d.first_bookings === 1, "(d) the second booking opens its own case");
expect(d?.second_rep_same === true, "(d) ...on the same rep");
expect(d?.second_names_first === true, "(d) ...naming the first case");
expect(JSON.stringify(lines.d2_forged?.payload) === '{"keep":"yes"}' && lines.d2_forged?.related_lead_id === null, "(d2) form payload cannot carry system keys");
expect(lines.e_close_reason?.close_reason === "dry run reason", "(e) close_reason writable");
const f = lines.f_waitlist;
expect(f?.type === "potential" && f.departure_ok && f.package_ok, "(f) waitlist date -> departure");
expect(lines.g_merge?.ok === true && lines.g_merge?.bookings === 1, "(g) merge ok, one booking moved");
const h = lines.h_after_merge;
expect(h?.first_bookings === 2 && h.live_cases === 1 && h.merged_into_set === 1, "(h) bookings on the older case, newer one merged");
expect(typeof h?.notes === "string" && h.notes.includes("note A") && h.notes.includes("note B"), "(h) notes joined");
expect(h?.merged_list === 1 && h?.type === "reservation", "(h) merged list + reservation");
expect(h?.contact_kept === true, "(h) the target keeps its own contact");
expect(lines.i_merge_again?.ok === false, "(i) a merged case cannot merge again");

const after = await query(
  "select count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'close_reason'",
  true,
);
const stayed = JSON.parse(after.body)[0]?.n;
console.log("close_reason column on prod after the run:", stayed);
expect(Number(stayed) === 0 || process.env.MIGRATED === "1", "production unchanged (no close_reason column)");

if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\ntours-cases rejects sql dry run: ok");
