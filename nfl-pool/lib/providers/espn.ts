/* lib/providers/espn.ts */
/**
 * Final scores from ESPN's public scoreboard.
 *
 * Free, no key, and stable for years — but unofficial, so it can change
 * without notice. If grading ever goes quiet, check here first.
 *
 * Team names come back as full display names ("Kansas City Chiefs"), which is
 * the same convention the odds feed uses, so matching on name works. Matching
 * on name is still fragile enough that `matchGame` falls back to a nickname
 * comparison rather than silently failing to grade someone's week.
 */

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export type FinalScore = {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  kickoff: string;
  completed: boolean;
};

type EspnCompetitor = {
  homeAway: "home" | "away";
  score: string;
  team?: { displayName?: string; name?: string; abbreviation?: string };
};

export async function fetchScores(season: number, week: number): Promise<FinalScore[]> {
  const url = new URL(SCOREBOARD);
  url.searchParams.set("dates", String(season));
  url.searchParams.set("seasontype", "2"); // 1 pre, 2 regular, 3 post
  url.searchParams.set("week", String(week));

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = await res.json();

  const out: FinalScore[] = [];
  for (const event of data?.events ?? []) {
    const comp = event?.competitions?.[0];
    const competitors: EspnCompetitor[] = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    out.push({
      home: home.team?.displayName ?? "",
      away: away.team?.displayName ?? "",
      homeScore: Number.parseInt(home.score, 10),
      awayScore: Number.parseInt(away.score, 10),
      kickoff: comp?.date ?? event?.date,
      // Only settle on `completed`. Grading a game that is merely "ended"
      // risks a stat correction reversing a result after money changed hands.
      completed: Boolean(comp?.status?.type?.completed),
    });
  }
  return out;
}

const nickname = (team: string) => team.split(" ").pop()!.toLowerCase();

/** Tolerant name match between the odds feed and ESPN. */
export function matchGame(
  scores: FinalScore[],
  home: string,
  away: string
): FinalScore | undefined {
  return (
    scores.find((s) => s.home === home && s.away === away) ??
    scores.find(
      (s) => nickname(s.home) === nickname(home) && nickname(s.away) === nickname(away)
    )
  );
}
