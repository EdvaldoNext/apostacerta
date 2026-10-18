"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CHECKOUT_TOKEN_KEY } from "@/lib/billing-ui";
import type { AuthUser, BillingMe } from "@/lib/types";
import { AccountDrawer } from "./AccountDrawer";
import { AuthScreen } from "./AuthScreen";
import { Studio } from "./Studio";

export function AppShell() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  async function loadBilling() {
    const me = await api<BillingMe>("/api/billing/me");
    setBilling(me);
    return me;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("checkout");
    if (token) {
      localStorage.setItem(CHECKOUT_TOKEN_KEY, token);
      params.delete("checkout");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `/?${next}` : "/");
    }
    api<{ user: AuthUser | null }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) {
      setBilling(null);
      return;
    }
    let stopped = false;
    const token = localStorage.getItem(CHECKOUT_TOKEN_KEY);
    const refresh = () => loadBilling().catch(() => null);

    if (!token) {
      refresh();
      return;
    }

    let tries = 0;
    const tick = async () => {
      if (stopped || tries >= 8) return;
      tries += 1;
      try {
        await api("/api/billing/link-checkout", { method: "POST", body: { checkout_token: token } });
        const me = await refresh();
        if (me?.access) {
          localStorage.removeItem(CHECKOUT_TOKEN_KEY);
          return;
        }
      } catch {
        /* o webhook pode ainda nao ter chegado */
      }
      if (!stopped) window.setTimeout(tick, 4000);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [user]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setBilling(null);
    setAccountOpen(false);
  }

  if (user === undefined) {
    return (
      <main className="shell">
        <p className="muted">Abrindo a Aposta Certa…</p>
      </main>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <strong>Aposta Certa</strong>
          <span>{user.email}</span>
        </div>
        <div className="row">
          <button className="ghost" type="button" onClick={() => setAccountOpen(true)}>
            Conta
          </button>
          <button className="ghost" type="button" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <Studio
        access={Boolean(billing?.access)}
        onNeedAccess={() => setAccountOpen(true)}
      />
      {accountOpen && (
        <AccountDrawer billing={billing} onClose={() => setAccountOpen(false)} onLogout={logout} />
      )}
    </main>
  );
}
