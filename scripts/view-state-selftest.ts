// scripts/view-state-selftest.ts - `npx tsx scripts/view-state-selftest.ts`
// The pure rules behind "a refresh keeps my place" (lib/view-state.ts). The hooks
// that read the URL and sessionStorage are verified in the browser.
import { parseStored, readParam, tableStateKey, viewStateKey, withParam } from "../lib/view-state";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

// --- URL: which tab / view am I on -------------------------------------------------------
check("set adds the param", withParam("", "tab", "kanban", "tasks"), "?tab=kanban");
check("set keeps the other params", withParam("?board=dev", "tab", "kanban", "tasks"), "?board=dev&tab=kanban");
check("set replaces its own value", withParam("?tab=kanban&board=dev", "tab", "roadmap", "tasks"), "?tab=roadmap&board=dev");
check("the default is not written", withParam("?tab=kanban", "tab", "tasks", "tasks"), "");
check("the default leaves the others", withParam("?tab=kanban&board=dev", "tab", "tasks", "tasks"), "?board=dev");
check("null clears", withParam("?comp=golasso", "comp", null), "");
check("empty clears", withParam("?view=done", "view", "", "open"), "");
check("hebrew survives", readParam(withParam("", "q", "מנצ'סטר"), "q", ""), "מנצ'סטר");

check("read finds the value", readParam("?tab=kanban", "tab", "tasks"), "kanban");
check("read falls back when absent", readParam("?board=dev", "tab", "tasks"), "tasks");
check("read rejects a value off the list", readParam("?tab=hacked", "tab", "tasks", ["tasks", "kanban"]), "tasks");
check("read accepts a value on the list", readParam("?tab=kanban", "tab", "tasks", ["tasks", "kanban"]), "kanban");
check("read without a leading ?", readParam("tab=kanban", "tab", "tasks"), "kanban");

// --- sessionStorage: how I narrowed the list ---------------------------------------------
check("key is per screen", viewStateKey("/events", "hideSold"), "myt:view:/events:hideSold");
check("another screen, another key", viewStateKey("/tasks", "owner") === viewStateKey("/events", "owner"), false);

check("nothing stored = the default", parseStored(null, false), false);
check("stored boolean", parseStored("true", false), true);
check("stored string", parseStored('"mine"', "all"), "mine");
check("broken JSON = the default", parseStored("{oops", "all"), "all");
check("wrong type = the default", parseStored('"yes"', false), false);
check("array where an object is expected", parseStored("[1,2]", { pageIndex: 0, pageSize: 25 }), { pageIndex: 0, pageSize: 25 });
check("object where an array is expected", parseStored('{"id":"x"}', [] as unknown[]), []);
check("stored page", parseStored('{"pageIndex":3,"pageSize":50}', { pageIndex: 0, pageSize: 25 }), { pageIndex: 3, pageSize: 50 });
check("a field of the wrong type drops the whole value",
  parseStored('{"pageIndex":"3","pageSize":50}', { pageIndex: 0, pageSize: 25 }), { pageIndex: 0, pageSize: 25 });
check("a missing field drops the whole value",
  parseStored('{"pageIndex":3}', { pageIndex: 0, pageSize: 25 }), { pageIndex: 0, pageSize: 25 });
check("an open map accepts any keys", parseStored('{"tags":false}', {} as Record<string, boolean>), { tags: false });
check("stored sorting", parseStored('[{"id":"id","desc":true}]', [] as { id: string; desc: boolean }[]), [{ id: "id", desc: true }]);
check("a validator has the last word",
  parseStored('"user:42"', "all", (v): v is string => typeof v === "string" && (v === "all" || v.startsWith("user:"))), "user:42");
check("a validator can refuse",
  parseStored('"everyone"', "all", (v): v is string => typeof v === "string" && (v === "all" || v.startsWith("user:"))), "all");
check("null default needs a validator to accept a value", parseStored('"golasso"', null), null);
check("null default with a validator",
  parseStored('"golasso"', null as string | null, (v): v is string | null => v === null || typeof v === "string"), "golasso");

// --- a table's own key -------------------------------------------------------------------
check("same columns, same key", tableStateKey(["id", "name", "date"]), tableStateKey(["id", "name", "date"]));
check("other columns, other key", tableStateKey(["id", "name"]) === tableStateKey(["id", "email"]), false);
check("order matters", tableStateKey(["a", "b"]) === tableStateKey(["b", "a"]), false);
check("key is short and plain", /^[a-z0-9]{1,8}$/.test(tableStateKey(["id", "name", "date", "actions"])), true);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
