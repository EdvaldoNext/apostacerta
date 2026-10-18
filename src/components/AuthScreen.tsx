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
        <div>
          <p className="kicker">Loterias da Caixa</p>
          <h1>Um volante para cada jogo. Uma conta para cada pessoa.</h1>
          <p className="muted">
            Mega-Sena, Lotofácil, Quina, Lotomania, Dupla Sena, Timemania, Dia de Sorte, Super Sete e +Milionária.
            O histórico fica só na sua conta.
          </p>
        </div>
        <div className="hero-list">
          <div>Surpresinha ou volante balanceado, com o preço da aposta na hora.</div>
          <div>Pagamento único de 30 dias ou 12 meses. Não renova sozinho.</div>
          <div>Simulador. Não vende aposta e não muda a chance de uma combinação.</div>
        </div>
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
