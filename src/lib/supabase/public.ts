import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnvironment } from "@/lib/supabase/env";

export function createPublicClient() {
  const { url, publishableKey } = getSupabaseEnvironment();

  return createSupabaseClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
