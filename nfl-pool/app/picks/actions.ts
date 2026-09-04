"use server";
/* app/picks/actions.ts */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAmerican } from "@/lib/odds";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Submit a spread pick.
 *
 * The line is read server-side at submit time and frozen onto the row. Never
 * trust a spread posted from the browser — otherwise the pick is whatever the
 * client says it is.
 */
export async function submitSpreadPick(gameId: string, side: "home" | "away"): Promise<Result> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: game } = await db
    .from("games").select("kickoff").eq("id", gameId).maybeSingle();
  if (!game) return { ok: false, error: "Unknown game" };
  if (new Date(game.kickoff) <= new Date()) return { ok: false, error: "This game is locked" };

  const { data: line } = await db
    .from("line_snapshots")
    .select("home_spread, home_price, away_spread, away_price")
    .eq("game_id", gameId)
    .order("captured_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!line) return { ok: false, error: "No line posted for this game yet" };

  const { error } = await db.from("spread_picks").upsert({
    profile_id: user.id,
    game_id: gameId,
    side,
    locked_spread: side === "home" ? line.home_spread : line.away_spread,
    locked_price: side === "home" ? line.home_price : line.away_price,
    created_at: new Date().toISOString(),
  }, { onConflict: "profile_id,game_id" });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/picks");
  return { ok: true };
}

/**
 * Submit a TD scorer or prop.
 *
 * Free text, a price, and which game it belongs to. The game tag is what lets
 * a prop lock at its own kickoff instead of on a blanket weekly deadline;
 * leaving it blank falls back to Sunday 1pm ET. The database trigger enforces
 * both, so this check is a courtesy that produces a readable error rather than
 * the only thing standing in the way.
 */
export async function submitPropPick(form: FormData): Promise<Result> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const season = Number(form.get("season"));
  const week = Number(form.get("week"));
  const kind = String(form.get("kind")) as "td" | "prop";
  const label = String(form.get("label") ?? "").trim();
  const price = parseAmerican(String(form.get("price") ?? ""));
  const otherRaw = String(form.get("otherPrice") ?? "").trim();
  const otherPrice = otherRaw ? parseAmerican(otherRaw) : null;
  const gameId = String(form.get("gameId") ?? "").trim() || null;

  if (label.length < 3) return { ok: false, error: "Describe the pick in a few more words" };
  if (price === null) return { ok: false, error: "Price must be American odds, like -150 or +240" };
  if (otherRaw && otherPrice === null) {
    return { ok: false, error: "The other side's price isn't valid American odds" };
  }

  if (gameId) {
    const { data: game } = await db
      .from("games").select("kickoff").eq("id", gameId).maybeSingle();
    if (!game) return { ok: false, error: "That game isn't in this week" };
    if (new Date(game.kickoff) <= new Date()) {
      return { ok: false, error: "That game has already kicked off" };
    }
  }

  const { error } = await db.from("prop_picks").upsert({
    profile_id: user.id,
    season, week, kind, label,
    price, other_price: otherPrice, game_id: gameId,
    created_at: new Date().toISOString(),
  }, { onConflict: "profile_id,season,week,kind" });

  if (error) {
    // The lock trigger raises a check_violation once the deadline passes.
    if (error.message.includes("kicked off")) {
      return { ok: false, error: "That game has already kicked off" };
    }
    if (error.message.includes("locked")) {
      return { ok: false, error: "Props are locked for this week" };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/picks");
  return { ok: true };
}


/**
 * Set this week's lock. Replaces any existing one — the unique index allows
 * only a single lock per player per week, so the old one is cleared first.
 */
export async function setLock(gameId: string): Promise<Result> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: pick } = await db
    .from("spread_picks").select("season, week")
    .eq("profile_id", user.id).eq("game_id", gameId).maybeSingle();
  if (!pick) return { ok: false, error: "Pick that game first, then lock it" };

  const { data: game } = await db
    .from("games").select("kickoff").eq("id", gameId).maybeSingle();
  if (!game) return { ok: false, error: "Unknown game" };
  if (new Date(game.kickoff) <= new Date()) {
    return { ok: false, error: "That game has already kicked off" };
  }

  await db.from("spread_picks").update({ is_lock: false })
    .eq("profile_id", user.id).eq("season", pick.season).eq("week", pick.week);

  const { error } = await db.from("spread_picks").update({ is_lock: true })
    .eq("profile_id", user.id).eq("game_id", gameId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/picks");
  return { ok: true };
}

/**
 * Total points guess for the last game of the week.
 *
 * Only consulted when two players tie for worst record. Submitting nothing
 * means losing any tiebreak automatically, so there's no upside in skipping it.
 */
export async function submitTiebreak(
  season: number, week: number, points: string
): Promise<Result> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const value = Number.parseInt(points.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(value) || value < 0 || value > 200) {
    return { ok: false, error: "Enter a total between 0 and 200" };
  }

  const { error } = await db.from("tiebreak_guesses").upsert(
    { profile_id: user.id, season, week, points: value },
    { onConflict: "profile_id,season,week" }
  );

  if (error) {
    if (error.message.includes("locked")) {
      return { ok: false, error: "The last game has started — tiebreaker is closed" };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/picks");
  return { ok: true };
}
