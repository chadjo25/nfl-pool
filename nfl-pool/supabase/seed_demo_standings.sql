-- ============================================================
-- TEMPORARY SEED DATA — for eyeballing the standings layout.
--
-- Creates three finished weeks (15, 16, 17) so the week-by-week
-- grid, CLV column and prop tables all have something in them.
-- Deliberately uses weeks 15-17 and 'seed-' ids so it can't collide
-- with your real Week 1 games or affect the picks page.
--
-- DELETE IT WHEN YOU'RE DONE — the cleanup block is at the bottom.
-- Do not leave this in place once real picks start.
-- ============================================================

-- ---------- finished games ----------
insert into games (id, season, week, home, away, kickoff, home_score, away_score, status) values
  ('seed-15-1', 2026, 15, 'Buffalo Bills',      'New York Jets',      now() - interval '22 days', 27, 17, 'final'),
  ('seed-15-2', 2026, 15, 'Dallas Cowboys',     'Philadelphia Eagles',now() - interval '22 days', 20, 24, 'final'),
  ('seed-15-3', 2026, 15, 'Seattle Seahawks',   'Los Angeles Rams',   now() - interval '21 days', 13, 10, 'final'),
  ('seed-16-1', 2026, 16, 'Green Bay Packers',  'Detroit Lions',      now() - interval '15 days', 31, 28, 'final'),
  ('seed-16-2', 2026, 16, 'Baltimore Ravens',   'Cleveland Browns',   now() - interval '15 days', 17, 21, 'final'),
  ('seed-16-3', 2026, 16, 'Tampa Bay Buccaneers','New Orleans Saints',now() - interval '14 days', 24, 14, 'final'),
  ('seed-17-1', 2026, 17, 'Kansas City Chiefs', 'Los Angeles Chargers',now() - interval '8 days', 30, 27, 'final'),
  ('seed-17-2', 2026, 17, 'Minnesota Vikings',  'Chicago Bears',      now() - interval '8 days', 14, 20, 'final'),
  ('seed-17-3', 2026, 17, 'Houston Texans',     'Indianapolis Colts', now() - interval '7 days', 23, 23, 'final')
on conflict (id) do nothing;

-- ---------- lines, so CLV has something to measure ----------
-- An opening number and a closing one, three days apart.
insert into line_snapshots (game_id, captured_at, home_spread, home_price, away_spread, away_price, book)
select id, kickoff - interval '3 days', -3.5, -110, 3.5, -110, 'seed'
from games where id like 'seed-%'
union all
select id, kickoff - interval '1 hour', -4.5, -110, 4.5, -110, 'seed'
from games where id like 'seed-%'
on conflict (game_id, captured_at) do nothing;

-- ---------- spread picks for everyone who has an account ----------
-- The lock trigger refuses picks on games that already kicked off, which is
-- exactly what it's for. Turn it off just long enough to backfill.
alter table spread_picks disable trigger spread_picks_lock;

insert into spread_picks (profile_id, game_id, side, locked_spread, locked_price, result, graded_at)
select
  p.id,
  g.id,
  case when get_byte(decode(md5(p.id::text || g.id), 'hex'), 0) % 2 = 0 then 'home' else 'away' end,
  case when get_byte(decode(md5(p.id::text || g.id), 'hex'), 0) % 2 = 0 then -3.5 else 3.5 end,
  -110,
  case
    when get_byte(decode(md5(p.id::text || g.id || 'result'), 'hex'), 1) % 100 < 48 then 'win'
    when get_byte(decode(md5(p.id::text || g.id || 'result'), 'hex'), 1) % 100 < 96 then 'loss'
    else 'push'
  end,
  now()
from profiles p
cross join games g
where g.id like 'seed-%'
on conflict (profile_id, game_id) do nothing;

alter table spread_picks enable trigger spread_picks_lock;

-- ---------- prop picks ----------
alter table prop_picks disable trigger prop_picks_lock;

insert into prop_picks (profile_id, season, week, kind, label, price, result, graded_at)
select
  p.id, 2026, w.week, k.kind,
  case k.kind when 'td' then 'Seed touchdown scorer' else 'Seed prop of the week' end,
  -- a mix of chalk and dogs, so WAE and Expected diverge visibly
  case get_byte(decode(md5(p.id::text || w.week::text || k.kind), 'hex'), 0) % 4
    when 0 then -180 when 1 then 130 when 2 then 240 else 420 end,
  case when get_byte(decode(md5(p.id::text || w.week::text || k.kind || 'r'), 'hex'), 1) % 100 < 38
    then 'win' else 'loss' end,
  now()
from profiles p
cross join (values (15), (16), (17)) as w(week)
cross join (values ('td'), ('prop')) as k(kind)
on conflict (profile_id, season, week, kind) do nothing;

alter table prop_picks enable trigger prop_picks_lock;

-- ---------- what landed ----------
select
  (select count(*) from games where id like 'seed-%')                   as seed_games,
  (select count(*) from spread_picks sp join games g on g.id = sp.game_id
     where g.id like 'seed-%')                                          as seed_spread_picks,
  (select count(*) from prop_picks where label like 'Seed %')           as seed_prop_picks,
  (select count(*) from profiles)                                       as players;


-- ============================================================
-- CLEANUP — run these two lines on their own when you're done.
-- Deleting the games removes their lines and spread picks too.
-- ============================================================
--
-- delete from prop_picks where label like 'Seed %';
-- delete from games where id like 'seed-%';
