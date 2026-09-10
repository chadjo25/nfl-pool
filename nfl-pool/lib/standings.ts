/* lib/standings.ts */
import { createClient } from "./supabase/server";

/**
 * Supabase returns at most 1000 rows per request, and silently — a truncated
 * result looks exactly like a complete one. Five players over a full season
 * produce well past that in spread picks alone, so anything unbounded has to
 * page through explicitly rather than trust a single call.
 */
const PAGE = 1000;
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}
import {
  buildStandings, propMetrics, spreadMetrics,
  type PlayerSeason, type Standing, type ScoringModel,
} from "./scoring";

/**
 * Assemble season standings.
 *
 * Reads through RLS as the signed-in user, so a player who hasn't hit the
 * deadline yet simply won't see other people's unlocked picks — the numbers
 * fill in as the week locks rather than leaking early.
 */
export async function getStandings(
  season: number,
  model: ScoringModel = "capped"
): Promise<Standing[]> {
  const db = await createClient();

  const [profiles, spreads, props, closings] = await Promise.all([
    db.from("profiles").select("id, display_name"),
    fetchAll<{ profile_id: string; game_id: string; side: string; locked_spread: number; result: string | null }>(
      (from, to) => db.from("spread_picks")
        .select("profile_id, game_id, side, locked_spread, result")
        .eq("season", season).range(from, to)
    ),
    db.from("prop_picks").select("profile_id, kind, price, other_price, result").eq("season", season),
    fetchAll<{ game_id: string; home_spread: number; away_spread: number }>(
      (from, to) => db.from("closing_lines")
        .select("game_id, home_spread, away_spread").range(from, to)
    ),
  ]);

  const closingBySide = new Map<string, { home: number; away: number }>();
  for (const row of closings) {
    closingBySide.set(row.game_id, {
      home: Number(row.home_spread),
      away: Number(row.away_spread),
    });
  }

  const players: PlayerSeason[] = (profiles.data ?? []).map((profile) => {
    const mySpreads = spreads
      .filter((s) => s.profile_id === profile.id)
      .map((s) => {
        const closing = closingBySide.get(s.game_id);
        return {
          result: s.result as "win" | "loss" | "push" | null,
          lockedSpread: Number(s.locked_spread),
          closingSpread: closing ? (s.side === "home" ? closing.home : closing.away) : null,
        };
      });

    const myProps = (props.data ?? []).filter((p) => p.profile_id === profile.id);
    const forKind = (kind: "td" | "prop") =>
      myProps
        .filter((p) => p.kind === kind)
        .map((p) => ({
          price: p.price,
          otherPrice: p.other_price,
          result: p.result as "win" | "loss" | "void" | null,
        }));

    return {
      profileId: profile.id,
      displayName: profile.display_name,
      spreads: spreadMetrics(mySpreads),
      td: propMetrics(forKind("td"), model),
      props: propMetrics(forKind("prop"), model),
    };
  });

  return buildStandings(players);
}

