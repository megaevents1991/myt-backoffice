// scripts/tours-customer-mail-sql-pglite-test.mjs - `node scripts/tours-customer-mail-sql-pglite-test.mjs`
//
// The SQL test of migration 20261030180000_tours_booking_customer_mail.sql, on an in-process Postgres (PGlite): stub
// tables with the columns the mail functions touch, the real tours.booking_key_ok's rule, then the migration, then the
// scenarios through tours.site_booking - the key, another company's order, a mail that is not true of the order, the
// claim (a second call mails nothing, a release frees it, a failed page then a paid one each get their own), a payment
// link's own slot, and a birth date never in the answer.
//
// Needs @electric-sql/pglite: `npm i --no-save @electric-sql/pglite` in the repo, or point PGLITE_PATH at an
// install elsewhere (the package directory). No network, no prod.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const pglitePath = process.env.PGLITE_PATH;
const { PGlite } = await import(pglitePath ? pathToFileURL(`${pglitePath.replace(/[\\/]$/, "")}/dist/index.js`).href : "@electric-sql/pglite");

const MIGRATION = `${process.cwd()}/supabase/migrations/20261030180000_tours_booking_customer_mail.sql`;
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
    discount numeric default 0, total numeric default 0, customer_name text, customer_email text, total_ils numeric, payments int, cg_card_last4 text, is_deleted date);
  create table tours.payment_links (id uuid primary key default gen_random_uuid(), company_id uuid, booking_id uuid, kind text, amount numeric, currency text, amount_ils numeric,
    payments smallint default 1, status text default 'open', cg_uniqueids text[] default '{}', cg_card_last4 text);
  create function tours.booking_key_ok(p_company uuid, p_key text) returns boolean language sql stable as $$
    select coalesce(length(p_key) >= 32 and encode(sha256(convert_to(p_key, 'UTF8')), 'hex') = (select payment_config->>'site_key_sha256' from public.companies where id = p_company), false) $$;
`);
await db.exec(readFileSync(MIGRATION, "utf8"));

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
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
