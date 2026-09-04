/* lib/scoring.ts */
/**
 * Scoring and season metrics.
 *
 * Three categories are tracked independently, exactly as the pool is played:
 *   spreads  — straight record, plus CLV as a skill signal
 *   td       — one anytime touchdown scorer per week
 *   prop     — one prop per week
 *
 * Props are never ranked on raw record. A 12-5 season on -200 favourites and
 * a 12-5 season on +300 dogs are not the same achievement, and everything
 * below exists to say so numerically.
 */

import { toDecimal, devig, spreadClv, spreadClvPoints } from "./odds";

// ---------------------------------------------------------------------------
// Points — what decides who pays
// ---------------------------------------------------------------------------

export type ScoringModel = "payout" | "capped" | "log";

/** Longest price that earns full credit under `capped`. +600. */
export const ODDS_CEILING = 7.0;

const WIN_POINTS: Record<ScoringModel, (decimal: number) => number> = {
  payout: (d) => 100 * (d - 1),
  capped: (d) => 100 * (Math.min(d, ODDS_CEILING) - 1),
  log: (d) => 100 * Math.log2(d),
};

export const LOSS_POINTS = -100;

/**
 * Points for a single graded prop pick.
 *
 * Uncapped payout is the most familiar model and the worst one for a season
 * pool: because one +2000 hit erases a bad year, everyone stops handicapping
 * and starts buying lottery tickets around Week 8. `capped` keeps the
 * betting feel with a ceiling on that.
 */
export function scorePick(
  american: number,
  result: "win" | "loss" | "void",
  model: ScoringModel = "capped"
): number {
  if (result === "void") return 0;
  if (result === "loss") return LOSS_POINTS;
  return WIN_POINTS[model](toDecimal(american));
}

// ---------------------------------------------------------------------------
// Prop metrics
// ---------------------------------------------------------------------------

export type GradedProp = {
  price: number;
  otherPrice?: number | null;
  result: "win" | "loss" | "void" | null;
};

export type PropMetrics = {
  wins: number;
  losses: number;
  voids: number;
  /** Sum of vig-free probabilities: how many the market says you should hit. */
  expected: number;
  /** wins − expected. The headline number. */
  wae: number;
  /** WAE in standard deviations. Under ~1.5, it's noise wearing a costume. */
  z: number;
  /** Flat-stake profit in units, priced at what you actually took. */
  units: number;
  points: number;
};

export function propMetrics(
  picks: GradedProp[],
  model: ScoringModel = "capped"
): PropMetrics {
  let wins = 0, losses = 0, voids = 0;
  let expected = 0, variance = 0, units = 0, points = 0;

  for (const pick of picks) {
    if (!pick.result || pick.result === "void") {
      if (pick.result === "void") voids++;
      continue;
    }

    const fair = devig(pick.price, pick.otherPrice).prob;
    expected += fair;
    variance += fair * (1 - fair);
    points += scorePick(pick.price, pick.result, model);

    if (pick.result === "win") {
      wins++;
      units += toDecimal(pick.price) - 1;
    } else {
      losses++;
      units -= 1;
    }
  }

  const wae = wins - expected;
  return {
    wins, losses, voids, expected, wae,
    z: variance > 0 ? wae / Math.sqrt(variance) : 0,
    units, points,
  };
}

// ---------------------------------------------------------------------------
// Spread metrics
// ---------------------------------------------------------------------------

export type GradedSpread = {
  result: "win" | "loss" | "push" | null;
  lockedSpread: number;
  /** Spread this side closed at. Null until the closing snapshot exists. */
  closingSpread: number | null;
};

export type SpreadMetrics = {
  wins: number;
  losses: number;
  pushes: number;
  /** Pushes count as half, so a 9-6-1 beats a 9-7-0. */
  winPct: number;
  /** Mean cover-probability edge from the number you got. */
  clv: number;
  /** Mean points of line value. Easier to explain than the above. */
  clvPoints: number;
  clvSample: number;
};

/**
 * Spread CLV is free here — everyone picks the same games off the same feed,
 * so it costs nothing to measure who took Bears -3.5 on Wednesday against
 * who took -4.5 on Sunday. It also carries far more signal per season than
 * win-loss, because it registers on every pick regardless of outcome.
 */
export function spreadMetrics(picks: GradedSpread[]): SpreadMetrics {
  let wins = 0, losses = 0, pushes = 0;
  let clvSum = 0, clvPointsSum = 0, clvSample = 0;

  for (const pick of picks) {
    if (pick.result === "win") wins++;
    else if (pick.result === "loss") losses++;
    else if (pick.result === "push") pushes++;

    if (pick.closingSpread != null) {
      clvSum += spreadClv(pick.lockedSpread, pick.closingSpread);
      clvPointsSum += spreadClvPoints(pick.lockedSpread, pick.closingSpread);
      clvSample++;
    }
  }

  const decided = wins + losses + pushes;
  return {
    wins, losses, pushes,
    winPct: decided > 0 ? (wins + pushes / 2) / decided : 0,
    clv: clvSample > 0 ? clvSum / clvSample : 0,
    clvPoints: clvSample > 0 ? clvPointsSum / clvSample : 0,
    clvSample,
  };
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export type PlayerSeason = {
  profileId: string;
  displayName: string;
  spreads: SpreadMetrics;
  td: PropMetrics;
  props: PropMetrics;
};

export type Standing = PlayerSeason;

/**
 * Standings are just the players — there's no debt flag any more.
 * Under a buy-in, money flows to the weekly winner and the season leaders;
 * last place is simply last place.
 */
export function buildStandings(players: PlayerSeason[]): Standing[] {
  return players;
}

// ---------------------------------------------------------------------------
// The pot
// ---------------------------------------------------------------------------

/**
 * Everything is defined per player, so headcount scales the prizes on its own.
 * Add three people mid-August and the weekly prize grows without anyone
 * renegotiating the rules.
 *
 *   buy-in = (WEEKLY_STAKE x REGULAR_SEASON_WEEKS) + SEASON_STAKE
 */
export const WEEKLY_STAKE = 5;
export const SEASON_STAKE = 60;
export const REGULAR_SEASON_WEEKS = 18;

export const buyIn = () => WEEKLY_STAKE * REGULAR_SEASON_WEEKS + SEASON_STAKE;
export const weeklyPrize = (players: number) => WEEKLY_STAKE * players;
export const seasonPot = (players: number) => SEASON_STAKE * players;

/**
 * How the season pot splits, by headcount. Declared up front so it adjusts
 * itself rather than becoming a November argument.
 */
export function seasonSplit(players: number): number[] {
  if (players >= 12) return [0.5, 0.3, 0.2];
  if (players >= 8) return [0.65, 0.35];
  return [1];
}
