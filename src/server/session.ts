import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/types";
import { db, nowIso, str } from "./db";
import { isProduction, jwtSecret } from "./env";
import { fail } from "./http";

export const SESSION_COOKIE = "apostacerta_session";
export const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 7 * 24 * 60 * 60;

export const MIN_PASSWORD_LENGTH = 8;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: string | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  if (!dummyHash) dummyHash = bcrypt.hashSync("apostacerta-dummy-password", 10);
  await bcrypt.compare(password, dummyHash);
}

async function signToken(userId: string, sessionId: string): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecret());
  return { token, expiresAt };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const sessionId = randomUUID();
  const { token, expiresAt } = await signToken(userId, sessionId);
  await db().execute({
    sql: "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [sessionId, userId, sha256Hex(token), expiresAt.toISOString(), nowIso()],
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    maxAge: 0,
  });
}

export interface Session {
  user: AuthUser;
  sessionId: string;
  token: string;
  issuedAt: number;
  viaBearer: boolean;
}

async function readToken(req: Request, allowBearer: boolean): Promise<{ token: string; viaBearer: boolean } | null> {
  if (allowBearer) {
    const header = req.headers.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return { token: match[1].trim(), viaBearer: true };
  }
  const jar = await cookies();
  const value = jar.get(SESSION_COOKIE)?.value;
  return value ? { token: value, viaBearer: false } : null;
}

export async function getSession(req: Request, opts: { allowBearer?: boolean } = {}): Promise<Session | null> {
  const found = await readToken(req, Boolean(opts.allowBearer));
  if (!found) return null;

  let sub: string;
  let sid: string;
  let iat: number;
  try {
    const { payload } = await jwtVerify(found.token, jwtSecret(), { algorithms: ["HS256"] });
    sub = String(payload.sub || "");
    sid = String(payload.sid || "");
    iat = Number(payload.iat || 0);
    if (!sub || !sid) return null;
  } catch {
    return null;
  }

  const result = await db().execute({
    sql: `SELECT s.id AS sid, s.user_id, s.token_hash, s.expires_at, u.email
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.id = ?`,
    args: [sid],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (str(row, "user_id") !== sub) return null;
  if (str(row, "token_hash") !== sha256Hex(found.token)) return null;
  if (Date.parse(str(row, "expires_at")) <= Date.now()) {
    await db().execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [sid] });
    return null;
  }

  return {
    user: { id: sub, email: str(row, "email") },
    sessionId: sid,
    token: found.token,
    issuedAt: iat,
    viaBearer: found.viaBearer,
  };
}

export async function renewSessionIfNeeded(session: Session): Promise<void> {
  if (session.viaBearer) return;
  const age = Math.floor(Date.now() / 1000) - session.issuedAt;
  if (age < RENEW_AFTER_SECONDS) return;

  const { token, expiresAt } = await signToken(session.user.id, session.sessionId);
  const result = await db().execute({
    sql: "UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ? AND token_hash = ?",
    args: [sha256Hex(token), expiresAt.toISOString(), session.sessionId, sha256Hex(session.token)],
  });
  if (result.rowsAffected > 0) await setSessionCookie(token, expiresAt);
}

export async function destroySession(sessionId: string): Promise<void> {
  await db().execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [sessionId] });
}

export async function requireSession(
  req: Request,
  opts: { allowBearer?: boolean } = {},
): Promise<Session | NextResponse> {
  const session = await getSession(req, opts);
  if (!session) return fail(401, "unauthorized", "Entre na sua conta para continuar.");
  return session;
}
