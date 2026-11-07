import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../env.js";
import { newId, nowIso, purgeExpiredSessions, type Database, type SessionRecord } from "../store.js";
import { randomToken, sha256 } from "./passwords.js";

export const SESSION_COOKIE = "nova_session";

function sign(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Creates a server-side session and returns the opaque cookie value. */
export function createSession(
  db: Database,
  userId: string,
  userAgent: string,
): { token: string; session: SessionRecord } {
  purgeExpiredSessions(db);
  const id = newId();
  const token = `${id}.${sign(id, env.sessionSecret)}`;
  const session: SessionRecord = {
    id,
    userId,
    tokenHash: sha256(token),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + env.sessionTtlMs).toISOString(),
    userAgent: userAgent.slice(0, 200),
  };
  db.sessions.set(id, session);
  return { token, session };
}

/**
 * Resolves a cookie value to a live session. Signature is verified before the
 * store is touched, so forged ids never reach a lookup.
 */
export function resolveSession(db: Database, token: string | undefined): SessionRecord | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const id = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(id, env.sessionSecret))) return null;

  const session = db.sessions.get(id);
  if (!session) return null;
  if (session.tokenHash !== sha256(token)) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    db.sessions.delete(id);
    return null;
  }
  return session;
}

export function destroySession(db: Database, token: string | undefined): void {
  const session = resolveSession(db, token);
  if (session) db.sessions.delete(session.id);
}

export function destroyUserSessions(db: Database, userId: string, exceptId?: string): void {
  for (const [id, session] of db.sessions) {
    if (session.userId === userId && session.id !== exceptId) db.sessions.delete(id);
  }
}

export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: env.sessionTtlMs,
    path: "/",
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
}

export { randomToken };
