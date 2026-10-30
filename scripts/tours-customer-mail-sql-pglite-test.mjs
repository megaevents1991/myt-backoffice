// scripts/tours-customer-mail-sql-pglite-test.mjs - `node scripts/tours-customer-mail-sql-pglite-test.mjs`
//
// The SQL test of migrations 20261030180000_tours_booking_customer_mail.sql and 20261030201500_tours_customer_mail_cancellation_rules.sql, on an in-process Postgres (PGlite): stub
// tables with the columns the mail functions touch, the real tours.booking_key_ok's rule, then the migration, then the
// scenarios through tours.site_booking - the key, another company's order, a mail that is not true of the order, the
// claim (a second call mails nothing, a release frees it, a failed page then a paid one each get their own), a payment
// link's own slot, a birth date never in the answer, an address a mail server would read differently, and the caps
// (per mailbox under its many spellings, per company, an hour of when the mail went out; a failed card page counts, a paid one does not).
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an
// install elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIGRATIONS = ["20261030180000_tours_booking_customer_mail.sql", "20261030201500_tours_customer_mail_cancellation_rules.sql"].map((f) => `${process.cwd()}/supabase/migrations/${f}`);
const KEY = "k".repeat(40);
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const sha = createHash("sha256").update(KEY).digest("hex");

const db = new PGlite();
await db.exec(`
  create role service_role; create role anon; create role authenticated;
  create schema tours;
  create table public.companies (id uuid primary key, payment_config jsonb default '{}');
  insert into public.companies values ('${A}', '{"site_key_sha256":"${sha}"}'), ('${B}', '{"site_key_sha256":"${sha}"}');
  create table tours.packages (id uuid primary key default gen_random_uuid(), company_id uuid, slug text, name text, hero_image text, card_image text, data jsonb not null default '{}');
  create table tours.departures (id uuid primary key default gen_random_uuid(), company_id uuid, package_id uuid, code text, start_date date, end_date date);
  create table tours.bookings (id uuid primary key default gen_random_uuid(), company_id uuid, ref text unique, departure_id uuid, kind text, status text,
    price_basis text default 'server', currency text default 'USD', rooms jsonb default '[]', passengers jsonb default '[]', adults int default 0, children int default 0,
    discount numeric default 0, total numeric default 0, customer_name text, customer_email text, total_ils numeric, payments int, cg_card_last4 text, is_deleted date, created_at timestamptz not null default now());
  create table tours.cancellation_rules (id uuid primary key default gen_random_uuid(), company_id uuid, package_id uuid, component text, until_days_before int, fee_kind text, fee_value numeric, position int not null default 0);
  create table public.leads (id uuid primary key default gen_random_uuid(), company_id uuid, kind text, email text, created_at timestamptz not null default now());
  create table tours.payment_links (id uuid primary key default gen_random_uuid(), company_id uuid, booking_id uuid, kind text, amount numeric, currency text, amount_ils numeric,
    payments smallint default 1, status text default 'open', cg_uniqueids text[] default '{}', cg_card_last4 text);
  create function tours.booking_key_ok(p_company uuid, p_key text) returns boolean language sql stable as $$
    select coalesce(length(p_key) >= 32 and encode(sha256(convert_to(p_key, 'UTF8')), 'hex') = (select payment_config->>'site_key_sha256' from public.companies where id = p_company), false) $$;
`);
for (const migration of MIGRATIONS) await db.exec(readFileSync(migration, "utf8"));

const pkg = (await db.query(`insert into tours.packages (company_id, slug, name, hero_image, data) values ('${A}', 'rome', 'רומא משפחתי', '/media/rome.jpg', '{"path":"/package/rome/"}') returning id`)).rows[0].id;
const dep = (await db.query(`insert into tours.departures (company_id, package_id, code, start_date, end_date) values ('${A}', '${pkg}', 'ROM1221', '2026-12-21', '2026-12-27') returning id`)).rows[0].id;
const passengers = JSON.stringify([{ first: "DANA", last: "COHEN", dob: "1985-02-03", gender: "f" }, { first: "NOA", last: "COHEN", dob: "2018-05-06" }]);
const rooms = JSON.stringify([{ key: "couple", title: "חדר זוגי", price: 2000, net: 1900 }]);
const add = async (ref, kind, status, email = "dana@example.com", company = A) =>
  (await db.query(`insert into tours.bookings (company_id, ref, departure_id, kind, status, customer_name, customer_email, passengers, rooms, total, adults, children, total_ils, payments, cg_card_last4)
                   values ($1, $2, '${dep}', $3, $4, 'דנה כהן', $5, $6, $7, 1900, 1, 1, 6900, 3, '4242') returning id`, [company, ref, kind, status, email, passengers, rooms])).rows[0].id;

