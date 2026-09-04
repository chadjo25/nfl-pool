-- ============================================================
-- The Ledger — schema
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- people ----------
create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- New signups get a profile automatically.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- games ----------
create table games (
  id          text primary key,          -- provider event id
  season      int  not null,
  week        int  not null,
  home        text not null,
  away        text not null,
  kickoff     timestamptz not null,
  home_score  int,
  away_score  int,
  status      text not null default 'scheduled'
              check (status in ('scheduled','in_progress','final')),
  updated_at  timestamptz not null default now()
);
create index games_week_idx on games (season, week);
create index games_kickoff_idx on games (kickoff);

-- Every poll writes a row. Gives you line movement, an audit trail for
-- disputes, and the closing number that CLV is measured against.
create table line_snapshots (
  game_id     text not null references games on delete cascade,
  captured_at timestamptz not null default now(),
  home_spread numeric(4,1) not null,
  home_price  int          not null,
  away_spread numeric(4,1) not null,
  away_price  int          not null,
  book        text         not null default 'consensus',
  primary key (game_id, captured_at)
);

-- The closing line = last snapshot taken at or before kickoff.
create view closing_lines as
select distinct on (s.game_id)
  s.game_id, s.home_spread, s.home_price, s.away_spread, s.away_price, s.captured_at
from line_snapshots s
join games g on g.id = s.game_id
where s.captured_at <= g.kickoff
order by s.game_id, s.captured_at desc;

-- ---------- spread picks (fully automated) ----------
create table spread_picks (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles on delete cascade,
  game_id       text not null references games on delete cascade,
  side          text not null check (side in ('home','away')),

  -- Frozen at submit time. Never recomputed. This is what stops the
  -- "but the line moved" argument in December.
  locked_spread numeric(4,1) not null,
  locked_price  int          not null,

  created_at    timestamptz not null default now(),
  result        text check (result in ('win','loss','push')),
  graded_at     timestamptz,

  unique (profile_id, game_id)          -- one pick per game per person
);
create index spread_picks_profile_idx on spread_picks (profile_id);

-- ---------- prop picks (self-entered, hand-graded) ----------
create table prop_picks (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles on delete cascade,
  season      int  not null,
  week        int  not null,
  kind        text not null check (kind in ('td','prop')),

  label       text not null check (length(trim(label)) between 3 and 160),
  price       int  not null check (abs(price) >= 100),
  other_price int  check (other_price is null or abs(other_price) >= 100),
  proof_url   text,                      -- bet-slip screenshot

  created_at  timestamptz not null default now(),
  result      text check (result in ('win','loss','void')),
  graded_at   timestamptz,
  graded_by   uuid references profiles,
  note        text,                      -- commissioner's ruling, if contested

  unique (profile_id, season, week, kind)   -- one TD + one prop per week
);
create index prop_picks_week_idx on prop_picks (season, week);

-- ---------- deadlines ----------
-- Props lock at the first kickoff of the week. Spreads lock per game.
create table week_config (
  season          int not null,
  week            int not null,
  prop_deadline   timestamptz not null,
  primary key (season, week)
);

-- ---------- lock enforcement (defense in depth) ----------
-- Stable so Postgres caches it per statement instead of per row.
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function enforce_spread_lock()
returns trigger language plpgsql as $$
declare k timestamptz;
begin
  if is_admin() then return new; end if;   -- commissioner can always correct
  select kickoff into k from games where id = new.game_id;
  if k is null or now() >= k then
    raise exception 'Game % is locked', new.game_id using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger spread_picks_lock
  before insert or update of side, locked_spread, locked_price on spread_picks
  for each row execute function enforce_spread_lock();

create or replace function enforce_prop_lock()
returns trigger language plpgsql as $$
declare d timestamptz;
begin
  if is_admin() then return new; end if;
  select prop_deadline into d from week_config
   where season = new.season and week = new.week;
  if d is null or now() >= d then
    raise exception 'Week %/% props are locked', new.season, new.week using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger prop_picks_lock
  before insert or update of label, price, other_price on prop_picks
  for each row execute function enforce_prop_lock();
