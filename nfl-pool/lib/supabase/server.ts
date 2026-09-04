/* lib/supabase/server.ts */
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Shape of the cookies Supabase hands back for us to persist.
 * Declared explicitly because TypeScript can't infer callback parameters
 * from this position, and `strict` mode refuses to guess.
 */
type CookieToSet = { name: string; value: string; options?: any };

/** Request-scoped client. Runs as the signed-in user, so RLS applies. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: CookieToSet[]) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. Bypasses RLS entirely — cron jobs only.
 * Never import this into anything that renders.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
