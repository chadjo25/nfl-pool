/* app/layout.tsx */
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dick Picks 2026",
  description: "NFL pick'em against the spread, with props for bragging rights",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: profile } = user
    ? await db.from("profiles").select("display_name, is_admin").eq("id", user.id).maybeSingle()
    : { data: null };

  return (
    <html lang="en">
      <body>
        <header className="mast">
          <div className="wrap mast-inner">
            <Link href="/picks" className="brand">Dick Picks 2026</Link>
            <nav>
              <Link href="/picks">Picks</Link>
              <Link href="/standings">Standings</Link>
              {profile?.is_admin && <Link href="/admin">Grade</Link>}
              <Link href="/how">How</Link>
              {profile && <Link href="/account" className="me">{profile.display_name}</Link>}
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
