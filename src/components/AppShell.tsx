"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { CHECKOUT_TOKEN_KEY } from "@/lib/billing-ui";
import type { AuthUser, BillingMe } from "@/lib/types";
import { AccountDrawer } from "./AccountDrawer";
import { AuthScreen } from "./AuthScreen";
import { ResultadosScreen } from "./ResultadosScreen";
import { Studio } from "./Studio";

export function AppShell() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function openAccount() {
    setMenuOpen(false);
    setHistoryOpen(false);
    setResultsOpen(false);
    setAccountOpen(true);
  }

  function openHistory() {
    setMenuOpen(false);
    setAccountOpen(false);
    setResultsOpen(false);
    setHistoryOpen(true);
  }

  function openResults() {
    setMenuOpen(false);
    setAccountOpen(false);
    setHistoryOpen(false);
    setResultsOpen(true);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setBilling(null);
    setAccountOpen(false);
    setHistoryOpen(false);
    setResultsOpen(false);
    setMenuOpen(false);
  }

  if (user === undefined) {
    return (
      <main className="shell boot">
        <img className="brand-mark brand-mark-lg" src="/logo.jpg" alt="Aposta Certa" width={96} height={96} />
        <p className="muted">Abrindo a Aposta Certa…</p>
      </main>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/logo.jpg" alt="" width={48} height={48} />
          <div className="brand-copy">
            <strong>Aposta Certa</strong>
          </div>
        </div>
        <div className="menu" ref={menuRef}>
          <button
            className="ghost menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="top-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="menu-icon" aria-hidden="true" />
            Menu
          </button>
          {menuOpen && (
            <div className="menu-panel" id="top-menu" role="menu">
              <button role="menuitem" type="button" onClick={openResults}>
                Resultados
              </button>
              <button role="menuitem" type="button" onClick={openHistory}>
                Histórico
              </button>
              <button role="menuitem" type="button" onClick={openAccount}>
                Conta
              </button>
              <button className="danger" role="menuitem" type="button" onClick={() => void logout()}>
                Sair
              </button>
            </div>
          )}
        </div>
      </header>
      <Studio
        access={Boolean(billing?.access)}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
        onNeedAccess={openAccount}
      />
      {accountOpen && (
        <AccountDrawer
          billing={billing}
          email={user.email}
          onClose={() => setAccountOpen(false)}
          onLogout={logout}
        />
      )}
      {resultsOpen && <ResultadosScreen onClose={() => setResultsOpen(false)} />}
    </main>
  );
}
