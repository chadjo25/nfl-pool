/* app/auth/callback/route.ts */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing point.
 *
 * The exchange can fail for reasons that have nothing to do with the user
 * doing anything wrong — a corporate mail scanner that pre-fetched the link
 * and burned the one-time code, or a link opened in a different browser from
 * the one that requested it. Both used to dump people back at a blank login
 * form with no explanation, which is indistinguishable from the link simply
 * not working. Pass the real reason through so the page can say something.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Supabase reports some failures on the inbound URL before we even start.
  const inboundError = searchParams.get("error_description") ?? searchParams.get("error");
  if (inboundError) {
    return NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent(inboundError)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent("No sign-in code was in that link.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/picks`);
}
