"use server";
/* app/account/actions.ts */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Rename yourself. The RLS policy restricts this to your own row and blocks
 * any change to is_admin, so there's no way to promote yourself here.
 */
export async function updateDisplayName(name: string): Promise<Result> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) return { ok: false, error: "Name needs at least two characters" };
  if (trimmed.length > 30) return { ok: false, error: "Keep it under 30 characters" };

  const { error } = await db.from("profiles")
    .update({ display_name: trimmed }).eq("id", user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/standings");
  revalidatePath("/account");
  return { ok: true };
}
