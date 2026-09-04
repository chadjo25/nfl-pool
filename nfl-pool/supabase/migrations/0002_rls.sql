-- ============================================================
-- Row-level security
--
-- The load-bearing rule: you see your own picks whenever you like,
-- and everyone else's only once they're locked. This is what makes
-- "did you look at my picks first" structurally impossible rather
-- than a matter of trust.
--
-- Safe to run more than once. Every policy is dropped before it's
-- recreated, so re-running this file just resets permissions to a
-- known-good state.
-- ============================================================

alter table profiles       enable row level security;
alter table games          enable row level security;
alter table line_snapshots enable row level security;
alter table week_config    enable row level security;
alter table spread_picks   enable row level security;
alter table prop_picks     enable row level security;

-- ---------- public reference data ----------
drop policy if exists "read games" on games;
create policy "read games" on games for select to authenticated using (true);

drop policy if exists "read lines" on line_snapshots;
create policy "read lines" on line_snapshots for select to authenticated using (true);

drop policy if exists "read weeks" on week_config;
create policy "read weeks" on week_config for select to authenticated using (true);

drop policy if exists "read profiles" on profiles;
create policy "read profiles" on profiles for select to authenticated using (true);
drop policy if exists "update own name" on profiles;
create policy "update own name" on profiles       for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select is_admin from profiles where id = auth.uid()));

-- ---------- spread picks ----------
drop policy if exists "read spread picks after kickoff" on spread_picks;
create policy "read spread picks after kickoff" on spread_picks for select to authenticated
using (
  profile_id = auth.uid()
  or is_admin()
  or exists (select 1 from games g where g.id = game_id and now() >= g.kickoff)
);

drop policy if exists "insert own spread picks" on spread_picks;
create policy "insert own spread picks" on spread_picks for insert to authenticated
with check (profile_id = auth.uid() or is_admin());

drop policy if exists "update own spread picks" on spread_picks;
create policy "update own spread picks" on spread_picks for update to authenticated
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

drop policy if exists "delete own spread picks" on spread_picks;
create policy "delete own spread picks" on spread_picks for delete to authenticated
using (profile_id = auth.uid() or is_admin());

-- ---------- prop picks ----------
drop policy if exists "read prop picks after deadline" on prop_picks;
create policy "read prop picks after deadline" on prop_picks for select to authenticated
using (
  profile_id = auth.uid()
  or is_admin()
  or exists (
    select 1 from week_config w
    where w.season = prop_picks.season and w.week = prop_picks.week
      and now() >= w.prop_deadline
  )
);

drop policy if exists "insert own prop picks" on prop_picks;
create policy "insert own prop picks" on prop_picks for insert to authenticated
with check (profile_id = auth.uid());

-- Players edit their own picks up to the deadline (the trigger enforces
-- the deadline). Admins update anything — that's the grading path.
drop policy if exists "update prop picks" on prop_picks;
create policy "update prop picks" on prop_picks for update to authenticated
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

drop policy if exists "delete own prop picks" on prop_picks;
create policy "delete own prop picks" on prop_picks for delete to authenticated
using (profile_id = auth.uid() or is_admin());

-- ---------- bet-slip screenshots ----------
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

drop policy if exists "upload own proof" on storage.objects;
create policy "upload own proof" on storage.objects for insert to authenticated
with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "read proofs" on storage.objects;
create policy "read proofs" on storage.objects for select to authenticated
using (bucket_id = 'proofs');