const call = async (action, args, company = A) =>
  (await db.query(`select tours.site_booking($1, $2, $3) as r`, [company, action, JSON.stringify(args)])).rows[0].r;

let failures = 0;
const check = (name, got, want) => {
  const ok = Object.entries(want).every(([k, v]) => JSON.stringify(got?.[k]) === JSON.stringify(v));
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(got)}`}`);
};

await add("T1", "request", "new");
await add("T2", "request", "new", null);
await add("T3", "card", "pending_payment");
const t4 = await add("T4", "card", "paid");
await add("T5", "card", "failed");
await add("T6", "request", "new", "not-an-email");
await add("T7", "request", "new", "other@example.com", B);
await add("T8", "request", "new");
await db.query(`update tours.bookings set is_deleted = '2026-10-30' where ref = 'T8'`);

check("no key refused", await call("customer_mail", { mail: "request", ref: "T1" }), { ok: false, error: "forbidden" });
check("wrong key refused", await call("customer_mail", { key: "x".repeat(40), mail: "request", ref: "T1" }), { ok: false, error: "forbidden" });
check("unknown mail", await call("customer_mail", { key: KEY, mail: "hello", ref: "T1" }), { ok: false, error: "mail" });
check("bad ref", await call("customer_mail", { key: KEY, mail: "request", ref: "T1;drop" }), { ok: false, error: "not_found" });
check("unknown ref", await call("customer_mail", { key: KEY, mail: "request", ref: "T999" }), { ok: false, error: "not_found" });
check("another company's order", await call("customer_mail", { key: KEY, mail: "request", ref: "T7" }), { ok: false, error: "not_found" });
check("deleted order", await call("customer_mail", { key: KEY, mail: "request", ref: "T8" }), { ok: false, error: "not_found" });

const first = await call("customer_mail", { key: KEY, mail: "request", ref: "T1" });
check("request claims", first, { ok: true, slot: "request", ref: "T1", to: "dana@example.com", total: 1900 });
check("request tells the tour", first.tour, { slug: "rome", name: "רומא משפחתי", image: "/media/rome.jpg", path: "/package/rome/" });
check("request tells the date", first.departure, { code: "ROM1221", start_date: "2026-12-21", end_date: "2026-12-27" });
check("names alone", { p: first.passengers }, { p: ["DANA COHEN", "NOA COHEN"] });
check("no birth date in the answer", { has: JSON.stringify(first).includes("1985") }, { has: false });
check("no link on an order mail", { link: first.link }, { link: null });
check("second request call mails nothing", await call("customer_mail", { key: KEY, mail: "request", ref: "T1" }), { ok: true, already: true });
check("release needs the key", await call("customer_mail_release", { ref: "T1", slot: "request" }), { ok: false, error: "forbidden" });
check("release refuses a bad slot", await call("customer_mail_release", { key: KEY, ref: "T1", slot: "x' or 1=1" }), { ok: false, error: "args" });
check("release frees it", await call("customer_mail_release", { key: KEY, ref: "T1", slot: "request" }), { ok: true });
check("after release it claims again", await call("customer_mail", { key: KEY, mail: "request", ref: "T1" }), { ok: true, slot: "request" });

check("no email: skip", await call("customer_mail", { key: KEY, mail: "request", ref: "T2" }), { ok: true, skip: "no_email" });
check("junk email: skip", await call("customer_mail", { key: KEY, mail: "request", ref: "T6" }), { ok: true, skip: "no_email" });
check("skip claims nothing", (await db.query(`select customer_mails from tours.bookings where ref='T2'`)).rows[0], { customer_mails: {} });

check("paid on a request", await call("customer_mail", { key: KEY, mail: "paid", ref: "T1" }), { ok: false, error: "state" });
check("request on a card order", await call("customer_mail", { key: KEY, mail: "request", ref: "T4" }), { ok: false, error: "state" });
check("paid before it is paid", await call("customer_mail", { key: KEY, mail: "paid", ref: "T3" }), { ok: false, error: "state" });
check("failed on a paid order", await call("customer_mail", { key: KEY, mail: "failed", ref: "T4" }), { ok: false, error: "state" });
check("paid claims", await call("customer_mail", { key: KEY, mail: "paid", ref: "T4" }), { ok: true, slot: "paid", total_ils: 6900, payments: 3, card_last4: "4242" });
check("failed claims", await call("customer_mail", { key: KEY, mail: "failed", ref: "T5" }), { ok: true, slot: "failed" });
await db.query(`update tours.bookings set status = 'paid' where ref = 'T5'`);
check("failed, then paid: its own slot", await call("customer_mail", { key: KEY, mail: "paid", ref: "T5" }), { ok: true, slot: "paid" });

