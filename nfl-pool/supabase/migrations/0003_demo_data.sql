-- ============================================================
-- DEMO DATA — fake games so you can click around before the
-- odds feed is connected.
--
-- Run this AFTER 0001 and 0002.
--
-- Dates are relative to when you run it, so the games are always
-- "this week." Safe to run more than once.
--
-- Season 2026, week 1. If you change SEASON_YEAR in Vercel,
-- find-and-replace 2026 here to match.
-- ============================================================

-- ---------- six fake games ----------
insert into games (id, season, week, home, away, kickoff, status) values
  ('demo-1', 2026, 1, 'Green Bay Packers',   'Chicago Bears',      now() + interval '2 days', 'scheduled'),
  ('demo-2', 2026, 1, 'Baltimore Ravens',    'Cincinnati Bengals', now() + interval '4 days', 'scheduled'),
  ('demo-3', 2026, 1, 'Houston Texans',      'Tennessee Titans',   now() + interval '4 days', 'scheduled'),
  ('demo-4', 2026, 1, 'Denver Broncos',      'Las Vegas Raiders',  now() + interval '4 days', 'scheduled'),
  ('demo-5', 2026, 1, 'San Francisco 49ers', 'Arizona Cardinals',  now() + interval '4 days', 'scheduled'),
  ('demo-6', 2026, 1, 'Kansas City Chiefs',  'Carolina Panthers',  now() + interval '5 days', 'scheduled')
on conflict (id) do update set
  kickoff = excluded.kickoff,
  status  = 'scheduled';

-- ---------- lines ----------
-- Two snapshots per game, so the closing-line and line-movement
-- code has something real to work with.
insert into line_snapshots
  (game_id, captured_at, home_spread, home_price, away_spread, away_price, book) values
  ('demo-1', now() - interval '2 days', -3.0, -110,  3.0, -110, 'demo'),
  ('demo-1', now() - interval '1 hour', -3.5, -108,  3.5, -112, 'demo'),
  ('demo-2', now() - interval '2 days', -2.0, -105,  2.0, -115, 'demo'),
  ('demo-2', now() - interval '1 hour', -2.5, -105,  2.5, -115, 'demo'),
  ('demo-3', now() - interval '2 days', -6.5, -110,  6.5, -110, 'demo'),
  ('demo-3', now() - interval '1 hour', -6.0, -110,  6.0, -110, 'demo'),
  ('demo-4', now() - interval '2 days', -1.0, -115,  1.0, -105, 'demo'),
  ('demo-4', now() - interval '1 hour', -1.5, -118,  1.5, -102, 'demo'),
  ('demo-5', now() - interval '2 days', -7.0, -108,  7.0, -112, 'demo'),
  ('demo-5', now() - interval '1 hour', -7.5, -105,  7.5, -115, 'demo'),
  ('demo-6', now() - interval '2 days', -9.0, -110,  9.0, -110, 'demo'),
  ('demo-6', now() - interval '1 hour', -9.5, -112,  9.5, -108, 'demo')
on conflict (game_id, captured_at) do nothing;

-- ---------- prop deadline ----------
-- Matches the first kickoff, so props are still open for picking.
insert into week_config (season, week, prop_deadline)
values (2026, 1, now() + interval '2 days')
on conflict (season, week) do update set prop_deadline = excluded.prop_deadline;

-- ---------- what did we just do ----------
select
  (select count(*) from games)          as games,
  (select count(*) from line_snapshots) as lines,
  (select count(*) from week_config)    as weeks;


-- ============================================================
-- CLEANUP — run these two lines on their own, later, when you're
-- ready for real games. Deleting a game removes its lines and any
-- picks against it automatically.
-- ============================================================
--
-- delete from games where id like 'demo-%';
-- delete from week_config where season = 2026 and week = 1;
