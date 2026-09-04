/* app/admin/page.tsx */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentSeason } from "@/lib/providers/odds-provider";
import GradeClient, { type Row, type WeekTab } from "./GradeClient";

export const dynamic = "force-dynamic";

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const db = await createClient();
  const season = currentSeason();
  const { data: { user } } = await db.auth.getUser();

  const { data: profile } = await db
    .from("profiles").select("is_admin").eq("id", user!.id).maybeSingle();
  if (!profile?.is_admin) redirect("/standings");

  // Every week that has picks, with how many are still outstanding.
  const { data: all } = await db
    .from("prop_picks").select("week, result").eq("season", season);

  const tally = new Map<number, WeekTab>();
  for (const r of all ?? []) {
    const tab = tally.get(r.week) ?? { week: r.week, total: 0, ungraded: 0 };
    tab.total++;
    if (!r.result) tab.ungraded++;
    tally.set(r.week, tab);
  }
  const weeks = [...tally.values()].sort((a, b) => a.week - b.week);

  // Default to the oldest week with outstanding picks — that's the work you
  // actually owe. Falls back to the newest week when everything is graded.
  const requested = Number(( await searchParams).week);
  const week =
    Number.isFinite(requested) && tally.has(requested)
      ? requested
      : weeks.find((w) => w.ungraded > 0)?.week ?? weeks.at(-1)?.week ?? 1;

  // Names are fetched separately rather than as an embedded join: prop_picks
  // has two foreign keys into profiles (profile_id and graded_by), so asking
  // for `profiles(display_name)` is ambiguous and PostgREST refuses it.
  const [picks, people, games] = await Promise.all([
    db.from("prop_picks")
      .select("id, profile_id, kind, label, price, other_price, proof_url, result, game_id")
      .eq("season", season).eq("week", week)
      .order("kind"),
    db.from("profiles").select("id, display_name"),
    db.from("games").select("id, home, away").eq("season", season).eq("week", week),
  ]);

  if (picks.error) {
    return (
      <>
        <div className="pagehead"><h1>Grade week {week}</h1></div>
        <p className="err banner">Couldn&apos;t load picks: {picks.error.message}</p>
      </>
    );
  }

  const names = new Map(
    (people.data ?? []).map((p) => [p.id as string, p.display_name as string])
  );
  const matchups = new Map(
    (games.data ?? []).map((g) => [g.id as string, `${g.away} @ ${g.home}`])
  );

  const rows: Row[] = (picks.data ?? []).map((r) => ({
    id: r.id,
    displayName: names.get(r.profile_id) ?? "Unknown",
    kind: r.kind as "td" | "prop",
    label: r.label,
    price: r.price,
    other_price: r.other_price,
    proof_url: r.proof_url,
    result: r.result as Row["result"],
    game: r.game_id ? matchups.get(r.game_id) ?? null : null,
  }));

  return <GradeClient rows={rows} week={week} season={season} weeks={weeks} />;
}