const link1 = (await db.query(`insert into tours.payment_links (company_id, booking_id, kind, amount, currency, amount_ils, payments, status, cg_uniqueids, cg_card_last4)
  values ('${A}', '${t4}', 'deposit', 400, 'USD', 1500, 1, 'paid', '{uid-11111111}', '1111') returning id`)).rows[0].id;
await db.query(`insert into tours.payment_links (company_id, booking_id, kind, amount, currency, amount_ils, status, cg_uniqueids)
  values ('${A}', '${t4}', 'balance', 1500, 'USD', 5400, 'open', '{uid-22222222}')`);
check("link: bad uid", await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "no" }), { ok: false, error: "not_found" });
check("link: unknown uid", await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "uid-99999999" }), { ok: false, error: "not_found" });
check("link: another company", await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "uid-11111111" }, B), { ok: false, error: "not_found" });
check("link: not paid yet", await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "uid-22222222" }), { ok: false, error: "state" });
const paidLink = await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "uid-11111111" });
check("link: claims", paidLink, { ok: true, slot: `link:${link1}`, ref: "T4" });
check("link: tells the payment", paidLink.link, { kind: "deposit", amount: 400, currency: "USD", amount_ils: 1500, payments: 1, card_last4: "1111" });
check("link: second call nothing", await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "uid-11111111" }), { ok: true, already: true });
await db.query(`update tours.payment_links set status = 'paid' where kind = 'balance'`);
check("second link: its own slot", await call("customer_mail", { key: KEY, mail: "link_paid", uniqueid: "uid-22222222" }), { ok: true, ref: "T4" });
check("release a link slot", await call("customer_mail_release", { key: KEY, ref: "T4", slot: `link:${link1}` }), { ok: true });
check("the entry point still answers other actions", await call("nope", {}), { ok: false, error: "action" });

const mails = (await db.query(`select customer_mails from tours.bookings where ref='T4'`)).rows[0].customer_mails;
console.log("T4 slots:", Object.keys(mails).map((k) => k.split(":")[0]).sort().join(", "));

// the tour's fee rules travel with the answer, in the staff's order
await add("T10", "request", "new", "rules@example.com");
check("a tour without rules: an empty list", { rules: (await call("customer_mail", { key: KEY, mail: "request", ref: "T10" })).cancellation_rules }, { rules: [] });
await db.query(`insert into tours.cancellation_rules (company_id, package_id, component, until_days_before, fee_kind, fee_value, position)
  values ('${A}', '${pkg}', 'flight', null, 'percent', 100, 2), ('${A}', '${pkg}', 'flight', 30, 'per_pax', 200, 1)`);
await db.query(`insert into tours.cancellation_rules (company_id, package_id, component, until_days_before, fee_kind, fee_value, position)
  select '${B}', gen_random_uuid(), 'hotel', 1, 'per_order', 9, 0`);
await add("T11", "request", "new", "rules@example.com");
check("a tour's rules, only its own", { rules: (await call("customer_mail", { key: KEY, mail: "request", ref: "T11" })).cancellation_rules }, { rules: [{ fee_kind: "per_pax", component: "flight", fee_value: 200, until_days_before: 30 }, { fee_kind: "percent", component: "flight", fee_value: 100, until_days_before: null }] });

// an address a mail server would read as someone else than the one counted
await add("T20", "request", "new", "x<victim@example.com>");
await add("T21", "request", "new", "a,b@example.com");
check("a display name: skip", await call("customer_mail", { key: KEY, mail: "request", ref: "T20" }), { ok: true, skip: "no_email" });
check("a list: skip", await call("customer_mail", { key: KEY, mail: "request", ref: "T21" }), { ok: true, skip: "no_email" });

// 5 an hour to a mailbox, under its many spellings
const spellings = ["cap@example.com", "c.ap@example.com", "cap+1@example.com", "c.a.p+2@example.com", "cap@example.com"];
for (let i = 0; i < 5; i++) {
  await add(`T3${i}`, "request", "new", spellings[i]);
  check(`mailbox cap: mail ${i + 1} goes (${spellings[i]})`, await call("customer_mail", { key: KEY, mail: "request", ref: `T3${i}` }), { ok: true, slot: "request" });
}
await add("T35", "request", "new", "cap+3@example.com");
check("mailbox cap: the 6th stays out, whatever the spelling", await call("customer_mail", { key: KEY, mail: "request", ref: "T35" }), { ok: true, skip: "limit" });
check("over the cap claims nothing", (await db.query(`select customer_mails from tours.bookings where ref='T35'`)).rows[0], { customer_mails: {} });
await add("T36", "request", "new", "other-mailbox@example.com");
check("another mailbox still goes", await call("customer_mail", { key: KEY, mail: "request", ref: "T36" }), { ok: true, slot: "request" });
await add("T37", "request", "new", "cap@example.com", B);
check("another company's count is its own", await call("customer_mail", { key: KEY, mail: "request", ref: "T37" }, B), { ok: true, slot: "request" });

