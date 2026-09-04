"use client";
/* app/admin/GradeClient.tsx */

import { useState, useTransition } from "react";
import Link from "next/link";
import { gradeProp, correctPrice } from "./actions";
import { devig, formatAmerican } from "@/lib/odds";
import { scorePick } from "@/lib/scoring";

export type WeekTab = { week: number; total: number; ungraded: number };

export type Row = {
  id: string;
  displayName: string;
  kind: "td" | "prop";
  label: string;
  price: number;
  other_price: number | null;
  proof_url: string | null;
  result: "win" | "loss" | "void" | null;
  /** Matchup this prop was tagged to, or null for a multi-game pick. */
  game: string | null;
};

/**
 * The Monday button pass.
 *
 * Ten picks, three buttons each. Everything downstream — de-vigging, expected
 * wins, WAE, units, points — is derived from the price and this one click.
 */
export default function GradeClient({ rows, week, season, weeks }: {
  rows: Row[]; week: number; season: number; weeks: WeekTab[];
}) {
  const [state, setState] = useState(rows);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  const ungraded = state.filter((r) => !r.result).length;
  const outstanding = weeks
    .filter((w) => w.week !== week)
    .reduce((sum, w) => sum + w.ungraded, 0);

  function grade(id: string, result: "win" | "loss" | "void") {
    const previous = state.find((r) => r.id === id)?.result ?? null;
    setState((s) => s.map((r) => (r.id === id ? { ...r, result } : r)));
    startTransition(async () => {
      const res = await gradeProp(id, result);
      if (!res.ok) {
        setState((s) => s.map((r) => (r.id === id ? { ...r, result: previous } : r)));
        setError(res.error);
      }
    });
  }

  return (
    <>
      <div className="pagehead">
        <h1>Grade week {week}</h1>
        <span className="count">
          {ungraded === 0 ? "Week graded." : `${ungraded} left this week`}
          {outstanding > 0 && ` · ${outstanding} in other weeks`}
        </span>
      </div>
      {error && <p className="err banner">{error}</p>}

      {weeks.length > 1 && (
        <nav className="weeks" aria-label="Week">
          {weeks.map((w) => (
            <Link
              key={w.week}
              href={`/admin?week=${w.week}`}
              aria-current={w.week === week ? "page" : undefined}
              className={w.ungraded > 0 ? "pending" : ""}
            >
              {w.week}
              {w.ungraded > 0 && <span>{w.ungraded}</span>}
            </Link>
          ))}
        </nav>
      )}

      <div className="gradelist">
        {state.map((row) => (
          <GradeRow key={row.id} row={row} onGrade={grade} onError={setError} />
        ))}
        {state.length === 0 && (
          <p className="empty">
            No prop picks found for season {season}, week {week}. If someone has
            submitted one, the season or week here doesn&apos;t match the pick —
            check SEASON_YEAR in Vercel against the data.
          </p>
        )}
      </div>

      <p className="note">
        Prices are as reported by each player. Under this scoring the price is worth points,
        so it&apos;s the one number worth spot-checking. Editing a price here works even after
        the deadline.
      </p>
    </>
  );
}

function GradeRow({
  row, onGrade, onError,
}: {
  row: Row;
  onGrade: (id: string, result: "win" | "loss" | "void") => void;
  onError: (message: string) => void;
}) {
  const [price, setPrice] = useState(formatAmerican(row.price));
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const fair = devig(row.price);
  const points = scorePick(row.price, "win", "capped");

  async function save() {
    const res = await correctPrice(row.id, price, "");
    if (res.ok) { setEditing(false); setSaved(true); }
    else onError(res.error);
  }

  return (
    <div className={`graderow${row.result ? " done" : ""}`}>
      <div className="who">
        {row.displayName}
        <em>{row.kind === "td" ? "TD scorer" : "Prop"}</em>
      </div>

      <div className="what">
        <div className="lbl">{row.label}</div>
        <div className="tagged">{row.game ?? "Multiple games"}</div>
        <div className="meta">
          {editing ? (
            <>
              <input className="odds" value={price} onChange={(e) => setPrice(e.target.value)} />
              <button className="link" onClick={save}>Save</button>
            </>
          ) : (
            <>
              <b>{formatAmerican(row.price)}</b>
              <span className="faint">
                {(fair.prob * 100).toFixed(1)}% fair · +{Math.round(points)} pts if it hits
              </span>
              <button className="link" onClick={() => setEditing(true)}>
                {saved ? "Edited" : "Edit price"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grades">
        {(["win", "loss", "void"] as const).map((g) => (
          <button key={g} data-g={g} aria-pressed={row.result === g} onClick={() => onGrade(row.id, g)}>
            {g === "win" ? "Hit" : g === "loss" ? "Miss" : "Void"}
          </button>
        ))}
      </div>
    </div>
  );
}
