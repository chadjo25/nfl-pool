/* app/api/cron/remind/route.ts */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { currentSeason } from "@/lib/providers/odds-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nudge anyone with picks outstanding.
 *
 * Thursday 9:30am and Sunday 8:30am Mountain. GitHub's scheduler only speaks
 * UTC and doesn't know about daylight saving, so the workflow fires at both
 * candidate hours and this route decides whether it's actually the right
 * local time. Half the runs exit immediately, which costs nothing.
 */
const SCHEDULE: Record<string, number> = { Thu: 9, Sun: 8 };

function denverNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")) % 24 };
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";

  const { weekday, hour } = denverNow();
  if (!force && SCHEDULE[weekday] !== hour) {
    return NextResponse.json({ ok: true, skipped: `${weekday} ${hour}:00 MT` });
  }

  const key = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!key || !from) {
    return NextResponse.json({ error: "BREVO_API_KEY or BREVO_SENDER_EMAIL missing" }, { status: 500 });
  }

  const db = createAdminClient();
  const season = currentSeason();

  // The week people are picking: earliest with an unplayed game.
  const { data: open } = await db
    .from("games").select("week")
    .eq("season", season).neq("status", "final")
    .order("kickoff").limit(1).maybeSingle();
  if (!open) return NextResponse.json({ ok: true, note: "no open week" });
  const week = open.week;

  const [{ count: totalGames }, profiles, spreads, tiebreaks, users] = await Promise.all([
    db.from("games").select("id", { count: "exact", head: true })
      .eq("season", season).eq("week", week),
    db.from("profiles").select("id, display_name"),
    db.from("spread_picks").select("profile_id, is_lock").eq("season", season).eq("week", week),
    db.from("tiebreak_guesses").select("profile_id").eq("season", season).eq("week", week),
    db.auth.admin.listUsers(),
  ]);

  const emailOf = new Map<string, string>(
    (users.data?.users ?? []).map((u: { id: string; email?: string }) => [u.id, u.email ?? ""])
  );
  const guessed = new Set((tiebreaks.data ?? []).map((t) => t.profile_id));
  const games = totalGames ?? 0;

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nfl-pool-eight.vercel.app";
  const results: { name: string; missing: string[]; sent: boolean }[] = [];

  for (const p of profiles.data ?? []) {
    const mine = (spreads.data ?? []).filter((s) => s.profile_id === p.id);
    const missing: string[] = [];
    if (mine.length < games) missing.push(`${games - mine.length} of ${games} spreads`);
    if (!mine.some((s) => s.is_lock)) missing.push("your lock");
    if (!guessed.has(p.id)) missing.push("the tiebreaker");

    // Nobody needs an email telling them they're already done.
    if (missing.length === 0) continue;

    const email = emailOf.get(p.id);
    if (!email) continue;

    const body = `
      <div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#16191A">
        <p>${p.display_name} — Week ${week} picks are still open.</p>
        <p><strong>You're missing ${missing.join(", ")}.</strong></p>
        <p>Each game locks at its own kickoff, so anything you haven't picked
           by then scores as a loss.</p>
        <p><a href="${site}/picks"
              style="background:#16191A;color:#EDE9DE;padding:10px 18px;
                     border-radius:3px;text-decoration:none;display:inline-block">
           Make your picks</a></p>
      </div>`;

    if (!dry) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: process.env.BREVO_SENDER_NAME ?? "Dick Picks 2026", email: from },
          to: [{ email, name: p.display_name }],
          subject: `Week ${week} picks — ${missing[0]} outstanding`,
          htmlContent: body,
        }),
      });
      if (!res.ok) console.error(`[remind] ${email}: ${res.status} ${await res.text()}`);
      results.push({ name: p.display_name, missing, sent: res.ok });
    } else {
      results.push({ name: p.display_name, missing, sent: false });
    }
  }

  return NextResponse.json({ ok: true, week, dry, reminded: results });
}