/** Games open for picking, with the line as of right now. */
export async function getOpenGames(season: number, week: number) {
  const db = await createClient();
  const { data: games } = await db
    .from("games")
    .select("id, home, away, kickoff, status")
    .eq("season", season)
    .eq("week", week)
    .order("kickoff");

  if (!games?.length) return [];

  // One row per game, straight from the view. Fetching every snapshot and
  // reducing in code hit the 1000-row cap and silently dropped games.
  const { data: lines } = await db
    .from("latest_lines")
    .select("game_id, home_spread, home_price, away_spread, away_price")
    .in("game_id", games.map((g) => g.id));

  const latest = new Map<string, NonNullable<typeof lines>[number]>();
  for (const line of lines ?? []) latest.set(line.game_id, line);

  return games.map((game) => ({
    ...game,
    locked: new Date(game.kickoff) <= new Date(),
    line: latest.get(game.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Week-by-week spread results
// ---------------------------------------------------------------------------

export type WeekRecord = {
  wins: number; losses: number; pushes: number; pct: number;
  /** Game their lock landed on, whether chosen or defaulted. */
  lockGameId: string | null;
  lockChosen: boolean;
};

export type WeekRow = {
  week: number;
  complete: boolean;
  records: Map<string, WeekRecord>;
  /** Who takes the week. Empty until every game is final; >1 means unresolved. */
  winners: string[];
  /** How the winner was determined, for display. */
  via: "record" | "tiebreak" | "unresolved" | "pending";
  /** Total points in the last game, once it's final. */
  tiebreakTotal: number | null;
  tiebreakGame: string | null;
  guesses: Map<string, number>;
};

/**
 * Spread results by week, with the lock and the tiebreaker applied.
 *
 * The lock counts double either way. A pushed lock voids instead of doubling —
 * a push is the market being exactly right, and twice nothing is nothing.
 * Anyone who didn't set one has it default to the last game of the week, so
 * forgetting is never an advantage.
 *
 * A week only names a winner once all its games are final. If two players tie
 * at the top, the total-points guess on the last game breaks it: closest to the
 * real number takes it, and submitting nothing loses the tiebreak outright.
 */
export async function getWeeklySpreadResults(season: number): Promise<WeekRow[]> {
  const db = await createClient();

  const [games, picks, tiebreaks] = await Promise.all([
    fetchAll<{ id: string; week: number; status: string; kickoff: string; home: string; away: string; home_score: number | null; away_score: number | null }>(
      (from, to) => db.from("games")
        .select("id, week, status, kickoff, home, away, home_score, away_score")
        .eq("season", season).range(from, to)
    ),
    fetchAll<{ profile_id: string; game_id: string; result: string | null; is_lock: boolean }>(
      (from, to) => db.from("spread_picks")
        .select("profile_id, game_id, result, is_lock")
        .eq("season", season).range(from, to)
    ),
    db.from("tiebreak_guesses").select("profile_id, week, points").eq("season", season),
  ]);

  const weekOf = new Map<string, number>();
  const weeksSeen = new Map<number, { total: number; final: number }>();
  const lastGameOf = new Map<number, { id: string; kickoff: string; label: string; total: number | null }>();

  for (const g of games) {
    weekOf.set(g.id, g.week);
    const tally = weeksSeen.get(g.week) ?? { total: 0, final: 0 };
    tally.total++;
    if (g.status === "final") tally.final++;
    weeksSeen.set(g.week, tally);

    const current = lastGameOf.get(g.week);
    if (!current || g.kickoff > current.kickoff) {
      lastGameOf.set(g.week, {
        id: g.id,
        kickoff: g.kickoff,
        label: `${g.away} @ ${g.home}`,
        total: g.status === "final" && g.home_score != null && g.away_score != null
          ? g.home_score + g.away_score
          : null,
      });
    }
  }

  const guessesByWeek = new Map<number, Map<string, number>>();
  for (const t of tiebreaks.data ?? []) {
    const m = guessesByWeek.get(t.week) ?? new Map<string, number>();
    m.set(t.profile_id, t.points);
    guessesByWeek.set(t.week, m);
  }

  // Group each player's picks by week so the lock can be applied per week.
  type Pick = { game_id: string; result: string | null; is_lock: boolean };
  const byWeekPlayer = new Map<number, Map<string, Pick[]>>();
  for (const pick of picks) {
    const week = weekOf.get(pick.game_id);
    if (week === undefined) continue;
    const players = byWeekPlayer.get(week) ?? new Map<string, Pick[]>();
    const list = players.get(pick.profile_id) ?? [];
    list.push({ game_id: pick.game_id, result: pick.result, is_lock: pick.is_lock });
    players.set(pick.profile_id, list);
    byWeekPlayer.set(week, players);
  }

  const rows: WeekRow[] = [];
  for (const [week, tally] of weeksSeen) {
    const complete = tally.total > 0 && tally.final === tally.total;
    const last = lastGameOf.get(week) ?? null;
    const guesses = guessesByWeek.get(week) ?? new Map<string, number>();
    const records = new Map<string, WeekRecord>();

    for (const [profileId, list] of byWeekPlayer.get(week) ?? []) {
      const chosen = list.find((p) => p.is_lock)?.game_id ?? null;
      // Forgetting to set one defaults to the last game, so it's never free.
      const lockGameId = chosen ?? (list.some((p) => p.game_id === last?.id) ? last!.id : null);

      let wins = 0, losses = 0, pushes = 0;
      for (const p of list) {
        if (p.result === "push") { pushes += 1; continue; }   // a pushed lock voids
        const weight = p.game_id === lockGameId ? 2 : 1;
        if (p.result === "win") wins += weight;
        else if (p.result === "loss") losses += weight;
      }
      const decided = wins + losses + pushes;
      records.set(profileId, {
        wins, losses, pushes,
        pct: decided > 0 ? (wins + pushes / 2) / decided : 0,
        lockGameId,
        lockChosen: chosen != null,
      });
    }

    let winners: string[] = [];
    let via: WeekRow["via"] = "pending";

    if (complete && records.size > 0) {
      const best = Math.max(...[...records.values()].map((r) => r.pct));
      const tied = [...records].filter(([, r]) => r.pct === best).map(([id]) => id);

      if (tied.length === 1) {
        winners = tied;
        via = "record";
      } else if (last?.total != null) {
        // Closest guess takes it. No guess is treated as infinitely far off,
        // so skipping it can never be the safe play.
        const distance = (id: string) =>
          guesses.has(id) ? Math.abs(guesses.get(id)! - last.total!) : Infinity;
        const closest = Math.min(...tied.map(distance));
        winners = closest === Infinity ? tied : tied.filter((id) => distance(id) === closest);
        via = winners.length === 1 ? "tiebreak" : "unresolved";
      } else {
        winners = tied;
        via = "unresolved";
      }
    }

    rows.push({
      week, complete, records, winners, via,
      tiebreakTotal: last?.total ?? null,
      tiebreakGame: last?.label ?? null,
      guesses,
    });
  }

  return rows.sort((a, b) => a.week - b.week);
}

/**
 * Season spread record, summed from the weekly rows.
 *
 * Derived rather than recalculated on purpose. The lock doubling and the
 * default-to-last-game rule are fiddly enough that having two implementations
 * guarantees they disagree — which they did: the week grid showed a lost lock
 * as 0-2 while the season table showed the same pick as 0-1.
 */
export function seasonSpreadTotals(weeks: WeekRow[]) {
  const totals = new Map<string, { wins: number; losses: number; pushes: number; pct: number }>();

  for (const w of weeks) {
    for (const [profileId, rec] of w.records) {
      const t = totals.get(profileId) ?? { wins: 0, losses: 0, pushes: 0, pct: 0 };
      t.wins += rec.wins;
      t.losses += rec.losses;
      t.pushes += rec.pushes;
      totals.set(profileId, t);
    }
  }

  for (const t of totals.values()) {
    const decided = t.wins + t.losses + t.pushes;
    t.pct = decided > 0 ? (t.wins + t.pushes / 2) / decided : 0;
  }
  return totals;
}

/**
 * Weeks won per player.
 *
 * An unresolved week pays nobody. That should be vanishingly rare — it needs
 * two players tied on record *and* equidistant on the tiebreaker, or tied with
 * neither having guessed — but the money has to go somewhere definite, and
 * "split it" is a conversation rather than a rule.
 */
export function weeksWon(weeks: WeekRow[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const w of weeks) {
    if (w.winners.length !== 1) continue;
    tally.set(w.winners[0], (tally.get(w.winners[0]) ?? 0) + 1);
  }
  return tally;
}
