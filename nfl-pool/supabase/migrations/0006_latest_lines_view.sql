-- ============================================================
-- Fix: the picks page was fetching every snapshot for the week and
-- picking the newest per game in application code.
--
-- Supabase caps a query at 1000 rows. With hourly polling across a
-- full slate that window covers only the last ~60 polls, so any game
-- with fewer snapshots than the rest — one added late, or one the
-- feed skipped for a while — falls outside it and renders as
-- "no line" despite having plenty of data.
--
-- Let Postgres do the work instead. `distinct on` returns exactly one
-- row per game, so the result is 16 rows rather than thousands and the
-- cap can never be reached.
--
-- Safe to run more than once.
-- ============================================================

create or replace view latest_lines as
select distinct on (s.game_id)
  s.game_id,
  s.home_spread,
  s.home_price,
  s.away_spread,
  s.away_price,
  s.captured_at,
  s.book
from line_snapshots s
order by s.game_id, s.captured_at desc;

-- Makes both this view and `closing_lines` cheap as the table grows.
create index if not exists line_snapshots_game_time_idx
  on line_snapshots (game_id, captured_at desc);

-- Picks are queried per season now that they carry the column.
create index if not exists spread_picks_season_week_idx
  on spread_picks (season, week);
