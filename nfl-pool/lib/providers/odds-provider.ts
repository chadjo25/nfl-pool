/* lib/providers/odds-provider.ts */
/**
 * Spread-line ingestion — SharpAPI.
 *
 * Props are entered by hand in this pool, so the only thing needing a feed is
 * game spreads. SharpAPI's free tier covers NFL at 12 requests/minute with no
 * monthly cap, from DraftKings and FanDuel, on a 60-second delay. The delay is
 * irrelevant here: everyone in the pool needs the same number, not the fastest
 * one.
 *
 * Docs: https://docs.sharpapi.io/en/api-reference/odds/
 */

export type IngestedGame = {
  id: string;
  home: string;
  away: string;
  kickoff: string; // ISO 8601
  homeSpread: number;
  homePrice: number;
  awaySpread: number;
  awayPrice: number;
  book: string;
};

const BASE = process.env.ODDS_API_BASE ?? "https://api.sharpapi.io/api/v1";

/**
 * The book of record. Free tier offers draftkings and fanduel.
 *
 * Pick one and keep it all season. Switching mid-season silently changes what
 * CLV means, because a pick would be measured against a different market's
 * close than the one it was taken from.
 */
const BOOK = process.env.ODDS_BOOK ?? "draftkings";

type OddsRow = {
  event_id: string;
  sportsbook: string;
  home_team: string;
  away_team: string;
  market_type: string;
  selection_type: string;
  odds_american: number;
  line: number | null;
  event_start_time: string;
  is_main_line?: boolean;
  is_active?: boolean;
  is_live?: boolean;
};

export async function fetchSpreads(): Promise<IngestedGame[]> {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY is not set");

  const rows: OddsRow[] = [];
  let cursor: string | null = null;

  // Cursor pagination. Capped at 10 pages — an NFL week is ~14 games, so a
  // full slate fits in one page of 200. Hitting the cap means something is
  // wrong with the filters, and looping forever would burn the rate limit.
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${BASE}/odds`);
    url.searchParams.set("league", "nfl");
    url.searchParams.set("market", "point_spread"); // exact type = full game only
    url.searchParams.set("sportsbook", BOOK);
    url.searchParams.set("is_live", "false");       // prematch only
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { "X-API-Key": key },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`SharpAPI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const body = await res.json();
    rows.push(...((body?.data ?? []) as OddsRow[]));

    // Docs show pagination at the top level; older examples nest it under
    // meta. Accept either rather than break on a shape change.
    const pagination = body?.pagination ?? body?.meta?.pagination;
    if (!pagination?.has_more || !pagination?.next_cursor) break;
    cursor = pagination.next_cursor as string;
  }

  return pairSides(rows);
}

/**
 * SharpAPI returns one row per side. Pair them back into games.
 */
function pairSides(rows: OddsRow[]): IngestedGame[] {
  type Partial_ = {
    home?: OddsRow;
    away?: OddsRow;
    homeTeam: string;
    awayTeam: string;
    kickoff: string;
    book: string;
  };
  const byEvent = new Map<string, Partial_>();

  for (const row of rows) {
    // Alternate lines come back alongside the main one. Without this filter
    // you'd ingest a dozen spreads per game and pick an arbitrary one.
    if (row.is_main_line === false) continue;
    if (row.is_active === false) continue; // suspended: price is frozen, not real
    if (row.selection_type !== "home" && row.selection_type !== "away") continue;
    if (row.line == null) continue;

    let entry = byEvent.get(row.event_id);
    if (!entry) {
      entry = {
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        kickoff: row.event_start_time,
        book: row.sportsbook,
      };
      byEvent.set(row.event_id, entry);
    }
    entry[row.selection_type as "home" | "away"] = row;
  }

  const games: IngestedGame[] = [];
  for (const [eventId, entry] of byEvent) {
    // Only one side posted is normal mid-update, not an error. Skip it and
    // let the next poll pick the game up.
    if (!entry.home || !entry.away) continue;

    games.push({
      id: eventId,
      home: entry.homeTeam,
      away: entry.awayTeam,
      kickoff: entry.kickoff,
      homeSpread: entry.home.line!,
      homePrice: entry.home.odds_american,
      awaySpread: entry.away.line!,
      awayPrice: entry.away.odds_american,
      book: entry.book,
    });
  }
  return games;
}

/**
 * NFL week number from a kickoff timestamp.
 *
 * Weeks run Thursday through Monday night, so the boundary sits on Tuesday.
 * Set SEASON_WEEK_ONE to the Tuesday before the season's first Thursday game
 * — it is the single date this whole calculation depends on.
 *
 * The boundary is midday UTC, not midnight, and that matters: a Monday night
 * game kicking off 8:15pm Eastern is already 00:15 UTC *Tuesday*. Anchored at
 * midnight, every Monday nighter of the season would be filed under the
 * following week. Noon UTC sits safely after the latest MNF finish and well
 * before Thursday's opener.
 *
 * Returns 0 for anything before the anchor, which is how preseason games get
 * filtered out instead of being crushed into Week 1.
 */
export function weekFromKickoff(kickoff: string | Date): number {
  const anchor = process.env.SEASON_WEEK_ONE;
  if (!anchor) throw new Error("SEASON_WEEK_ONE is not set (e.g. 2026-09-08)");
  const start = new Date(`${anchor}T12:00:00Z`).getTime();
  const at = new Date(kickoff).getTime();
  if (at < start) return 0; // preseason
  return Math.min(Math.floor((at - start) / (7 * 86_400_000)) + 1, 18);
}

/** True for regular-season games only. */
export const isRegularSeason = (kickoff: string | Date) => weekFromKickoff(kickoff) > 0;

export const currentSeason = () =>
  Number(process.env.SEASON_YEAR ?? new Date().getFullYear());

// ---------------------------------------------------------------------------
// Prop deadline
// ---------------------------------------------------------------------------

/** Milliseconds a timezone is ahead of UTC at a given instant. */
function tzOffsetMs(ts: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(ts).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    +p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second
  );
  return asUtc - ts;
}

/**
 * Convert a wall-clock Eastern time to a UTC instant.
 *
 * Two passes: guess, measure the offset at that guess, correct. One pass is
 * wrong within an hour of a DST transition, because the offset you need
 * depends on the answer you're computing.
 */
function easternToUtc(isoDate: string, hour: number): Date {
  const naive = Date.parse(`${isoDate}T${String(hour).padStart(2, "0")}:00:00Z`);
  let ts = naive;
  for (let i = 0; i < 2; i++) ts = naive - tzOffsetMs(ts, "America/New_York");
  return new Date(ts);
}

/**
 * Fallback deadline for props that aren't tagged to a single game.
 *
 * Most props carry a game tag and lock at that game's kickoff, same as a
 * spread pick. This covers the rest — "any defensive TD in the 1pm window"
 * and similar — which have no single kickoff to lock against.
 *
 * The season crosses the DST boundary, so this is 17:00 UTC in September and
 * 18:00 UTC in December. Computing it from the timezone rather than a fixed
 * offset is what keeps it at 1pm all season.
 */
export function propDeadline(week: number): string {
  const anchor = process.env.SEASON_WEEK_ONE;
  if (!anchor) throw new Error("SEASON_WEEK_ONE is not set (e.g. 2026-09-08)");
  const start = new Date(`${anchor}T12:00:00Z`).getTime();
  // The anchor is a Tuesday; the Sunday of that week is five days on.
  const sunday = new Date(start + ((week - 1) * 7 + 5) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return easternToUtc(sunday, 13).toISOString();
}
