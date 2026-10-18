import type { Client, Row } from "@libsql/client";
import { addDaysIso, addMonthsIso, str, strOrNull } from "./db";

export const PERIOD_DAYS = 30;
export const PERIOD_MONTHS_YEAR = 12;
export const CHECKOUT_SESSION_DAYS = 7;

export type Executor = { execute: Client["execute"] };

export interface CheckoutSessionRow {
  id: string;
  token: string;
  plan_id: string;
  preference_id: string | null;
  status: "pending" | "paid" | "expired" | "linked";
  user_id: string | null;
  subscription_id: string | null;
}

export interface SubscriptionRow {
  id: string;
  user_id: string | null;
  status: string;
  preference_id: string | null;
}

function toSession(row: Row): CheckoutSessionRow {
  return {
    id: str(row, "id"),
    token: str(row, "token"),
    plan_id: str(row, "plan_id"),
    preference_id: strOrNull(row, "preference_id"),
    status: str(row, "status") as CheckoutSessionRow["status"],
    user_id: strOrNull(row, "user_id"),
    subscription_id: strOrNull(row, "subscription_id"),
  };
}

function toSubscription(row: Row): SubscriptionRow {
  return {
    id: str(row, "id"),
    user_id: strOrNull(row, "user_id"),
    status: str(row, "status"),
    preference_id: strOrNull(row, "preference_id"),
  };
}

const SESSION_COLS = "id, token, plan_id, preference_id, status, user_id, subscription_id";
const SUB_COLS = "id, user_id, status, preference_id";

export async function findSessionByToken(ex: Executor, token: string): Promise<CheckoutSessionRow | null> {
  const r = await ex.execute({ sql: `SELECT ${SESSION_COLS} FROM checkout_sessions WHERE token = ?`, args: [token] });
  return r.rows[0] ? toSession(r.rows[0]) : null;
}

export async function findSessionByPreference(ex: Executor, preferenceId: string): Promise<CheckoutSessionRow | null> {
  const r = await ex.execute({
    sql: `SELECT ${SESSION_COLS} FROM checkout_sessions WHERE preference_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [preferenceId],
  });
  return r.rows[0] ? toSession(r.rows[0]) : null;
}

export async function findSubscriptionById(ex: Executor, id: string): Promise<SubscriptionRow | null> {
  const r = await ex.execute({ sql: `SELECT ${SUB_COLS} FROM subscriptions WHERE id = ?`, args: [id] });
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

export async function findOpenSubscriptionByUser(ex: Executor, userId: string): Promise<SubscriptionRow | null> {
  const r = await ex.execute({
    sql: `SELECT ${SUB_COLS} FROM subscriptions
          WHERE user_id = ? AND status IN ('pending', 'active', 'past_due')
          ORDER BY created_at DESC LIMIT 1`,
    args: [userId],
  });
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

export async function findSubscriptionByPreference(ex: Executor, preferenceId: string): Promise<SubscriptionRow | null> {
  const r = await ex.execute({
    sql: `SELECT ${SUB_COLS} FROM subscriptions WHERE preference_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [preferenceId],
  });
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

export async function periodEndForPlan(ex: Executor, planId: string, from: Date = new Date()): Promise<string> {
  const r = await ex.execute({
    sql: "SELECT billing_interval FROM plans WHERE id = ?",
    args: [planId],
  });
  const interval = r.rows[0] ? String(r.rows[0].billing_interval) : "month";
  return interval === "year" ? addMonthsIso(PERIOD_MONTHS_YEAR, from) : addDaysIso(PERIOD_DAYS, from);
}

const OPEN = new Set(["pending", "active", "past_due"]);

export async function findSubscriptionForSession(
  ex: Executor,
  session: CheckoutSessionRow,
  paymentPreferenceId?: string | null,
): Promise<SubscriptionRow | null> {
  const byId = session.subscription_id ? await findSubscriptionById(ex, session.subscription_id) : null;
  if (byId && OPEN.has(byId.status)) return byId;

  const byUser = session.user_id ? await findOpenSubscriptionByUser(ex, session.user_id) : null;
  if (byUser) return byUser;

  if (byId) return byId;

  const pref = session.preference_id || paymentPreferenceId;
  return pref ? findSubscriptionByPreference(ex, pref) : null;
}
