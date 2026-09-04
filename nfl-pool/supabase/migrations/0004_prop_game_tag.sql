-- ============================================================
-- Tag prop picks to a game.
--
-- The description stays free text — you still type "Bijan anytime TD".
-- You just also say which game it belongs to, and that one dropdown buys
-- per-game locking instead of one blunt weekly deadline.
--
--   tagged   -> locks at that game's kickoff, exactly like a spread pick
--   untagged -> falls back to Sunday 1pm ET, for things that span games
--               ("any defensive TD in the 1pm window")
--
-- Safe to run more than once.
-- ============================================================

alter table prop_picks
  add column if not exists game_id text references games on delete set null;

create index if not exists prop_picks_game_idx on prop_picks (game_id);

-- ---------- locking ----------
-- The column list on the trigger has to change, so drop and recreate.
drop trigger if exists prop_picks_lock on prop_picks;

create or replace function enforce_prop_lock()
returns trigger language plpgsql as $$
declare k timestamptz; d timestamptz;
begin
  if is_admin() then return new; end if;   -- commissioner can always correct

  -- Tagged to a game: same rule as spreads.
  if new.game_id is not null then
    select kickoff into k from games where id = new.game_id;
    if k is null then
      raise exception 'Unknown game %', new.game_id using errcode = 'check_violation';
    end if;
    if now() >= k then
      raise exception 'That game has already kicked off' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Untagged: the weekly fallback.
  select prop_deadline into d from week_config
   where season = new.season and week = new.week;
  if d is null or now() >= d then
    raise exception 'Props are locked for week %/%', new.season, new.week
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger prop_picks_lock
  before insert or update of label, price, other_price, game_id on prop_picks
  for each row execute function enforce_prop_lock();

-- ---------- visibility ----------
-- Reveal on the same schedule as the lock. Without this, a Monday-night prop
-- would become readable at Sunday 1pm — while it was still live.
drop policy if exists "read prop picks after deadline" on prop_picks;
create policy "read prop picks after deadline" on prop_picks for select to authenticated
using (
  profile_id = auth.uid()
  or is_admin()
  or (
    game_id is not null
    and exists (
      select 1 from games g
      where g.id = prop_picks.game_id and now() >= g.kickoff
    )
  )
  or (
    game_id is null
    and exists (
      select 1 from week_config w
      where w.season = prop_picks.season and w.week = prop_picks.week
        and now() >= w.prop_deadline
    )
  )
);
