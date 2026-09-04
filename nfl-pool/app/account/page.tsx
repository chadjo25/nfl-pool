/* app/account/page.tsx */
import { createClient } from "@/lib/supabase/server";
import AccountClient from "./AccountClient";

export const dynamic = "force-dynamic";

export default async function Account() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: profile } = await db
    .from("profiles").select("display_name, is_admin").eq("id", user!.id).maybeSingle();

  return (
    <AccountClient
      name={profile?.display_name ?? ""}
      email={user?.email ?? ""}
      isAdmin={Boolean(profile?.is_admin)}
    />
  );
}
