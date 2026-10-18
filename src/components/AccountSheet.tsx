"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { periodLabel, statusLabel } from "@/lib/billing-ui";
import { CHECKOUT_TOKEN_KEY } from "@/lib/billing-ui";
import { formatBRL } from "@/lib/format";
import type { BillingMe } from "@/lib/types";

export function AccountSheet({
  billing,
  onClose,
  onLogout,
}: {
  billing: BillingMe | null;
  onClose: () => void;
  onLogout: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

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
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="spread">
          <h2>Conta</h2>
          <button className="ghost" onClick={onClose}>Fechar</button>
        </div>
        <p>{statusLabel(billing) || "Carregando acesso…"}</p>
        <p className="hint">
          Pagamento único pelo Mercado Pago. Não há renovação automática. Um novo pagamento redefine o prazo.
        </p>
        <div className="plans">
          {(billing?.plans || []).map((plan) => (
            <button key={plan.slug} className="plan" disabled={Boolean(busy)} onClick={() => pay(plan.slug)}>
              <span className="muted">{plan.name}</span>
              <strong>{formatBRL(plan.price_brl)}</strong>
              <span>{periodLabel(plan.billing_interval)}</span>
            </button>
          ))}
        </div>
        {error && <p className="danger-text">{error}</p>}
        <button className="ghost" onClick={() => void onLogout()}>Sair</button>
      </div>
    </div>
  );
}
