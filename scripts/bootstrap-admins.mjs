// Usage: node scripts/bootstrap-admins.mjs <email> <password> [display_name] [role]
// role: "admin" (default) or "superadmin" (can manage admin accounts).
// Reads .env.local for Supabase URL + service-role key. Run once per admin.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);

const [email, password, displayName, roleArg] = process.argv.slice(2);
if (!email || !password) {
  console.error(
    "Usage: node scripts/bootstrap-admins.mjs <email> <password> [display_name] [role=admin|superadmin]",
  );
  process.exit(1);
}
const role = roleArg ?? "admin";
if (!["admin", "superadmin"].includes(role)) {
  console.error(`Invalid role "${role}" - use "admin" or "superadmin".`);
  process.exit(1);
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: created, error: authError } =
  await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
if (authError) {
  console.error("Auth user creation failed:", authError.message);
  process.exit(1);
}

const { error: profileError } = await supabase.from("user_profiles").insert({
  id: created.user.id,
  email: email.toLowerCase(),
  display_name: displayName ?? null,
  role,
  is_active: true,
});
if (profileError) {
  console.error("Profile insert failed:", JSON.stringify(profileError));
  await supabase.auth.admin.deleteUser(created.user.id);
  process.exit(1);
}

console.log(`${role} created: ${email} (${created.user.id})`);
