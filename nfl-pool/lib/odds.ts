/* lib/odds.ts */
/**
 * Odds math. Pure functions, no I/O — everything here is unit-testable
 * and nothing else in the app should be doing arithmetic on prices.
 */

/** American price -> decimal odds. -150 => 1.667, +150 => 2.5 */
export function toDecimal(american: number): number {
  if (!Number.isFinite(american) || Math.abs(american) < 100) {
    throw new Error(`Invalid American odds: ${american}`);
  }
  return american >= 100 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

/** Decimal odds -> American price. */
export function toAmerican(decimal: number): number {
  if (decimal <= 1) throw new Error(`Invalid decimal odds: ${decimal}`);
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

/** Probability implied by the posted price. Includes the book's margin. */
export const impliedProb = (american: number) => 1 / toDecimal(american);

export function formatAmerican(american: number): string {
  return american > 0 ? `+${american}` : String(american);
}

/**
 * Parse a price the way a person types it: "+150", "150", "-110", " -110 ".
 * Returns null rather than throwing, since this runs on user input.
 */
export function parseAmerican(input: string): number | null {
  const cleaned = input.replace(/[^0-9+-]/g, "");
  if (!cleaned) return null;
  const n = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return n;
}

// ---------------------------------------------------------------------------
// De-vigging
// ---------------------------------------------------------------------------

/**
 * Typical bookmaker hold as a function of the fair probability.
 *
 * Books charge far more margin on longshots than on favourites — the
 * favourite–longshot bias. A -200 prop might carry 5% hold while a +1600
 * anytime-TD carries 13%. Scoring off raw prices would therefore punish
 * exactly the risk-takers the pool is trying to reward, so a one-sided
 * market gets this curve applied instead.
 *
 * It is an approximation. It is applied identically to every player, and it
 * corrects the direction of the bias, which is the part that matters.
 */
export const estimatedHold = (p: number) => 0.04 + 0.1 * (1 - p);

export type FairOdds = {
  prob: number;
  american: number;
  method: "two-way" | "estimated";
};

/**
 * Strip the vig.
 *
 * When both sides are posted (any over/under, any yes/no), normalising the
 * two implied probabilities is exact. Anytime-TD markets almost never post
 * the "no" side, so fall back to the hold curve above.
 */
export function devig(price: number, otherPrice?: number | null): FairOdds {
  const p = impliedProb(price);

  if (otherPrice != null) {
    const q = impliedProb(otherPrice);
    const fair = p / (p + q);
    return { prob: fair, american: toAmerican(1 / fair), method: "two-way" };
  }

  const fair = p / (1 + estimatedHold(p));
  return { prob: fair, american: toAmerican(1 / fair), method: "estimated" };
}

// ---------------------------------------------------------------------------
// Spreads
// ---------------------------------------------------------------------------

/**
 * Standard deviation of NFL margin of victory. Roughly 13.2 points across
 * the modern era; it drifts a little year to year but not enough to matter
 * for ranking five friends.
 */
export const NFL_MARGIN_SD = 13.2;

/** Normal CDF (Abramowitz & Stegun 7.1.26 via erf approximation). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * Closing line value on a spread pick, in probability terms.
 *
 * `taken` and `closing` are both the spread for the side you actually
 * picked (negative = laying points). Take Bears -3.5 and watch it close
 * -4.5 and you bought a point of value; the market's final verdict says
 * your side should have cost more than you paid.
 *
 * Returns the edge over a coinflip: +0.030 means the number you got was
 * worth about three extra percentage points of cover probability.
 */
export function spreadClv(taken: number, closing: number): number {
  // The CDF approximation is accurate to ~1e-7, which would otherwise make
  // "took exactly the closing number" display as -0.0000001 instead of zero.
  if (taken === closing) return 0;
  return normalCdf((taken - closing) / NFL_MARGIN_SD) - 0.5;
}

/** Raw points of line value. Positive = you got the better number. */
export const spreadClvPoints = (taken: number, closing: number) => taken - closing;

/** Did the pick cover? Handles pushes. */
export function gradeSpread(
  side: "home" | "away",
  lockedSpread: number,
  homeScore: number,
  awayScore: number
): "win" | "loss" | "push" {
  const margin = side === "home" ? homeScore - awayScore : awayScore - homeScore;
  const adjusted = margin + lockedSpread;
  if (Math.abs(adjusted) < 1e-9) return "push";
  return adjusted > 0 ? "win" : "loss";
}
