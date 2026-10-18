import type { BillingMe } from "./types";
import { formatTimestampBR } from "./format";

export const CHECKOUT_TOKEN_KEY = "apostacerta_checkout_token";

export function periodLabel(interval: string | null | undefined): string {
  return interval === "year" ? "12 meses" : "30 dias";
}

export function statusLabel(billing: BillingMe | null, now = Date.now()): string {
  if (!billing) return "";
  const sub = billing.subscription;
  if (!sub) return billing.isAdmin ? "Acesso de administrador" : "Sem acesso";
  if (sub.status === "pending") return "Aguardando pagamento";
  if (sub.status === "active" || sub.status === "past_due") {
    const until = sub.access_until ? Date.parse(sub.access_until) : NaN;
    if (Number.isNaN(until) || until <= now) return "Acesso encerrado";
    const prefix = sub.status === "past_due" ? "Tolerância até" : "Acesso até";
    return `${prefix} ${formatTimestampBR(sub.access_until as string)}`;
  }
  return "Sem acesso";
}
