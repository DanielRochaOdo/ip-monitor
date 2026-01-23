import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getRequiredEnv } from "@/lib/env";

const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
