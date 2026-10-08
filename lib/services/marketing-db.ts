/* eslint-disable @typescript-eslint/no-explicit-any */
// The ONE untyped boundary for the marketing tables (types/marketing.types.ts carries the
// shapes) until `npm run db:types` is rerun after migration 20261008120000 is applied.
import { supabase } from "@/lib/supabase-server";

export const mdb = supabase as any;
