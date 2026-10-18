"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CHECKOUT_TOKEN_KEY, periodLabel, statusLabel } from "@/lib/billing-ui";
import { formatBRL } from "@/lib/format";
import type { BillingMe } from "@/lib/types";

export function AccountDrawer({
  billing,
  onClose,
  onLogout,
}: {
  billing: BillingMe | null;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function pay(slug: string) {
    setBusy(slug);
    setError("");
    try {
      const res = await api<{ init_point: string; checkout_token: string }>("/api/billing/create-checkout", {
        method: "POST",
        body: { plan_slug: slug },
      });
      localStorage.setItem(CHECKOUT_TOKEN_KEY, res.checkout_token);
      window.location.href = res.init_point;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível abrir o pagamento.");
      setBusy("");
    }
  }

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Conta">
        <div className="spread">
          <h2>Conta</h2>
          <button className="ghost" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
        <p>{statusLabel(billing) || "Carregando acesso…"}</p>
        <p className="hint">
          Cada pagamento libera o período do plano. Não há cobrança automática no mês seguinte.
        </p>
        <div className="stack">
          {(billing?.plans ?? []).map((plan) => (
            <article className="plan" key={plan.slug}>
              <span>{plan.name}</span>
              <strong>{formatBRL(plan.price_brl)}</strong>
              <span className="muted">Acesso por {periodLabel(plan.billing_interval)}</span>
              <button className="solid" type="button" disabled={busy === plan.slug} onClick={() => pay(plan.slug)}>
                {busy === plan.slug ? "Abrindo…" : "Pagar"}
              </button>
            </article>
          ))}
        </div>
        <p className="error">{error}</p>
        <button className="text-btn danger" type="button" onClick={onLogout}>
          Sair da conta
        </button>
      </aside>
    </div>
  );
}
