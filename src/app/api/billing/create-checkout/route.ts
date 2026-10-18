import { getActivePlan } from "@/server/access";
import { CHECKOUT_SESSION_DAYS, findOpenSubscriptionByUser } from "@/server/billing";
import { addDaysIso, db, nowIso, uuid } from "@/server/db";
import { appUrl } from "@/server/env";
import { asString, fail, isValidEmail, json, normalizeEmail, readJson } from "@/server/http";
import { mpFetch } from "@/server/mercadopago";
import { requireSession } from "@/server/session";

interface MpPreference {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
}

export async function POST(req: Request) {
  const auth = await requireSession(req, { allowBearer: true });
  if (auth instanceof Response) return auth;

  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const plan = await getActivePlan(asString(body.plan_slug).trim());
  if (!plan) return fail(400, "invalid_plan", "Plano indisponível.");

  const payerEmail = normalizeEmail(body.payer_email) || auth.user.email;
  if (!payerEmail || !isValidEmail(payerEmail)) {
    return fail(400, "email_required", "Informe um e-mail para o pagamento.");
  }

  const checkoutToken = uuid();
  const base = appUrl();
  const backUrl = `${base}/?checkout=${checkoutToken}&tab=conta`;
  const span = plan.billing_interval === "year" ? "12 meses" : "30 dias";

  const preferenceBody: Record<string, unknown> = {
    items: [
      {
        id: plan.slug,
        title: `Aposta Certa — ${plan.name} (${span})`,
        description: `Acesso por ${span}`,
        quantity: 1,
        currency_id: "BRL",
        unit_price: plan.price_brl,
      },
    ],
    payer: { email: payerEmail },
    external_reference: checkoutToken,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    notification_url: `${base}/api/billing/mercadopago-webhook`,
    statement_descriptor: "APOSTACERTA",
    metadata: { checkout_token: checkoutToken, plan_slug: plan.slug, user_id: auth.user.id },
    payment_methods: { installments: 1 },
  };
  if (base.startsWith("https://")) preferenceBody.auto_return = "approved";

  let preference: MpPreference;
  try {
    preference = await mpFetch<MpPreference>("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(preferenceBody),
    });
  } catch (error) {
    console.error("[create-checkout]", error);
    return fail(502, "mercadopago_error", "Não foi possível abrir o pagamento agora.");
  }

  const initPoint = preference.init_point || preference.sandbox_init_point;
  const preferenceId = preference.id;
  if (!initPoint || !preferenceId) return fail(502, "mercadopago_error", "Não foi possível abrir o pagamento agora.");

  const now = nowIso();
  const sessionId = uuid();
  const tx = await db().transaction("write");
  try {
    await tx.execute({
      sql: `INSERT INTO checkout_sessions
              (id, token, plan_id, payer_email, preference_id, status, user_id, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      args: [sessionId, checkoutToken, plan.id, payerEmail, preferenceId, auth.user.id, addDaysIso(CHECKOUT_SESSION_DAYS), now, now],
    });

    const open = await findOpenSubscriptionByUser(tx, auth.user.id);
    let subscriptionId: string;
    if (open) {
      subscriptionId = open.id;
      if (open.status === "pending") {
        await tx.execute({
          sql: `UPDATE subscriptions
                SET plan_id = ?, status = 'pending', preference_id = ?, checkout_session_id = ?,
                    current_period_end = NULL, updated_at = ?
                WHERE id = ?`,
          args: [plan.id, preferenceId, sessionId, now, open.id],
        });
      } else {
        await tx.execute({
          sql: `UPDATE subscriptions
                SET plan_id = ?, preference_id = ?, checkout_session_id = ?, updated_at = ?
                WHERE id = ?`,
          args: [plan.id, preferenceId, sessionId, now, open.id],
        });
      }
    } else {
      subscriptionId = uuid();
      await tx.execute({
        sql: `INSERT INTO subscriptions
                (id, user_id, plan_id, status, preference_id, checkout_session_id, current_period_end, created_at, updated_at)
              VALUES (?, ?, ?, 'pending', ?, ?, NULL, ?, ?)`,
        args: [subscriptionId, auth.user.id, plan.id, preferenceId, sessionId, now, now],
      });
    }

    await tx.execute({
      sql: "UPDATE checkout_sessions SET subscription_id = ?, updated_at = ? WHERE id = ?",
      args: [subscriptionId, now, sessionId],
    });
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    console.error("[create-checkout] gravacao", error);
    return fail(500, "internal_error");
  } finally {
    tx.close();
  }

  return json({ init_point: initPoint, checkout_token: checkoutToken, preference_id: preferenceId });
}
