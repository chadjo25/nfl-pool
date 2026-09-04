"use server";
/* app/admin/actions.ts */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAmerican } from "@/lib/odds";

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: profile } = await db
    .from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  return profile?.is_admin ? { db, user } : null;
}

/** The Monday button pass. This is the whole manual job. */
export async function gradeProp(
  pickId: string,
  result: "win" | "loss" | "void",
  note?: string
): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Commissioner only" };

  const { error } = await session.db.from("prop_picks").update({
    result,
    graded_at: new Date().toISOString(),
    graded_by: session.user.id,
    note: note?.trim() || null,
  }).eq("id", pickId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  revalidatePath("/standings");
  return { ok: true };
}

/**
 * Correct a reported price.
 *
 * The enforcement mechanism behind "name a book of record". If a screenshot
 * doesn't match what was typed, fix it here — the lock trigger exempts
 * admins so this works after the deadline.
 */
export async function correctPrice(
  pickId: string,
  price: string,
  otherPrice: string
): Promise<Result> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Commissioner only" };

  const parsed = parseAmerican(price);
  if (parsed === null) return { ok: false, error: "Price must be American odds" };
  const other = otherPrice.trim() ? parseAmerican(otherPrice) : null;
  if (otherPrice.trim() && other === null) {
    return { ok: false, error: "Other side isn't valid American odds" };
  }

  const { error } = await session.db.from("prop_picks")
    .update({ price: parsed, other_price: other }).eq("id", pickId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  revalidatePath("/standings");
  return { ok: true };
}
