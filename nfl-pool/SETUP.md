# Setup, assuming you've never done this before

No terminal. No installing anything. Everything below happens in a browser.

You'll make three free accounts. Here's what each one is actually for:

| Service | What it does | Think of it as |
|---|---|---|
| **GitHub** | Holds the files | A folder in the cloud |
| **Supabase** | Stores the picks and results | The database — this replaces your spreadsheet |
| **Vercel** | Turns the files into a real website | The web host |

Budget about an hour. Do Part 1 and 2 in one sitting; Part 3 can wait.

A note on screenshots: these dashboards get redesigned a few times a year, so
button labels may have shifted since this was written. The *sequence* won't
have changed — if a button isn't where I said, look for one with a similar
name nearby.

---

# Part 1 — The database

### 1.1 Make a Supabase project

Go to **supabase.com** → sign up → **New project**.

- Name it whatever you like
- **Save the database password it asks you to create.** Put it in your password
  manager now. You won't need it today, but you'll be miserable later if it's gone.
- Pick the region closest to you
- Click create, then wait ~2 minutes while it builds

### 1.2 Create the tables

In the left sidebar, click **SQL Editor**, then **New query**.

Open `supabase/migrations/0001_schema.sql` from the downloaded folder in any
text editor (Notepad, TextEdit, VS Code — anything). Select all, copy, paste
into the Supabase query box, click **Run**.

You want to see *Success. No rows returned.* That's what success looks like
here — it's not an error.

Now repeat, exactly the same way, with:

- `supabase/migrations/0002_rls.sql`
- `supabase/migrations/0003_demo_data.sql`

Three files, three separate runs, in that order. Order matters — the second
file refers to tables the first one creates.

> **If a file errors:** read the message for the phrase *already exists*. That
> means you ran it twice, which is harmless — move on. Any other error, stop
> and don't run the remaining files.

### 1.3 Turn off email confirmation

Sidebar → **Authentication** → **Providers** → **Email**.

Make sure Email is enabled, and turn **off** "Confirm email." You're using
magic links, which already prove someone owns the address, and leaving this on
sends your friends a pointless extra email.

### 1.4 Grab three values

Sidebar → **Project Settings** (gear icon) → **API**.

Copy these into a scratch document. You'll paste them into Vercel shortly.

| On the page | Save it as |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

The service_role key can do anything to your database with no restrictions.
Never paste it into a chat window, a public repo, or anywhere in the app's
front end. It only ever goes in Vercel's settings.

---

# Part 2 — Getting it online

### 2.1 Upload the files to GitHub

Go to **github.com** → sign up → **New repository**.

- Name: `nfl-pool`
- Set it to **Private**
- **Don't** check "Add a README" — the folder already has one
- Click create

On the next page, find the link that says **uploading an existing file**.

Now open your downloaded `nfl-pool` folder. Select *everything inside it* —
the `app` folder, the `lib` folder, `package.json`, all of it — and drag it
into the browser window.

Two things people get wrong here:

- **Drag the contents, not the folder itself.** `package.json` needs to land at
  the top level of the repo, not inside another `nfl-pool` folder.
- **Hidden files.** `.env.example` and `.gitignore` start with a dot, which
  means your computer hides them by default. On Mac press `Cmd+Shift+.` in
  Finder to reveal them; on Windows check "Hidden items" in the View tab.
  Neither file is required to make the app run, so if you can't find them,
  carry on.

Scroll down, click **Commit changes**.

### 2.2 Deploy on Vercel

Go to **vercel.com** → **Sign up with GitHub** (this saves you a linking step
later) → **Add New** → **Project**.

Find `nfl-pool` in the list and click **Import**.

**Don't click Deploy yet.** Expand the **Environment Variables** section first.
You need to add eight, one at a time — name on the left, value on the right:

```
NEXT_PUBLIC_SUPABASE_URL        (from step 1.4)
NEXT_PUBLIC_SUPABASE_ANON_KEY   (from step 1.4)
SUPABASE_SERVICE_ROLE_KEY       (from step 1.4)
SEASON_YEAR                     2026
SEASON_WEEK_ONE                 2026-09-08
ODDS_API_KEY                    leave blank for now
ODDS_API_BASE                   https://api.the-odds-api.com/v4
CRON_SECRET                     any long random string you make up
```

