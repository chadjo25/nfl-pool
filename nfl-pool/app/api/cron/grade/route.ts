/* app/api/cron/grade/route.ts */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchScores, matchGame } from "@/lib/providers/espn";
import { gradeSpread } from "@/lib/odds";
import { currentSeason } from "@/lib/providers/odds-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Grade every ungraded spread pick whose game has finished.
 *
 * Idempotent: it only touches picks where `result is null`, so running it
 * hourly through Monday night is safe and a stat correction that arrives
 * late gets picked up on the next pass.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const season = currentSeason();

  // Games that have kicked off but aren't marked final yet.
  const { data: pending, error } = await db
    .from("games")
    .select("id, week, home, away")
    .eq("season", season)
    .neq("status", "final")
    .lt("kickoff", new Date().toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pending?.length) return NextResponse.json({ ok: true, graded: 0 });

  const weeks = [...new Set(pending.map((g) => g.week))];
  const scoresByWeek = new Map<number, Awaited<ReturnType<typeof fetchScores>>>();
  for (const week of weeks) {
    try {
      scoresByWeek.set(week, await fetchScores(season, week));
    } catch (e) {
      console.error(`[grade] ESPN week ${week}`, e);
    }
  }

  let gamesFinal = 0;
  let picksGraded = 0;

  for (const game of pending) {
    const score = matchGame(scoresByWeek.get(game.week) ?? [], game.home, game.away);

    // `completed` rather than merely ended — ESPN finalises up to an hour
    // after the whistle, and that window is when stat corrections land.
    if (!score?.completed) continue;

    await db
      .from("games")
      .update({
        home_score: score.homeScore,
        away_score: score.awayScore,
        status: "final",
        updated_at: new Date().toISOString(),
      })
      .eq("id", game.id);
    gamesFinal++;

    const { data: picks } = await db
      .from("spread_picks")
      .select("id, side, locked_spread")
      .eq("game_id", game.id)
      .is("result", null);

    for (const pick of picks ?? []) {
      const result = gradeSpread(
        pick.side as "home" | "away",
        Number(pick.locked_spread),
        score.homeScore,
        score.awayScore
      );
      await db
        .from("spread_picks")
        .update({ result, graded_at: new Date().toISOString() })
        .eq("id", pick.id);
      picksGraded++;
    }
  }

  return NextResponse.json({ ok: true, gamesFinal, picksGraded });
}
