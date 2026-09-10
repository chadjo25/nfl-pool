/* app/how/page.tsx */
export const metadata = { title: "How it works · Dick Picks 2026" };

/**
 * Written for the group chat, not for me. No jargon survives here without a
 * plain-English gloss immediately after it.
 */
export default function How() {
  return (
    <>
      <div className="pagehead"><h1>How it works</h1></div>

      <h2 className="sec">Every week</h2>
      <p className="prose">
        Pick a side of every game against the spread, one anytime touchdown scorer,
        and one prop. <b>Best spread record each week takes the weekly pot.</b> The
        touchdown and prop categories are scored and ranked but no money changes
        hands — those are for bragging rights.
      </p>

      <h2 className="sec">Deadlines</h2>
      <p className="prose">
        <b>Spreads lock game by game, at kickoff.</b> Pick the Sunday slate on Wednesday
        and leave Monday night blank if you want — that game stays open until it starts.
        Once a game kicks off, that pick is sealed.
      </p>
      <p className="prose">
        <b>Props and touchdown scorers lock Sunday at 1pm Eastern</b>, all at once.
        They can&apos;t lock individually the way spreads do, because you type them in
        freehand and the app has no idea which game yours belongs to.
      </p>
      <p className="prose">
        <b>The price you see is the price you get.</b> Whatever the spread was when you
        tapped it is stamped onto your pick permanently. If the line moves afterwards,
        it moves for the next person, not for you.
      </p>

      <h2 className="sec">The money</h2>
      <p className="prose">
        One buy-in up front, collected before Week 1. It covers a weekly stake for all
        eighteen weeks plus a share of the season pot, and everything is defined
        <em> per player</em> — so if more people join, every prize grows and nothing
        about the rules changes.
      </p>
      <p className="prose">
        Roughly 60% of the money pays out weekly and 40% at the end. That&apos;s deliberate:
        a single week of spread picking is close to a coin flip, so the weekly prizes keep
        everyone playing in December, while the season pot is where actual skill gets paid.
        The number of season places paid widens as the pool grows — one winner in a small
        group, top two or three once there are enough people to make that meaningful.
      </p>

      <h2 className="sec">Spreads</h2>
      <p className="prose">
        Straight record. A push counts as half a win, so 9-6-1 beats 9-7. Best
        record on the week takes it.
      </p>

      <h3 className="sub">The lock</h3>
      <p className="prose">
        Every week you name one pick as your <b>lock</b>. It counts double in your record —
        double win if it covers, double loss if it doesn&apos;t. Pick it well and a good week
        becomes a winning one; pick it badly and it&apos;s the difference between taking the
        pot and finishing mid-table.
      </p>
      <p className="prose">
        A pushed lock <b>voids</b> rather than doubling — a push means the market had the number
        exactly right, and twice nothing is still nothing. Your lock has to be set before that
        game kicks off, same as the pick itself, so locking a Thursday game means committing
        on Thursday. <b>Forget to set one and it defaults to the last game of the week</b>, so
        there&apos;s no advantage in skipping it.
      </p>

      <h3 className="sub">The tiebreaker</h3>
      <p className="prose">
        Along with your picks you guess the <b>combined points in the last game of the week</b>,
        both teams added together. Most weeks this is completely moot. It only gets looked at when
        two people tie for the best record — then whoever is closest to the real number takes
        the week.
      </p>
      <p className="prose">
        <b>No guess means you lose the tiebreak automatically.</b> Otherwise there&apos;d be an
        incentive to skip it whenever you thought you were out of it. If two tied players are
        exactly the same distance away, the week goes unpaid and you sort it out yourselves.
      </p>

     {/* <h3 className="sub">CLV, the odd-looking column</h3>
      <p className="prose">
        Lines move all week. Bears might open −3.5 on Wednesday and close −4.5 by
        kickoff as money and injury news come in. <b>The closing line is the market&apos;s
        smartest guess</b> — by then everything anybody knows is priced in.
      </p>
      <p className="prose">
        So if you took Bears −3.5 and it closed −4.5, you got a better number than the
        market&apos;s own final verdict. You were right before everyone caught up.
        That&apos;s positive CLV. It&apos;s shown as an average across your picks;
        <span className="mono"> +0.50pp</span> means your numbers were worth about half a
        percentage point of extra cover probability.
      </p>
      <p className="prose faint">
        Why bother: your record only produces about seventeen data points a week. CLV
        registers on <em>every</em> pick whether it won or lost, so it separates good
        pickers from lucky ones much faster. It only works if you pick early, though —
        submit at 12:55 on Sunday and the line has already closed, so you&apos;ll read zero.
      </p>  */}

      <h2 className="sec">Touchdown scorers and props</h2>
      <p className="prose">
        These are <b>not ranked on record</b>, and that&apos;s the whole point of the thing.
      </p>
      <p className="prose">
        Every pick comes with a price, and the price is the market telling you how likely
        it is. <span className="mono">−250</span> means it happens about 70% of the time.
        <span className="mono"> +300</span> means about 25%.
      </p>

      <p className="prose">
        Say you made three picks: <span className="mono">+150</span> (won),{" "}
        <span className="mono">&minus;200</span> (lost), <span className="mono">+300</span> (won).
        Every column below is worked out from exactly those three.
      </p>

      <dl className="terms">
        <dt>Expected</dt>
        <dd>
          Turn each price into a probability, then add them up. Sportsbooks pad their numbers,
          so the site strips that out first &mdash; <span className="mono">+150</span> shows as
          40% at the book but is really about <b>36%</b>, <span className="mono">&minus;200</span>{" "}
          is 67% listed and about <b>62%</b> real, <span className="mono">+300</span> is 25%
          listed and about <b>22%</b>.
          <div className="calc">0.36 + 0.62 + 0.22 = <b>1.21 expected hits</b></div>
        </dd>

        <dt>WAE &mdash; wins above expected</dt>
        <dd>
          What you actually hit, minus what you should have.
          <div className="calc">2 hits &minus; 1.21 expected = <b>+0.79</b></div>
          Nearly one win better than the market said those exact picks were worth. Had you gone
          2-1 on three heavy favourites instead, expected would be about 2.1 and you&apos;d be
          at <span className="mono">&minus;0.1</span> &mdash; same record, worse season.
        </dd>

        <dt>Signal</dt>
        <dd>
          How surprising that WAE really is. Three picks can&apos;t prove anything, and this
          column says so out loud.
          <div className="calc">+0.79 &divide; 0.80 spread of luck = <b>+1.0&sigma;</b></div>
          Under about 1.5 it stays greyed out. You&apos;d need roughly the same edge over
          thirty-odd picks before it starts meaning something.
        </dd>

        <dt>Units</dt>
        <dd>
          Flat $100 on every pick. A winner pays what the price says; a loser costs one unit.
          <div className="calc">+1.5 &nbsp;&minus;1.0 &nbsp;+3.0 = <b>+3.5 units</b>, or $350</div>
        </dd>

        <dt>Points</dt>
        <dd>
          The scoreboard, and the same idea as units on a bigger scale. A miss is always
          &minus;100.
          <div className="calc">+150 &rarr; 150 &nbsp;&middot;&nbsp; miss &rarr; &minus;100
          &nbsp;&middot;&nbsp; +300 &rarr; 300 &nbsp;=&nbsp; <b>350</b></div>
          Anything longer than <span className="mono">+600</span> is credited at +600, so one
          lucky lottery ticket in Week 3 can&apos;t decide the season.
        </dd>
      </dl>

      <h2 className="sec">A note on prices</h2>
      <p className="prose">
        You report your own price, and under this scoring the price is worth points to you.
        Take it from the same sportsbook every week and the commissioner can spot-check it.
        Prices can be corrected after the fact if something looks off.
      </p>

      <h2 className="sec">The honest caveat</h2>
      <p className="prose">
        Five players making two prop picks a week is about 170 picks across the whole pool
        in a season. That is a <em>small</em> sample. WAE is a much better measure than raw
        record, but it still won&apos;t settle who&apos;s genuinely best in one year. That&apos;s
        what the Signal column is there to keep everyone honest about.
      </p>
    </>
  );
}
