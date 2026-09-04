/* app/api/cron/ingest/route.ts */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchSpreads, weekFromKickoff, currentSeason, isRegularSeason, propDeadline } from "@/lib/providers/odds-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pull current spreads and append a snapshot per game.
 *
 * Snapshots are append-only. That gives you three things for free: a line
 * movement chart, the closing number that CLV is measured against, and an
 * audit trail for the week someone insists the line was different when they
 * picked. Storage cost for a season is trivial.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const season = currentSeason();

  let games;
  try {
    // Preseason and any stray non-regular-season events are dropped here
    // rather than being clamped into Week 1.
    games = (await fetchSpreads()).filter((g) => isRegularSeason(g.kickoff));
  } catch (error) {
    console.error("[ingest] provider failed", error);
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }

  if (games.length === 0) {
    return NextResponse.json({ ok: true, games: 0, note: "no lines posted" });
  }

  const { error: gamesError } = await db.from("games").upsert(
    games.map((g) => ({
      id: g.id,
      season,
      week: weekFromKickoff(g.kickoff),
      home: g.home,
      away: g.away,
      kickoff: g.kickoff,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "id", ignoreDuplicates: false }
  );
  if (gamesError) {
    console.error("[ingest] games upsert", gamesError);
    return NextResponse.json({ error: gamesError.message }, { status: 500 });
  }

  const capturedAt = new Date().toISOString();
  const { error: linesError } = await db.from("line_snapshots").insert(
    games.map((g) => ({
      game_id: g.id,
      captured_at: capturedAt,
      home_spread: g.homeSpread,
      home_price: g.homePrice,
      away_spread: g.awaySpread,
      away_price: g.awayPrice,
      book: g.book,
    }))
  );
  if (linesError) {
    console.error("[ingest] snapshot insert", linesError);
    return NextResponse.json({ error: linesError.message }, { status: 500 });
  }

  // Props lock Sunday 1pm ET. Written on every run rather than once, so the
  // deadline self-corrects if the season anchor is ever adjusted.
  const weeks = new Set(games.map((g) => weekFromKickoff(g.kickoff)));
  await db.from("week_config").upsert(
    [...weeks].map((week) => ({
      season,
      week,
      prop_deadline: propDeadline(week),
    })),
    { onConflict: "season,week" }
  );

  return NextResponse.json({ ok: true, games: games.length, capturedAt });
}
