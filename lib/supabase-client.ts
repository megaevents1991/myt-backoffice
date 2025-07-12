import { createClient } from "@supabase/supabase-js"

// Client-side Supabase client - used in client components
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables")
}

// Create a single instance of the Supabase client to be used across client components
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
