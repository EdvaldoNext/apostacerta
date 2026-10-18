import {
  findSessionByPreference,
  findSessionByToken,
  findSubscriptionForSession,
  periodEndForPlan,
  type CheckoutSessionRow,
} from "@/server/billing";
import { db, isUniqueViolation, nowIso, uuid } from "@/server/db";
import { fail, json } from "@/server/http";
import { getPayment, verifyMpSignature, type MpPayment } from "@/server/mercadopago";

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return fail(500, "webhook_not_configured");

  let parsed: Record<string, unknown> = {};
  let bodyIsJson = false;
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
      bodyIsJson = true;
    }
  } catch {
    bodyIsJson = false;
  }

  const url = new URL(req.url);
  const bodyData = (parsed.data && typeof parsed.data === "object" ? parsed.data : {}) as Record<string, unknown>;
  const dataId = String(url.searchParams.get("data.id") ?? bodyData.id ?? "").trim();

  if (!verifyMpSignature(req.headers, dataId, secret)) return fail(401, "invalid_signature");

  const topic = String(parsed.type ?? parsed.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const action = String(parsed.action ?? "");
  const isPayment = topic === "payment" || action.startsWith("payment.");
  const eventId = dataId || req.headers.get("x-request-id") || "";
  if (!eventId) return fail(400, "missing_event_id");

  const dbEventRowId = uuid();
  try {
    await db().execute({
      sql: "INSERT INTO billing_events (id, mp_event_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [dbEventRowId, eventId, topic || action || "unknown", bodyIsJson ? raw : JSON.stringify({ raw: raw.slice(0, 2000) }), nowIso()],
    });
  } catch (error) {
    if (isUniqueViolation(error)) return json({ ok: true, duplicate: true });
    console.error("[webhook]", error);
    return fail(500, "internal_error");
  }

  const release = () =>
    db()
      .execute({ sql: "DELETE FROM billing_events WHERE id = ?", args: [dbEventRowId] })
      .catch((e) => console.error("[webhook] release", e));

  if (!isPayment || !dataId) return json({ ok: true, ignored: true });

  try {
    const payment = await getPayment(dataId);
    if (payment.status !== "approved") {
      await release();
      return json({ ok: true, ignored: true, payment_status: payment.status ?? null });
    }
    await activateApprovedPayment(payment);
    return json({ ok: true });
  } catch (error) {
    console.error("[webhook] pagamento", error);
    await release();
    return fail(500, "internal_error");
  }
}

async function activateApprovedPayment(payment: MpPayment): Promise<void> {
  const reference = payment.external_reference ? String(payment.external_reference) : "";
  const preferenceId = payment.preference_id ? String(payment.preference_id) : "";
  const now = nowIso();
  const tx = await db().transaction("write");
  try {
    let session: CheckoutSessionRow | null = reference ? await findSessionByToken(tx, reference) : null;
    if (!session && preferenceId) session = await findSessionByPreference(tx, preferenceId);
    if (!session) {
      await tx.rollback();
      return;
    }

    await tx.execute({
      sql: `UPDATE checkout_sessions
            SET status = CASE WHEN status = 'linked' THEN 'linked' ELSE 'paid' END, updated_at = ?
            WHERE id = ?`,
      args: [now, session.id],
    });

    const periodEnd = await periodEndForPlan(tx, session.plan_id);
    const sub = await findSubscriptionForSession(tx, session, preferenceId);
    if (sub) {
      await tx.execute({
        sql: `UPDATE subscriptions
              SET status = 'active', current_period_end = ?, checkout_session_id = ?, canceled_at = NULL, updated_at = ?
              WHERE id = ?`,
        args: [periodEnd, session.id, now, sub.id],
      });
    } else if (session.user_id) {
      const subId = uuid();
      await tx.execute({
        sql: `INSERT INTO subscriptions
                (id, user_id, plan_id, status, preference_id, checkout_session_id, current_period_end, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        args: [subId, session.user_id, session.plan_id, session.preference_id, session.id, periodEnd, now, now],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }
}
