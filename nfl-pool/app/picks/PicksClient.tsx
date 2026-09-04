"use client";
/* app/picks/PicksClient.tsx */

import { useState, useTransition } from "react";
import { submitSpreadPick, submitPropPick, setLock, submitTiebreak } from "./actions";
import { parseAmerican, devig, formatAmerican } from "@/lib/odds";
import { scorePick } from "@/lib/scoring";

type Game = {
  id: string; home: string; away: string; kickoff: string; locked: boolean;
  line: { home_spread: number; home_price: number; away_spread: number; away_price: number } | null;
};
export type PropPick = {
  kind: "td" | "prop"; label: string; price: number;
  other_price: number | null; proof_url: string | null; game_id: string | null;
};

const fmtSpread = (n: number) => (n > 0 ? `+${n}` : String(n));
const kickoffLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });

export default function PicksClient({
  games, spreadPicks, propPicks, season, week, weeklyDeadlinePassed,
  lockGameId, tiebreakGuess,
}: {
  games: Game[];
  spreadPicks: Record<string, "home" | "away">;
  propPicks: Partial<Record<"td" | "prop", PropPick>>;
  season: number; week: number; weeklyDeadlinePassed: boolean;
  lockGameId: string | null; tiebreakGuess: number | null;
}) {
  const [picks, setPicks] = useState(spreadPicks);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // Every pick loaded from the server is by definition saved. The marker
  // stays put rather than flashing — a confirmation nobody sees isn't one.
  const [saved, setSaved] = useState<Record<string, boolean>>(
    () => Object.fromEntries(Object.keys(spreadPicks).map((id) => [id, true]))
  );
  const [lock, setLockState] = useState(lockGameId);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  /**
   * Spread picks save the moment you tap — there's no submit button, because
   * a pick sitting unsaved in a browser tab is a pick you can lose. The
   * tradeoff is that saving becomes invisible, so each row reports its own
   * state instead.
   */
  function choose(gameId: string, side: "home" | "away") {
    const previous = picks[gameId];
    setPicks((p) => ({ ...p, [gameId]: side })); // optimistic
    setSaving((s) => ({ ...s, [gameId]: true }));
    setSaved((s) => ({ ...s, [gameId]: false }));
    setError("");

    startTransition(async () => {
      const res = await submitSpreadPick(gameId, side);
      setSaving((s) => ({ ...s, [gameId]: false }));

      if (res.ok) {
        setSaved((s) => ({ ...s, [gameId]: true }));
      } else {
        setPicks((p) => {
          const next = { ...p };
          // Restore the old value, or drop the key entirely if there wasn't
          // one — an undefined value left behind would still be counted.
          if (previous) next[gameId] = previous;
          else delete next[gameId];
          return next;
        });
        setError(res.error);
      }
    });
  }

  const made = games.filter((g) => picks[g.id]).length;
  const remaining = games.filter((g) => !g.locked && !picks[g.id]).length;
  const status =
    remaining === 0
      ? made === games.length
        ? "All spreads in."
        : `${made} of ${games.length} in · the rest are locked`
      : `${made} of ${games.length} in · ${remaining} left to pick`;

  return (
    <>
      <div className="pagehead">
        <h1>Week {week}</h1>
        <span className="count">{status}</span>
      </div>
      {error && <p className="err banner">{error}</p>}

      <h2 className="sec">Against the spread</h2>
      <div className="games">
        {games.map((g) => (
          <div className={`game${g.locked ? " locked" : ""}`} key={g.id}>
            <div className="gtime">
              {kickoffLabel(g.kickoff)}
              {g.locked && <em className="lock">locked</em>}
              {saving[g.id] && <em className="saving">saving…</em>}
              {saved[g.id] && <em className="saved">saved</em>}
            </div>
            {(["away", "home"] as const).map((side) => {
              const team = side === "home" ? g.home : g.away;
              const spread = side === "home" ? g.line?.home_spread : g.line?.away_spread;
              const price = side === "home" ? g.line?.home_price : g.line?.away_price;
              return (
                <button
                  key={side}
                  className="pick"
                  aria-pressed={picks[g.id] === side}
                  disabled={g.locked || !g.line}
                  onClick={() => choose(g.id, side)}
                >
                  <span className="tm">{team}</span>
                  <span className="ln">
                    {spread != null ? fmtSpread(spread) : "—"}
                    <small>{price != null ? formatAmerican(price) : "no line"}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {games.length === 0 && <p className="empty">No games loaded yet. The line feed runs hourly.</p>}
      </div>

      {games.length > 0 && remaining === 0 && made > 0 && (
        <p className="allin">
          Every open game is picked. Each one saved as you tapped it — there&apos;s nothing
          left to submit.
        </p>
      )}

      <h2 className="sec">Lock of the week</h2>
      <LockPicker
        games={games} picks={picks} lock={lock}
        onChange={setLockState} onError={setError}
      />

      <h2 className="sec">Tiebreaker</h2>
      <Tiebreak season={season} week={week} games={games} existing={tiebreakGuess} />

      <h2 className="sec">
        Touchdown scorer <em className="opt">Optional &middot; bragging rights only</em>
      </h2>
      <PropForm kind="td" season={season} week={week} existing={propPicks.td}
        games={games} weeklyDeadlinePassed={weeklyDeadlinePassed}
        placeholder="Bijan Robinson anytime TD" />

      <h2 className="sec">
        Prop of the week <em className="opt">Optional &middot; bragging rights only</em>
      </h2>
      <PropForm kind="prop" season={season} week={week} existing={propPicks.prop}
        games={games} weeklyDeadlinePassed={weeklyDeadlinePassed}
        placeholder="Puka Nacua over 7.5 receptions" />
    </>
  );
}

/**
 * Free-text prop entry, tagged to a game.
 *
 * The tag is what buys per-game locking: pick a Monday night prop on Monday
 * morning, and a Thursday prop is sealed the moment Thursday kicks off. Left
 * untagged (for anything spanning games) it falls back to the Sunday 1pm
 * deadline instead.
 *
 * Only the one price is collected, so de-vigging always uses the estimated
 * hold curve rather than normalising two posted sides. Slightly less precise
 * per pick, but applied identically to everyone — which for ranking people
 * against each other is what actually matters.
 */
function PropForm({
  kind, season, week, existing, games, weeklyDeadlinePassed, placeholder,
}: {
  kind: "td" | "prop"; season: number; week: number;
  existing?: PropPick; games: Game[]; weeklyDeadlinePassed: boolean; placeholder: string;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [price, setPrice] = useState(existing ? formatAmerican(existing.price) : "");
  const [gameId, setGameId] = useState(existing?.game_id ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const openGames = games.filter((g) => !g.locked);

  // A tagged pick follows its game. An untagged one follows the weekly clock.
  const locked = existing?.game_id
    ? (games.find((g) => g.id === existing.game_id)?.locked ?? true)
    : existing
      ? weeklyDeadlinePassed
      : openGames.length === 0 && weeklyDeadlinePassed;

  const parsed = parseAmerican(price);
  const fair = parsed !== null ? devig(parsed) : null;
  const points = parsed !== null ? scorePick(parsed, "win", "capped") : null;

  async function save() {
    setStatus("saving");
    const form = new FormData();
    form.set("season", String(season));
    form.set("week", String(week));
    form.set("kind", kind);
    form.set("label", label);
    form.set("price", price);
    form.set("gameId", gameId);
    const res = await submitPropPick(form);
    if (res.ok) { setStatus("saved"); setMessage(""); }
    else { setStatus("error"); setMessage(res.error); }
  }

  if (locked && !existing) return <p className="empty">Locked — no pick was in before the deadline.</p>;

  const taggedGame = existing?.game_id
    ? games.find((g) => g.id === existing.game_id)
    : null;

  return (
    <div className="propform">
      <input
        className="label" type="text" value={label} placeholder={placeholder} disabled={locked}
        onChange={(e) => { setLabel(e.target.value); setStatus("idle"); }}
      />

      <div className="oddrow">
        <label>Price
          <input className="odds" value={price} placeholder="+240" disabled={locked}
            onChange={(e) => { setPrice(e.target.value); setStatus("idle"); }} />
        </label>
        {fair && (
          <span className="fair">
            {(fair.prob * 100).toFixed(1)}% fair
            <small>{points! > 0 ? "+" : ""}{Math.round(points!)} pts if it hits</small>
          </span>
        )}
      </div>

      <div className="gamerow">
        <label>Which game
          {locked ? (
            <span className="static">
              {taggedGame ? `${taggedGame.away} @ ${taggedGame.home}` : "Multiple games"}
            </span>
          ) : (
            <select value={gameId} disabled={locked}
              onChange={(e) => { setGameId(e.target.value); setStatus("idle"); }}>
              <option value="">
                {weeklyDeadlinePassed
                  ? "Multiple games (closed)"
                  : "Multiple games — locks Sunday 1pm ET"}
              </option>
              {openGames.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.away} @ {g.home} — {kickoffLabel(g.kickoff)}
                </option>
              ))}
            </select>
          )}
        </label>
        <span className="hintline">
          {gameId
            ? "Locks at that game's kickoff."
            : "Untagged picks lock Sunday at 1pm ET."}
        </span>
      </div>

      {!locked && (
        <div className="formfoot">
          <button className="btn" onClick={save}
            disabled={status === "saving" || !label || parsed === null || (!gameId && weeklyDeadlinePassed)}>
            {status === "saving" ? "Saving…" : existing ? "Update pick" : "Lock it in"}
          </button>
          {status === "saved" && <span className="ok">Saved.</span>}
          {status === "error" && <span className="err">{message}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Lock of the week — one pick that counts double, win or lose.
 *
 * A dropdown rather than sixteen toggles: it works on a phone, it makes the
 * one-per-week rule obvious, and it can only offer games you've actually
 * picked. A pushed lock voids rather than doubling.
 */
function LockPicker({
  games, picks, lock, onChange, onError,
}: {
  games: Game[];
  picks: Record<string, "home" | "away">;
  lock: string | null;
  onChange: (id: string | null) => void;
  onError: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const eligible = games.filter((g) => !g.locked && picks[g.id]);
  const current = games.find((g) => g.id === lock) ?? null;
  const lastGame = [...games].sort((a, b) => a.kickoff.localeCompare(b.kickoff)).at(-1);

  async function choose(id: string) {
    if (!id) return;
    const previous = lock;
    onChange(id);
    setSaving(true);
    const res = await setLock(id);
    setSaving(false);
    if (!res.ok) { onChange(previous); onError(res.error); }
  }

  const sideOf = (g: Game) =>
    picks[g.id] === "home"
      ? `${g.home} ${fmtSpread(g.line?.home_spread ?? 0)}`
      : `${g.away} ${fmtSpread(g.line?.away_spread ?? 0)}`;

  if (current?.locked) {
    return (
      <div className="propform">
        <div className="lockcurrent">{sideOf(current)}<em>locked in</em></div>
        <span className="hintline">This game has kicked off. Your lock is set for the week.</span>
      </div>
    );
  }

  return (
    <div className="propform">
      <div className="gamerow">
        <label>Counts double, win or lose
          <select value={lock ?? ""} disabled={saving}
            onChange={(e) => choose(e.target.value)}>
            <option value="" disabled>
              {eligible.length ? "Choose one of your picks…" : "Make a pick first"}
            </option>
            {eligible.map((g) => (
              <option key={g.id} value={g.id}>
                {sideOf(g)} — {kickoffLabel(g.kickoff)}
              </option>
            ))}
          </select>
        </label>
        {saving && <span className="hintline">Saving…</span>}
        {!saving && lock && <span className="hintline saved">Saved.</span>}
      </div>
      <span className="hintline">
        {lock
          ? "A push on your lock voids instead of doubling."
          : `No lock set means it defaults to the last game of the week${
              lastGame ? ` (${lastGame.away} @ ${lastGame.home})` : ""
            }.`}
      </span>
    </div>
  );
}

/**
 * Total points in the last game of the week.
 *
 * Only consulted when two people tie for worst record — most weeks it's moot.
 * Skipping it means losing any tiebreak automatically, so there's no upside
 * in leaving it blank when you think you're safe.
 */
function Tiebreak({
  season, week, games, existing,
}: {
  season: number; week: number; games: Game[]; existing: number | null;
}) {
  const [points, setPoints] = useState(existing != null ? String(existing) : "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    existing != null ? "saved" : "idle"
  );
  const [message, setMessage] = useState("");

  const last = [...games].sort((a, b) => a.kickoff.localeCompare(b.kickoff)).at(-1);
  if (!last) return <p className="empty">No games loaded yet.</p>;
  if (last.locked) {
    return (
      <div className="propform">
        <div className="lockcurrent">
          {existing != null ? `${existing} points` : "No guess submitted"}
          <em>{last.away} @ {last.home}</em>
        </div>
        <span className="hintline">
          {existing != null
            ? "Locked in."
            : "That game has started — you'd lose any tiebreak this week."}
        </span>
      </div>
    );
  }

  async function save() {
    setStatus("saving");
    const res = await submitTiebreak(season, week, points);
    if (res.ok) { setStatus("saved"); setMessage(""); }
    else { setStatus("error"); setMessage(res.error); }
  }

  return (
    <div className="propform">
      <div className="gamerow">
        <label>Combined points, {last.away} @ {last.home}
          <input className="odds wide" value={points} placeholder="47" inputMode="numeric"
            onChange={(e) => { setPoints(e.target.value); setStatus("idle"); }} />
        </label>
        <span className="hintline">Both teams added together. Closest wins a tie.</span>
      </div>
      <div className="formfoot">
        <button className="btn" onClick={save} disabled={status === "saving" || !points}>
          {status === "saving" ? "Saving…" : existing != null ? "Update guess" : "Submit guess"}
        </button>
        {status === "saved" && <span className="ok">Saved.</span>}
        {status === "error" && <span className="err">{message}</span>}
      </div>
    </div>
  );
}
