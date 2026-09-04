/* app/standings/page.tsx */
import { getStandings, getWeeklySpreadResults, weeksWon } from "@/lib/standings";
import { currentSeason } from "@/lib/providers/odds-provider";
import {
  type PropMetrics, buyIn, weeklyPrize, seasonPot, seasonSplit,
} from "@/lib/scoring";

export const dynamic = "force-dynamic";

const sgn = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
const cls = (n: number) => (n >= 0 ? "credit" : "debit");
const money = (n: number) => `$${n.toFixed(0)}`;

/**
 * The spreads settle weekly and pay the winner, so they get a week-by-week
 * grid — a season total can't tell you who won Week 2. The touchdown and prop
 * tables stay as running season totals, since no money rides on those.
 */
export default async function Standings() {
  const season = currentSeason();
  const [standings, weeks] = await Promise.all([
    getStandings(season),
    getWeeklySpreadResults(season),
  ]);
  const won = weeksWon(weeks);
  const players = [...standings].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const played = weeks.filter((w) => w.records.size > 0);
  const headcount = standings.length;
  const perWeek = weeklyPrize(headcount);
  const split = seasonSplit(headcount);

  return (
    <>
      <div className="pagehead">
        <h1>Standings</h1>
        <span className="count">
          {headcount} in · {money(buyIn())} each · {money(perWeek)}/week
        </span>
      </div>

      <h2 className="sec">Week by week <em>against the spread</em></h2>
      {played.length === 0 ? (
        <p className="empty">No graded games yet.</p>
      ) : (
        <div className="scroller">
          <table className="grid">
            <thead><tr>
              <th>Week</th>
              {players.map((p) => <th key={p.profileId}>{p.displayName}</th>)}
            </tr></thead>
            <tbody>
              {played.map((w) => (
                <tr key={w.week}>
                  <td className="wk">
                    {w.week}
                    {!w.complete && <em>live</em>}
                  </td>
                  {players.map((p) => {
                    const rec = w.records.get(p.profileId);
                    const isWinner = w.winners.includes(p.profileId);
                    return (
                      <td key={p.profileId} className={isWinner ? "winner" : ""}>
                        {rec
                          ? `${rec.wins}-${rec.losses}${rec.pushes ? `-${rec.pushes}` : ""}`
                          : <span className="faint">—</span>}
                        {isWinner && w.winners.length === 1 && (
                          <em>{w.via === "tiebreak" ? `${money(perWeek)} · tiebreak` : money(perWeek)}</em>
                        )}
                        {isWinner && w.winners.length > 1 && <em>tied</em>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="totals">
                <td className="wk">Won</td>
                {players.map((p) => {
                  const n = won.get(p.profileId) ?? 0;
                  return (
                    <td key={p.profileId} className={n ? "credit" : "faint"}>
                      {n ? `${n} · ${money(n * perWeek)}` : "0"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        Best record each week takes {money(perWeek)}. Records include the <b>lock</b>, which
        counts double either way; a pushed lock voids instead. A week is only settled once all
        its games are final — weeks marked <b>live</b> are still running. Ties at the top go to
        the tiebreaker: closest to the real total in the last game wins, and anyone who
        didn&apos;t guess loses it outright.
      </p>

      {played.some((w) => w.via === "tiebreak") && (
        <>
          <h2 className="sec">Tiebreakers used</h2>
          <table>
            <thead><tr>
              <th>Week</th><th>Game</th><th>Actual</th><th>Guesses</th>
            </tr></thead>
            <tbody>
              {played.filter((w) => w.via === "tiebreak").map((w) => (
                <tr key={w.week}>
                  <td className="name">{w.week}</td>
                  <td className="faint" style={{ textAlign: "left" }}>{w.tiebreakGame}</td>
                  <td>{w.tiebreakTotal}</td>
                  <td className="faint">
                    {players
                      .filter((p) => w.records.has(p.profileId))
                      .map((p) => `${p.displayName} ${w.guesses.get(p.profileId) ?? "—"}`)
                      .join("  ·  ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 className="sec">Season totals <em>against the spread</em></h2>
      <table>
        <thead><tr>
          <th>Player</th><th>Record</th><th>Win%</th><th>Weeks won</th><th>CLV</th>
        </tr></thead>
        <tbody>
          {[...standings].sort((a, b) => b.spreads.winPct - a.spreads.winPct).map((p, i) => (
            <tr key={p.profileId} className={i < split.length ? "inmoney" : ""}>
              <td className="name">
                {p.displayName}
                {i < split.length && <em>{money(seasonPot(headcount) * split[i])}</em>}
              </td>
              <td>{p.spreads.wins}-{p.spreads.losses}{p.spreads.pushes ? `-${p.spreads.pushes}` : ""}</td>
              <td>{(p.spreads.winPct * 100).toFixed(1)}</td>
              <td className={won.get(p.profileId) ? "credit" : "faint"}>{won.get(p.profileId) ?? 0}</td>
              <td className={cls(p.spreads.clv)}>
                {p.spreads.clvSample ? `${sgn(p.spreads.clv * 100, 2)}pp` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Season pot is {money(seasonPot(headcount))}, paid to the top{" "}
        {split.length === 1 ? "finisher" : `${split.length} on ${split.map((s) => `${Math.round(s * 100)}%`).join(" / ")}`}
        {" "}— the split widens automatically as more people join. CLV measures the number you
        got against where the game closed; it registers on every pick whether it wins or not,
        so it says something useful long before a win-loss record does.
      </p>

      <PropTable title="Touchdown scorers" rows={standings.map((p) => ({ ...p, m: p.td }))} />
      <PropTable title="Props" rows={standings.map((p) => ({ ...p, m: p.props }))} />

      <p className="note">
        Running season totals — no money rides on these two. <b>WAE</b> is wins above what the
        market expected from those exact picks, which is the honest read on who is picking well.
        <b> Signal</b> is WAE in standard deviations; below about 1.5, treat it as noise.
      </p>
    </>
  );
}

function PropTable({ title, rows }: {
  title: string;
  rows: Array<{ profileId: string; displayName: string; m: PropMetrics }>;
}) {
  return (
    <>
      <h2 className="sec">{title} <em>season to date</em></h2>
      <table>
        <thead><tr>
          <th>Player</th><th>Record</th><th className="hide">Expected</th>
          <th>WAE</th><th className="hide">Signal</th><th>Units</th><th>Points</th>
        </tr></thead>
        <tbody>
          {[...rows].sort((a, b) => b.m.points - a.m.points).map((p) => (
            <tr key={p.profileId}>
              <td className="name">{p.displayName}</td>
              <td>{p.m.wins}-{p.m.losses}{p.m.voids ? ` (${p.m.voids} void)` : ""}</td>
              <td className="hide faint">{p.m.expected.toFixed(1)}</td>
              <td className={cls(p.m.wae)}>{sgn(p.m.wae)}</td>
              <td className={`hide ${Math.abs(p.m.z) >= 1.5 ? "" : "faint"}`}>{sgn(p.m.z)}σ</td>
              <td className={cls(p.m.units)}>{sgn(p.m.units)}u</td>
              <td className={cls(p.m.points)}>{p.m.points >= 0 ? "+" : ""}{Math.round(p.m.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