// a failed card page needs no money: it shares the count, and so does a charge kept for a check
await add("T40", "card", "failed", "cap@example.com");
check("a failed page over the cap stays out", await call("customer_mail", { key: KEY, mail: "failed", ref: "T40" }), { ok: true, skip: "limit" });
await add("T41", "card", "review", "cap@example.com");
check("a charge in review over the cap stays out", await call("customer_mail", { key: KEY, mail: "review", ref: "T41" }), { ok: true, skip: "limit" });
await add("T42", "card", "paid", "cap@example.com");
check("a paid order has no cap", await call("customer_mail", { key: KEY, mail: "paid", ref: "T42" }), { ok: true, slot: "paid" });
await add("T43", "card", "failed", "failed-only@example.com");
check("a failed page counts for its mailbox", await call("customer_mail", { key: KEY, mail: "failed", ref: "T43" }), { ok: true, slot: "failed" });

// the hour is of when the mail went out, not of when the order was made
await db.query(`update tours.bookings set created_at = now() - interval '2 hours' where ref like 'T3%'`);
check("old orders, fresh mails: still over the cap", await call("customer_mail", { key: KEY, mail: "request", ref: "T35" }), { ok: true, skip: "limit" });
await db.query(`update tours.bookings set customer_mails = jsonb_build_object('request', now() - interval '61 minutes') where ref = 'T30'`);
check("the hour passes", await call("customer_mail", { key: KEY, mail: "request", ref: "T35" }), { ok: true, slot: "request" });

// 60 an hour in the company, whatever the addresses; a checkout stocked up earlier is counted when it mails
await db.query(`insert into tours.bookings (company_id, ref, departure_id, kind, status, customer_email, customer_mails)
  select '${A}', 'T5' || g, '${dep}', 'request', 'new', 'many' || g || '@example.com', jsonb_build_object('request', now()) from generate_series(1, 60) g`);
await add("T400", "request", "new", "fresh@example.com");
check("company cap: rotating addresses stop too", await call("customer_mail", { key: KEY, mail: "request", ref: "T400" }), { ok: true, skip: "limit" });
await add("T401", "card", "failed", "fresh2@example.com");
await db.query(`update tours.bookings set created_at = now() - interval '3 hours' where ref = 'T401'`);
check("company cap: a stocked-up checkout stops too", await call("customer_mail", { key: KEY, mail: "failed", ref: "T401" }), { ok: true, skip: "limit" });

// one mailbox, many spellings
const key = async (e) => (await db.query(`select tours.mailbox_key($1) as k`, [e])).rows[0].k;
check("mailbox key", { a: await key(" Dana.Cohen+x@Mail.CO "), b: await key("danacohen@googlemail.com"), c: await key("danacohen@gmail.com") }, { a: "danacohen@mail.co", b: "danacohen@gmail.com", c: "danacohen@gmail.com" });

// the cancellation form: 3 an hour to a mailbox, 30 in the company; the lead being answered is already stored
const lead = (email, company = A) => db.query(`insert into public.leads (company_id, kind, email) values ($1, 'cancellation', $2)`, [company, email]);
check("cancellation: the key", await call("cancellation_mail_ok", { email: "c@example.com" }), { ok: false, error: "forbidden" });
check("cancellation: not a plain address", await call("cancellation_mail_ok", { key: KEY, email: "x<c@example.com>" }), { ok: true, allowed: false });
for (let i = 1; i <= 3; i++) {
  await lead("c@example.com");
  check(`cancellation: request ${i} may mail`, await call("cancellation_mail_ok", { key: KEY, email: "C@Example.com" }), { ok: true, allowed: true });
}
await lead("c+1@example.com");
check("cancellation: the 4th may not, whatever the spelling", await call("cancellation_mail_ok", { key: KEY, email: "c+1@example.com" }), { ok: true, allowed: false });
await db.query(`insert into public.leads (company_id, kind, email) values ('${A}', 'contact', 'd@example.com'), ('${B}', 'cancellation', 'd@example.com')`);
await lead("d@example.com");
check("cancellation: another form or company does not count", await call("cancellation_mail_ok", { key: KEY, email: "d@example.com" }), { ok: true, allowed: true });
await db.query(`update public.leads set created_at = now() - interval '61 minutes' where email in ('c@example.com', 'c+1@example.com')`);
check("cancellation: the hour passes", await call("cancellation_mail_ok", { key: KEY, email: "c@example.com" }), { ok: true, allowed: true });
await db.query(`insert into public.leads (company_id, kind, email) select '${A}', 'cancellation', 'x' || g || '@example.com' from generate_series(1, 30) g`);
await lead("e@example.com");
check("cancellation: company cap", await call("cancellation_mail_ok", { key: KEY, email: "e@example.com" }), { ok: true, allowed: false });

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
