-- ============================================================
-- Lock of the week + tiebreaker guess
--
--   lock      one pick per week counts double, win or lose. A pushed
--             lock voids rather than doubling — the market was exactly
--             right, and twice nothing is still nothing.
--
--   tiebreak  total points in the last game of the week. Only consulted
--             when two players tie for worst record. Closest wins;
--             no guess submitted means you lose the tiebreak.
--
-- Safe to run more than once.
-- ============================================================

-- ---------- the lock flag ----------
alter table spread_picks
  add column if not exists is_lock boolean not null default false;

-- A unique index can't reach into `games` for the week, so denormalise it
-- onto the pick and keep it correct with a trigger.
alter table spread_picks add column if not exists season int;
alter table spread_picks add column if not exists week   int;

create or replace function set_pick_week()
returns trigger language plpgsql as $$
begin
  select g.season, g.week into new.season, new.week
    from games g where g.id = new.game_id;
  return new;
end $$;

drop trigger if exists spread_picks_week on spread_picks;
create trigger spread_picks_week
  before insert or update of game_id on spread_picks
  for each row execute function set_pick_week();

-- Backfill anything already in the table.
update spread_picks sp
   set season = g.season, week = g.week
  from games g
 where g.id = sp.game_id
   and (sp.season is null or sp.week is null);

-- One lock per player per week.
create unique index if not exists one_lock_per_week
  on spread_picks (profile_id, season, week) where is_lock;

-- ---------- tiebreaker guesses ----------
create table if not exists tiebreak_guesses (
  profile_id uuid not null references profiles on delete cascade,
  season     int  not null,
  week       int  not null,
  points     int  not null check (points between 0 and 200),
  created_at timestamptz not null default now(),
  primary key (profile_id, season, week)
);

alter table tiebreak_guesses enable row level security;

-- Same reveal rule as everything else: your own any time, everyone else's
-- once the game it refers to has started.
drop policy if exists "read tiebreaks" on tiebreak_guesses;
create policy "read tiebreaks" on tiebreak_guesses for select to authenticated
using (
  profile_id = auth.uid()
  or is_admin()
  or exists (
    select 1 from games g
    where g.season = tiebreak_guesses.season and g.week = tiebreak_guesses.week
    group by g.season, g.week
    having max(g.kickoff) <= now()
  )
);

drop policy if exists "write own tiebreak" on tiebreak_guesses;
create policy "write own tiebreak" on tiebreak_guesses for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists "update own tiebreak" on tiebreak_guesses;
create policy "update own tiebreak" on tiebreak_guesses for update to authenticated
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

-- Locks at the last kickoff of the week — the game being guessed.
create or replace function enforce_tiebreak_lock()
returns trigger language plpgsql as $$
declare last_kick timestamptz;
begin
  if is_admin() then return new; end if;
  select max(kickoff) into last_kick from games
   where season = new.season and week = new.week;
  if last_kick is null or now() >= last_kick then
    raise exception 'Tiebreaker is locked for week %', new.week
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists tiebreak_lock on tiebreak_guesses;
create trigger tiebreak_lock
  before insert or update of points on tiebreak_guesses
  for each row execute function enforce_tiebreak_lock();