For `CRON_SECRET`, mash the keyboard — 30-odd characters of nonsense. It's a
password that stops strangers triggering your scheduled jobs. Nobody types it.

`SEASON_WEEK_ONE` must be the Tuesday before the season's first Thursday game.
Every week number in the app is calculated from that one date. It doesn't
matter for the demo data, but it matters in September.

Now click **Deploy**, and wait 2–3 minutes.

### 2.3 Point Supabase at your new address

Vercel gives you a URL like `nfl-pool-abc123.vercel.app`. Copy it.

Back in Supabase: **Authentication** → **URL Configuration** → set **Site URL**
to your Vercel address.

Skip this and your sign-in links will send everyone to a page that doesn't
exist. It's the single most common thing to forget.

### 2.4 Log in

Visit your Vercel URL. Enter your email, check your inbox, click the link.

You should land on a Week 1 picks page with six fake games. **Click some
spreads. Enter a fake touchdown scorer with a price like `+240`.** Watch the
fair-probability number appear as you type.

That's the app running. Everything from here is refinement.

### 2.5 Make yourself the commissioner

Back to Supabase → **SQL Editor** → **New query**:

```sql
update profiles set is_admin = true;
```

That promotes every account, which is correct right now because yours is the
only one. Run it before your friends sign up, not after.

Reload the site and **Grade** in the top nav will now work.

---

# Part 3 — Real games

Everything so far used fake data. This part swaps in the live NFL schedule and
real spreads.

### 3.1 Get an odds key

Sign up at **the-odds-api.com** for a free key. Their free tier doesn't
include NFL, so you'll need the paid plan — around $29/month — when the season
starts. You don't need it in August.

Cheaper alternatives exist (SharpAPI has a genuinely free NFL tier). Swapping
providers means changing one function in
`lib/providers/odds-provider.ts` — ask me and I'll do it.

### 3.2 Add the key

Vercel → your project → **Settings** → **Environment Variables** → edit
`ODDS_API_KEY` and paste it in.

**Then go to Deployments and click Redeploy.** Environment variables don't take
effect until you redeploy. This trips up everyone once.

### 3.3 Clear out the demo games

Supabase → SQL Editor:

```sql
delete from games where id like 'demo-%';
delete from week_config where season = 2026 and week = 1;
```

### 3.4 Check that real lines load

The line feed runs automatically every three hours, so just wait, then reload
the picks page.

If real games appear, you're finished. If the page is empty after four hours,
that's the odds provider — send me what you see and I'll fix the adapter.

---

# When something breaks

**Sign-in link goes to a broken page** → Site URL in Supabase (step 2.3).

**"Failed to compile" on Vercel** → the files probably landed nested inside an
extra folder. Check your GitHub repo: `package.json` should be visible on the
main page. If it's inside a `nfl-pool` folder, delete the repo and re-upload
the *contents*.

**Logged in but the page is blank** → the migrations didn't all run. Supabase →
**Table Editor** and confirm you see `profiles`, `games`, `spread_picks`,
`prop_picks`. If any are missing, re-run the migration files in order.

**"Grade" bounces me to standings** → you're not admin. Step 2.5.

**Picks won't save, says locked** → the demo kickoffs are relative to when you
ran `0003_demo_data.sql`. Run that file again to reset the clock.

**Changed a setting, nothing happened** → redeploy. Almost always redeploy.

---

# Adding your friends

Send them the URL. They enter their email, click their link, and they're in.
No passwords, no invitations, nothing for you to administer.

One catch: right now *anyone* who finds the URL can join. For five friends and
an unlisted address that's usually fine. If you'd rather lock it down, ask me
for the email allowlist — it's about ten lines.

Their display name defaults to whatever comes before the @ in their email.
To fix someone's:

```sql
update profiles set display_name = 'Duck' where display_name = 'dwhitmer';
```
