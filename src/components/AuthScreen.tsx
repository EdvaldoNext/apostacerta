"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

export function AuthScreen({ onAuth }: { onAuth: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: AuthUser }>(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        body: { email, password },
      });
      onAuth(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell auth">
      <section className="hero">
        <img className="hero-logo" src="/logo.jpg" alt="Aposta Certa" />
      </section>
      <section className="card">
        <p className="kicker">{mode === "signup" ? "Criar conta" : "Entrar"}</p>
        <h2>{mode === "signup" ? "Comece com e-mail e senha" : "Bem-vindo de volta"}</h2>
        <form onSubmit={submit}>
          <label>
            E-mail
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <p className="error">{error}</p>
          <button className="solid" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : mode === "signup" ? "Criar conta" : "Entrar"}
          </button>
        </form>
        <button className="text-btn" type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "Já tenho conta" : "Quero criar uma conta"}
        </button>
      </section>
    </main>
  );
}
