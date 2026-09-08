"use client";
/* app/login/LoginClient.tsx */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Magic link, with a typed-code fallback.
 *
 * The link alone fails for a predictable minority. Sign-in uses PKCE, which
 * stashes a verifier in the browser that asked for the link — so opening the
 * email on a different device, or in a mail app's built-in browser, means the
 * verifier isn't there and the exchange fails. Corporate mail scanners cause
 * the same symptom by fetching the link before the human does, spending the
 * one-time code.
 *
 * The six-digit code has neither problem: it's typed into the same browser
 * session that requested it, and a scanner can't consume it by visiting a URL.
 */
export default function LoginClient({ reason }: { reason: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "verifying" | "error">("idle");
  const [message, setMessage] = useState(reason ?? "");

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
    else { setState("sent"); setMessage(""); }
  }

  async function verify() {
    const token = code.replace(/\D/g, "");
    if (token.length < 6) {
      setState("error");
      setMessage("The code is six digits.");
      return;
    }
    setState("verifying");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) { setState("error"); setMessage(error.message); }
    else { router.push("/picks"); router.refresh(); }
  }

  return (
    <div className="login">
      <h1>Dick Picks 2026</h1>
      <p className="sub">NFL pick&apos;em &middot; sign in to make your picks</p>

      {state === "sent" ? (
        <>
          <p className="ok">Check {email} for your sign-in link.</p>
          <p className="loginhint">
            Tap the link and you&apos;re in. If it brings you back to this page instead,
            the email also contains a six-digit code — type it here.
          </p>
          <input
            type="text" inputMode="numeric" value={code} placeholder="123456"
            onChange={(e) => { setCode(e.target.value); setState("sent"); setMessage(""); }}
            onKeyDown={(e) => e.key === "Enter" && verify()}
          />
          <button className="btn" onClick={verify} disabled={state !== "sent" || !code}>
            Sign in with code
          </button>
          {message && <p className="err">{message}</p>}
          <p className="loginhint">
            <button className="link" onClick={() => { setState("idle"); setCode(""); setMessage(""); }}>
              Use a different email
            </button>
          </p>
        </>
      ) : (
        <>
          {message && <p className="err banner">{message}</p>}
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
        </>
      )}
    </div>
  );
}
