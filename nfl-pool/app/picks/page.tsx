/* app/picks/page.tsx */
import { createClient } from "@/lib/supabase/server";
import { getOpenGames } from "@/lib/standings";
import { currentSeason } from "@/lib/providers/odds-provider";
import PicksClient, { type PropPick } from "./PicksClient";

export const dynamic = "force-dynamic";

/** The current week = the earliest week that still has an unplayed game. */
async function currentWeek(season: number) {
  const db = await createClient();
  const { data } = await db
    .from("games").select("week")
    .eq("season", season).neq("status", "final")
    .order("kickoff").limit(1).maybeSingle();
  return data?.week ?? 1;
}

export default async function PicksPage() {
  const db = await createClient();
  const season = currentSeason();
  const week = await currentWeek(season);
  const { data: { user } } = await db.auth.getUser();

  const games = await getOpenGames(season, week);

  const { data: spreads } = await db
    .from("spread_picks").select("game_id, side, is_lock").eq("profile_id", user!.id);
  const spreadPicks = Object.fromEntries(
    (spreads ?? []).map((s) => [s.game_id, s.side as "home" | "away"])
  );
  const lockGameId = (spreads ?? []).find((s) => s.is_lock)?.game_id ?? null;

  const { data: guess } = await db
    .from("tiebreak_guesses").select("points")
    .eq("profile_id", user!.id).eq("season", season).eq("week", week).maybeSingle();

  const { data: props } = await db
    .from("prop_picks")
    .select("kind, label, price, other_price, proof_url, game_id")
    .eq("profile_id", user!.id).eq("season", season).eq("week", week);
  const propPicks = Object.fromEntries(
    (props ?? []).map((p) => [p.kind, { ...p, kind: p.kind as "td" | "prop" }])
  ) as Partial<Record<"td" | "prop", PropPick>>;

  const { data: config } = await db
    .from("week_config").select("prop_deadline")
    .eq("season", season).eq("week", week).maybeSingle();
  const weeklyDeadlinePassed = config
    ? new Date(config.prop_deadline) <= new Date()
    : false;

  return (
    <PicksClient
      games={games} spreadPicks={spreadPicks} propPicks={propPicks}
      season={season} week={week} weeklyDeadlinePassed={weeklyDeadlinePassed}
      lockGameId={lockGameId} tiebreakGuess={guess?.points ?? null}
    />
  );
}
