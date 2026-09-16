import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

// Cache for the Supabase client instance
let supabaseInstance: ReturnType<typeof createClient> | null = null;

// Lazy initialization of Supabase client - only creates the client when actually needed
function getSupabaseClient() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false, // Don't persist session on server
    },
  });

  return supabaseInstance;
}

// Export the lazy client getter
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(target, prop) {
    const client = getSupabaseClient();
    const value = client[prop as keyof typeof client];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

// The same client, typed against the generated schema (types/database.types.ts,
// `npm run db:types`). `supabase` above is untyped, so its rows resolve to `never` and
// older callers cast it to `any`; new code should use this one instead.
export const supabaseTyped = supabase as unknown as SupabaseClient<Database>;

