/* app/api/cron/remind/route.ts */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { currentSeason } from "@/lib/providers/odds-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nudge anyone with picks still outstanding, on the morning of a game day.
 *
 * This used to fire on Thursday and Sunday only, which is wrong on any week
 * with an unusual slate — Thanksgiving week has games Wednesday, Thursday,
 * Friday, Sunday and Monday. Now it looks at the actual schedule: if games
 * kick off later today and someone still has picks open, they hear about it.
 *
 * The window is a few hours wide because GitHub and most free schedulers run
 * jobs late, and reminder_log keys on the date so a wide window still produces
 * at most one email per person per day.
 */
const MORNING = [7, 8, 9, 10, 11];

function denverNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
  };
}

/** Calendar date in Denver for any timestamp. */
const denverDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";

  const { date: today, hour } = denverNow();
  const slot = today;
  if (!force && !MORNING.includes(hour)) {
    return NextResponse.json({ ok: true, skipped: `${hour}:00 MT — outside the morning window` });
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

  const { data: weekGames } = await db
    .from("games").select("id, away, home, kickoff")
    .eq("season", season).eq("week", week).order("kickoff");

  const now = Date.now();
  const all = weekGames ?? [];
  const stillOpen = all.filter((g) => new Date(g.kickoff).getTime() > now);
  const todayGames = stillOpen.filter((g) => denverDate(g.kickoff) === today);

  // Only nudge on days that actually have football left to play.
  if (!force && todayGames.length === 0) {
    return NextResponse.json({ ok: true, week, skipped: "no games left to kick off today" });
  }
  if (stillOpen.length === 0) {
    return NextResponse.json({ ok: true, week, skipped: "every game has started" });
  }

  const lastGame = all[all.length - 1];
  const tiebreakOpen = lastGame ? new Date(lastGame.kickoff).getTime() > now : false;
  const openIds = new Set(stillOpen.map((g) => g.id));

  const [profiles, spreads, tiebreaks, users] = await Promise.all([
    db.from("profiles").select("id, display_name"),
    db.from("spread_picks").select("profile_id, game_id, is_lock").eq("season", season).eq("week", week),
    db.from("tiebreak_guesses").select("profile_id").eq("season", season).eq("week", week),
    db.auth.admin.listUsers(),
  ]);

  const emailOf = new Map<string, string>(
    (users.data?.users ?? []).map((u: { id: string; email?: string }) => [u.id, u.email ?? ""])
  );
  const guessed = new Set((tiebreaks.data ?? []).map((t) => t.profile_id));

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nfl-pool-eight.vercel.app";

  // Claim the slot before sending. The primary key means a second run inside
  // the same window loses the race and exits, so a delayed or duplicated run
  // can't double-mail anyone.
  //
  // Only a duplicate-key error means "already sent". Anything else is a real
  // failure and has to be loud: this previously returned the same cheerful
  // "already sent" for both, so a broken claim looked exactly like a normal
  // no-op and two weeks of reminders went missing without a single error
  // anywhere. A non-200 here fails the cron job, which is the point.
  if (!force && !dry) {
    const { error: claimed } = await db
      .from("reminder_log").insert({ season, week, slot });

    if (claimed?.code === "23505") {
      return NextResponse.json({ ok: true, week, slot, skipped: "already sent today" });
    }
    if (claimed) {
      console.error("[remind] could not claim slot", claimed);
      return NextResponse.json(
        { ok: false, week, slot, error: `Could not claim the slot: ${claimed.message}` },
        { status: 500 }
      );
    }
  }

  const results: { name: string; missing: string[]; sent: boolean }[] = [];

  for (const p of profiles.data ?? []) {
    const mine = (spreads.data ?? []).filter((s) => s.profile_id === p.id);
    const picked = new Set(mine.map((s) => s.game_id));

    // Only count games they can still act on. Nagging about a game that
    // kicked off two days ago is noise — that one is already scored.
    const unpicked = stillOpen.filter((g) => !picked.has(g.id));

    const missing: string[] = [];
    if (unpicked.length > 0) {
      missing.push(`${unpicked.length} spread${unpicked.length === 1 ? "" : "s"}`);
    }
    if (!mine.some((s) => s.is_lock)) missing.push("your lock");
    if (tiebreakOpen && !guessed.has(p.id)) missing.push("the tiebreaker");

    // Nobody needs an email telling them they're already done.
    if (missing.length === 0) continue;

    const email = emailOf.get(p.id);
    if (!email) continue;

    const kickingOff = todayGames
      .map((g) => `${g.away} @ ${g.home}`)
      .slice(0, 4)
      .join(", ");

    const body = `
      <div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#16191A">
        <p>${p.display_name} — football today: ${kickingOff}${todayGames.length > 4 ? " and more" : ""}.</p>
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
          subject: `${todayGames.length} game${todayGames.length === 1 ? "" : "s"} today — ${missing[0]} outstanding`,
          htmlContent: body,
        }),
      });
      if (!res.ok) console.error(`[remind] ${email}: ${res.status} ${await res.text()}`);
      results.push({ name: p.display_name, missing, sent: res.ok });
    } else {
      results.push({ name: p.display_name, missing, sent: false });
    }
  }

  const sent = results.filter((r) => r.sent).length;
  const failed = results.filter((r) => !r.sent).length;

  if (!force && !dry) {
    await db.from("reminder_log")
      .update({ count: sent })
      .eq("season", season).eq("week", week).eq("slot", slot);
  }

  // Everyone bounced means the mail provider is down or the key is wrong.
  // The slot is already claimed at this point, so without a loud failure here
  // the day would be silently written off.
  if (!dry && failed > 0 && sent === 0) {
    console.error(`[remind] all ${failed} sends failed`);
    return NextResponse.json(
      { ok: false, week, slot, error: `All ${failed} reminder emails failed to send`, reminded: results },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, week, slot, dry, sent, failed, reminded: results });
}
