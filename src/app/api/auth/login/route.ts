import { asString, fail, json, normalizeEmail, readJson } from "@/server/http";
import { db, str } from "@/server/db";
import { burnPasswordCheck, createSession, setSessionCookie, verifyPassword } from "@/server/session";

const BAD = "E-mail ou senha incorretos.";

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail(400, "invalid_body");

  const email = normalizeEmail(body.email);
  const password = asString(body.password);
  if (!email || !password) return fail(401, "invalid_credentials", BAD);

  try {
    const result = await db().execute({
      sql: "SELECT id, email, password_hash FROM users WHERE email = ?",
      args: [email],
    });
    const row = result.rows[0];
    if (!row) {
      await burnPasswordCheck(password);
      return fail(401, "invalid_credentials", BAD);
    }
    const ok = await verifyPassword(password, str(row, "password_hash"));
    if (!ok) return fail(401, "invalid_credentials", BAD);

    const userId = str(row, "id");
    const { token, expiresAt } = await createSession(userId);
    await setSessionCookie(token, expiresAt);
    return json({ user: { id: userId, email: str(row, "email") } });
  } catch (error) {
    console.error("[login]", error);
    return fail(503, "database_unavailable", "Banco indisponível. Confira o token do Turso.");
  }
}
