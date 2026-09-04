"use client";
/* app/login/page.tsx */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Magic link only — nobody needs to remember a password for a pick'em pool.
 *
 * The name field matters more than it looks. Without it everyone shows up in
 * the standings as whatever precedes the @ in their email, which is fine for
 * five friends and useless once the pool grows. It's passed as signup
 * metadata, which the handle_new_user trigger reads when creating the profile.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send() {
    if (!email.includes("@")) {
      setState("error");
      setMessage("That doesn't look like an email address.");
      return;
    }
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        // Only applied when the account is created; ignored on later logins.
        data: name.trim() ? { display_name: name.trim() } : undefined,
      },
    });
    if (error) { setState("error"); setMessage(error.message); }
    else { setState("sent"); }
  }

  return (
    <div className="login">
      <h1>Dick Picks 2026</h1>
      <p className="sub">NFL pick&apos;em &middot; sign in to make your picks</p>

      {state === "sent" ? (
        <p className="ok">Check {email} for your sign-in link.</p>
      ) : (
        <>
          <input
            type="text" value={name} placeholder="Your name"
            onChange={(e) => { setName(e.target.value); setState("idle"); }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <input
            type="email" value={email} placeholder="you@example.com"
            onChange={(e) => { setEmail(e.target.value); setState("idle"); }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn" onClick={send} disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a link"}
          </button>
          <p className="loginhint">
            New here? Your name is how you&apos;ll show up in the standings.
            Signing back in? Just the email is fine.
          </p>
          {state === "error" && <p className="err">{message}</p>}
        </>
      )}
    </div>
  );
}
