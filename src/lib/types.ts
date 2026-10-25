import type { GameId } from "./games";

export interface Sorteio {
  jogo: GameId;
  numero: number;
  dataApuracao: string;
  dataProximo: string | null;
  estimativaProximo: number | null;
  dezenas: number[];
  dezenasSegundo: number[];
  trevos: number[];
  extra: string | null;
  acumulado: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface PlanInfo {
  slug: string;
  name: string;
  price_brl: number;
  billing_interval?: "month" | "year";
}

export type SubscriptionStatus = "pending" | "active" | "past_due" | "canceled" | "expired";

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  current_period_end: string | null;
  access_until: string | null;
  plan: PlanInfo | null;
}

export interface BillingMe {
  access: boolean;
  isAdmin: boolean;
  plan: PlanInfo | null;
  plans: PlanInfo[];
  subscription: SubscriptionInfo | null;
}

export interface BetView {
  numbers: number[];
  columns?: number[];
  trevos?: number[];
  mes?: string;
  time?: string;
  stats: { evens: number; odds: number; sum: number; primes?: number };
}

export interface SavedBet {
  id: string;
  jogo: string;
  quantidade: number;
  created_at: string;
  bets: BetView[];
  total: number;
  concurso: number | null;
}
