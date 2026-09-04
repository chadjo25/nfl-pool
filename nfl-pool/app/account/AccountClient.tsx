"use client";
/* app/account/AccountClient.tsx */

import { useState } from "react";
import { updateDisplayName } from "./actions";

export default function AccountClient({
  name, email, isAdmin,
}: { name: string; email: string; isAdmin: boolean }) {
  const [value, setValue] = useState(name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  // Anyone still carrying the part before the @ never set a name.
  const looksUnset = name === email.split("@")[0];

  async function save() {
    setStatus("saving");
    const res = await updateDisplayName(value);
    if (res.ok) { setStatus("saved"); setMessage(""); }
    else { setStatus("error"); setMessage(res.error); }
  }

  return (
    <>
      <div className="pagehead">
        <h1>Your account</h1>
        <span className="count">{isAdmin ? "Commissioner" : "Player"}</span>
      </div>

      {looksUnset && (
        <p className="allin" style={{ borderLeftColor: "var(--amber)" }}>
          You&apos;re showing up as <b>{name}</b> in the standings. Set a real name so
          everyone knows who you are.
        </p>
      )}

      <h2 className="sec">Display name</h2>
      <div className="propform">
        <input
          className="label" type="text" value={value} placeholder="Chad"
          onChange={(e) => { setValue(e.target.value); setStatus("idle"); }}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <span className="hintline">This is what appears on every leaderboard.</span>
        <div className="formfoot">
          <button className="btn" onClick={save}
            disabled={status === "saving" || value.trim().length < 2 || value === name}>
            {status === "saving" ? "Saving…" : "Save name"}
          </button>
          {status === "saved" && <span className="ok">Saved.</span>}
          {status === "error" && <span className="err">{message}</span>}
        </div>
      </div>

      <h2 className="sec">Sign-in email</h2>
      <p className="prose">
        <span className="mono">{email}</span> — this is where your sign-in links go.
        Ask the commissioner if you need it changed.
      </p>
    </>
  );
}
