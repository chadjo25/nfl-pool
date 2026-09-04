# The Ledger

NFL pick'em for a small group. Spreads are fully automated; TD scorers and props
are self-entered by players and graded by the commissioner in about three
minutes a week.

**Stack:** Next.js 15 · Supabase (Postgres + magic-link auth) · Vercel.
**Cost:** $0/month at five players. Props being manual is what keeps it there —
player-prop feeds start around $99/month, game spreads are free.

---

## Setup

### 1. Supabase

Create a project, then run the two migrations in order from the SQL editor:

```
supabase/migrations/0001_schema.sql
supabase/migrations/0002_rls.sql
```

Under **Authentication → Providers**, enable Email and turn *off* "Confirm
email" (magic links already prove ownership).

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in the Supabase URL and both keys from **Project Settings → API**, then:

```bash
openssl rand -hex 32     # -> CRON_SECRET
```

`SEASON_WEEK_ONE` is the Tuesday before the season's first Thursday game. Every
week number in the app derives from that one date, so get it right.

### 3. Run

```bash
npm install
npm run dev
```

Sign in once, then promote yourself:

```sql
update profiles set is_admin = true where display_name = 'your-name';
```

### 4. Seed the first lines

```bash
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/ingest
```

If this returns games, you're live. If it 502s, see *Odds provider* below.

### 5. Deploy

Push to GitHub, import to Vercel, paste the same env vars in. `vercel.json`
registers both crons automatically. Set the Supabase **Site URL** to your
production domain or magic links will redirect to localhost.

---

## Odds provider

`lib/providers/odds-provider.ts` is written against The Odds API's v4 shape.
**Verify the base URL, auth style, and field names against your provider's
current docs before the first run** — vendors rename things, and I'd rather you
find out in five minutes than on a Sunday morning.

Everything vendor-specific is inside `mapResponse()`. Swapping providers means
rewriting that one function; nothing else in the codebase knows or cares.

Spreads only. Free tiers all cover this.

---

## How a week runs

| When | What | Who |
|---|---|---|
| Every 3h | Lines ingested, snapshot appended | cron |
| Any time before kickoff | Players pick spreads + enter TD/prop with a price | them |
| Each kickoff | That game's spread pick locks | database trigger |
| First kickoff of the week | Props lock | database trigger |
| Hourly | Finished games graded off ESPN | cron |
| Monday | Ten Hit/Miss/Void buttons at `/admin` | **you** |

That last row is the entire manual job.

---

## Scoring

Three categories ranked independently. Last place in each pays `WEEKLY_STAKE`.

**Spreads** — straight record, pushes count as half. CLV shown alongside:
the number you got measured against where the game closed. It registers on
every pick whether it wins or not, so it says something useful long before a
win-loss record does.

**TD scorers and props** — never ranked on bare record, because a 12-5 on
−200 favourites and a 12-5 on +300 dogs are not the same achievement.

- **Points** decide who pays. Default model is `capped`: payout units with
  credit ceilinged at +600. Uncapped payout is more familiar but degenerates —
  one +2000 hit erases a season, so by Week 8 nobody handicaps anymore.
- **WAE** (wins above expected) is the honest read on skill. Sum the vig-free
  probability of every pick; that's what the market says you should have hit.
- **Signal** is WAE in standard deviations. Below ~1.5, it's noise.
- **Units** is flat-stake profit at the price taken.

Change the model in one place: the `model` argument to `getStandings()`.

### De-vigging

WAE is built entirely on fair probability, and books load far more margin onto
longshots than favourites — roughly 7% on a −250 prop against 13% on a +1600
anytime-TD. Scoring off raw prices would punish exactly the risk-takers the
pool is trying to reward.

When both sides are posted, normalising the two implied probabilities is exact.
Anytime-TD markets rarely post the "no" side, so `estimatedHold()` in
`lib/odds.ts` approximates it. It's applied identically to everyone.

**Tell your players to fill the "other side" field when they can.** It's the
difference between exact and estimated.

---

## House rules worth settling before Week 1

**Name a book of record.** DraftKings, say. Under this scoring the price
someone reports is worth points to them — a new incentive your spreadsheet
never had. Require a bet-slip screenshot; the price field is editable by you at
`/admin`, and that's the whole enforcement mechanism.

**Missed picks.** Currently a missing prop simply doesn't score. If you'd
rather it cost −100, that's a filter change in `propMetrics`. Decide now,
apply it silently forever.

**No-repeat TD scorers.** Not implemented. If you want it — and it does add
real strategy, since burning Bijan in Week 4 means not having him in Week 15 —
add a partial unique index on `(profile_id, season, label)` where `kind = 'td'`.

**Odds floor.** Consider rejecting anything shorter than −400, or someone finds
a −2000 prop and grinds out risk-free points weekly.

---

## What you're giving up

No closing line value on props. CLV needs a snapshot of where the market
finished, and without a props feed there's nothing to snapshot. That's the real
cost of hand-grading, and it's the metric that stabilises fastest.

You keep CLV on spreads, which is fully automated — so your easiest category
ends up carrying your sharpest skill signal.

At five players you'll have ~170 prop picks in the pool per season. That's a
small sample no matter how good the metric is. Say so out loud in Week 1, so
the December arguments are about football rather than about the math.
