"use client";

import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Access denied");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <section className="login-panel">
      <div className="login-panel-head">
        <LockKeyhole size={18} />
        <span>Operator access</span>
      </div>
      <form onSubmit={submit}>
        <input className="visually-hidden" name="username" autoComplete="username" value="volta-operator" readOnly tabIndex={-1} />
        <label htmlFor="access-code">Demo access code</label>
        <input
          id="access-code"
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button full-button" type="submit" disabled={busy || !code}>
          <span>{busy ? "Authorizing…" : "Enter control room"}</span>
          <ArrowRight size={17} />
        </button>
      </form>
      <p className="login-footnote">Single operator · 12 hour session · rate limited</p>
    </section>
  );
}
